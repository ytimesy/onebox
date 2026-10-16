import { defineConfig } from "vitest/config";
export default defineConfig({
  root: "apps/web",
  build: { outDir: "../../dist", emptyOutDir: true, sourcemap: false },
  test: { include: ["../../packages/**/*.test.ts"], maxWorkers: 1 },
});
