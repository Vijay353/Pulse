/** CH-5: fixed-window limiter, pure unit checks with an injected clock. */
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../apps/api/src/security/rateLimit";

describe("rate limiter", () => {
  it("allows up to the limit, then refuses with a retry-after, then resets after the window", () => {
    let t = 1_000_000;
    const l = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([l.hit("a"), l.hit("a"), l.hit("a")].every((r) => r.ok)).toBe(true);
    const over = l.hit("a");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.retryAfterSeconds).toBe(60);
    t += 30_000;
    const later = l.hit("a");
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.retryAfterSeconds).toBe(30);
    t += 30_000;
    expect(l.hit("a").ok).toBe(true);
  });

  it("keys are independent", () => {
    const l = createRateLimiter({ limit: 1, now: () => 0 });
    expect(l.hit("mgr|1.1.1.1").ok).toBe(true);
    expect(l.hit("mgr|1.1.1.1").ok).toBe(false);
    expect(l.hit("staff|1.1.1.1").ok).toBe(true);
    expect(l.hit("mgr|2.2.2.2").ok).toBe(true);
  });

  it("limit 0 disables limiting", () => {
    const l = createRateLimiter({ limit: 0 });
    for (let i = 0; i < 1000; i++) expect(l.hit("x").ok).toBe(true);
  });
});
