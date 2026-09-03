import { defineConfig } from "vite";

// This project is served under a path prefix on kweinstock.dev, never at the
// root. `base` makes every built asset URL absolute under that prefix so it
// works the same on production, testing, and `vite preview`.
export default defineConfig({
  base: "/ant-farm/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
