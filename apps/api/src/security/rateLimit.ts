/**
 * Small in-memory fixed-window rate limiter for mutating routes (CH-5).
 *
 * Scope and limits, stated plainly:
 * - Counts live in this process only. They reset on restart and are not shared
 *   between instances. That matches the single-process SQLite deployment
 *   described in docs/ARCHITECTURE.md; several instances would need a shared store.
 * - The key is the demo identity plus the client address. The demo identity is
 *   not authentication, so this slows a noisy client; it is not abuse prevention
 *   against a determined attacker.
 */
export interface RateLimiter {
  /** Records one request for `key`. ok=false means the caller is over the limit for this window. */
  hit(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
  readonly limit: number;
}

export function createRateLimiter(opts: { limit: number; windowMs?: number; now?: () => number }): RateLimiter {
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();

  const sweep = (t: number) => {
    if (t - lastSweep < windowMs) return;
    for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
    lastSweep = t;
  };

  return {
    limit: opts.limit,
    hit(key) {
      // limit <= 0 disables limiting.
      if (opts.limit <= 0) return { ok: true };
      const t = now();
      sweep(t);
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= opts.limit) return { ok: true };
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
    },
  };
}
