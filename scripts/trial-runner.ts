// Runs a fixed batch of seeds against whatever src/sim/params.ts currently
// says on disk, and prints exactly one line of JSON fitness data to stdout.
// Not meant to be run by hand — optimize-params.ts spawns this as a FRESH
// CHILD PROCESS per candidate parameter set, specifically because the sim's
// params are plain module-level constants imported all over the codebase
// (queen.ts, workforce.ts, surface.ts, ...), not something injectable at
// runtime. A brand-new process is the only way to guarantee every one of
// those imports re-reads the file fresh instead of reusing a stale value
// some earlier candidate's run already baked into Node's ES module cache
// (import-with-a-cache-busting-query only invalidates the one specifier you
// bust — every *other* file's plain `from "../params"` still resolves to
// whatever got cached first, so an in-process sweep would silently keep
// testing candidate #1's numbers forever after the first trial).
//
// Fitness = how long the colony survives, per the optimization brief
// ("longest tick period"), averaged across several seeds so a single lucky
// or unlucky run doesn't dominate. Reporting `births` lets optimize-params.ts
// disqualify the degenerate "never lay an egg" genome — a colony that never
// reproduces can't overshoot its food supply, so it trivially outlasts one
// that actually tries to grow, which isn't what anyone means by "survived."
// A colony frozen at 1 ant for 8000 ticks isn't a healthy colony either;
// see optimize-params.ts's compareTrials for how births/ticks/population
// combine into one fitness ordering.
//
// Sim imports below are DYNAMIC, resolved from TRIAL_SIM_DIR, instead of the
// plain `from "../src/sim/state"` this file used to have. optimize-params.ts
// (sequential) doesn't set that env var, so this falls back to the real
// src/sim tree and behaves exactly as before. optimize-params-parallel.ts
// sets it to a per-worker COPY of src/sim (see that file's header) so N
// trial-runner processes can each rewrite and import their own private
// params.ts concurrently instead of fighting over the one real file.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_DIR = process.env.TRIAL_SIM_DIR
    ? path.resolve(process.env.TRIAL_SIM_DIR)
    : path.resolve(__dirname, "../src/sim");

const simImport = (relativeFile: string) => import(pathToFileURL(path.join(SIM_DIR, relativeFile)).href);

const { createInitialState } = await simImport("state.ts");
const { step } = await simImport("index.ts");
const { QUEEN_MAX_LIFESPAN_TICKS } = await simImport("params.ts");

// 12345 is the seed actually in use (print-sim.ts's default) — that's the
// trajectory that matters when this is run standalone, not an arbitrary
// sample.
const SEEDS = (process.env.TRIAL_SEEDS ?? "12345").split(",").map(Number);
// Defaults to the queen's own max lifespan when run standalone (outside
// optimize-params.ts, which always forwards its own resolved --maxticks) —
// "survived" should mean "made it through one queen's natural life," not an
// arbitrary short smoke-test window.
const MAX_TICKS = Number(process.env.TRIAL_MAX_TICKS ?? QUEEN_MAX_LIFESPAN_TICKS);
const SAMPLE_EVERY = 100;
// Optional early-abort: the optimizer rejects any genome whose MEAN peak
// population (across seeds) exceeds this ceiling, no matter how long it
// survives — and a booming colony is also by far the slowest thing to
// simulate (tick cost scales with ants), so letting one finish just to
// reject it can stall a whole generation for days. The moment the summed
// peaks make a mean above the ceiling unavoidable (even if every remaining
// seed peaked at zero), the outcome is already decided and the trial stops.
const ABORT_PEAK_MEAN = process.env.TRIAL_ABORT_PEAK_MEAN ? Number(process.env.TRIAL_ABORT_PEAK_MEAN) : undefined;
const ABORT_PEAK_SUM = ABORT_PEAK_MEAN === undefined ? Infinity : ABORT_PEAK_MEAN * SEEDS.length;

type SeedResult = {
    seed: number;
    ticksSurvived: number;
    survivedFullWindow: boolean;
    avgPopulation: number;
    peakPopulation: number;
    finalPopulation: number;
    births: number;
    aborted?: boolean;
};

function runOneSeed(seed: number, peakSumSoFar: number): SeedResult {
    let state = createInitialState(seed);
    let popSum = 0;
    let samples = 0;
    let births = 0;
    let peakPopulation = state.ants.size;

    for (let tick = 1; tick <= MAX_TICKS; tick++) {
        const result = step(state, 1);
        state = result.state;
        for (const event of result.events) {
            if (event.kind === "birth") births += 1;
        }

        if (tick % SAMPLE_EVERY === 0) {
            popSum += state.ants.size;
            samples += 1;
            // Sampled at the same cadence as the average, not every tick —
            // a boom that spikes and collapses between samples wouldn't
            // register, but that's the same resolution avgPopulation
            // already accepts, and matching it keeps the two comparable.
            if (state.ants.size > peakPopulation) peakPopulation = state.ants.size;
            if (peakSumSoFar + peakPopulation > ABORT_PEAK_SUM) {
                return {
                    seed,
                    ticksSurvived: tick,
                    survivedFullWindow: false,
                    avgPopulation: popSum / samples,
                    peakPopulation,
                    finalPopulation: state.ants.size,
                    births,
                    aborted: true,
                };
            }
        }

        if (state.ants.size === 0) {
            return {
                seed,
                ticksSurvived: tick,
                survivedFullWindow: false,
                avgPopulation: samples > 0 ? popSum / samples : 0,
                peakPopulation,
                finalPopulation: 0,
                births,
            };
        }
    }

    return {
        seed,
        ticksSurvived: MAX_TICKS,
        survivedFullWindow: true,
        avgPopulation: samples > 0 ? popSum / samples : 0,
        peakPopulation,
        finalPopulation: state.ants.size,
        births,
    };
}

const results: SeedResult[] = [];
let peakSum = 0;
for (const seed of SEEDS) {
    const result = runOneSeed(seed, peakSum);
    results.push(result);
    peakSum += result.peakPopulation;
    if (result.aborted) break;
}
const aborted = results.some((r) => r.aborted);
const meanTicksSurvived = results.reduce((s, r) => s + r.ticksSurvived, 0) / results.length;
const meanAvgPopulation = results.reduce((s, r) => s + r.avgPopulation, 0) / results.length;
// Divided by the FULL seed count, not results.length — an aborted trial
// never ran its remaining seeds, and this is the lower bound on the true
// mean (unrun seeds counted as zero), which is already over the ceiling.
const meanPeakPopulation = peakSum / SEEDS.length;
const meanBirths = results.reduce((s, r) => s + r.births, 0) / results.length;
const survivedAll = !aborted && results.every((r) => r.survivedFullWindow);

// The one line the parent process reads. Nothing else in this file (or
// anything it imports) should ever write to stdout — that would corrupt
// this line for optimize-params.ts's JSON.parse.
console.log(JSON.stringify({ meanTicksSurvived, meanAvgPopulation, meanPeakPopulation, meanBirths, survivedAll, maxTicks: MAX_TICKS, aborted, results }));
