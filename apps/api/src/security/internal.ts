/**
 * V3 CH-20: MarginPulse reaches its own simulators over HTTP on the same
 * process. When the visitor access gate is on, those calls carry a random
 * per-process token so they pass the gate. The token is added only for
 * origins this process registered as itself; it is never sent elsewhere.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

export const INTERNAL_HEADER = "x-mp-internal";
const TOKEN = randomBytes(32).toString("hex");
const selfOrigins = new Set<string>();

export function registerInternalOrigin(base: string): void {
  try { selfOrigins.add(new URL(base).origin); } catch { /* ignore malformed */ }
}

export function isInternalRequest(value: string | string[] | undefined): boolean {
  if (typeof value !== "string" || value.length !== TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(TOKEN));
}

/** fetch that adds the internal token only for this process's own origins. */
export function internalFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let origin: string | null = null;
  try { origin = new URL(url).origin; } catch { /* let fetch report it */ }
  if (origin && selfOrigins.has(origin)) {
    const headers = new Headers(init.headers);
    headers.set(INTERNAL_HEADER, TOKEN);
    return fetch(url, { ...init, headers });
  }
  return fetch(url, init);
}
