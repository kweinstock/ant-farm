// Browser entry for the Ant Farm view. index.html now loads this file
// directly (the old /src/main.ts template placeholder is gone).
//
// PHASE 2: local mode only. main.ts owns both the sim clock (this file's
// setInterval below) and a mutable `state` slot; render/engine.ts just reads
// that slot on every animation frame — it never calls step() itself. That
// split is what Phase 6 reuses: swap the setInterval block below for
// net/socket.ts writing into the same `state` slot from incoming
// Snapshot/Diff messages, and engine.ts, grid.ts, and ants.ts don't change.
//
// Eventual full boot sequence (not built yet):
//   1. visitor-id.ts  -> get/create anonymous UUID in localStorage
//   2. store.ts       -> create empty client state
//   3. socket.ts      -> connect wss /ant-farm/api/stream; feed Snapshot/Diff into store
//   4. api.ts         -> initial GETs: pins, stats
//   6. ui/*           -> mount toolbar, ant list, HUD, pinned tray

import { createInitialState } from "../sim/state";
import { step } from "../sim";
import { SOURCE, TICK_INTERVALS_MS } from "./config";
import { startRenderLoop } from "./render/engine";

const canvas = document.getElementById("ant-farm-canvas");

// Fail loudly and specifically instead of letting engine.ts's
// canvas.getContext(...) throw a confusing null-reference error if the id in
// index.html and this lookup ever drift apart.
if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Expected a <canvas id="ant-farm-canvas"> element in index.html');
}

// Fixed, same as scripts/print-sim.ts — deterministic while you're tuning
// behavior. Once this is the actual public page (Phase 6+), the colony is
// founded once server-side and this local seed stops mattering.
const seed = 12345;

// `let` + reassignment (not mutating fields on a fixed object) because step()
// returns a brand-new state object each call — matches the sim's pure,
// nothing-mutated-in-place contract. The closure passed to startRenderLoop
// below always reads whatever this variable currently holds.
let state = createInitialState(seed)

startRenderLoop(canvas, () => state);

// NOTE: SOURCE is typed as the single literal "local" until Phase 6 actually
// introduces a "stream" branch — at that point this comparison needs SOURCE's
// declared type widened to "local" | "stream" (config.ts) or TypeScript will
// treat the else branch below as unreachable dead code.
if (SOURCE === "local") {
    setInterval(() => {
        state = step(state, 1).state;
    }, TICK_INTERVALS_MS);
} else {
    // Phase 6
}
