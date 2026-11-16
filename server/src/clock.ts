/**
 * The server's wall clock for memorial rules (occasions, the ceremony, 24 h flowers, review timestamps) with the TEST-ONLY
 * shift `CV_FAKE_NOW` (memorial-2 W0). NEVER set it in /etc/caysonverse.env.
 *
 * `CV_FAKE_NOW` forms:
 *   - an ISO instant (`2026-11-15T19:54:00+09:00`): the clock starts there when first read and then runs on in real time;
 *   - an offset from the real clock: `+3d`, `-2h`, `+90m`, `+30s` (sum several: `+6d+11h`).
 * Unset or unparsable → the real clock (an unparsable value is reported once, without echoing it).
 */

const UNIT_MS: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };

/** The shift (ms) to add to the real clock for `raw`, or null when it is not a valid CV_FAKE_NOW. Pure. */
export function fakeShift(raw: string | undefined, realNow: number): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^([+-]\d+(\.\d+)?[dhms])+$/.test(s)) {
    let ms = 0;
    for (const m of s.matchAll(/([+-])(\d+(?:\.\d+)?)([dhms])/g)) ms += (m[1] === "-" ? -1 : 1) * Number(m[2]) * UNIT_MS[m[3]!]!;
    return ms;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t - realNow : null;
}

let cachedRaw: string | undefined;
let cachedShift = 0;
let warned = false;

/** Now (ms since epoch) on the memorial clock. */
export function serverNow(): number {
  const raw = process.env.CV_FAKE_NOW;
  const real = Date.now();
  if (!raw) return real;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    const shift = fakeShift(raw, real);
    if (shift === null && !warned) {
      warned = true;
      console.warn("[clock] CV_FAKE_NOW is set but not understood; using the real clock");
    }
    cachedShift = shift ?? 0;
  }
  return real + cachedShift;
}

/** Whether the test clock is active (printed once at boot so a stray setting on a real server is noticed). */
export function fakeClockActive(): boolean {
  return Boolean(process.env.CV_FAKE_NOW);
}
