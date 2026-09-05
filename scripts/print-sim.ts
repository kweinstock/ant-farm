// Not part of the test suite — a scratch script to *watch* the sim, run via
// `npm run test:basic` (tsx, no build step). Safe to keep hacking on this
// file directly; nothing else imports it.
//
// Phase 3: the per-tick ASCII grid stopped making sense once there are
// dozens of ants on a 10x10 board — a redrawn grid can show one ant's
// position but not a colony's. Replaced with a periodic demography summary
// instead; individual birth/death events still print immediately since
// those are milestones worth seeing as they happen, not just folded into
// the next summary line.
import { createInitialState } from "../src/sim/state";
import { step } from "../src/sim";
import { getDemography } from "../src/sim/colony/demography";

const seed = 12345;

// Raised from Phase 2's 1001 — that was sized for watching one ant's single
// lifespan (500-1000 ticks). Population growth via egg -> larva -> pupa ->
// adult (colony/brood.ts's stage durations) needs more runway than that to
// show anything interesting happening.
const MAX_TICKS = 20000;

const SUMMARY_INTERVAL_TICKS = 200;

let state = createInitialState(seed);

console.log(`Seed: ${seed}`);
console.log();

for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const result = step(state, 1);
    state = result.state;

    for (const event of result.events) {
        if (event.kind === "birth") {
            console.log(`  [tick ${tick}] birth: ${event.antId}`);
        } else if (event.kind === "death" && event.antId === state.queenId) {
            // state.queenId still points at her id even after she's removed
            // from state.ants — this only tells us it WAS her id, not that
            // she's currently alive, which is exactly the comparison we want
            // here (there's no colony/caste.ts succession yet, so this is
            // effectively "the colony just lost its only queen").
            console.log(`  [tick ${tick}] QUEEN DIED (age ${event.ageTicks})`);
        }
    }

    if (tick % SUMMARY_INTERVAL_TICKS === 0 || state.ants.size === 0) {
        const demography = getDemography(state);

        console.log(
            `Tick ${tick.toString().padStart(5)} | pop ${demography.population
                .toString()
                .padStart(3)} (nurses ${demography.nurses}, foragers ${demography.foragers}) | brood ${demography.broodCount}`
        );
    }

    if (state.ants.size === 0) {
        console.log();
        console.log(`Colony extinct at tick ${tick}`);
        break;
    }

    await new Promise((resolve) => setTimeout(resolve, 0.1));
}