import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["verification/matrix-real-dataset.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    retry: 0,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
