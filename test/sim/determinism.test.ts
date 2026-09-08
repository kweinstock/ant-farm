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

  // Phase 5: environment advances at tick-order step 2 and consumes rng for
  // the weather Markov chain and the predator (a variable 1-2 calls per tick
  // depending on env state). 3000 ticks is long enough for dozens of weather
  // transitions and at least one predator visit, so this catches any place
  // advanceEnvironment's rng cadence diverges between one big step and many.
  it("stays identical through Phase 5 environment: 3000 ticks, one call vs 3000", () => {
    const seed = 90210;
    const big = step(createInitialState(seed), 3000);

    let small = createInitialState(seed);
    for (let i = 0; i < 3000; i++) small = step(small, 1).state;

    expect(big.state).toEqual(small);
  }, 20000);

  // A forced hard winter puts the per-worker cold-death roll (index.ts's
  // worker loop) in play every tick, on top of weather + predator — the
  // densest RNG path the sim has. climateOverride is test-only scaffolding
  // but the determinism guarantee still has to hold with it set.
  it("stays identical with the cold-death roll active: forced winter, 1500 ticks", () => {
    const seed = 4242;
    const override = { season: "WINTER", weather: "SNOW" } as const;

    const big = step(createInitialState(seed, override), 1500);

    let small = createInitialState(seed, override);
    for (let i = 0; i < 1500; i++) small = step(small, 1).state;

    expect(big.state).toEqual(small);
  }, 20000);
});
