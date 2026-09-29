// Shared genetic-algorithm machinery for optimize-params.ts (sequential) and
// optimize-params-parallel.ts (worker-pool) — the search space, genome
// operators, and fitness ordering are identical between the two; only HOW
// each trial gets evaluated (one child process at a time vs. a pool of them
// against isolated sim copies) differs. Keeping this in one place means the
// two runners can never quietly drift apart on what "better" means.

// ---- the search space: name, bounds, and whether it's an integer knob ----
// The first batch (BASE_LAY_PROBABILITY..PILE_SPAWN_CHANCE) were the
// least-settled dials in the ongoing boom-bust balance issue. The rest were
// asked for explicitly: nurse aging, the whole pheromone trail channel, and
// the whole alarm channel. Bounds are centered on whatever's currently in
// params.ts, roughly halved/doubled — wide enough to actually search, not
// so wide the GA spends its budget on obviously-broken corners of the
// space. Add more entries here to widen the search further; each just
// needs to be a plain `export const NAME = <number>;` line in params.ts.
export type ParamSpec = { name: string; min: number; max: number; integer?: boolean };

export const SEARCH_SPACE: ParamSpec[] = [
    // Floor widened 0.02 -> 0.005: the seed-12345 diagnostic's genome sat
    // at 0.0667, under 5% into the old [0.02,1] range — the same
    // "pinned near a wall" signal the params below were widened for.
    { name: "BASE_LAY_PROBABILITY", min: 0.005, max: 1 },
    // Both widened downward after a 151-trial run's best genome landed
    // exactly on the old floor for each — NURSE_BROOD_PER_NURSE=3 (old
    // floor) and POPULATION_SOFT_TARGET=15 (old floor), the same "pinned at
    // the boundary" signal that FOOD_TILE_CAPACITY/MAX_PILES/PILE_SPAWN_
    // CHANCE gave before they were widened.
    { name: "NURSE_BROOD_PER_NURSE", min: 1, max: 12, integer: true },
    { name: "NURSE_LAY_HEADROOM", min: 1, max: 4 },
    // Floor widened 5 -> 3: STARTER_WORKER_COUNT is 20, so a soft target of
    // 15 (the seed-12345 genome's value, ~10% into the old [5,100] range)
    // already sat BELOW the colony's own starting population — the taper
    // was throttling laying from tick 0 before the colony had done
    // anything to actually overshoot. See params.ts's own value, raised to
    // 20 to match STARTER_WORKER_COUNT directly; widening the floor further
    // down is for the search to explore below that starting point if it
    // turns out to actually help, not because 5 itself was reached.
    { name: "POPULATION_SOFT_TARGET", min: 3, max: 100, integer: true },
    { name: "FOOD_STORE_LAY_HALT_RATIO", min: 0.02, max: 0.4 },
    // Widened after two full runs both drove FOOD_TILE_CAPACITY, MAX_PILES,
    // and PILE_SPAWN_CHANCE straight to their old ceilings and still
    // couldn't sustain even a ~30-50 ant colony — the winning genome was
    // asking for more headroom than the search space allowed, not settling
    // on a comfortable middle value. Ceiling raised again 7000 -> 10000
    // after the seed-12345 genome's FOOD_PILE_START_AMOUNT sat at 6169,
    // under 15% from the old ceiling; FOOD_TILE_CAPACITY's own ceiling
    // moved the same amount to keep it able to actually hold that much
    // (spawnFoodPiles caps a pile's amount at FOOD_TILE_CAPACITY).
    { name: "FOOD_TILE_CAPACITY", min: 500, max: 10000, integer: true },
    { name: "FOOD_PILE_START_AMOUNT", min: 50, max: 10000, integer: true },
    // No ceiling change: 1 is a hard, physical bound on a probability, not
    // an arbitrary search-space wall — nothing to widen past it.
    { name: "PILE_SPAWN_CHANCE", min: 0.03, max: 1 },
    // Ceiling widened 400 -> 600: seed-12345's genome sat at 345, ~16% from
    // the old ceiling.
    { name: "NURSE_AGE_THRESHOLD_TICKS", min: 50, max: 600, integer: true },
    { name: "MAX_TRAIL", min: 100, max: 1000, integer: true },
    { name: "EVAPORATION_FACTOR", min: 0.85, max: 0.99 },
    { name: "MIN_TRAIL", min: 0.5, max: 10 },
    { name: "SPREAD_FRAC", min: 0.1, max: 0.8 },
    { name: "FOLLOW_THRESHOLD", min: 1, max: 30, integer: true },
    { name: "DEPOSIT_AMOUNT", min: 10, max: 200, integer: true },
    { name: "ALARM_MAX", min: 50, max: 500, integer: true },
    // Floor widened 0.5 -> 0.3: seed-12345's genome sat at 0.5712, under 5%
    // into the old [0.5,0.98] range.
    { name: "ALARM_EVAPORATION_FACTOR", min: 0.3, max: 0.98 },
    { name: "ALARM_DEPOSIT_AMOUNT", min: 20, max: 300, integer: true },
    { name: "ALARM_SPREAD_FRAC", min: 0.1, max: 0.9 },
    { name: "ALARM_FLEE_THRESHOLD", min: 5, max: 100, integer: true },
    { name: "MAX_PILES", min: 10, max: 1000, integer: true },

    // ---- foraging memory ----
    { name: "FORAGING_TRIP_FAILURE_TICKS", min: 50, max: 400, integer: true },
    { name: "MAX_REMEMBERED", min: 1, max: 10, integer: true },
    // Floor widened 50 -> 10: seed-12345's genome sat at 73, under 3% into
    // the old [50,1000] range — and that value was actually BELOW
    // FORAGING_TRIP_FAILURE_TICKS (175), meaning a remembered food site
    // couldn't reliably survive one full round trip back to it. params.ts's
    // seed value raised to 250 (comfortably above the trip-failure
    // threshold) for the same reason; the floor here stays low so the
    // search can still go lower if that turns out to actually help, not
    // because 50 itself was the wall being tested against.
    { name: "MEMORY_TTL_TICKS", min: 10, max: 1000, integer: true },
    { name: "EMPTY_PATCH_TTL_TICKS", min: 50, max: 800, integer: true },
    // Ceiling widened 20 -> 30: seed-12345's genome sat at 17, ~16% from
    // the old ceiling.
    { name: "MAX_EMPTY_PATCHES_REMEMBERED", min: 1, max: 30, integer: true },

    // ---- teaching & learned trust ----
    { name: "PATCH_QUALITY_EMA_ALPHA", min: 0.05, max: 0.9 },
    { name: "MAX_PREDATOR_SIGHTINGS", min: 1, max: 15, integer: true },
    { name: "PREDATOR_SIGHTING_TTL_TICKS", min: 100, max: 1500, integer: true },
    { name: "PATCH_QUALITY_RICHNESS_WEIGHT", min: 0.1, max: 5 },
    { name: "PREDATOR_SIGHTING_RICHNESS_WEIGHT", min: 0.1, max: 5 },
    { name: "ABSORB_MAX_TRANSFER", min: 1, max: 6, integer: true },
    // All three share ONE range and get sorted into valid MIN < BASELINE <
    // MAX order by repairLearningTrio() after every random/mutate/crossover
    // (see that function). Previously these were disjoint fixed windows
    // (MIN [0.05,0.4], BASELINE [0.6,1.4], MAX [1.6,5]) specifically to
    // guarantee valid ordering without a repair step — but that carves out
    // two permanent dead zones (0.4-0.6 and 1.4-1.6) the GA could never
    // search, and a real run's best genome landed with LEARNING_MAX pinned
    // at 1.6 — its OWN floor — meaning it wanted a smaller baseline-to-max
    // gap than the disjoint design could ever represent (e.g. baseline=0.9,
    // max=1.1 was structurally impossible before). Sharing one range and
    // repairing after the fact removes the dead zones entirely: any valid
    // ordering, including a tight gap right above baseline, is reachable.
    { name: "LEARNING_MIN", min: 0.05, max: 5 },
    { name: "LEARNING_BASELINE", min: 0.05, max: 5 },
    { name: "LEARNING_MAX", min: 0.05, max: 5 },
    { name: "REINFORCE_STEP", min: 0.01, max: 0.5 },
    { name: "KNOWLEDGE_SHARE_CHANCE", min: 0.01, max: 0.6 },

    // ---- colony-level decisions ----
    // Floor widened 100 -> 50: seed-12345's genome sat at 193, ~10% into
    // the old [100,1000] range.
    { name: "DECISION_INTERVAL_TICKS", min: 50, max: 1000, integer: true },
    // Widened downward for the same reason as above: the same 151-trial
    // run's best genome landed exactly on the old floor (0.3).
    { name: "DECISION_THRESHOLD", min: 0.05, max: 0.95 },
    { name: "GRAVEYARD_THREAT_RADIUS", min: 5, max: 30, integer: true },
    { name: "GRAVEYARD_THREAT_INCREMENT", min: 1, max: 5, integer: true },
    { name: "GRAVEYARD_THREAT_DECAY", min: 0.9, max: 0.999 },
    { name: "GRAVEYARD_THREAT_CAP", min: 50, max: 400, integer: true },
    // Ceiling widened 15 -> 20: seed-12345's genome sat at 13, ~13% from
    // the old ceiling. Still well under BASE_TEMP.SUMMER (28) plus the
    // HEAT weather mod (+8), so a cold-expansion proposal still can't fire
    // in genuinely warm conditions.
    { name: "NURSERY_COLD_TEMP", min: 0, max: 20, integer: true },
    { name: "NURSERY_COLD_SCALE", min: 2, max: 30, integer: true },
    // Floor widened 10 -> 5: seed-12345's genome sat at 16, exactly 10%
    // into the old [10,70] range.
    { name: "FOOD_STORE_TRAVEL_THRESHOLD", min: 5, max: 70, integer: true },
    { name: "FOOD_STORE_TRAVEL_SCALE", min: 5, max: 50, integer: true },
];

export type Genome = Record<string, number>;

function randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

// LEARNING_MIN/BASELINE/MAX share one search range (see the SEARCH_SPACE
// comment above) and are sorted into valid order here — this is the repair
// step that makes sharing a range safe. A minimum gap between each pair
// keeps reinforce()'s clamp(value, LEARNING_MIN, LEARNING_MAX) from ever
// degenerating to a single point or an inverted range. Applied after every
// random draw, mutation, and crossover, since each of those can otherwise
// produce an invalid ordering independently.
const LEARNING_TRIO = ["LEARNING_MIN", "LEARNING_BASELINE", "LEARNING_MAX"] as const;
const LEARNING_TRIO_GAP = 0.05;

function repairLearningTrio(genome: Genome): Genome {
    const bounds = SEARCH_SPACE.find((s) => s.name === "LEARNING_MIN")!;
    let [min, baseline, max] = LEARNING_TRIO.map((name) => genome[name]).sort((a, b) => a - b);

    baseline = Math.max(baseline, min + LEARNING_TRIO_GAP);
    max = Math.max(max, baseline + LEARNING_TRIO_GAP);

    // If pushing max up ran past the shared range's own ceiling, pull the
    // whole trio back down together rather than clamping max alone (which
    // would silently re-collapse the gap it just enforced).
    if (max > bounds.max) {
        max = bounds.max;
        baseline = Math.min(baseline, max - LEARNING_TRIO_GAP);
        min = Math.min(min, baseline - LEARNING_TRIO_GAP);
    }

    return {
        ...genome,
        LEARNING_MIN: Number(min.toFixed(4)),
        LEARNING_BASELINE: Number(baseline.toFixed(4)),
        LEARNING_MAX: Number(max.toFixed(4)),
    };
}

export function randomGenome(): Genome {
    const genome: Genome = {};
    for (const spec of SEARCH_SPACE) {
        const raw = randomInRange(spec.min, spec.max);
        genome[spec.name] = spec.integer ? Math.round(raw) : Number(raw.toFixed(4));
    }
    return repairLearningTrio(genome);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function mutate(genome: Genome, mutationRate: number, mutationStrength: number): Genome {
    const next: Genome = { ...genome };
    for (const spec of SEARCH_SPACE) {
        if (Math.random() >= mutationRate) continue;
        const range = spec.max - spec.min;
        const delta = (Math.random() * 2 - 1) * range * mutationStrength;
        const mutated = clamp(next[spec.name] + delta, spec.min, spec.max);
        next[spec.name] = spec.integer ? Math.round(mutated) : Number(mutated.toFixed(4));
    }
    return repairLearningTrio(next);
}

// Builds a whole starting generation OUT OF the seed genome, not just
// alongside it: slot 0 is the exact seed (so its confirmed result is always
// on record unmutated), every other slot is a mutation of it. Fixes a real
// gap in the original seeding — before this, only one slot was the seed and
// the other POP_SIZE-1 were pulled from randomGenome(), completely
// unrelated to it; mutation/crossover only ever touches the seed's genes
// starting generation 2, so generation 1 was mostly wasted compute on
// blind guesses instead of refining the one genome already known to work.
// This way every candidate in generation 1 is a variation on the best
// known starting point, not a coin flip across the whole search space.
export function seedGenerationFromBest(popSize: number, seed: Genome, mutationRate: number, mutationStrength: number): Genome[] {
    const population: Genome[] = [seed];
    while (population.length < popSize) {
        population.push(mutate(seed, mutationRate, mutationStrength));
    }
    return population;
}

export function crossover(a: Genome, b: Genome): Genome {
    const child: Genome = {};
    for (const spec of SEARCH_SPACE) {
        child[spec.name] = Math.random() < 0.5 ? a[spec.name] : b[spec.name];
    }
    return repairLearningTrio(child);
}

// ---- writing a genome into params.ts's text ----
export function applyGenome(paramsText: string, genome: Genome): string {
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

// ---- reading a genome BACK out of params.ts's text (the inverse of applyGenome) ----
// Every run used to start from POP_SIZE fully random genomes, discarding
// whatever the previous run had already discovered — a fresh 16x8 run's
// generation 1 has no way to know a prior 32x16 run already found something
// that survives 50x longer. Reading the genome currently sitting in
// params.ts and seeding it into generation 1 means a new run always starts
// at least as strong as the last one's result, instead of re-walking the
// same ground from scratch every time.
export function readGenomeFromText(paramsText: string): Genome {
    const genome: Genome = {};
    for (const spec of SEARCH_SPACE) {
        const re = new RegExp(`export const ${spec.name} = ([0-9.]+);`);
        const match = paramsText.match(re);
        if (!match) {
            throw new Error(`ga-core: couldn't find "export const ${spec.name} = <number>;" in params.ts while reading the seed genome — did it get renamed?`);
        }
        const raw = Number(match[1]);
        genome[spec.name] = spec.integer ? Math.round(raw) : raw;
    }
    // Guards against a params.ts whose LEARNING trio was hand-edited (or
    // saved by a pre-redesign version of this script) into an order the
    // current repair step wouldn't have produced on its own.
    return repairLearningTrio(genome);
}

export type TrialOutput = { meanTicksSurvived: number; meanAvgPopulation: number; meanPeakPopulation: number; meanBirths: number; survivedAll: boolean; maxTicks: number; aborted?: boolean; timedOut?: boolean };
export type Scored = { genome: Genome; trial: TrialOutput };

// A colony that never lays a single egg can't overshoot its food supply, so
// it trivially outlasts any colony that actually tries to grow — "longest
// survival wins" alone rewards that non-answer over a real one, and it got
// a lot easier to fall into once worker lifespans stretched into the
// hundreds of thousands of ticks (a founding cohort that never reproduces
// can now coast for most of a trial window on nothing but its own long
// natural lifespan). Reproducing at all is checked FIRST, ahead of ticks
// survived, so a genome has to actually function as a colony before
// survival duration is allowed to matter.
export const MIN_BIRTHS_TO_COUNT_AS_A_COLONY = 1;

// A colony that booms well past the target population isn't "doing
// better," it's mid-overshoot — the same pattern that precedes a
// starvation crash, just not far enough along yet to show up as a shorter
// survival time. Found by validation: with maxTicks in the millions,
// "survived the full window" (the only case the population-closeness
// tiebreak below actually reaches) essentially never happens, so on a raw
// ticks-survived comparison a colony that grows to 90+ ants and crashes at
// tick 13000 beats one that holds steady near 30 forever — a bigger boom
// buys a few thousand more ticks before its own inevitable collapse, and
// that's the ONLY signal compareTrials saw. Gating out overshoot before
// comparing ticks survived stops the GA from being rewarded for finding
// bigger booms instead of actual stability.
//
// Gated on PEAK population, not the trial's average: a genome that booms to
// 90 by tick 3000, crashes to 1 ant by tick 4500, and then sits at
// population 1 for the remaining 15000+ ticks of the window still averages
// out to a deceptively on-target ~30 — the long near-zero tail dilutes the
// boom in the mean. Found exactly this in validation: a "best" genome
// reporting avgPop=30.8 turned out to be that boom-then-flatline, not a
// stable colony. Peak population isn't fooled by the tail the same way.
export const MAX_POPULATION_OVERSHOOT = 10; // multiple of targetAvgPopulation a trial's PEAK population may reach before it's treated as unfit, regardless of ticks survived

// Longest survival wins (among genomes that reproduced and didn't
// overshoot); ties (very common once several candidates survive the whole
// window at maxTicks) fall to whichever sat closest to targetAvgPopulation.
// Deliberately NOT a blended score — a config that lasts longer wins
// outright regardless of population, and only among equally-long survivors
// does population matter at all.
export function makeCompareTrials(targetAvgPopulation: number): (a: TrialOutput, b: TrialOutput) => number {
    const overshootCeiling = targetAvgPopulation * MAX_POPULATION_OVERSHOOT;
    return (a, b) => {
        const aReproduced = a.meanBirths >= MIN_BIRTHS_TO_COUNT_AS_A_COLONY;
        const bReproduced = b.meanBirths >= MIN_BIRTHS_TO_COUNT_AS_A_COLONY;
        if (aReproduced !== bReproduced) {
            return aReproduced ? -1 : 1;
        }
        const aOvershot = a.meanPeakPopulation > overshootCeiling;
        const bOvershot = b.meanPeakPopulation > overshootCeiling;
        if (aOvershot !== bOvershot) {
            return aOvershot ? 1 : -1;
        }
        if (a.meanTicksSurvived !== b.meanTicksSurvived) {
            return b.meanTicksSurvived - a.meanTicksSurvived;
        }
        const aDistance = Math.abs(a.meanAvgPopulation - targetAvgPopulation);
        const bDistance = Math.abs(b.meanAvgPopulation - targetAvgPopulation);
        return aDistance - bDistance;
    };
}

export function tournamentSelect(scored: Scored[], compareTrials: (a: TrialOutput, b: TrialOutput) => number, tournamentSize: number): Genome {
    let best: Scored | undefined;
    for (let i = 0; i < tournamentSize; i++) {
        const candidate = scored[Math.floor(Math.random() * scored.length)];
        if (best === undefined || compareTrials(candidate.trial, best.trial) < 0) best = candidate;
    }
    return best!.genome;
}

export function formatTrial(trial: TrialOutput): string {
    return `ticks=${trial.meanTicksSurvived.toFixed(0)}/${trial.maxTicks}  avgPop=${trial.meanAvgPopulation.toFixed(1)}  peakPop=${trial.meanPeakPopulation.toFixed(1)}  births=${trial.meanBirths.toFixed(1)}  survivedAll=${trial.survivedAll}${trial.aborted ? "  (aborted early: population overshoot)" : ""}${trial.timedOut ? "  (TIMED OUT: scored as failed)" : ""}`;
}

export function printTable(rows: string[][], indent = "  "): void {
    const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
    for (const row of rows) {
        console.log(indent + row.map((cell, col) => cell.padEnd(widths[col])).join("  "));
    }
}

export function printGenomeTable(genome: Genome): void {
    printTable(SEARCH_SPACE.map((spec) => [spec.name, `= ${genome[spec.name]}`, `[${spec.min}, ${spec.max}]`]), "    ");
}

export function printSearchSpaceTable(): void {
    printTable(SEARCH_SPACE.map((spec) => [spec.name, `[${spec.min}, ${spec.max}]`, spec.integer ? "integer" : "float"]), "    ");
}

export function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

// ---- CLI flags: `--flag value`, `--flag=value`, or the bare `-h` ----
// hyphen/case-insensitive, so "--pop-size" and "--popsize" both match the
// same key.
export function parseArgs(argv: string[]): Map<string, string> {
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

export type FlagSpec = { flag: string; env: string; default: string; help: string };
