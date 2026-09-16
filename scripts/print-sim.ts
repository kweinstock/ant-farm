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
//
// Updated for Phase 9/10: the summary line was still Phase 3-shaped (pop /
// nurses / foragers / brood) and had nothing about sleep, predators, or
// death causes — three of the biggest things that now happen during a run.
// Predator appear/leave/strike are milestone events (same tier as
// birth/queen-death); asleep count and a running death tally are cheap
// enough to fold into every summary line.
import { createInitialState } from "../src/sim/state";
import { step } from "../src/sim";
import { getDemography } from "../src/sim/colony/demography";
import type { DeathEvent } from "../src/sim";

const seed = 12345;

// Raised from Phase 2's 1001 — that was sized for watching one ant's single
// lifespan (500-1000 ticks). Population growth via egg -> larva -> pupa ->
// adult (colony/brood.ts's stage durations) needs more runway than that to
// show anything interesting happening.
const MAX_TICKS = 20000;

const SUMMARY_INTERVAL_TICKS = 200;

let state = createInitialState(seed);

const deathsByCause: Record<DeathEvent["cause"], number> = {
    oldAge: 0,
    starvation: 0,
    predator: 0,
    cold: 0,
    exposure: 0,
};

console.log(`Seed: ${seed}`);
console.log();

for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const result = step(state, 1);
    state = result.state;

    for (const event of result.events) {
        if (event.kind === "death") {
            deathsByCause[event.cause] += 1;
            if (event.antId === state.queenId) {
                // state.queenId still points at her id even after she's
                // removed from state.ants — this only tells us it WAS her
                // id, not that she's currently alive, which is exactly the
                // comparison we want here (there's no colony/caste.ts
                // succession yet, so this is effectively "the colony just
                // lost its only queen").
                console.log(`  [tick ${tick}] QUEEN DIED (age ${event.ageTicks}, cause ${event.cause})`);
            }
        } else if (event.kind === "birth") {
            console.log(`  [tick ${tick}] birth: ${event.antId}`);
        } else if (event.kind === "predatorAppeared") {
            console.log(`  [tick ${tick}] predator appeared`);
        } else if (event.kind === "predatorLeft") {
            console.log(`  [tick ${tick}] predator left`);
        } else if (event.kind === "predatorStrike") {
            console.log(`  [tick ${tick}] predator struck: ${event.antId}`);
        }
    }

    if (tick % SUMMARY_INTERVAL_TICKS === 0 || state.ants.size === 0) {
        const demography = getDemography(state);
        const totalDeaths = Object.values(deathsByCause).reduce((a, b) => a + b, 0);
        const deathSummary = (Object.entries(deathsByCause) as [DeathEvent["cause"], number][])
            .filter(([, n]) => n > 0)
            .map(([cause, n]) => `${cause} ${n}`)
            .join(", ");

        console.log(
            `Tick ${tick.toString().padStart(5)} | pop ${demography.population.toString().padStart(3)} ` +
                `(nurses ${demography.nurses}/${demography.awakeNurses} awake, foragers ${demography.foragers}/${demography.awakeForagers} awake, ` +
                `asleep ${demography.asleep}) | brood ${demography.broodCount} | food ${Math.round(state.foodStore.amount)} | ` +
                `predator ${state.env.predator ? `at (${state.env.predator.pos.x},${state.env.predator.pos.y})${state.env.predator.huntingAntId ? " [hunting]" : ""}` : "none"} | ` +
                `deaths ${totalDeaths}${deathSummary ? ` (${deathSummary})` : ""}`
        );
    }

    if (state.ants.size === 0) {
        console.log();
        console.log(`Colony extinct at tick ${tick}`);
        break;
    }

    await new Promise((resolve) => setTimeout(resolve, 0.1));
}
