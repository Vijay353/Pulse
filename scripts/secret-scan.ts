/**
 * Fails if secret-looking values appear in source, fixtures or the built client bundle,
 * or if server-only configuration names leak into the browser build.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "packages", "scripts", "tests", "data/templates", ".env.example", "README.md", "docs"];
const skip = /node_modules|\.db$|\.png$|\.woff2?$|\.xlsx$/;
const patterns: [string, RegExp][] = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Private key block", /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
  ["Bearer token literal", /Bearer [A-Za-z0-9._-]{40,}/],
  // V3 CH-20: a real access PIN must never be committed. Test files use test-only values and are exempt.
  ["Access PIN value", /ACCESS_PIN\s*[=:]\s*["']?\d{4}\b/],
];
const exempt = (f: string, name: string) => f.endsWith("secret-scan.ts") || (name === "Access PIN value" && /^tests[\\/]/.test(f));
const files: string[] = [];
const walk = (p: string) => {
  if (!existsSync(p) || skip.test(p)) return;
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else files.push(p);
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const [name, re] of patterns) if (re.test(text) && !exempt(f, name)) { console.error(`✗ ${name} in ${f}`); bad++; }
}
const dist = "apps/web/dist";
if (existsSync(dist)) {
  const bundle: string[] = [];
  const w = (p: string) => (statSync(p).isDirectory() ? readdirSync(p).forEach((f) => w(join(p, f))) : /\.(js|html|css)$/.test(p) && bundle.push(p));
  w(dist);
  for (const f of bundle) {
    const t = readFileSync(f, "utf8");
    for (const leak of ["UBER_ADS_TOKEN", "POS_WEBHOOK_SECRET", "ANTHROPIC_API_KEY", "local-mock-ads-token", "local-mock-pos-webhook-secret", "ACCESS_PIN", "SESSION_SECRET"])
      if (t.includes(leak)) { console.error(`✗ server-only value "${leak}" found in client bundle ${f}`); bad++; }
  }
  console.log(`checked ${bundle.length} client bundle files`);
} else console.log("client bundle not built; run npm run build:web to include it in the scan");
console.log(`scanned ${files.length} source files: ${bad ? `${bad} problem(s)` : "no secrets found"}`);
process.exit(bad ? 1 : 0);
