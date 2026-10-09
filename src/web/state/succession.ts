// Following a dead ant to whoever took over its name. The sim keeps a bounded
// `heirs` map (deadId -> the ant that inherited its surname; see
// sim/names/generator.ts); the ant card and the pins both use this to stay on
// "the same" ant across deaths.
import type { ColonyState } from "../../sim/state";
import type { Ant, AntId } from "../../sim/ants/ant";

// A heir chain is at most HEIRS_CAP long; this just stops a corrupt map from
// looping forever.
const MAX_FOLLOW = 200;

// The ant to show for `id`: itself if alive, else the first living heir down
// the chain. The returned id is whichever that turned out to be, so a caller can
// keep tracking the heir from then on. `ant` is undefined when the chain ends
// at a dead ant with no heir (yet).
export function resolveAnt(state: ColonyState, id: AntId): { id: AntId; ant: Ant | undefined } {
    let current = id;
    for (let i = 0; i < MAX_FOLLOW; i++) {
        const ant = state.ants.get(current);
        if (ant) {
            return { id: current, ant };
        }
        const heir = state.heirs[current];
        if (heir === undefined) {
            return { id: current, ant: undefined };
        }
        current = heir;
    }
    return { id: current, ant: undefined };
}
