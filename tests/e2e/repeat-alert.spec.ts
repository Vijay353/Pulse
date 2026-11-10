import { expect, test } from "@playwright/test";

test("repeat alert: warning shown, pause stays disabled until the manager confirms", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Scenario").selectOption("S");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("heading", { name: "No kitchen alerts yet" })).toBeVisible();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: "Recommendation ready" })).toBeVisible();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.getByRole("heading", { name: "Possible repeat alert" })).toBeVisible();
  await page.getByRole("button", { name: "Pause campaign" }).first().click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Pause campaign" });
  await expect(confirm).toBeDisabled();
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(0);
  await dialog.getByRole("checkbox").check();
  await confirm.click();
  await expect(page.getByRole("region", { name: "Campaign paused and verified" })).toBeVisible();
  expect((await (await request.get("/api/sim/state")).json()).patchCount).toBe(1);
});
