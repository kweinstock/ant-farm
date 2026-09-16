// The flee action handler. No decideFlee dispatcher lives here — the flee
// condition itself is a one-line check inside behavior.ts's decide() (it
// needs Perception fields this file has no other reason to touch), so
// fleeing.ts only supplies what act() calls once that check fires. Mirrors
// foraging.ts/undertaking.ts's "one file per surface behavior" shape.
import type { Ant } from "./ant";
import type { ColonyState } from "../state";
import { stepAwayFrom, moveTowardAvoiding, surfaceRouteStep } from "./movement";
import { deposit } from "../pheromones";
import { fieldToTile, manhattanDistance, type Position } from "../world/grid";
import { ALARM_DEPOSIT_AMOUNT, ALARM_MAX, ALARM_SPREAD_FRAC, PREDATOR_HOME_THREAT_RADIUS, PREDATOR_FLEE_AVOID_RADIUS, SPOOK_COOLDOWN_TICKS } from "../params";
import { applySurfaceMove } from "./foraging";
import type { ActResult } from "./jobs";

export function flee(state: ColonyState, ant: Ant): ActResult {
    const predator = state.env.predator ?? undefined;
    const hole = state.surface.holePos;

    // Running "toward the hole" is only safety if the hole is actually
    // clear. A predator camped on or near it (bug found in review — she can
    // linger right at the doorstep since that's where the ant traffic is)
    // makes "flee to the hole" run the ant straight at her instead of away.
    // In that case, just get distance from her; once she moves off, the next
    // tick's flee (still triggered by alarm/beingChased) resumes toward the
    // hole on its own.
    const holeCompromised =
        predator !== undefined && manhattanDistance(predator.pos, hole) <= PREDATOR_HOME_THREAT_RADIUS;

    let result: { position: Position; seed: number };
    if (holeCompromised) {
        result = stepAwayFrom(state.surface.grid, ant.location.pos, predator!.pos, state.rngSeed);
    } else if (predator !== undefined) {
        // Routed, not greedy — same reasoning as a laden forager's go-home
        // step (foraging.ts's surfaceRoute): a panicked ant still needs to
        // actually get around a rock cluster toward the hole, not stall
        // against it. Also steers each step clear of the predator's
        // immediate vicinity — bug found in review: plain routing toward the
        // hole only avoided terrain, so if she happened to be sitting on or
        // near the shortest path (without being close enough to the hole
        // itself to count as "camped"), a fleeing ant would walk straight at
        // her instead of around her.
        result = moveTowardAvoiding(
            state.surface.grid,
            fieldToTile(state.surface.grid, hole),
            ant.location.pos,
            predator.pos,
            PREDATOR_FLEE_AVOID_RADIUS,
            state.rngSeed,
        );
    } else {
        // Fleeing on alarm alone with no predator currently in state (she
        // may have just left) — plain route home, nothing to avoid.
        result = surfaceRouteStep(state.surface.grid, ant.location.pos, hole, state.rngSeed);
    }
    const moved = applySurfaceMove(state, ant, result);

    // Deposit alarm wherever the ant ends up — bundling "run" and "warn
    // everyone nearby" into one act, since act() only ever sees the Action,
    // not the Perception that explains why this particular ant is fleeing.
    const alarm = deposit(
        moved.surface.alarm,
        result.position.x,
        result.position.y,
        ALARM_DEPOSIT_AMOUNT,
        ALARM_MAX,
        ALARM_SPREAD_FRAC,
    );

    // Refresh the spook cooldown every tick this ant flees, not just once —
    // a predator that keeps her in sight for a while should keep it wound
    // back up, not let it start counting down mid-chase.
    return {
        ...moved,
        ant: { ...moved.ant, spookedUntil: state.simTime + SPOOK_COOLDOWN_TICKS },
        surface: { ...moved.surface, alarm },
    };
}