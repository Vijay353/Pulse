// Runs the API (with simulators) and the Vite dev server together.
import { spawn } from "node:child_process";
const procs = [
  spawn("node", ["--disable-warning=ExperimentalWarning", "--import", "tsx", "--watch", "apps/api/src/server.ts"], { stdio: "inherit", env: { ...process.env, SERVE_WEB: "false" } }),
  // NOTE: `shell: true` is required on Windows — without it, spawn("npx", ...)
  // fails with ENOENT because npx is an npx.cmd shim, not a bare executable.
  spawn("npx", ["vite"], { stdio: "inherit", shell: true }),
];
const stop = () => { for (const p of procs) p.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) {
  p.on("error", (err) => {
    console.error(`Could not start a dev process: ${err.message}`);
    stop();
  });
  p.on("exit", (c) => { if (c) stop(); });
}
