// the teaching pass. Ants that share a room compare notes — the
// richest one (memory.ts's richness()) teaches the others via absorb().
// Run once per tick from index.ts, same shape as workforce.ts's
// reassignJobs: one function over the whole ants Map, not folded into the
// per-ant sense->decide->act loop, because teaching needs to see PAIRS of
// ants at once — perceive/decide/act is strictly one-ant-at-a-time and
// read-only, structurally unable to let one ant's memory affect another's.
import type { Ant, AntId } from "../ants/ant";
import { absorb, richness } from "../ants/memory";
import { chamberIdAt } from "../world/nest";
import type { ColonyState } from "../state";
import { rng } from "../rng";
import { KNOWLEDGE_SHARE_CHANCE } from "../params";

export function spreadKnowledge(state: ColonyState): { ants: Map<AntId, Ant>; rngSeed: number } {
    const groups = new Map<string, Ant[]>();
    for (const ant of state.ants.values()) {
        if (ant.caste !== "WORKER" || ant.location.where !== "nest") continue;
        const chamberId = chamberIdAt(state.nest, ant.location.pos);
        if (chamberId === undefined) continue;

        const group = groups.get(chamberId);
        if (group) {
            group.push(ant);
        } else {
            groups.set(chamberId, [ant]);
        }
    }

    let seed = state.rngSeed;
    const next = new Map(state.ants);
    let changed = false;

    for (const group of groups.values()) {
        if (group.length < 2) continue;

        const roll = rng(seed);
        seed = roll.seed;
        if (roll.value >= KNOWLEDGE_SHARE_CHANCE) continue;

        const sorted = [...group].sort(
            (a, b) => richness(b.memory, state.simTime) - richness(a.memory, state.simTime),
        );
        const teacher = sorted[0];

        for (const learner of sorted.slice(1)) {
            const memory = absorb(learner.memory, teacher.memory, state.simTime);
            next.set(learner.id, { ...learner, memory });
            changed = true;
        }
    }

    return { ants: changed ? next : state.ants, rngSeed: seed };
}