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
// or unlucky run doesn't dominate. A small bonus for average population
// size breaks ties among configs that all survive the full window — a
// colony frozen at 1 ant for 8000 ticks technically "survived" but isn't
// what anyone means by a healthy colony; see optimize-params.ts's FITNESS
// formula for how the two combine.
import { createInitialState } from "../src/sim/state";
import { step } from "../src/sim";

const SEEDS = (process.env.TRIAL_SEEDS ?? "2,3,11").split(",").map(Number);
const MAX_TICKS = Number(process.env.TRIAL_MAX_TICKS ?? 5000);
const SAMPLE_EVERY = 100;

type SeedResult = {
    seed: number;
    ticksSurvived: number;
    survivedFullWindow: boolean;
    avgPopulation: number;
    finalPopulation: number;
};

function runOneSeed(seed: number): SeedResult {
    let state = createInitialState(seed);
    let popSum = 0;
    let samples = 0;

    for (let tick = 1; tick <= MAX_TICKS; tick++) {
        state = step(state, 1).state;

        if (tick % SAMPLE_EVERY === 0) {
            popSum += state.ants.size;
            samples += 1;
        }

        if (state.ants.size === 0) {
            return {
                seed,
                ticksSurvived: tick,
                survivedFullWindow: false,
                avgPopulation: samples > 0 ? popSum / samples : 0,
                finalPopulation: 0,
            };
        }
    }

    return {
        seed,
        ticksSurvived: MAX_TICKS,
        survivedFullWindow: true,
        avgPopulation: samples > 0 ? popSum / samples : 0,
        finalPopulation: state.ants.size,
    };
}

const results = SEEDS.map(runOneSeed);
const meanTicksSurvived = results.reduce((s, r) => s + r.ticksSurvived, 0) / results.length;
const meanAvgPopulation = results.reduce((s, r) => s + r.avgPopulation, 0) / results.length;
const survivedAll = results.every((r) => r.survivedFullWindow);

// The one line the parent process reads. Nothing else in this file (or
// anything it imports) should ever write to stdout — that would corrupt
// this line for optimize-params.ts's JSON.parse.
console.log(JSON.stringify({ meanTicksSurvived, meanAvgPopulation, survivedAll, maxTicks: MAX_TICKS, results }));
