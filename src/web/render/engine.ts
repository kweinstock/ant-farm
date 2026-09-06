// This file only draws — it never calls step() or otherwise changes state.
// That boundary is deliberate and is the one thing in Phase 2 worth keeping
// intact going forward: `getState` is a closure that reads whatever the
// caller's current state variable holds *at draw time*, not a value handed
// in once at startup. In Phase 2, main.ts's setInterval is what mutates that
// variable. In Phase 6, net/socket.ts applying incoming Diffs will mutate it
// instead — this function doesn't need to know or care which, so it survives
// that swap completely unmodified.
import type { ColonyState } from "../../sim/state";
import { CELL_SIZE } from "../config";
import { renderGrid } from "./grid";
import { renderResources } from "./resources";
import { renderBrood } from "./brood";
import { renderAnts } from "./ants";

export function startRenderLoop(canvas: HTMLCanvasElement, getState: () => ColonyState,): void {
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("Could not get 2D canvas context");
  }

  const ctx: CanvasRenderingContext2D = context;

  function render(): void {
    const state = getState();

    // Re-derived and reassigned every frame even though the grid is static
    // post-Phase-3a (no digging mechanic). Setting .width/.height clears the
    // canvas as a side effect regardless of whether the value actually
    // changed — wasteful but harmless at 24x16 (960x640). Hoist outside
    // render() if the grid is ever confirmed to never resize mid-run.
    canvas.width = state.grid.width * CELL_SIZE;
    canvas.height = state.grid.height * CELL_SIZE;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Painter's order, back to front: tiles, then food, then brood, then
    // ants on top (an ant standing on food/brood should be visible).
    renderGrid(ctx, state.grid, state.nest);
    renderResources(ctx, state);
    renderBrood(ctx, state);
    renderAnts(ctx, state);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}