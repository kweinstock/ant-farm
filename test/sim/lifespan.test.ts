import { describe, expect, it } from "vitest";

import {
  createInitialState,
  MAX_LIFESPAN_TICKS,
  MIN_LIFESPAN_TICKS,
} from "../../src/sim/state";
import { step } from "../../src/sim";

describe("ant lifespan", () => {
  it("eventually kills the ant exactly once, within the configured lifespan range", () => {
    const state = createInitialState(12345);

    // 2000 comfortably clears MAX_LIFESPAN_TICKS (1000 in state.ts) so the
    // ant is guaranteed dead by the end, however the RNG rolled its lifespan.
    const result = step(state, 2000);

    const deathEvents = result.events.filter(
      (event) => event.kind === "death"
    );

    expect(result.state.ant).toBeNull();

    expect(deathEvents).toHaveLength(1);

    const deathEvent = deathEvents[0];

    // Ties this test to the actual roll range instead of just ">0" — catches
    // an off-by-one in the death check (e.g. `>` vs `>=` against
    // lifespanTicks) that ">0" alone would miss.
    expect(deathEvent.ageTicks).toBeGreaterThanOrEqual(MIN_LIFESPAN_TICKS);
    expect(deathEvent.ageTicks).toBeLessThanOrEqual(MAX_LIFESPAN_TICKS);
  });
});
