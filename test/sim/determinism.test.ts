import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/sim/state";
import { step } from "../../src/sim";

describe("simulation determinism", () => {
  // toEqual does a deep structural comparison, including the grid's
  // Uint8Array — that's fine because everything in ColonyState is plain data
  // (no closures, no class instances), which is exactly the property this
  // test is checking for.
  it("produces the same state from the same seed", () => {
    const seed = 12345;

    const stateA = createInitialState(seed);
    const stateB = createInitialState(seed);

    const resultA = step(stateA, 50);
    const resultB = step(stateB, 50);

    expect(resultA.state).toEqual(resultB.state);
  });

  // The test most likely to catch a bug in step()'s loop: if singleTick ever
  // reads dtTicks, or `step` mutated shared state instead of threading a
  // fresh value through each iteration, this diverges from the single big
  // step even though the "same seed" test above would still pass.
  it("produces the same result for one 50-tick step or fifty 1-tick steps", () => {
    const seed = 12345;

    const initialState = createInitialState(seed);

    const bigStep = step(initialState, 50);

    let smallStepState = createInitialState(seed);

    for (let i = 0; i < 50; i++) {
      smallStepState = step(smallStepState, 1).state;
    }

    expect(bigStep.state).toEqual(smallStepState);
  });

  // 50 ticks is before the first worker ages into a forager (age 150), so the
  // trail field, surface hazard roll, and food memory never fire in the check
  // above. Run long enough to exercise all of Phase 4: foragers on trips,
  // trail deposits + evaporation accumulating, hazard deaths on the surface.
  // This is also the check that the MIN_TRAIL evaporation floor keeps the
  // Float32Array byte-identical between one big step and many small ones.
  it("stays identical through Phase 4 mechanics: 400 ticks, one call vs 400", () => {
    const seed = 24680;
    const big = step(createInitialState(seed), 400);

    let small = createInitialState(seed);
    for (let i = 0; i < 400; i++) small = step(small, 1).state;

    expect(big.state).toEqual(small);
  });
});
