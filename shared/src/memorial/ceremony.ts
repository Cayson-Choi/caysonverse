import { CEREMONY_HOUR, CEREMONY_MINUTE, CEREMONY_NAMES_MAX, CEREMONY_PHASE_MS, CEREMONY_WEEKDAY } from "./constants";
import { kstDate, kstParts, kstTime } from "./kst";
import type { CeremonyPhase } from "./types";

/**
 * F4 schedule (memorial-2 Appendix "Ceremony scheduler"), pure: where in the weekly ceremony an instant falls.
 * gather(−5 m) → open(30 s) → names(4 s × n, n ≤ 40; skipped with no names) → light(60 s) → silence(60 s) → close(20 s)
 * → afterglow(60 m) → idle. The W3 scheduler calls this on a timer and broadcasts `CeremonyState` on each change.
 */

export interface CeremonySlot {
  /** `C-YYYY-MM-DD` (the KST date of the start). */
  ceremonyId: string;
  /** UTC ms of the start (Sunday 20:00 KST). */
  startsAt: number;
  phase: CeremonyPhase;
  phaseStartsAt: number;
  phaseEndsAt: number;
}

/** The start (UTC ms) of the ceremony of the KST week containing `now` — Sunday 20:00 KST. */
export function weekCeremonyStart(now: number): number {
  const p = kstParts(now);
  const back = (p.weekday - CEREMONY_WEEKDAY + 7) % 7;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) - back * 86_400_000);
  return kstTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), CEREMONY_HOUR, CEREMONY_MINUTE);
}

/** The phases of a ceremony starting at `start` with `names` names (the count is capped). */
export function ceremonyPhases(start: number, names: number): { phase: CeremonyPhase; from: number; to: number }[] {
  const n = Math.max(0, Math.min(CEREMONY_NAMES_MAX, Math.floor(names)));
  const P = CEREMONY_PHASE_MS;
  const out: { phase: CeremonyPhase; from: number; to: number }[] = [];
  let t = start - P.gather;
  const push = (phase: CeremonyPhase, len: number) => {
    if (len <= 0) return;
    out.push({ phase, from: t, to: t + len });
    t += len;
  };
  push("gather", P.gather);
  push("open", P.open);
  push("names", P.namePer * n);
  push("light", P.light);
  push("silence", P.silence);
  push("close", P.close);
  push("afterglow", P.afterglow);
  return out;
}

/** Where `now` falls: a phase of this week's (or last week's) ceremony, else idle until the next gather. */
export function ceremonyAt(now: number, names: number): CeremonySlot {
  // The whole ceremony (19:55 .. about 21:10 with the afterglow) lies inside its Sunday, so this week's start covers every case.
  const start = weekCeremonyStart(now);
  const phases = ceremonyPhases(start, names);
  const id = `C-${kstDate(start)}`;
  for (const ph of phases) {
    if (now >= ph.from && now < ph.to) return { ceremonyId: id, startsAt: start, phase: ph.phase, phaseStartsAt: ph.from, phaseEndsAt: ph.to };
  }
  const last = phases[phases.length - 1]!;
  const next = now < phases[0]!.from ? start : start + 7 * 86_400_000;
  const nextGather = next - CEREMONY_PHASE_MS.gather;
  return {
    ceremonyId: `C-${kstDate(next)}`,
    startsAt: next,
    phase: "idle",
    phaseStartsAt: now < phases[0]!.from ? start - 7 * 86_400_000 + (last.to - start) : last.to,
    phaseEndsAt: nextGather,
  };
}
