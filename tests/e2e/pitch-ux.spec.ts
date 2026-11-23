/** CH-7 / CH-8 / CH-10 / CH-12: tiered Shift view. Read-only checks against the live server. */
import { expect, test, Page } from "@playwright/test";

async function alert(page: Page, scenario: string, url = "/?onboarding=0") {
  await page.goto(url);
  await page.getByLabel("Scenario").selectOption(scenario);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
}

for (const [name, viewport] of [["desktop 1280x800", { width: 1280, height: 800 }], ["phone 375x812", { width: 375, height: 812 }]] as const) {
  test(`CH-7: on ${name} the verdict, the reason and the one primary action are visible without scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await alert(page, "A");
    await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeInViewport();
    await expect(page.getByText("Kitchen prep time (P95) is 34 min, over your 28 min limit.", { exact: false })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Pause campaign" })).toBeInViewport();
  });
}

test("CH-7: proof and simulator are not shown by default; the demo-tools switch reveals the simulator and is remembered", async ({ page }) => {
  await alert(page, "A");
  await expect(page.locator("details.inspector")).not.toHaveAttribute("open", "");
  await expect(page.locator("details.evidence-checks")).not.toHaveAttribute("open", "");
  await expect(page.locator("details.simulator")).toHaveCount(0);
  await page.getByLabel("Show demo tools").check();
  await expect(page.locator("details.simulator")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Show demo tools")).toBeChecked();
  await page.getByLabel("Show demo tools").uncheck();
  await expect(page.locator("details.simulator")).toHaveCount(0);
});

test("CH-7: the authority is named next to the action", async ({ page }) => {
  await alert(page, "A");
  await expect(page.getByText(/Who decides:.*Ana Reyes/)).toBeVisible();
});

test("CH-8: an evidence chip opens the technical evidence at that record", async ({ page }) => {
  await alert(page, "A");
  await page.getByRole("button", { name: "Show evidence record kds-snap-812" }).click();
  await expect(page.locator("details.inspector")).toHaveAttribute("open", "");
  await expect(page.locator("#ev-kds-snap-812")).toHaveAttribute("open", "");
});

test("CH-8: a calm NO_ACTION states the observed value against the limit", async ({ page }) => {
  await alert(page, "B");
  await expect(page.getByText("No action is needed. The guardrail ran and the campaign stays as it is.")).toBeVisible();
  await expect(page.getByText("Kitchen prep time (P95) is 24 min, under your 28 min limit.")).toBeVisible();
});

test("CH-10: the verified receipt comes first, with the audit hash and a print button", async ({ page }) => {
  await alert(page, "A");
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  const receipt = page.getByRole("region", { name: "Campaign paused and verified" });
  await expect(receipt).toContainText(/Audit record #\d+, hash [0-9a-f]{16}/);
  await expect(receipt.getByRole("button", { name: "Print receipt" })).toBeVisible();
  await expect(page.getByText("A readback shows the campaign paused and not serving, version 13.", { exact: false })).toBeVisible();
});

test("CH-12: the first-run welcome is shown once, dismissed with one click, and never blocks the alert button", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("mp.welcomeDismissed"));
  await page.reload();
  await page.getByLabel("Scenario").selectOption("A");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "How MarginPulse works" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("heading", { name: "How MarginPulse works" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How MarginPulse works" })).toHaveCount(0);
  await page.goto("/?onboarding=0");
  await page.evaluate(() => localStorage.removeItem("mp.welcomeDismissed"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How MarginPulse works" })).toHaveCount(0);
});

test("CH-9: the shift digest appears once the alert is settled and shows counts only", async ({ page }) => {
  await alert(page, "A");
  await expect(page.getByRole("region", { name: "What happened on your shift" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  const digest = page.getByRole("region", { name: "What happened on your shift" });
  await expect(digest).toContainText("Paused Downtown Sponsored Listing with mgr-ana's approval");
  await expect(digest).toContainText("1 alert checked, 1 pause verified");
  await expect(digest).toContainText("1 change request sent");
  await expect(digest).not.toContainText("$");
});

test("CH-18: on the Solo plan a two-store manager can switch stores and is told the fleet view is a Group feature", async ({ page }) => {
  await page.goto("/?onboarding=0");
  await page.getByLabel("Scenario").selectOption("T");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await page.getByLabel("Demo identity (not authentication)").selectOption("area-dee");
  const fleet = page.getByRole("region", { name: "Your stores" });
  await expect(fleet).toContainText("The fleet view is part of the Group plan");
  await fleet.getByLabel("Store").selectOption("SYN-STORE-205");
  await expect(page).toHaveURL(/[?&]store=SYN-STORE-205/);
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByText("Juniper Pizza — Uptown", { exact: false }).first()).toBeVisible();
});

test("CH-18: a single-store manager never sees the store switcher", async ({ page }) => {
  await alert(page, "A");
  await expect(page.getByRole("region", { name: "Your stores" })).toHaveCount(0);
});
