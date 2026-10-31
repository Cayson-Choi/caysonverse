/**
 * Which name tags are drawn, and how overlapping ones stack (controls-ux Task 14,
 * spec §6) — pure functions, unit-tested without a canvas or a camera.
 *
 *  - selectNametags: the nearest NAMETAG_CAP students on screen, plus everyone who is
 *    speaking, plus the pinned (teacher / AI assistants) — never off-screen or past the
 *    fade-out distance.
 *  - declutter: nearer tags keep their place, farther ones step up out of the way.
 *  - roundRobinIndices: which labels the wall-occlusion test visits this frame.
 *
 * selectNametags and declutter run at 5 Hz (NAMETAG_SELECT_INTERVAL_MS), so their small
 * allocations are fine; roundRobinIndices runs every frame and writes into a
 * caller-owned buffer.
 */

import { DECLUTTER, NAMETAG_CAP, NAMETAG_FADE_END } from "./constants";

/** "all" = every tag in range, "nearby" = the spec's smart selection, "off" = none (Settings, Task 15). */
export type NametagMode = "all" | "nearby" | "off";

export interface NametagCandidate {
  id: string;
  /** Straight-line distance (m) from the camera. */
  dist: number;
  onScreen: boolean;
  speaking: boolean;
  /** Always shown while on screen and in range: the teacher and the AI assistants. */
  pinned: boolean;
}

/** Sort key: nearer first, ties broken by id so the choice is stable between runs. */
function byDistance(a: { dist: number; id: string }, b: { dist: number; id: string }): number {
  return a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The ids whose tags should be drawn: (the `cap` nearest eligible) ∪ (eligible speakers)
 * ∪ (eligible pinned). "Eligible" = on screen and nearer than NAMETAG_FADE_END — a tag
 * that far is already faded to nothing, and an off-screen one cannot be seen, even if
 * its owner is talking. `pinned` is the documented exception to the nearest-`cap` rule
 * (a handful of fixed assistants plus the teacher).
 */
export function selectNametags(
  c: readonly NametagCandidate[],
  mode: NametagMode,
  cap: number = NAMETAG_CAP,
): Set<string> {
  const out = new Set<string>();
  if (mode === "off") return out;
  const eligible = c.filter((x) => x.onScreen && x.dist < NAMETAG_FADE_END);
  if (mode === "all") {
    for (const x of eligible) out.add(x.id);
    return out;
  }
  for (const x of eligible) if (x.speaking || x.pinned) out.add(x.id);
  const byDist = [...eligible].sort(byDistance);
  for (const x of byDist.slice(0, cap)) out.add(x.id);
  return out;
}

/** A tag's on-screen box in CSS pixels; (x, y) is its centre, y grows downward. */
export interface TagRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Camera distance (m): nearer tags keep their place. */
  dist: number;
}

/**
 * Stack overlapping tags: the nearest tag stays where it is and every farther one that
 * would overlap an already-placed tag steps up by (its height + gapPx) until it is
 * clear — or until it has stepped `maxSteps` times (bounded work: in a crowd some
 * overlap is better than a tower). Returns, per id, how many screen px to lift it
 * (0 = stays put).
 */
export function declutter(
  rects: readonly TagRect[],
  maxSteps: number = DECLUTTER.maxSteps,
  gapPx: number = DECLUTTER.gapPx,
): Map<string, number> {
  const order = [...rects].sort(byDistance);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const lifts = new Map<string, number>();
  for (const r of order) {
    let lift = 0;
    for (let step = 0; ; step++) {
      const y = r.y - lift; // screen y grows downward, so lifting = decreasing y
      const hit = placed.some(
        (p) =>
          Math.abs(p.x - r.x) * 2 < p.w + r.w && Math.abs(p.y - y) * 2 < p.h + r.h + 2 * gapPx,
      );
      if (!hit || step === maxSteps) break;
      lift += r.h + gapPx;
    }
    placed.push({ x: r.x, y: r.y - lift, w: r.w, h: r.h });
    lifts.set(r.id, lift);
  }
  return lifts;
}

/**
 * The next `count` label indices after `cursor`, wrapping around `total`: written into
 * `out` (caller-owned, so the per-frame call allocates nothing). Returns how many were
 * written — `min(count, total)`, or 0 when there are no labels — so the caller visits
 * `out[0 .. n)` and moves its cursor on by n.
 */
export function roundRobinIndices(
  out: number[],
  cursor: number,
  total: number,
  count: number,
): number {
  if (total <= 0 || count <= 0) return 0;
  const n = count < total ? count : total;
  const start = ((cursor % total) + total) % total;
  for (let i = 0; i < n; i++) out[i] = (start + i) % total;
  return n;
}
