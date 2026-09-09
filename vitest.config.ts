import { defineConfig } from "vitest/config";

// The sim tests step tens of thousands of ticks. Phase 6 grew the nest ~9x
// and Phase 7 the surface ~2x, so several tests (balance, weather, ecology,
// determinism, learning) run 5-25s each and tip over vitest's 5s default —
// especially under parallel-pool load. A generous global timeout beats
// sprinkling per-test overrides that then go stale every time the world
// grows; individual `it(..., n)` overrides below this value have been
// removed. If a test genuinely hits 60s it's a hang, not a slow machine.
export default defineConfig({
    test: {
        testTimeout: 60000,
        hookTimeout: 60000,
    },
});
