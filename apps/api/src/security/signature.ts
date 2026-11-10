import { createHmac, timingSafeEqual } from "node:crypto";

/** Canonical form: every field except `signature`, keys sorted, JSON encoded. */
export function canonicalPayload(event: object): string {
  const rec = event as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => k !== "signature").sort();
  return JSON.stringify(keys.map((k) => [k, rec[k]]));
}

export function signEvent(event: object, secret: string): string {
  return createHmac("sha256", secret).update(canonicalPayload(event)).digest("hex");
}

export function verifySignature(event: object, secret: string): boolean {
  const given = String((event as { signature?: unknown }).signature ?? "");
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = signEvent(event, secret);
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

/** Remove secrets before anything is persisted or shown in the inspector. */
export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = /authorization|cookie|token|secret/i.test(k) ? "[REDACTED]" : v;
  return out;
}
