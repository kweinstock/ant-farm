import { defineConfig } from "vitest/config";

// The sim tests step tens of thousands of ticks. Since Phase 6 grew the nest
// (~9x) and surface, a few of them (learning, balance, determinism, surface)
// run several seconds each and tip over vitest's 5s default when the pool is
// under load. A generous global timeout is simpler than sprinkling per-test
// overrides — none of these should ever legitimately take this long, so if
// one does hit the cap it's a real hang, not a slow machine.
export default defineConfig({
    test: {
        testTimeout: 40000,
        hookTimeout: 40000,
    },
});
