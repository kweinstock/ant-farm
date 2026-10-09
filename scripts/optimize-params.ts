// Parameter optimization via a genetic algorithm: a population of candidate
// parameter sets is scored by fitness (colony survival, see below), the
// best breed and mutate into the next generation, repeat. "Genetic
// algorithm" is the name for the "several parameters tested and mutated"
// technique this was asked for — a population of candidates, evaluated by a
// fitness function, evolved by selection + crossover + mutation across
// generations. (If a different search — grid search, random search,
// Bayesian optimization/Optuna-style — was actually meant, this file is the
// place to swap the evolve loop out; SEARCH_SPACE and evaluateGenome below
// don't care which search strategy drives them.)
//
// FITNESS = longest survival, then most ants: candidates are ranked
// LEXICOGRAPHICALLY, not by a blended score — mean ticks survived first
// (ties are common and expected once several candidates survive the full
// window), mean average population as the tiebreak. See ga-core.ts's
// makeCompareTrials.
//
// HOW THIS ACTUALLY MUTATES PARAMETERS: src/sim/params.ts holds plain
// module-level constants, imported directly all over the codebase
// (queen.ts, workforce.ts, surface.ts, ...) — there's no runtime injection
// point to swap them through. So this script temporarily REWRITES
// src/sim/params.ts on disk for each candidate, then spawns
// trial-runner.ts as a brand-new child process to evaluate it (a fresh
// process is the only way every one of those imports is guaranteed to
// re-read the current file — see trial-runner.ts's header for why an
// in-process cache-busted re-import doesn't work).
//
// params.ts ends the run holding the BEST genome found, applied
// automatically — that's what was asked for, not just a printout. A
// `.params-backup.ts` snapshot of what params.ts held BEFORE this script
// touched it is written alongside it and left there (not auto-deleted) so
// the pre-optimization values are always one `cp` away:
//   cp src/sim/.params-backup.ts src/sim/params.ts
// If the run is interrupted (Ctrl+C) or errors out partway, params.ts is
// restored to that original content instead — only a clean full run ends
// with the best genome applied.
//
// Because every trial mutates the same on-disk file, trials in THIS script
// CANNOT run concurrently — each one must finish (or be killed) before the
// next candidate's values are written. For real parallelism (each trial
// against its own isolated copy of src/sim, no shared file to collide on),
// use optimize-params-parallel.ts instead — same search space and fitness
// (both live in ga-core.ts), just a worker pool instead of one process at
// a time.
//
// Run `npm run optimize-params -- --help` (or `-h`) for the full flag list.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { QUEEN_MAX_LIFESPAN_TICKS } from "../src/sim/params";
import {
    SEARCH_SPACE,
    type Genome,
    type TrialOutput,
    type Scored,
    type FlagSpec,
    randomGenome,
    mutate,
    crossover,
    applyGenome,
    readGenomeFromText,
    seedGenerationFromBest,
    makeCompareTrials,
    tournamentSelect,
    formatTrial,
    printGenomeTable,
    printSearchSpaceTable,
    printTable,
    formatDuration,
    parseArgs,
    MIN_BIRTHS_TO_COUNT_AS_A_COLONY,
    MAX_POPULATION_OVERSHOOT,
} from "./ga-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARAMS_PATH = path.resolve(__dirname, "../src/sim/params.ts");
const BACKUP_PATH = path.resolve(__dirname, "../src/sim/.params-backup.ts");
const TRIAL_RUNNER_PATH = path.resolve(__dirname, "./trial-runner.ts");
// Invoke tsx's CLI directly via `node <cli.mjs> <script>` rather than going
// through `npx tsx` — no shell needed (avoids the Windows "npx is a .cmd
// shim" ENOENT and Node's arg-escaping shell warning), and no PATH lookup.
const TSX_CLI_PATH = createRequire(import.meta.url).resolve("tsx/cli");

const ARGS = parseArgs(process.argv.slice(2));

// One source of truth for every flag this script reads, so --help can never
// drift out of sync with what option() actually does. `flag` is already
// hyphen/case-normalized the same way parseArgs normalizes what it parses.
const FLAGS: FlagSpec[] = [
    { flag: "popsize", env: "POP_SIZE", default: "16", help: "GA population size (candidates per generation)" },
    { flag: "generations", env: "GENERATIONS", default: "8", help: "number of generations to evolve" },
    { flag: "mutationrate", env: "MUTATION_RATE", default: "0.3", help: "per-gene chance a gene mutates when breeding (0-1)" },
    { flag: "mutationstrength", env: "MUTATION_STRENGTH", default: "0.25", help: "mutation size, as a fraction of each param's own [min,max] range" },
    // 12345 is the seed actually in use (print-sim.ts's default) — that's
    // the trajectory that matters, not an arbitrary sample.
    { flag: "seeds", env: "TRIAL_SEEDS", default: "12345", help: "comma-separated RNG seeds each trial's fitness is averaged over (forwarded to trial-runner.ts)" },
    // Defaults to the queen's own max lifespan: "the colony survives" means
    // "it makes it through one queen's natural life without collapsing" —
    // there's no queen-succession mechanic yet (colony/caste.ts is a stub),
    // so a run that outlasts her is already the ceiling this sim can prove.
    { flag: "maxticks", env: "TRIAL_MAX_TICKS", default: String(QUEEN_MAX_LIFESPAN_TICKS + 20000), help: "tick cap per seed — surviving to this point counts as \"survived the full window\" (forwarded to trial-runner.ts). Defaults to QUEEN_MAX_LIFESPAN_TICKS." },
    { flag: "targetpop", env: "TARGET_AVG_POPULATION", default: "30", help: "average population a trial is scored against — closer wins, not just \"more\" (a boom that overshoots the food supply isn't healthier than a steady colony)" },
    { flag: "seedcurrent", env: "SEED_FROM_CURRENT", default: "true", help: "include params.ts's current genome as a starting member of generation 1 instead of starting fully random — set to false to explore from scratch" },
];

// CLI flag, then env var, then default — in that order.
function option(spec: FlagSpec): string {
    return ARGS.get(spec.flag) ?? process.env[spec.env] ?? spec.default;
}

function printHelp(): void {
    console.log("Search src/sim/params.ts for a colony that actually reproduces, survives longest (a queen's own lifespan by default), then holds population closest to --targetpop, via a genetic algorithm.");
    console.log("params.ts is left holding the best genome found when the run completes cleanly.\n");
    console.log("Usage:");
    console.log("  npm run optimize-params -- [flags]      (the -- forwards flags to the script instead of npm eating them)");
    console.log("  npx tsx scripts/optimize-params.ts [flags]\n");
    console.log("For real parallelism, use optimize-params-parallel.ts instead (same flags, plus --workers).\n");
    console.log("Flags:");
    printTable([
        ["--help, -h", "", "", "show this help and exit"],
        ...FLAGS.map((f) => [`--${f.flag}`, `env ${f.env}`, `default ${f.default}`, f.help]),
    ]);
    console.log("\nExamples:");
    console.log("  npm run optimize-params -- --popsize 12 --generations 10");
    console.log("  npm run optimize-params -- --seeds 2,3,11,13,4001 --max-ticks 8000\n");
    console.log(`Search space tuned (${SEARCH_SPACE.length} params): ${SEARCH_SPACE.map((s) => s.name).join(", ")}`);
    console.log("(To add or remove which params get tuned, edit SEARCH_SPACE in ga-core.ts.)");
}

if (ARGS.has("help")) {
    printHelp();
    process.exit(0);
}

// ---- GA knobs ----
const POP_SIZE = Number(option(FLAGS[0]));
const GENERATIONS = Number(option(FLAGS[1]));
const ELITISM = Math.min(2, POP_SIZE - 1);
const MUTATION_RATE = Number(option(FLAGS[2]));
const MUTATION_STRENGTH = Number(option(FLAGS[3]));
const TARGET_AVG_POPULATION = Number(option(FLAGS[6]));
const TOURNAMENT_SIZE = 3;
const compareTrials = makeCompareTrials(TARGET_AVG_POPULATION);

// trial-runner.ts is a separate process and reads its own settings from
// TRIAL_SEEDS/TRIAL_MAX_TICKS env vars (see that file) — --seeds/--max-ticks
// here are just this script's CLI-flag front end for those, forwarded
// through the child's environment.
function evaluateGenome(originalParamsText: string, genome: Genome): TrialOutput {
    writeFileSync(PARAMS_PATH, applyGenome(originalParamsText, genome));
    const stdout = execFileSync(process.execPath, [TSX_CLI_PATH, TRIAL_RUNNER_PATH], {
        encoding: "utf8",
        env: {
            ...process.env,
            // Always forward the resolved value (flag, then env, then this
            // script's own default), not just when --seeds/--maxticks was
            // typed explicitly — otherwise trial-runner.ts falls back to ITS
            // own hardcoded defaults (5000 ticks) the moment this script's
            // default differs from that, silently ignoring the queen's
            // lifespan default set above.
            TRIAL_SEEDS: option(FLAGS[4]),
            TRIAL_MAX_TICKS: option(FLAGS[5]),
        },
    });
    return JSON.parse(stdout.trim().split("\n").pop()!) as TrialOutput;
}

// ---- main ----
async function main(): Promise<void> {
    const originalParamsText = readFileSync(PARAMS_PATH, "utf8");
    writeFileSync(BACKUP_PATH, originalParamsText);

    // Exactly one of these ever actually runs: a clean finish calls
    // finish(bestGenomeText, ...) itself, which marks doneWriting so the
    // "exit" handler's fallback restore-to-original becomes a no-op. Any
    // interruption or crash before that point leaves doneWriting false, so
    // the fallback fires and params.ts ends up back at its pre-run content
    // instead of stuck on some mid-search candidate.
    let doneWriting = false;
    const finish = (content: string, message: string) => {
        if (doneWriting) return;
        writeFileSync(PARAMS_PATH, content);
        doneWriting = true;
        console.log(message);
    };
    process.on("exit", () => finish(originalParamsText, "\n[optimize-params] interrupted — params.ts restored to its pre-run content."));
    process.on("SIGINT", () => process.exit(130));
    process.on("SIGTERM", () => process.exit(143));

    console.log("=".repeat(78));
    console.log(`[optimize-params] population=${POP_SIZE}  generations=${GENERATIONS}  elitism=${ELITISM}  mutationRate=${MUTATION_RATE}  mutationStrength=${MUTATION_STRENGTH}`);
    console.log(`[optimize-params] seeds=${option(FLAGS[4])}  maxTicks=${option(FLAGS[5])}  targetAvgPopulation=${TARGET_AVG_POPULATION}`);
    console.log(`[optimize-params] fitness: reproduced at all (>= ${MIN_BIRTHS_TO_COUNT_AS_A_COLONY} births) first, then not overshooting past ${TARGET_AVG_POPULATION * MAX_POPULATION_OVERSHOOT} avg population, then longest survival, then closest average population to ${TARGET_AVG_POPULATION} as the tiebreak.`);
    console.log(`[optimize-params] search space (${SEARCH_SPACE.length} params):`);
    printSearchSpaceTable();
    console.log(`[optimize-params] params.ts will be rewritten per-trial, then left holding the winner. Pre-run backup: ${BACKUP_PATH}`);
    console.log(`[optimize-params] run with --help for the flag list. Do not edit params.ts while this runs.`);
    console.log("=".repeat(78));

    // Seeded with the genome already sitting in params.ts instead of
    // starting fully random — see optimize-params-parallel.ts's matching
    // comment for why: otherwise every new run discards whatever a prior
    // run (possibly much longer) already found. The WHOLE generation is
    // built from it (slot 0 exact, every other slot a mutation of it), not
    // just one slot alongside random genomes.
    const seedFromCurrent = option(FLAGS[7]) !== "false";
    const initialPopulation = seedFromCurrent
        ? seedGenerationFromBest(POP_SIZE, readGenomeFromText(originalParamsText), MUTATION_RATE, MUTATION_STRENGTH)
        : Array.from({ length: POP_SIZE }, randomGenome);
    if (seedFromCurrent) {
        console.log(`[optimize-params] seeding generation 1 from params.ts's current genome — slot 1 exact, the rest mutations of it (--seedcurrent=false for a fully random start).`);
    }
    let population = initialPopulation;
    let scored: Scored[] = [];
    let bestEver: Scored | undefined;

    let trialsRun = 0;
    let totalTrialMs = 0;
    const runStart = Date.now();
    // Gen 0 evaluates the whole population fresh; every later generation
    // only re-evaluates the non-elite offspring (elites carry their known
    // trial result over) — this is an estimate, not exact, since crossover
    // can happen to reproduce an already-seen genome and skip a trial too,
    // but it's close enough for an ETA.
    const expectedTotalTrials = POP_SIZE + (GENERATIONS - 1) * (POP_SIZE - ELITISM);

    for (let gen = 0; gen < GENERATIONS; gen++) {
        console.log(`\n-- generation ${gen + 1}/${GENERATIONS} --`);

        // Elites already have a known trial result from last generation — no
        // need to re-run them through a fresh trial.
        const alreadyScored = new Map(scored.map((s) => [JSON.stringify(s.genome), s]));
        const newScored: Scored[] = [];
        let indexInGeneration = 0;

        for (const genome of population) {
            indexInGeneration += 1;
            const key = JSON.stringify(genome);
            const existing = alreadyScored.get(key);
            if (existing) {
                newScored.push(existing);
                console.log(`  [${indexInGeneration}/${POP_SIZE}] (elite, not re-run)  ${formatTrial(existing.trial)}`);
                continue;
            }

            const trialStart = Date.now();
            const trial = evaluateGenome(originalParamsText, genome);
            const trialMs = Date.now() - trialStart;
            trialsRun += 1;
            totalTrialMs += trialMs;
            const avgTrialMs = totalTrialMs / trialsRun;
            const eta = formatDuration(Math.max(0, expectedTotalTrials - trialsRun) * avgTrialMs);

            newScored.push({ genome, trial });

            const isNewBest = bestEver === undefined || compareTrials(trial, bestEver.trial) < 0;
            const marker = isNewBest ? "★ new best" : "";
            console.log(`  [${indexInGeneration}/${POP_SIZE}] (${formatDuration(trialMs)}, ~${eta} left)  ${formatTrial(trial)}  ${marker}`);
            if (isNewBest) {
                bestEver = { genome, trial };
                printGenomeTable(genome);
            }
        }

        scored = newScored.sort((a, b) => compareTrials(a.trial, b.trial));

        console.log(`  generation ${gen + 1} best: ${formatTrial(scored[0].trial)}`);

        // Next generation: keep the elites, breed the rest via tournament
        // selection + crossover + mutation.
        const elites = scored.slice(0, ELITISM).map((s) => s.genome);
        const offspring: Genome[] = [];
        while (elites.length + offspring.length < POP_SIZE) {
            const parentA = tournamentSelect(scored, compareTrials, TOURNAMENT_SIZE);
            const parentB = tournamentSelect(scored, compareTrials, TOURNAMENT_SIZE);
            offspring.push(mutate(crossover(parentA, parentB), MUTATION_RATE, MUTATION_STRENGTH));
        }
        population = [...elites, ...offspring];
    }

    console.log("\n" + "=".repeat(78));
    console.log(`[optimize-params] done in ${formatDuration(Date.now() - runStart)} (${trialsRun} trials run).`);
    console.log("[optimize-params] best genome found:");
    console.log(`  ${formatTrial(bestEver!.trial)}`);
    printGenomeTable(bestEver!.genome);

    finish(
        applyGenome(originalParamsText, bestEver!.genome),
        `\n[optimize-params] params.ts updated with the best genome found. ` +
            `Pre-run values are saved at ${BACKUP_PATH} if you want to revert (cp it back over params.ts).`,
    );
}

await main();
