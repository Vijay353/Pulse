/** CH-20: the visitor gate in a real browser (non-production instance with the gate on). */
import { expect, test } from "@playwright/test";

const PIN = "4826"; // test-only

test("deep link goes through the gate, wrong code is refused, right code lands on the deep link", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(r.url()); });
  await page.goto("/data");
  await expect(page).toHaveURL(/\/access\?next=%2Fdata$/);
  await expect(page.getByRole("heading", { name: "Enter access code" })).toBeVisible();
  expect(apiCalls).toEqual([]); // the gate page never touches the app API

  const pin = page.getByLabel("Access code", { exact: true });
  await pin.pressSequentially("12a3"); // non-digits are dropped
  await expect(pin).toHaveValue("123");
  await pin.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Enter all four digits.");

  await pin.fill("1234");
  await pin.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("That code did not work. Check it and try again.");
  await expect(page.getByLabel("Access code", { exact: true })).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Access code", { exact: true }).fill(PIN);
  await page.getByRole("button", { name: "Enter MarginPulse" }).click();
  await expect(page).toHaveURL(/\/data$/);
  await expect(page.getByRole("button", { name: "Lock demo" })).toBeVisible();

  await page.reload(); // refresh keeps the session
  await expect(page.getByRole("button", { name: "Lock demo" })).toBeVisible();

  await page.getByRole("button", { name: "Lock demo" }).click();
  await expect(page).toHaveURL(/\/access$/);
  const r = await page.request.get("/api/investigations");
  expect(r.status()).toBe(401);
});

test("cookie is HttpOnly and the PIN is not in any script the browser loads", async ({ page, context }) => {
  const bodies: string[] = [];
  page.on("response", async (res) => { if (/\.(js)(\?|$)/.test(res.url())) bodies.push(await res.text().catch(() => "")); });
  await page.goto("/access");
  await page.getByLabel("Access code", { exact: true }).fill(PIN);
  await page.getByLabel("Access code", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Lock demo" })).toBeVisible();
  const c = (await context.cookies()).find((x) => x.name === "mp_access")!;
  expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("mp_access");
  expect(bodies.length).toBeGreaterThan(0);
  for (const b of bodies) expect(b).not.toMatch(/ACCESS_PIN|SESSION_SECRET|\b4826\b/);
});

test("gate is usable on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/access");
  const card = await page.locator(".gate-card").boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab"); // focus order reaches the submit button
  await expect(page.getByRole("button", { name: "Enter MarginPulse" })).toBeFocused();
});

test("CH-21: no analytics traffic on the gate or in the app when no project ID is built in; app content is marked for masking", async ({ page }) => {
  const third: string[] = [];
  page.on("request", (r) => { const h = new URL(r.url()).hostname; if (h !== "127.0.0.1") third.push(r.url()); });
  await page.goto("/access");
  await page.getByLabel("Access code", { exact: true }).fill(PIN);
  await page.getByLabel("Access code", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Lock demo" })).toBeVisible();
  await page.getByRole("button", { name: "Simulate kitchen alert" }).click();
  await expect(page.locator("main#main")).toHaveAttribute("data-clarity-mask", "true");
  await expect(page.getByRole("region", { name: "Analytics choice" })).toHaveCount(0);
  expect(third).toEqual([]);
});
