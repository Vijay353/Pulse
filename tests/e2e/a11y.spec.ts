/** CH-13: automated WCAG 2.2 A/AA scan (axe-core) of every primary screen, desktop and phone. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function scan(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = r.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(summary).toEqual([]);
}

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test(`axe: primary flow at ${vp.width}px has no WCAG A/AA violations`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("mp.welcomeDismissed"));
    await page.getByLabel("Scenario").selectOption("A");
    await page.getByRole("button", { name: "Load scenario" }).click();
    await expect(page.getByRole("heading", { name: "How MarginPulse works" })).toBeVisible();
    await scan(page, "empty + welcome");
    await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
    await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
    await scan(page, "recommendation");
    await page.locator("details.evidence-checks > summary").click();
    await page.locator("details.inspector > summary").click();
    await scan(page, "details open");
    await page.getByRole("button", { name: "Pause campaign" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page, "confirm dialog");
    await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
    await expect(page.getByRole("region", { name: "Campaign paused and verified" })).toBeVisible();
    await scan(page, "verified");
  });
}

test("axe: blocked, calm and data studio screens", async ({ page }) => {
  for (const [sc, heading] of [["C", "Blocked: kitchen data is stale"], ["B", "No action needed"]] as const) {
    await page.goto("/?onboarding=0");
    await page.getByLabel("Scenario").selectOption(sc);
    await page.getByRole("button", { name: "Load scenario" }).click();
    await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
    await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
    await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
    await scan(page, sc);
  }
  await page.getByLabel("Show demo tools").check();
  await page.locator("details.simulator > summary").click();
  await scan(page, "simulator");
  await page.getByRole("button", { name: "Data studio" }).click();
  await expect(page.getByRole("button", { name: "Shift view" })).toBeVisible();
  await scan(page, "data studio");
});

test("keyboard: the confirm dialog traps focus and returns it to the opener", async ({ page }) => {
  await page.goto("/?onboarding=0");
  await page.getByLabel("Scenario").selectOption("A");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  const opener = page.getByRole("button", { name: "Pause campaign" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    // Native modal: focus stays in the dialog or briefly leaves to the browser's own UI (body); never page content behind it.
    expect(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest("dialog"); })).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
