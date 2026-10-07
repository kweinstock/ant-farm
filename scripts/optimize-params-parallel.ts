// Parallel version of optimize-params.ts — same genetic algorithm, same
// search space, same fitness (both come from ga-core.ts), but trials run
// N at a time instead of one at a time.
//
// WHY optimize-params.ts CAN'T just be run twice at once: every trial there
// works by physically rewriting the ONE shared src/sim/params.ts on disk,
// then spawning trial-runner.ts to import it fresh. Two trials writing that
// same file at once would corrupt each other's genome mid-evaluation.
//
// HOW THIS ONE PARALLELIZES INSTEAD: at startup, this script copies
// src/sim/** into N private directories, one per worker
// (`<tmpdir>/ant-farm-optimize-workers/worker-<i>/sim/`). Each worker gets
// its own params.ts to rewrite and its own copy of every file that imports
// it — no shared file, no collision. trial-runner.ts is told which copy to
// import from via the TRIAL_SIM_DIR env var (see that file's header) — it
// otherwise behaves identically to the sequential script's usage.
//
// The real src/sim/params.ts is NEVER touched during the search — only
// once, at the very end (or on interrupt), with whichever genome scored
// best so far. That's actually safer than the sequential script: there's no
// window where the real file holds a mid-search candidate that a crash
// could leave it stuck on.
//
// Memory footprint: each worker is a small tsx/Node process running a
// colony sim (tens of MB, not GBs) — this is CPU-bound, not memory-bound,
// so --workers is capped by core count by default, not by any memory
// budget. Override it upward if you know you have headroom and want to
// oversubscribe.
//
// Run `npm run optimize-params-parallel -- --help` (or `-h`) for the full
// flag list — it's the same list as optimize-params.ts, plus --workers.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { MAX_LIFESPAN_TICKS, QUEEN_MAX_LIFESPAN_TICKS } from "../src/sim/params";
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

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_SIM_DIR = path.resolve(__dirname, "../src/sim");
const PARAMS_PATH = path.join(REAL_SIM_DIR, "params.ts");
const BACKUP_PATH = path.join(REAL_SIM_DIR, ".params-backup.ts");
const TRIAL_RUNNER_PATH = path.resolve(__dirname, "./trial-runner.ts");
const TSX_CLI_PATH = createRequire(import.meta.url).resolve("tsx/cli");
// Each worker's private sim copy lives under the OS temp dir, not inside the
// repo — this is scratch infrastructure the GA rebuilds every run, not
// something that belongs in source control or git status.
const WORKERS_ROOT = path.join(os.tmpdir(), "ant-farm-optimize-workers");

const ARGS = parseArgs(process.argv.slice(2));

const FLAGS: FlagSpec[] = [
    { flag: "popsize", env: "POP_SIZE", default: "16", help: "GA population size (candidates per generation)" },
    { flag: "generations", env: "GENERATIONS", default: "8", help: "number of generations to evolve" },
    { flag: "mutationrate", env: "MUTATION_RATE", default: "0.3", help: "per-gene chance a gene mutates when breeding (0-1)" },
    { flag: "mutationstrength", env: "MUTATION_STRENGTH", default: "0.25", help: "mutation size, as a fraction of each param's own [min,max] range" },
    // 12345 is the seed actually in use (print-sim.ts's default) — that's
    // the trajectory that matters, not an arbitrary sample.
    { flag: "seeds", env: "TRIAL_SEEDS", default: "12345", help: "comma-separated RNG seeds each trial's fitness is averaged over (forwarded to trial-runner.ts)" },
    { flag: "maxticks", env: "TRIAL_MAX_TICKS", default: String(QUEEN_MAX_LIFESPAN_TICKS + MAX_LIFESPAN_TICKS), help: "tick cap per seed — surviving to this point counts as \"survived the full window\" (forwarded to trial-runner.ts). Defaults to QUEEN_MAX_LIFESPAN_TICKS." },
    { flag: "targetpop", env: "TARGET_AVG_POPULATION", default: "30", help: "average population a trial is scored against — closer wins, not just \"more\"" },
    // Every core, not cores-1: this machine's CPU is dedicated to the
    // search for the run's duration, and trial-runner.ts's workers are
    // CPU-bound single-threaded Node processes (see this file's header) —
    // leaving a core idle just means slower throughput, not headroom for
    // anything else running concurrently. Override downward with --workers
    // if the machine is doing other work at the same time.
    { flag: "workers", env: "OPTIMIZE_WORKERS", default: String(Math.max(1, os.cpus().length)), help: "trials to run concurrently, each against its own isolated sim copy. Defaults to every CPU core." },
    { flag: "trialtimeout", env: "TRIAL_TIMEOUT_MINUTES", default: "900", help: "wall-clock cap per trial in minutes — a trial still running after this is killed and scored as failed, so one pathological genome can't stall a whole generation" },
    { flag: "seedcurrent", env: "SEED_FROM_CURRENT", default: "true", help: "include params.ts's current genome as a starting member of generation 1 instead of starting fully random — set to false to explore from scratch" },
];

function option(spec: FlagSpec): string {
    return ARGS.get(spec.flag) ?? process.env[spec.env] ?? spec.default;
}

function printHelp(): void {
    console.log("Parallel version of optimize-params.ts — same search space and fitness, N trials at a time instead of one.");
    console.log("Each worker gets its own isolated copy of src/sim, so trials never collide on the one real params.ts.");
    console.log("params.ts is left holding the best genome found when the run completes cleanly (same as the sequential script).\n");
    console.log("Usage:");
    console.log("  npm run optimize-params-parallel -- [flags]");
    console.log("  npx tsx scripts/optimize-params-parallel.ts [flags]\n");
    console.log("Flags:");
    printTable([
        ["--help, -h", "", "", "show this help and exit"],
        ...FLAGS.map((f) => [`--${f.flag}`, `env ${f.env}`, `default ${f.default}`, f.help]),
    ]);
    console.log("\nExamples:");
    console.log("  npm run optimize-params-parallel -- --popsize 32 --generations 16 --workers 8\n");
    console.log(`Search space tuned (${SEARCH_SPACE.length} params): ${SEARCH_SPACE.map((s) => s.name).join(", ")}`);
    console.log("(Shared with optimize-params.ts — edit SEARCH_SPACE in ga-core.ts to change it.)");
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
const WORKER_COUNT = Math.max(1, Number(option(FLAGS[7])));
const TOURNAMENT_SIZE = 3;
const compareTrials = makeCompareTrials(TARGET_AVG_POPULATION);

// ---- worker pool setup ----
// One private sim copy per worker slot, rebuilt fresh at startup so a
// previous run's leftover mutations never leak into this one.
function setUpWorkers(): void {
    rmSync(WORKERS_ROOT, { recursive: true, force: true });
    mkdirSync(WORKERS_ROOT, { recursive: true });
    for (let i = 0; i < WORKER_COUNT; i++) {
        cpSync(REAL_SIM_DIR, path.join(WORKERS_ROOT, `worker-${i}`, "sim"), { recursive: true });
    }
}

function workerSimDir(i: number): string {
    return path.join(WORKERS_ROOT, `worker-${i}`, "sim");
}

function workerParamsPath(i: number): string {
    return path.join(workerSimDir(i), "params.ts");
}

// Evaluates one genome against worker slot `workerIndex`'s isolated sim
// copy — safe to call concurrently across different workerIndex values,
// since each writes only its own params.ts and trial-runner.ts is told
// (via TRIAL_SIM_DIR) to import only from that same copy.
async function evaluateGenomeOnWorker(workerIndex: number, baseParamsText: string, genome: Genome): Promise<TrialOutput> {
    writeFileSync(workerParamsPath(workerIndex), applyGenome(baseParamsText, genome));
    const pending = execFileAsync(process.execPath, [TSX_CLI_PATH, TRIAL_RUNNER_PATH], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
            ...process.env,
            TRIAL_SEEDS: option(FLAGS[4]),
            TRIAL_MAX_TICKS: option(FLAGS[5]),
            TRIAL_SIM_DIR: workerSimDir(workerIndex),
            TRIAL_ABORT_PEAK_MEAN: String(TARGET_AVG_POPULATION * MAX_POPULATION_OVERSHOOT),
        },
    });
    // tsx launches the real runner as a grandchild, so killing only the
    // direct child would orphan it and leave it burning a core — /T takes
    // the whole tree down.
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        if (pending.child.pid !== undefined) {
            try {
                execFileSync("taskkill", ["/PID", String(pending.child.pid), "/T", "/F"], { stdio: "ignore" });
            } catch {
                pending.child.kill();
            }
        }
    }, Number(option(FLAGS[8])) * 60_000);
    try {
        const { stdout } = await pending;
        return JSON.parse(stdout.trim().split("\n").pop()!) as TrialOutput;
    } catch (error) {
        if (!timedOut) throw error;
        return { meanTicksSurvived: 0, meanAvgPopulation: 0, meanPeakPopulation: 0, meanBirths: 0, survivedAll: false, maxTicks: Number(option(FLAGS[5])), timedOut: true };
    } finally {
        clearTimeout(timer);
    }
}

// Runs `genomes` through the worker pool, WORKER_COUNT at a time, calling
// onResult as each one lands (not necessarily in input order) so the caller
// can log progress live instead of waiting for the whole batch.
async function evaluateBatch(
    baseParamsText: string,
    genomes: Genome[],
    onResult: (genome: Genome, trial: TrialOutput, trialMs: number) => void,
): Promise<void> {
    let nextIndex = 0;
    async function runWorker(workerIndex: number): Promise<void> {
        while (nextIndex < genomes.length) {
            const genome = genomes[nextIndex];
            nextIndex += 1;
            const trialStart = Date.now();
            const trial = await evaluateGenomeOnWorker(workerIndex, baseParamsText, genome);
            onResult(genome, trial, Date.now() - trialStart);
        }
    }
    const activeWorkers = Math.min(WORKER_COUNT, genomes.length);
    await Promise.all(Array.from({ length: activeWorkers }, (_, i) => runWorker(i)));
}

// ---- main ----
async function main(): Promise<void> {
    const originalParamsText = readFileSync(PARAMS_PATH, "utf8");
    writeFileSync(BACKUP_PATH, originalParamsText);

    console.log(`[optimize-params-parallel] setting up ${WORKER_COUNT} isolated worker copies of src/sim under ${WORKERS_ROOT} ...`);
    setUpWorkers();

    // Unlike the sequential script, the REAL params.ts is never touched
    // during the search (only worker copies are) — so there's nothing to
    // restore on an interrupt, only a best-so-far to apply if one exists.
    let bestEver: Scored | undefined;
    let doneWriting = false;
    const finish = (message: string) => {
        if (doneWriting) return;
        doneWriting = true;
        if (bestEver) {
            writeFileSync(PARAMS_PATH, applyGenome(originalParamsText, bestEver.genome));
        }
        console.log(message);
        rmSync(WORKERS_ROOT, { recursive: true, force: true });
    };
    process.on("exit", () => finish(
        bestEver
            ? "\n[optimize-params-parallel] interrupted — params.ts updated with the best genome found before the stop."
            : "\n[optimize-params-parallel] interrupted before any trial finished — params.ts left untouched.",
    ));
    process.on("SIGINT", () => process.exit(130));
    process.on("SIGTERM", () => process.exit(143));

    console.log("=".repeat(78));
    console.log(`[optimize-params-parallel] population=${POP_SIZE}  generations=${GENERATIONS}  elitism=${ELITISM}  mutationRate=${MUTATION_RATE}  mutationStrength=${MUTATION_STRENGTH}  workers=${WORKER_COUNT}`);
    console.log(`[optimize-params-parallel] seeds=${option(FLAGS[4])}  maxTicks=${option(FLAGS[5])}  targetAvgPopulation=${TARGET_AVG_POPULATION}`);
    console.log(`[optimize-params-parallel] fitness: reproduced at all (>= ${MIN_BIRTHS_TO_COUNT_AS_A_COLONY} births) first, then not overshooting past ${TARGET_AVG_POPULATION * MAX_POPULATION_OVERSHOOT} avg population, then longest survival, then closest average population to ${TARGET_AVG_POPULATION} as the tiebreak.`);
    console.log(`[optimize-params-parallel] search space (${SEARCH_SPACE.length} params):`);
    printSearchSpaceTable();
    console.log(`[optimize-params-parallel] the real params.ts is untouched until the run ends, then left holding the winner. Pre-run backup: ${BACKUP_PATH}`);
    console.log("=".repeat(78));

    // Seeded with the genome already sitting in params.ts (from whatever
    // run last finished or was stopped) instead of starting fully random —
    // otherwise every new run discards all prior progress and re-walks the
    // same ground a much bigger/longer earlier run already covered. The
    // WHOLE generation is built from it (slot 0 exact, every other slot a
    // mutation of it), not just one slot alongside random genomes — a
    // single seeded slot meant every other candidate in generation 1 was
    // still a blind draw from the entire search space, since mutation/
    // crossover only touches the seed's genes starting generation 2.
    const seedFromCurrent = option(FLAGS[9]) !== "false";
    const initialPopulation = seedFromCurrent
        ? seedGenerationFromBest(POP_SIZE, readGenomeFromText(originalParamsText), MUTATION_RATE, MUTATION_STRENGTH)
        : Array.from({ length: POP_SIZE }, randomGenome);
    if (seedFromCurrent) {
        console.log(`[optimize-params-parallel] seeding generation 1 from params.ts's current genome — slot 1 exact, the rest mutations of it (--seedcurrent=false for a fully random start).`);
    }
    let population = initialPopulation;
    let scored: Scored[] = [];

    let trialsRun = 0;
    let totalTrialMs = 0;
    const runStart = Date.now();
    const expectedTotalTrials = POP_SIZE + (GENERATIONS - 1) * (POP_SIZE - ELITISM);

    for (let gen = 0; gen < GENERATIONS; gen++) {
        console.log(`\n-- generation ${gen + 1}/${GENERATIONS} --`);

        const alreadyScored = new Map(scored.map((s) => [JSON.stringify(s.genome), s]));
        const toEvaluate: Genome[] = [];
        for (const genome of population) {
            const existing = alreadyScored.get(JSON.stringify(genome));
            if (existing) {
                console.log(`  (elite, not re-run)  ${formatTrial(existing.trial)}`);
            } else {
                toEvaluate.push(genome);
            }
        }

        const newScored: Scored[] = population
            .map((genome) => alreadyScored.get(JSON.stringify(genome)))
            .filter((s): s is Scored => s !== undefined);

        await evaluateBatch(originalParamsText, toEvaluate, (genome, trial, trialMs) => {
            trialsRun += 1;
            totalTrialMs += trialMs;
            // Wall-clock-aware ETA: with WORKER_COUNT trials in flight at
            // once, the real throughput is roughly WORKER_COUNT trials per
            // average trial duration, not one — dividing by WORKER_COUNT is
            // an approximation (trial durations vary a lot, from a colony
            // that dies in seconds to one that runs the full multi-million-
            // tick window), but it's far closer than the sequential
            // script's plain per-trial estimate would be here.
            const avgTrialMs = totalTrialMs / trialsRun;
            const remaining = Math.max(0, expectedTotalTrials - trialsRun);
            const eta = formatDuration((remaining * avgTrialMs) / WORKER_COUNT);

            newScored.push({ genome, trial });

            const isNewBest = bestEver === undefined || compareTrials(trial, bestEver.trial) < 0;
            const marker = isNewBest ? "★ new best" : "";
            console.log(`  [${trialsRun}/${expectedTotalTrials}] (${formatDuration(trialMs)}, ~${eta} left)  ${formatTrial(trial)}  ${marker}`);
            if (isNewBest) {
                bestEver = { genome, trial };
                printGenomeTable(genome);
            }
        });

        scored = newScored.sort((a, b) => compareTrials(a.trial, b.trial));
        console.log(`  generation ${gen + 1} best: ${formatTrial(scored[0].trial)}`);

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
    console.log(`[optimize-params-parallel] done in ${formatDuration(Date.now() - runStart)} (${trialsRun} trials run across ${WORKER_COUNT} workers).`);
    console.log("[optimize-params-parallel] best genome found:");
    console.log(`  ${formatTrial(bestEver!.trial)}`);
    printGenomeTable(bestEver!.genome);

    finish(
        `\n[optimize-params-parallel] params.ts updated with the best genome found. ` +
            `Pre-run values are saved at ${BACKUP_PATH} if you want to revert (cp it back over params.ts).`,
    );
}

await main();
