/** V3 wave 4 UI checks (CH-10 onward). Read-only assertions on real server state. */
import { expect, test, Page } from "@playwright/test";

async function alert(page: Page, scenario: string) {
  await page.goto("/");
  await page.getByLabel("Scenario").selectOption(scenario);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
}

test("CH-10: contribution bar prints values and the shortfall", async ({ page }) => {
  await alert(page, "A");
  const bar = page.getByRole("figure", { name: /Estimated per order \$3\.20; Your floor \$5\.60; \$2\.40 below the floor/ });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("$2.40 below the floor");
});

test("CH-11: execution history is collapsed when settled and open when a response is needed", async ({ page }) => {
  await alert(page, "A");
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  const settled = page.locator("details.exec-history");
  await expect(settled).toBeVisible();
  await expect(settled.locator("summary")).toContainText("View history (3)");
  await expect(settled).not.toHaveAttribute("open", "");
  await settled.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(settled).toHaveAttribute("open", "");
  await expect(settled).toContainText("Pause sent (attempt 1)");

  await alert(page, "J");
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(page.getByRole("heading", { name: "Pause requested, still serving" }).first()).toBeVisible();
  await expect(page.locator("details.exec-history")).toHaveAttribute("open", "");
});

test("CH-12: badges name their source; live Uber Ads state updates after the pause", async ({ page }) => {
  await alert(page, "A");
  await expect(page.getByText("Uber Ads, live read:")).toBeVisible();
  await expect(page.locator(".source-badge").filter({ hasText: "Uber Ads" })).toContainText("Active, serving");
  await expect(page.locator(".source-badge").filter({ hasText: "POS connector" })).toContainText("Healthy");
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(page.locator(".source-badge").filter({ hasText: "Uber Ads" })).toContainText("Paused, not serving");
});

test("CH-13: staff sees who can approve, switches to the manager in one click, then pauses", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Demo identity (not authentication)").selectOption("staff-ben");
  await page.getByLabel("Scenario").selectOption("A");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByText("Only a manager for Juniper Pizza — Downtown can approve this pause.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause campaign" })).toBeDisabled();
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);
  await page.getByRole("button", { name: /Demo: switch to Ana Reyes/ }).click();
  await expect(page.getByLabel("Demo identity (not authentication)")).toHaveValue("mgr-ana");
  await expect(page.getByText(/Only a manager for/)).toHaveCount(0);
  await expect(page.getByText("Investigation inv-1042")).toBeVisible();
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(page.getByRole("region", { name: "Campaign paused and verified" })).toBeVisible();
});

test("CH-13: a manager of another store gets the same banner", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo identity (not authentication)").selectOption("mgr-cole");
  await page.getByLabel("Scenario").selectOption("A");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("button", { name: /Demo: switch to Ana Reyes/ })).toBeVisible();
});

test("CH-14: stepper follows the real status, and a blocked alert is shown as stopped", async ({ page }) => {
  await alert(page, "A");
  const stepper = page.getByRole("list", { name: "Progress of this alert" });
  await expect(stepper.locator('[aria-current="step"]')).toContainText("Manager decision");
  await expect(page.getByText("Waiting for a manager")).toBeVisible();
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(page.getByText("Done: paused and verified")).toBeVisible();
  await expect(stepper.locator('[aria-current="step"]')).toHaveCount(0);

  await alert(page, "C");
  await expect(page.getByText("Stopped: blocked by a check")).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress of this alert" }).locator(".step-done")).toHaveCount(2);
});

test("CH-15: a search with no match says so and offers a way back", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Scenario").selectOption("A");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await page.getByRole("button", { name: "Data studio" }).click();
  await page.getByLabel("Search").fill("no-such-campaign");
  await expect(page.getByText('None of the 3 campaigns records match "no-such-campaign".')).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator("table.records tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Shift view" }).click();
  await expect(page.getByLabel("Scenario").locator("option").first()).toHaveText(/^A: /);
});

test("CH-16: policy provenance is shown without inventing an author", async ({ page }) => {
  await alert(page, "A");
  await expect(page.locator(".policy-provenance")).toHaveText("Merchant policy policy-rush-control-v3, effective Oct 1, 2026, runs 18 ordered checks. Provenance unavailable: no author was recorded for this version.");
});

test("CH-17: the inspector can verify the audit chain and states its limits", async ({ page }) => {
  await alert(page, "A");
  await page.locator("details.inspector > summary").click();
  await page.getByRole("button", { name: "Verify audit log" }).click();
  await expect(page.getByText(/^No break found in \d+ entries/)).toBeVisible();
  await expect(page.getByText(/Not signed and not anchored outside this database/)).toBeVisible();
});

test("CH-18: evidence package downloads with its status and checksum", async ({ page }) => {
  await alert(page, "A");
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(page.getByRole("region", { name: "Campaign paused and verified" })).toBeVisible();
  await page.locator("details.inspector > summary").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download audit evidence package" }).click()]);
  expect(download.suggestedFilename()).toBe("audit-evidence-inv-1042.json");
  await expect(page.getByText(/Complete: every record this alert needs is present/)).toBeVisible();
  await expect(page.getByText("This is a checksum, not a signature.", { exact: false })).toBeVisible();
});

test("CH-19: evidence checks summary and table use words, and blocked checks are not shown as passed", async ({ page }) => {
  await alert(page, "C");
  const summary = page.locator("details.evidence-checks > summary");
  await expect(summary).toHaveText(/^Evidence checks: \d+ passed, 0 warned, 1 blocked, \d+ not evaluated$/);
  await summary.click();
  const table = page.locator("details.evidence-checks table");
  await expect(table.getByRole("row", { name: /Blocked here/ })).toHaveCount(1);
  await expect(table.getByText("Not evaluated", { exact: true }).first()).toBeVisible();
  await expect(page.locator("details.evidence-checks").getByText('"Not evaluated" means the check has not run, not that it passed.')).toBeVisible();
});
