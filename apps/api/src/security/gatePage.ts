/**
 * V3 CH-20: server-rendered access gate page. Uses the app's own tokens and
 * fonts. Works without JavaScript (plain form POST); gate.js only adds the
 * four-cell display and a loading state. No analytics or third-party requests.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderGate(o: { next: string; error?: string }): string {
  const err = o.error ? esc(o.error) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>MarginPulse · Access</title>
<link rel="stylesheet" href="/access/gate.css">
</head>
<body>
<main class="gate">
  <section class="gate-card" aria-labelledby="gate-title">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div><span class="brand-name">MarginPulse</span><span class="brand-sub">Rush-aware Sponsored Listings control</span></div>
    </div>
    <h1 id="gate-title">Enter access code</h1>
    <p class="lead">This portfolio demo is shared by invitation. Enter the four-digit code you were given.</p>
    <form method="post" action="/access/login" id="gate-form">
      <input type="hidden" name="next" value="${esc(o.next)}">
      <label for="pin" class="label">Access code</label>
      <div class="pin-wrap">
        <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" required autofocus
          aria-describedby="pin-help${err ? " pin-error" : ""}"${err ? ' aria-invalid="true"' : ""}>
        <div class="cells" aria-hidden="true"><span class="cell"></span><span class="cell"></span><span class="cell"></span><span class="cell"></span></div>
      </div>
      <p id="pin-help" class="help">Four digits. You can paste the code.</p>
      <p id="pin-error" class="error" role="alert">${err}</p>
      <button class="btn" type="submit">Enter MarginPulse</button>
    </form>
    <p class="note">A light gate for a portfolio demo, not account security. Every record inside is synthetic.</p>
  </section>
</main>
<script src="/access/gate.js" defer></script>
</body>
</html>
`;
}

export const GATE_CSS = `
@font-face { font-family: "Public Sans"; font-weight: 400; font-display: swap; src: url(/access/fonts/public-sans-400.woff2) format("woff2"); }
@font-face { font-family: "Public Sans"; font-weight: 700; font-display: swap; src: url(/access/fonts/public-sans-700.woff2) format("woff2"); }
@font-face { font-family: "Barlow Semi Condensed"; font-weight: 600; font-display: swap; src: url(/access/fonts/barlow-600.woff2) format("woff2"); }
@font-face { font-family: "Barlow Semi Condensed"; font-weight: 700; font-display: swap; src: url(/access/fonts/barlow-700.woff2) format("woff2"); }
:root {
  --steel: #e4e9ea; --steel-2: #d3dadc; --ticket: #ffffff; --ink: #1b2024; --ink-2: #4a545b; --rule: #c5cdd0;
  --over: #b42318; --ok: #0c7347; --focus: #1e5fd1;
  --display: "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif;
  --text: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: light;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: var(--steel); color: var(--ink); font: 400 15px/1.5 var(--text); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.gate { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; }
.gate-card { width: 100%; max-width: 400px; background: var(--ticket); border: 1px solid var(--steel-2); border-top: 4px solid #000; border-radius: 6px; padding: 28px 24px 22px; }
.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.brand-mark { width: 30px; height: 30px; flex: none; border-radius: 6px; background: var(--ok);
  background-image: linear-gradient(#fff 0 0), linear-gradient(#fff 0 0), linear-gradient(#fff 0 0);
  background-size: 14px 2.5px, 14px 2.5px, 9px 2.5px; background-repeat: no-repeat; background-position: 8px 9px, 8px 14px, 8px 19px; }
.brand-name { display: block; font: 700 18px/1.1 var(--display); }
.brand-sub { display: block; font-size: 12px; color: var(--ink-2); }
h1 { margin: 0 0 6px; font: 700 26px/1.15 var(--display); }
.lead { margin: 0 0 20px; color: var(--ink-2); }
.label { display: block; font-weight: 700; margin-bottom: 8px; }
.pin-wrap { position: relative; width: 248px; max-width: 100%; }
#pin { width: 100%; min-height: 56px; border: 1px solid var(--rule); border-radius: 4px; padding: 8px 14px; font: 700 24px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: .4em; background: #fff; }
#pin[aria-invalid="true"] { border-color: var(--over); }
.cells { display: none; }
.js .cells { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; position: absolute; inset: 0; pointer-events: none; }
.js #pin { color: transparent; caret-color: transparent; border-color: transparent; background: transparent; position: relative; z-index: 1; }
.js #pin:focus-visible { outline: none; }
.cell { display: grid; place-items: center; height: 56px; border: 1px solid var(--rule); border-radius: 4px; background: #fff; }
.cell.filled::after { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--ink); }
.js .pin-wrap:focus-within .cell.active { border-color: var(--ink); box-shadow: inset 0 -3px 0 var(--ok); }
.js .pin-wrap:focus-within { outline: 3px solid var(--focus); outline-offset: 4px; border-radius: 6px; }
.js #pin[aria-invalid="true"] ~ .cells .cell { border-color: var(--over); }
.help { margin: 8px 0 0; font-size: 13px; color: var(--ink-2); }
.error { margin: 6px 0 0; min-height: 1.5em; color: var(--over); font-weight: 700; font-size: 14px; }
.btn { margin-top: 14px; width: 100%; min-height: 44px; border: 0; border-radius: 4px; background: #000; color: #fff; font: 700 15px/1.2 var(--text); cursor: pointer; }
.btn:hover:not(:disabled) { background: #2a3034; }
.btn:disabled { opacity: .6; cursor: progress; }
.note { margin: 18px 0 0; padding-top: 14px; border-top: 1px solid var(--steel-2); font-size: 12.5px; color: var(--ink-2); }
@media (max-width: 360px) { .gate-card { padding: 22px 16px 18px; } .pin-wrap { width: 100%; } }
`;

export const GATE_JS = `(function () {
  var form = document.getElementById("gate-form");
  var pin = document.getElementById("pin");
  var err = document.getElementById("pin-error");
  if (!form || !pin) return;
  document.documentElement.classList.add("js");
  form.noValidate = true; // the script shows its own message; without JS the browser's checks stay on
  var cells = Array.prototype.slice.call(document.querySelectorAll(".cell"));
  function paint() {
    var clean = pin.value.replace(/\\D/g, "").slice(0, 4);
    if (clean !== pin.value) pin.value = clean;
    cells.forEach(function (c, i) {
      c.classList.toggle("filled", i < clean.length);
      c.classList.toggle("active", i === Math.min(clean.length, 3));
    });
  }
  pin.addEventListener("input", paint);
  pin.addEventListener("focus", paint);
  paint();
  form.addEventListener("submit", function (e) {
    if (!/^\\d{4}$/.test(pin.value)) {
      e.preventDefault();
      err.textContent = "Enter all four digits.";
      pin.setAttribute("aria-invalid", "true");
      pin.setAttribute("aria-describedby", "pin-help pin-error");
      pin.focus();
      return;
    }
    var btn = form.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Checking\\u2026";
    form.setAttribute("aria-busy", "true");
  });
})();
`;
