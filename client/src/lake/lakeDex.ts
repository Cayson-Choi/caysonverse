// 내 도감 (design 9.6): which species this device has caught, the biggest of each and the first day. Kept on THIS device only
// (localStorage) — there is no login yet, so the server cannot hold anyone's record; the panel says so.

import { FISH_SPECIES, species } from "./lakeProtocol";

export interface DexEntry {
  /** Biggest length (cm). */
  best: number;
  count: number;
  /** First catch, "YYYY-MM-DD" in Korea time. */
  first: string;
}
export type Dex = Record<string, DexEntry>;

const KEY = "cv.lake.dex.v1";
const COACH_KEY = "cv.lake.coach.v1";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadDex(): Dex {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Dex = {};
    for (const s of FISH_SPECIES) {
      const e = (parsed as Record<string, unknown>)[s.id] as Partial<DexEntry> | undefined;
      if (e && typeof e.best === "number" && typeof e.count === "number" && typeof e.first === "string") out[s.id] = { best: e.best, count: e.count, first: e.first };
    }
    return out;
  } catch {
    return {};
  }
}

export function koreaDay(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

/** Record a catch; returns the new dex and whether the species is new on this device. */
export function recordCatch(dex: Dex, kind: number, cm: number, nowMs: number): { dex: Dex; first: boolean; record: boolean } {
  const s = species(kind);
  if (!s) return { dex, first: false, record: false };
  const prev = dex[s.id];
  const next: Dex = { ...dex, [s.id]: prev ? { best: Math.max(prev.best, cm), count: prev.count + 1, first: prev.first } : { best: cm, count: 1, first: koreaDay(nowMs) } };
  return { dex: next, first: !prev, record: !!prev && cm > prev.best };
}

export function saveDex(dex: Dex): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(dex));
  } catch {
    // private mode: the dex just lives until the page closes
  }
}

export function coachSeen(): boolean {
  return storage()?.getItem(COACH_KEY) === "1";
}
export function markCoachSeen(): void {
  try {
    storage()?.setItem(COACH_KEY, "1");
  } catch {
    // ignore
  }
}
