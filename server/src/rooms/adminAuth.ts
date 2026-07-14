/**
 * Admin-code verification primitives. Pure and server-only — the ADMIN_CODE is
 * compared here and NOWHERE on the client, so the code never enters the browser
 * bundle. Two pieces:
 *
 *  - `compareAdminCode`: a constant-time-ish comparison (crypto.timingSafeEqual
 *    on length-padded buffers) so a wrong guess cannot be timed byte-by-byte.
 *    An unset/empty expected code makes admin login impossible (always false).
 *
 *  - `AdminAttemptLimiter`: a per-key sliding-window counter of FAILED attempts
 *    (5 per minute, per IP — or a shared global key when the IP is unavailable).
 *    Clock is injected (`now` ms) so it is tested with explicit timestamps, no
 *    fake timers.
 */

import { timingSafeEqual } from "node:crypto";

/** Max failed admin-code attempts allowed within the window, per key. */
export const ADMIN_ATTEMPT_LIMIT = 5;
/** Sliding-window length (ms) for the failed-attempt counter. */
export const ADMIN_ATTEMPT_WINDOW_MS = 60_000;

/**
 * True only if `provided` equals `expected`. Returns false when `expected` is
 * unset/empty (admin impossible) or `provided` is empty. Pads both operands to
 * equal length before timingSafeEqual (which requires equal-length buffers),
 * then still requires the original lengths to match — so a short prefix of the
 * real code is rejected without leaking length via an early return.
 */
export function compareAdminCode(provided: string, expected: string | null | undefined): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  const len = Math.max(a.length, b.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  a.copy(pa);
  b.copy(pb);

  // timingSafeEqual over the padded buffers, AND an exact-length requirement.
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

/**
 * Sliding-window counter of FAILED admin-code attempts, keyed per IP (or a
 * shared global key when the IP is not obtainable). Unlike RateWindow (which
 * gates accepted traffic), this only records failures and answers "is this key
 * currently blocked?"; a SUCCESSFUL login records nothing.
 */
export class AdminAttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit: number = ADMIN_ATTEMPT_LIMIT,
    private readonly windowMs: number = ADMIN_ATTEMPT_WINDOW_MS,
  ) {}

  /** True when `key` has reached `limit` failures within the trailing window. */
  isBlocked(key: string, now: number): boolean {
    return this.recent(key, now).length >= this.limit;
  }

  /** Record one failed attempt for `key` at time `now`. */
  recordFailure(key: string, now: number): void {
    const hits = this.recent(key, now);
    hits.push(now);
    this.failures.set(key, hits);
  }

  /** Non-expired failure timestamps for `key`, pruning the stored array. */
  private recent(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const hits = (this.failures.get(key) ?? []).filter((t) => t >= cutoff);
    this.failures.set(key, hits);
    return hits;
  }
}
