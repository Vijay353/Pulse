import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    fileParallelism: false,
    pool: "forks",
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
