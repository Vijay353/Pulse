/** CH-17/18/20 on a server started with DEMO_MODE=pitch PLAN=group (see playwright.config.ts). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("pitch story follows the live investigation and every metric comes from the server", async ({ page, request }) => {
  await page.goto("/?onboarding=0");
  await page.getByLabel("Scenario").selectOption("A");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
  const story = page.getByRole("region", { name: "Pitch story" });
  await expect(story.getByRole("tab", { name: /Problem/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(story.getByRole("tab", { name: /Decision/ })).toHaveAttribute("aria-selected", "true");
  await expect(story.getByRole("tabpanel")).toContainText("Kitchen prep time (P95) is 34 min, over your 28 min limit.");
  await page.getByRole("button", { name: "Pause campaign" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pause campaign" }).click();
  await expect(story.getByRole("tab", { name: /Proof/ })).toHaveAttribute("aria-selected", "true");
  const metrics = await (await request.get("/api/metrics")).json();
  const strip = story.getByRole("definition").filter({ hasText: /^\d+$/ });
  await expect(story.locator(".pitch-metrics")).toContainText(`Alerts checked${metrics.investigated}`);
  await expect(story.locator(".pitch-metrics")).toContainText(`Pauses verified${metrics.pausesVerified}`);
  expect(await strip.count()).toBeGreaterThan(0);
  await story.getByRole("tab", { name: /Business/ }).click();
  await expect(story.getByRole("tabpanel")).toContainText("Pricing is set per pilot.");
  await expect(story.getByRole("tabpanel")).toContainText("Fleet view across your stores");
  await expect(story).not.toContainText("$");
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
});

test("Group plan: fleet view lists both stores for the area manager and opens one", async ({ page, request }) => {
  await page.goto("/?onboarding=0");
  await page.getByLabel("Scenario").selectOption("T");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("button", { name: "Simulate kitchen alert" })).toBeEnabled();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await page.getByLabel("Demo identity (not authentication)").selectOption("area-dee");
  const fleet = page.getByRole("region", { name: "Your stores" });
  await expect(fleet.getByRole("listitem")).toHaveCount(2);
  await expect(fleet.getByRole("listitem").first()).toContainText("1 waiting for a manager");
  await fleet.getByRole("button", { name: "Open Juniper Pizza — Uptown" }).click();
  await expect(page).toHaveURL(/[?&]store=SYN-STORE-205/);
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);
});
