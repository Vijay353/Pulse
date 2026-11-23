import { defineConfig, devices } from "@playwright/test";

const PORT = 8799;
/** V3 CH-20: a second instance with the visitor gate on, for tests/e2e/access-gate.spec.ts only. */
const GATE_PORT = 8798;
/** CH-17/18/20: a third instance in pitch mode on the Group plan, for tests/e2e/pitch-mode.spec.ts only. */
const PITCH_PORT = 8797;
const server = (port: number, env: Record<string, string> = {}, health = "/api/health") => ({
  command: `node --disable-warning=ExperimentalWarning --import tsx apps/api/src/server.ts`,
  url: `http://127.0.0.1:${port}${health}`,
  env: { PORT: String(port), DB_PATH: ":memory:", READBACK_INTERVAL_MS: "50", ...env },
  reuseExistingServer: false,
  timeout: 60000,
});

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", testIgnore: /(access-gate|pitch-mode)\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORT}` } },
    { name: "gate", testMatch: /access-gate\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${GATE_PORT}` } },
    { name: "pitch", testMatch: /pitch-mode\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PITCH_PORT}` } },
  ],
  webServer: [
    server(PORT),
    // Test-only gate values for a non-production instance.
    server(GATE_PORT, { ACCESS_GATE: "on", ACCESS_PIN: "4826", SESSION_SECRET: "e2e-gate-session-secret-0123456789abcdef" }, "/healthz"),
    server(PITCH_PORT, { DEMO_MODE: "pitch", PLAN: "group" }),
  ],
});
