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
import { QUEEN_MAX_LIFESPAN_TICKS } from "../src/sim/params";

// CLI args, not env vars — `npm run` scripts on Windows go through cmd.exe
// by default, where inline `VAR=value command` assignment doesn't work, so
// args baked straight into the package.json script string are what stays
// portable. --key=value or --key value both work; env vars are still read
// as a fallback for ad-hoc runs from a POSIX shell.
const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const eq = argv.find((a) => a.startsWith(`--${flag}=`));
    if (eq) return eq.slice(flag.length + 3);
    const idx = argv.indexOf(`--${flag}`);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}
// --full: the actual multi-million-tick diagnostic trial, same seed as the
// default below (that's "the seed in code" trial-runner.ts's own trials also
// use), run out to the queen's own max lifespan — same reasoning
// trial-runner.ts's standalone default uses: "survived" should mean "made it
// through one queen's natural life," not an arbitrary short smoke window.
const FULL = argv.includes("--full");

const seed = Number(argValue("seed") ?? process.env.SIM_SEED ?? 12345);

// Raised from Phase 2's 1001 — that was sized for watching one ant's single
// lifespan (500-1000 ticks). Population growth via egg -> larva -> pupa ->
// adult (colony/brood.ts's stage durations) needs more runway than that to
// show anything interesting happening. Overridable via --max-ticks (or
// --full, for the real diagnostic run) — see HISTOGRAM_BUCKET_TICKS below,
// that's the whole point of tracking deaths bucketed over time rather than
// just a running cumulative total.
const MAX_TICKS = Number(argValue("max-ticks") ?? process.env.SIM_MAX_TICKS ?? (FULL ? QUEEN_MAX_LIFESPAN_TICKS : 20000));

const SUMMARY_INTERVAL_TICKS = FULL ? 20000 : 200;

// How wide a time bucket the death histogram groups into. Tied to
// SUMMARY_INTERVAL_TICKS rather than a fraction of MAX_TICKS — bucketing by
// MAX_TICKS/20 looks fine on paper but is useless the moment a run collapses
// well short of the full window (a colony that goes extinct at tick 420k
// against a 16.2M-tick --full run would dump its entire death history into
// one row of a 810k-wide bucket, exactly the "just a cumulative total"
// resolution this histogram exists to avoid). Tying it to the print
// cadence instead means resolution always matches how granular the run
// actually reads, regardless of how far it got.
const HISTOGRAM_BUCKET_TICKS = Number(argValue("bucket-ticks") ?? process.env.SIM_HISTOGRAM_BUCKET_TICKS ?? SUMMARY_INTERVAL_TICKS);

let state = createInitialState(seed);

const CAUSES: DeathEvent["cause"][] = ["oldAge", "starvation", "predator", "cold", "exposure"];
// "QUEEN" isn't split by job (see DeathEvent's comment — her `job` field is
// unused); NURSE/FORAGER are the two worker jobs (ant.ts's Job type).
const ROLES = ["QUEEN", "NURSE", "FORAGER"] as const;
type Role = (typeof ROLES)[number];

function roleOf(event: DeathEvent): Role {
    return event.caste === "QUEEN" ? "QUEEN" : (event.job ?? "FORAGER");
}

function emptyHistogramRow(): Record<Role, number> {
    return { QUEEN: 0, NURSE: 0, FORAGER: 0 };
}

const deathsByCause: Record<DeathEvent["cause"], number> = {
    oldAge: 0,
    starvation: 0,
    predator: 0,
    cold: 0,
    exposure: 0,
};

// cause -> role -> count, one entry per HISTOGRAM_BUCKET_TICKS-wide window —
// lets the suggested diagnostic ("is nurse starvation driving the
// collapse?") be read directly off which bucket it spikes in, rather than
// inferred from population symptoms alone.
const deathHistogram = new Map<number, Record<DeathEvent["cause"], Record<Role, number>>>();

function bucketFor(tick: number): Record<DeathEvent["cause"], Record<Role, number>> {
    const bucketIndex = Math.floor((tick - 1) / HISTOGRAM_BUCKET_TICKS);
    let bucket = deathHistogram.get(bucketIndex);
    if (!bucket) {
        bucket = {
            oldAge: emptyHistogramRow(),
            starvation: emptyHistogramRow(),
            predator: emptyHistogramRow(),
            cold: emptyHistogramRow(),
            exposure: emptyHistogramRow(),
        };
        deathHistogram.set(bucketIndex, bucket);
    }
    return bucket;
}

function printHistogram() {
    console.log();
    console.log(`Death histogram (${HISTOGRAM_BUCKET_TICKS}-tick buckets), cause x role:`);

    const bucketIndices = Array.from(deathHistogram.keys()).sort((a, b) => a - b);
    if (bucketIndices.length === 0) {
        console.log("  (no deaths recorded)");
        return;
    }

    // Only columns that saw at least one death anywhere in the run — most
    // cause/role combos never fire (a queen never crosses the surface, so
    // predator/exposure/QUEEN stay at zero all run) and printing all 15
    // would bury the columns that actually matter.
    const columns = CAUSES.flatMap((c) => ROLES.map((r) => ({ cause: c, role: r })))
        .filter(({ cause, role }) => bucketIndices.some((i) => deathHistogram.get(i)![cause][role] > 0));

    const rangeWidth = 22;
    const colWidth = 14;
    const header = `  ${"tick range".padEnd(rangeWidth)}` + columns.map(({ cause, role }) => `${cause}/${role}`.padStart(colWidth)).join("");
    console.log(header);
    for (const bucketIndex of bucketIndices) {
        const bucket = deathHistogram.get(bucketIndex)!;
        const rangeStart = bucketIndex * HISTOGRAM_BUCKET_TICKS + 1;
        const rangeEnd = rangeStart + HISTOGRAM_BUCKET_TICKS - 1;
        const range = `${rangeStart}-${rangeEnd}`.padEnd(rangeWidth);
        const cells = columns.map(({ cause, role }) => bucket[cause][role].toString().padStart(colWidth)).join("");
        console.log(`  ${range}${cells}`);
    }
}

console.log(`Seed: ${seed}`);
console.log();

for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const result = step(state, 1);
    state = result.state;

    for (const event of result.events) {
        if (event.kind === "death") {
            deathsByCause[event.cause] += 1;
            bucketFor(tick)[event.cause][roleOf(event)] += 1;
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

printHistogram();
