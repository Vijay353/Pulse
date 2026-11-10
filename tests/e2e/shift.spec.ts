import { expect, test, Page } from "@playwright/test";

async function loadScenario(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("Scenario").selectOption(id);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  // Controls stay disabled until the reload finishes; wait for them before pressing keys.
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
}

test("success: alert → recommendation → confirm → verified by readback", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await loadScenario(page, "A");
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: /Kitchen rush detected\. One active Sponsored Listings campaign/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
  await expect(page.locator(".facts dd").filter({ hasText: "$3.20" })).toBeVisible();
  await expect(page.getByText("Stays paused until someone resumes it")).toBeVisible();
  await expect(page.locator(".note")).toContainText("not accounting profit");
  // Nothing written yet
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);

  await page.getByRole("button", { name: "Pause campaign" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("remain paused until someone resumes it");
  // CH-7: read-only projection before approval; nothing has been written yet
  await expect(dialog.getByRole("table", { name: "If you approve" })).toContainText("$40.00, not changed");
  await expect(dialog).toContainText("Projection only. No records changed.");
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);
  await dialog.getByRole("button", { name: "Pause campaign" }).click();

  const outcome = page.getByRole("region", { name: "Campaign paused and verified" });
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("Configured");
  await expect(outcome).toContainText("PAUSED");
  await expect(outcome).toContainText("13");
  await expect(outcome).toContainText("None");
  await expect(page.getByRole("button", { name: /resume/i })).toHaveCount(0);

  // UI reflects simulator state, and the simulator really changed
  const state = await (await request.get("/api/sim/state")).json();
  expect(state.patchCount).toBe(1);
  expect(state.campaigns.find((c: any) => c.campaignId === "cmp-syn-4081")).toMatchObject({ configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", version: 13 });

  // Inspector is collapsed by default and holds the real trace
  const insp = page.locator("details.inspector");
  await expect(insp).not.toHaveAttribute("open", "");
  await insp.locator("> summary").click();
  await expect(insp).toContainText("req-pause-4081-001");
  await expect(insp).toContainText("kds-snap-812");
  expect(errors).toEqual([]);
});

test("negative: stale kitchen data blocks and offers no pause", async ({ page, request }) => {
  await loadScenario(page, "C");
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: "Blocked: kitchen data is stale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause campaign" })).toHaveCount(0);
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);
});

test("negative: campaign changed after review blocks without a PATCH", async ({ page, request }) => {
  await loadScenario(page, "G");
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
  await page.locator("details.simulator > summary").click();
  await page.getByRole("button", { name: "Another manager edits the campaign" }).click();
  await page.getByRole("button", { name: "Pause campaign" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(page.getByRole("heading", { name: "Blocked: campaign changed" })).toBeVisible();
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);
  await page.getByRole("button", { name: "Re-assess with fresh data" }).click();
  await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
});

test("keyboard: review, dismiss with a reason, and inspect without a mouse", async ({ page }) => {
  await loadScenario(page, "K");
  await page.getByRole("button", { name: "Simulate kitchen alert" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
  await page.getByRole("button", { name: "Keep active" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Keep the campaign active?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Keep active" }).focus();
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "Keep active" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Kept active", level: 2 })).toBeVisible();
  await page.locator("details.inspector > summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details.inspector")).toHaveAttribute("open", "");
});

test("responsive: no horizontal scroll at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loadScenario(page, "A");
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("data studio: invalid workbook is rejected; valid merge commits and changes the next decision", async ({ page }) => {
  await loadScenario(page, "A");
  await page.getByRole("button", { name: "Data studio" }).click();
  await page.locator("input[type=file]").setInputFiles("data/templates/invalid/stale-revision.xlsx");
  await page.getByLabel(/Replace/).check();
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText(/Stale revision/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit replace" })).toBeDisabled();

  await page.locator("input[type=file]").setInputFiles("data/templates/valid/merge-threshold-40.xlsx");
  await page.getByLabel(/Merge/).check();
  await page.getByRole("button", { name: "Check file" }).click();
  await page.getByRole("button", { name: "Commit merge" }).click();
  await expect(page.getByText(/^Committed\./)).toBeVisible();

  await page.getByRole("button", { name: "Shift view" }).click();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: "No action needed", level: 2 })).toBeVisible();
});
