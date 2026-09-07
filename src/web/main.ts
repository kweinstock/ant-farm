// Browser entry for the Ant Farm view. index.html loads this file directly.
//
// PHASE 2 (still true): local mode only — main.ts owns both the sim clock
// (setInterval below) and a mutable `state` slot; render/engine.ts just
// reads that slot every animation frame, never calls step() itself.
//
// PHASE 3b: the single <canvas id="ant-farm-canvas"> is gone. index.html
// now has a plain <div id="ant-farm-views"> that ui/view-switch.ts
// populates with two canvases (one per coordinate space) and hands back —
// this file no longer looks up a canvas by id itself.
//
// PHASE 4: mountViews also hands back renderOptions (the Trails toggle's
// live state) — passed straight through to startRenderLoop unchanged,
// same "own it in one place, thread it through" pattern as everything else
// here.
import { createInitialState } from "../sim/state";
import { step } from "../sim";
import { SOURCE, TICK_INTERVALS_MS } from "./config";
import { startRenderLoop } from "./render/engine";
import { mountViews } from "./ui/view-switch";

const viewsContainer = document.getElementById("ant-farm-views");

if (!(viewsContainer instanceof HTMLElement)) {
    throw new Error('Expected a <div id="ant-farm-views"> element in index.html');
}

const { nestCanvas, surfaceCanvas, renderOptions } = mountViews(viewsContainer);

// Fixed, same as scripts/print-sim.ts — deterministic while tuning behavior.
const seed = 12345;

let state = createInitialState(seed)

startRenderLoop(nestCanvas, surfaceCanvas, () => state, renderOptions);

if (SOURCE === "local") {
    setInterval(() => {
        state = step(state, 1).state;
    }, TICK_INTERVALS_MS);
} else {
    // Phase 6
}