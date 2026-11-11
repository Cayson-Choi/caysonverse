/**
 * The star finder's progress on this device: which figures were found (and when), and whether the found figures stay
 * drawn after the finder closes ("찾은 별자리 보기"). Kept in localStorage under `STAR_PROGRESS_KEY`; every read and
 * write is wrapped in try/catch (as cameraMemory.ts), and a broken stored value falls back field by field. A later task
 * saves it on the server under the same figure ids (a `StarFound { id }` message); this one does not touch the server.
 */

import { SKY_FIGURES, SEASON_ORDER, type SkyFigure, type SkySeason } from "@caysonverse/shared/village/constellations";
import { KST_OFFSET_MS } from "@caysonverse/shared/village/sunClock";
import type { StorageLike } from "../../game/settings";

/** localStorage key; the `v1` is the schema version of the stored blob. */
export const STAR_PROGRESS_KEY = "cv-stars-v1";

export interface StarProgress {
  /** Figure id -> when it was first found (KST ISO, "2026-11-10T21:03:00+09:00"). */
  found: Readonly<Record<string, string>>;
  /** Keep the found figures' lines and names on the sky when the finder is closed. */
  showFound: boolean;
}

export const EMPTY_PROGRESS: Readonly<StarProgress> = Object.freeze({ found: Object.freeze({}), showFound: false });

const KNOWN = new Set(SKY_FIGURES.map((f) => f.id));

/** A progress from any value: unknown ids and non-string dates are dropped, a non-boolean flag is off. */
export function normalizeStarProgress(value: unknown): StarProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { found: {}, showFound: false };
  const v = value as Record<string, unknown>;
  const found: Record<string, string> = {};
  if (typeof v.found === "object" && v.found !== null && !Array.isArray(v.found)) {
    for (const [id, at] of Object.entries(v.found as Record<string, unknown>)) {
      if (KNOWN.has(id) && typeof at === "string" && at.length <= 40) found[id] = at;
    }
  }
  return { found, showFound: v.showFound === true };
}

/** The browser's localStorage, or null when the platform hides it (private mode, blocked site data, no DOM). */
function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Read the stored progress; blocked, empty or broken storage is no progress, never an error. */
export function loadStarProgress(storage: StorageLike | null = browserStorage()): StarProgress {
  try {
    const raw = storage ? storage.getItem(STAR_PROGRESS_KEY) : null;
    return raw === null ? { found: {}, showFound: false } : normalizeStarProgress(JSON.parse(raw));
  } catch {
    return { found: {}, showFound: false };
  }
}

/** Store the progress; a blocked or full storage just means it lasts for this visit. */
export function saveStarProgress(p: StarProgress, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(STAR_PROGRESS_KEY, JSON.stringify({ found: p.found, showFound: p.showFound }));
  } catch {
    // Storage blocked or full — the progress still holds for this visit (the store keeps it).
  }
}

/** An instant as Korean wall-clock ISO text with its zone: "2026-11-10T21:03:00+09:00". */
export function kstIso(utcMs: number): string {
  return new Date(utcMs + KST_OFFSET_MS).toISOString().slice(0, 19) + "+09:00";
}

/** The progress with `id` found at `utcMs` (the first date is kept; an unknown id changes nothing). */
export function markFound(p: StarProgress, id: string, utcMs: number): StarProgress {
  if (!KNOWN.has(id) || p.found[id]) return p;
  return { ...p, found: { ...p.found, [id]: kstIso(utcMs) } };
}

/** "found / total" for each season (spring 7, summer 7, autumn 6, winter 8, north 3). */
export function seasonCounts(
  p: Pick<StarProgress, "found">,
  figures: readonly SkyFigure[] = SKY_FIGURES,
): Record<SkySeason, { found: number; total: number }> {
  const out = Object.fromEntries(SEASON_ORDER.map((s) => [s, { found: 0, total: 0 }])) as Record<SkySeason, { found: number; total: number }>;
  for (const f of figures) {
    out[f.season].total++;
    if (p.found[f.id]) out[f.season].found++;
  }
  return out;
}

/** "11월 10일" from a stored KST ISO date (empty for text that is not one). */
export function foundDateText(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : "";
}
