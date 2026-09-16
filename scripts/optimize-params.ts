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
// window), mean average population as the tiebreak. See compareTrials.
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
// Because every trial mutates the same on-disk file, trials CANNOT run
// concurrently — each one must finish (or be killed) before the next
// candidate's values are written. That's the main cost driver here; there's
// no in-process parallelism to reach for without giving each trial its own
// worktree/checkout, which is out of scope for this script.
//
// Run `npm run optimize-params -- --help` (or `-h`) for the full flag list.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARAMS_PATH = path.resolve(__dirname, "../src/sim/params.ts");
const BACKUP_PATH = path.resolve(__dirname, "../src/sim/.params-backup.ts");
const TRIAL_RUNNER_PATH = path.resolve(__dirname, "./trial-runner.ts");
// Invoke tsx's CLI directly via `node <cli.mjs> <script>` rather than going
// through `npx tsx` — no shell needed (avoids the Windows "npx is a .cmd
// shim" ENOENT and Node's arg-escaping shell warning), and no PATH lookup.
const TSX_CLI_PATH = createRequire(import.meta.url).resolve("tsx/cli");

// ---- CLI flags: `--flag value`, `--flag=value`, or the bare `-h` ----
// hyphen/case-insensitive, so "--pop-size" and "--popsize" both match the
// same key.
function parseArgs(argv: string[]): Map<string, string> {
    const args = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === "-h") {
            args.set("help", "true");
            continue;
        }
        if (!token.startsWith("--")) continue;
        const eq = token.indexOf("=");
        const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).toLowerCase().replace(/-/g, "");
        const value = eq === -1 ? (argv[i + 1] ?? "true") : token.slice(eq + 1);
        args.set(key, value);
    }
    return args;
}

const ARGS = parseArgs(process.argv.slice(2));

// One source of truth for every flag this script reads, so --help can never
// drift out of sync with what option() actually does. `flag` is already
// hyphen/case-normalized the same way parseArgs normalizes what it parses.
type FlagSpec = { flag: string; env: string; default: string; help: string };

const FLAGS: FlagSpec[] = [
    { flag: "popsize", env: "POP_SIZE", default: "16", help: "GA population size (candidates per generation)" },
    { flag: "generations", env: "GENERATIONS", default: "8", help: "number of generations to evolve" },
    { flag: "mutationrate", env: "MUTATION_RATE", default: "0.3", help: "per-gene chance a gene mutates when breeding (0-1)" },
    { flag: "mutationstrength", env: "MUTATION_STRENGTH", default: "0.25", help: "mutation size, as a fraction of each param's own [min,max] range" },
    { flag: "seeds", env: "TRIAL_SEEDS", default: "2,3,11", help: "comma-separated RNG seeds each trial's fitness is averaged over (forwarded to trial-runner.ts)" },
    { flag: "maxticks", env: "TRIAL_MAX_TICKS", default: "5000", help: "tick cap per seed — surviving to this point counts as \"survived the full window\" (forwarded to trial-runner.ts)" },
];

// CLI flag, then env var, then default — in that order.
function option(spec: FlagSpec): string {
    return ARGS.get(spec.flag) ?? process.env[spec.env] ?? spec.default;
}

function printTable(rows: string[][], indent = "  "): void {
    const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
    for (const row of rows) {
        console.log(indent + row.map((cell, col) => cell.padEnd(widths[col])).join("  "));
    }
}

function printHelp(): void {
    console.log("Search src/sim/params.ts for the longest-surviving, then most-populous, colony via a genetic algorithm.");
    console.log("params.ts is left holding the best genome found when the run completes cleanly.\n");
    console.log("Usage:");
    console.log("  npm run optimize-params -- [flags]      (the -- forwards flags to the script instead of npm eating them)");
    console.log("  npx tsx scripts/optimize-params.ts [flags]\n");
    console.log("Flags:");
    printTable([
        ["--help, -h", "", "", "show this help and exit"],
        ...FLAGS.map((f) => [`--${f.flag}`, `env ${f.env}`, `default ${f.default}`, f.help]),
    ]);
    console.log("\nExamples:");
    console.log("  npm run optimize-params -- --popsize 12 --generations 10");
    console.log("  npm run optimize-params -- --seeds 2,3,11,13,4001 --max-ticks 8000\n");
    console.log(`Search space tuned (${SEARCH_SPACE.length} params): ${SEARCH_SPACE.map((s) => s.name).join(", ")}`);
    console.log("(To add or remove which params get tuned, edit SEARCH_SPACE in this file.)");
}

// ---- the search space: name, bounds, and whether it's an integer knob ----
// The first batch (BASE_LAY_PROBABILITY..PILE_SPAWN_CHANCE) were the
// least-settled dials in the ongoing boom-bust balance issue. The rest were
// asked for explicitly: nurse aging, the whole pheromone trail channel, and
// the whole alarm channel. Bounds are centered on whatever's currently in
// params.ts, roughly halved/doubled — wide enough to actually search, not
// so wide the GA spends its budget on obviously-broken corners of the
// space. Add more entries here to widen the search further; each just
// needs to be a plain `export const NAME = <number>;` line in params.ts.
type ParamSpec = { name: string; min: number; max: number; integer?: boolean };

const SEARCH_SPACE: ParamSpec[] = [
    { name: "BASE_LAY_PROBABILITY", min: 0.05, max: 0.5 },
    { name: "NURSE_BROOD_PER_NURSE", min: 3, max: 12, integer: true },
    { name: "NURSE_LAY_HEADROOM", min: 1, max: 4 },
    { name: "POPULATION_SOFT_TARGET", min: 15, max: 60, integer: true },
    { name: "FOOD_TILE_CAPACITY", min: 200, max: 800, integer: true },
    { name: "FOOD_PILE_START_AMOUNT", min: 50, max: 400, integer: true },
    { name: "PILE_SPAWN_CHANCE", min: 0.03, max: 0.3 },
    { name: "NURSE_AGE_THRESHOLD_TICKS", min: 50, max: 400, integer: true },
    { name: "MAX_TRAIL", min: 100, max: 1000, integer: true },
    { name: "EVAPORATION_FACTOR", min: 0.85, max: 0.99 },
    { name: "MIN_TRAIL", min: 0.5, max: 10 },
    { name: "SPREAD_FRAC", min: 0.1, max: 0.8 },
    { name: "FOLLOW_THRESHOLD", min: 1, max: 30, integer: true },
    { name: "DEPOSIT_AMOUNT", min: 10, max: 200, integer: true },
    { name: "ALARM_MAX", min: 50, max: 500, integer: true },
    { name: "ALARM_EVAPORATION_FACTOR", min: 0.5, max: 0.98 },
    { name: "ALARM_DEPOSIT_AMOUNT", min: 20, max: 300, integer: true },
    { name: "ALARM_SPREAD_FRAC", min: 0.1, max: 0.9 },
    { name: "ALARM_FLEE_THRESHOLD", min: 5, max: 100, integer: true },
    { name: "MAX_PILES", min: 10, max: 150, integer: true },
];

if (ARGS.has("help")) {
    printHelp();
    process.exit(0);
}

type Genome = Record<string, number>;

// ---- GA knobs ----
const POP_SIZE = Number(option(FLAGS[0]));
const GENERATIONS = Number(option(FLAGS[1]));
const ELITISM = Math.min(2, POP_SIZE - 1);
const MUTATION_RATE = Number(option(FLAGS[2]));
const MUTATION_STRENGTH = Number(option(FLAGS[3]));
const TOURNAMENT_SIZE = 3;

function randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function randomGenome(): Genome {
    const genome: Genome = {};
    for (const spec of SEARCH_SPACE) {
        const raw = randomInRange(spec.min, spec.max);
        genome[spec.name] = spec.integer ? Math.round(raw) : Number(raw.toFixed(4));
    }
    return genome;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function mutate(genome: Genome): Genome {
    const next: Genome = { ...genome };
    for (const spec of SEARCH_SPACE) {
        if (Math.random() >= MUTATION_RATE) continue;
        const range = spec.max - spec.min;
        const delta = (Math.random() * 2 - 1) * range * MUTATION_STRENGTH;
        const mutated = clamp(next[spec.name] + delta, spec.min, spec.max);
        next[spec.name] = spec.integer ? Math.round(mutated) : Number(mutated.toFixed(4));
    }
    return next;
}

function crossover(a: Genome, b: Genome): Genome {
    const child: Genome = {};
    for (const spec of SEARCH_SPACE) {
        child[spec.name] = Math.random() < 0.5 ? a[spec.name] : b[spec.name];
    }
    return child;
}

// ---- writing a genome into params.ts's text ----
function applyGenome(paramsText: string, genome: Genome): string {
    let next = paramsText;
    for (const spec of SEARCH_SPACE) {
        const re = new RegExp(`(export const ${spec.name} = )[0-9.]+(;)`);
        if (!re.test(next)) {
            throw new Error(`optimize-params: couldn't find "export const ${spec.name} = <number>;" in params.ts — did it get renamed?`);
        }
        next = next.replace(re, `$1${genome[spec.name]}$2`);
    }
    return next;
}

type TrialOutput = { meanTicksSurvived: number; meanAvgPopulation: number; survivedAll: boolean; maxTicks: number };
type Scored = { genome: Genome; trial: TrialOutput };

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
            ...(ARGS.has("seeds") ? { TRIAL_SEEDS: ARGS.get("seeds") } : {}),
            ...(ARGS.has("maxticks") ? { TRIAL_MAX_TICKS: ARGS.get("maxticks") } : {}),
        },
    });
    return JSON.parse(stdout.trim().split("\n").pop()!) as TrialOutput;
}

// Longest survival wins; ties (very common once several candidates survive
// the whole window at maxTicks) fall to whichever kept more ants alive on
// average. Deliberately NOT a blended score — a config that lasts longer
// wins outright regardless of population, and only among equally-long
// survivors does population size matter at all.
function compareTrials(a: TrialOutput, b: TrialOutput): number {
    if (a.meanTicksSurvived !== b.meanTicksSurvived) {
        return b.meanTicksSurvived - a.meanTicksSurvived;
    }
    return b.meanAvgPopulation - a.meanAvgPopulation;
}

function tournamentSelect(scored: Scored[]): Genome {
    let best: Scored | undefined;
    for (let i = 0; i < TOURNAMENT_SIZE; i++) {
        const candidate = scored[Math.floor(Math.random() * scored.length)];
        if (best === undefined || compareTrials(candidate.trial, best.trial) < 0) best = candidate;
    }
    return best!.genome;
}

function formatTrial(trial: TrialOutput): string {
    return `ticks=${trial.meanTicksSurvived.toFixed(0)}/${trial.maxTicks}  avgPop=${trial.meanAvgPopulation.toFixed(1)}  survivedAll=${trial.survivedAll}`;
}

function printGenomeTable(genome: Genome): void {
    printTable(SEARCH_SPACE.map((spec) => [spec.name, `= ${genome[spec.name]}`, `[${spec.min}, ${spec.max}]`]), "    ");
}

function printSearchSpaceTable(): void {
    printTable(SEARCH_SPACE.map((spec) => [spec.name, `[${spec.min}, ${spec.max}]`, spec.integer ? "integer" : "float"]), "    ");
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
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
    console.log(`[optimize-params] seeds=${option(FLAGS[4])}  maxTicks=${option(FLAGS[5])}`);
    console.log(`[optimize-params] fitness: longest survival first, most ants (avg population) as the tiebreak.`);
    console.log(`[optimize-params] search space (${SEARCH_SPACE.length} params):`);
    printSearchSpaceTable();
    console.log(`[optimize-params] params.ts will be rewritten per-trial, then left holding the winner. Pre-run backup: ${BACKUP_PATH}`);
    console.log(`[optimize-params] run with --help for the flag list. Do not edit params.ts while this runs.`);
    console.log("=".repeat(78));

    let population = Array.from({ length: POP_SIZE }, randomGenome);
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
            const parentA = tournamentSelect(scored);
            const parentB = tournamentSelect(scored);
            offspring.push(mutate(crossover(parentA, parentB)));
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
