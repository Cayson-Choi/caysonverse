/**
 * 별자리 찾기 — the pure rules (no three.js, no DOM, no clock): which figures are up, which one to look for next, the aim
 * that finds it, the hints, the words the card uses. The runtime (finderRuntime.ts) feeds it the live sky and the camera.
 *
 *  - A figure is "up" (can be a target) when its aim point stands at least 12° high and at least 60 % of its stars clear
 *    the hills (8°: the village's backdrop reaches 8-9° from the plaza).
 *  - Order: this season's (by the Korean date) figures not yet found, then the northern sky's, then the next season's
 *    (the dawn sky), then the rest; already-found figures last (they can be found again, without counting twice). Inside
 *    a group, the comfortable heights (25-65°) first. A first-timer starts with 북두칠성 (or 카시오페이아, when the Dipper is
 *    down behind the hills in autumn) and then 북극성 찾기.
 *  - The aim: the figure's aim point inside the reticle for one second in total. Out of it the count drains at twice the
 *    speed (a shaky hand does not start over). The allowance is 0.3 × the figure's angular radius, 5-9°.
 */

import type { SkySeason } from "@caysonverse/shared/village/constellations";
import type { CalendarSeason, Vec3 } from "@caysonverse/shared/village/skyMath";

/** Seconds the target must sit in the reticle. */
export const AIM_SECONDS = 1;
/** The reticle's radius (° of sky). */
export const RETICLE_DEG = 6;
/** The aim allowance: 0.3 × the figure's radius, clamped to this band (°). */
export const AIM_MIN_DEG = 5;
export const AIM_MAX_DEG = 9;
/** A figure is up when its aim point is this high (°) ... */
export const ANCHOR_MIN_ALT = 12;
/** ... and this share of its stars stands above the hills (`STAR_MIN_ALT`, °). */
export const STAR_MIN_ALT = 8;
export const STAR_SHARE = 0.6;
/** Heights that are easy on the neck (°): preferred inside a group. */
export const COMFY_ALT: readonly [number, number] = [25, 65];
/** Seconds without finding before the target's faint "ghost" lines show. */
export const GHOST_AFTER_SECONDS = 20;
/** The edge arrow shows when the target is this far (°) from the view's centre (or off screen). */
export const ARROW_BEYOND_DEG = 25;
/** Aiming this close (°) to a planet / a star brighter than `BRIGHT_STAR_MAG` names it. */
export const PLANET_NEAR_DEG = 3;
export const BRIGHT_STAR_NEAR_DEG = 2;
export const BRIGHT_STAR_MAG = 1.5;

const DEG = 180 / Math.PI;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** The aim allowance (°) of a figure of angular radius `radiusDeg`. */
export function aimAllowanceDeg(radiusDeg: number): number {
  return clamp(0.3 * radiusDeg, AIM_MIN_DEG, AIM_MAX_DEG);
}

/** The normalized mean of some directions ([0, 1, 0] for none). */
export function meanDirection(dirs: readonly Readonly<Vec3>[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const d of dirs) {
    x += d[0];
    y += d[1];
    z += d[2];
  }
  const len = Math.hypot(x, y, z);
  return len > 1e-9 ? [x / len, y / len, z / len] : [0, 1, 0];
}

/** The largest angle (°) from `centre` to any of `dirs`. */
export function angularRadiusDeg(dirs: readonly Readonly<Vec3>[], centre: Readonly<Vec3>): number {
  let worst = 0;
  for (const d of dirs) {
    const dot = (d[0] * centre[0] + d[1] * centre[1] + d[2] * centre[2]) / (Math.hypot(d[0], d[1], d[2]) || 1);
    worst = Math.max(worst, Math.acos(clamp(dot, -1, 1)) * DEG);
  }
  return worst;
}

/** Whether a figure is up: its aim point at `anchorAltDeg`, its stars at `starAltsDeg`. */
export function isFigureUp(anchorAltDeg: number, starAltsDeg: readonly number[]): boolean {
  if (anchorAltDeg < ANCHOR_MIN_ALT || starAltsDeg.length === 0) return false;
  let above = 0;
  for (const a of starAltsDeg) if (a >= STAR_MIN_ALT) above++;
  return above >= STAR_SHARE * starAltsDeg.length - 1e-9;
}

/** One figure as the ranking sees it now. */
export interface Candidate {
  id: string;
  season: SkySeason;
  up: boolean;
  anchorAltDeg: number;
  found: boolean;
}

/** The season after `s` (the dawn sky shows it). */
function following(s: CalendarSeason): CalendarSeason {
  return s === "spring" ? "summer" : s === "summer" ? "autumn" : s === "autumn" ? "winter" : "spring";
}

/** The figures that are up, best target first (see the file's comment). */
export function rankTargets(cands: readonly Candidate[], season: CalendarSeason): string[] {
  const up = cands.filter((c) => c.up);
  const group = (c: Candidate): number => {
    if (c.found) return 4;
    if (c.season === season) return 0;
    if (c.season === "north") return 1;
    if (c.season === following(season)) return 2;
    return 3;
  };
  const comfy = (c: Candidate) => (c.anchorAltDeg >= COMFY_ALT[0] && c.anchorAltDeg <= COMFY_ALT[1] ? 0 : 1);
  const order = [...up].sort(
    (a, b) => group(a) - group(b) || comfy(a) - comfy(b) || Math.abs(a.anchorAltDeg - 45) - Math.abs(b.anchorAltDeg - 45) || (a.id < b.id ? -1 : 1),
  );
  // The first steps: the Dipper (or Cassiopeia's W when the Dipper is down), then the way to Polaris.
  const byId = new Map(up.map((c) => [c.id, c]));
  const firstTime = cands.every((c) => !c.found);
  const starter = byId.get("dipper") ?? byId.get("Cas");
  const polaris = byId.get("polaris");
  const front: string[] = [];
  if (firstTime && starter) front.push(starter.id);
  const starterFound = cands.some((c) => (c.id === "dipper" || c.id === "Cas") && c.found);
  if (polaris && !polaris.found && (firstTime || starterFound)) front.push(polaris.id);
  return [...front, ...order.filter((id) => !front.includes(id.id)).map((c) => c.id)];
}

/** The target after `current` in a ranking (the "다른 별자리" button): the next one, wrapping; the first when `current` is not in it. */
export function nextInRanking(ranking: readonly string[], current: string | null): string | null {
  if (ranking.length === 0) return null;
  const i = current === null ? -1 : ranking.indexOf(current);
  return ranking[(i + 1) % ranking.length] ?? null;
}

/** The aim's progress (0..1) after `dt` s: filling while inside, draining twice as fast outside. */
export function stepAim(progress: number, inside: boolean, dt: number): number {
  const d = Math.max(0, dt) / AIM_SECONDS;
  return inside ? Math.min(1, progress + d) : Math.max(0, progress - 2 * d);
}

/** Whether the faint ghost lines show, `secondsOnTarget` after the target was chosen. */
export function showGhost(secondsOnTarget: number): boolean {
  return secondsOnTarget >= GHOST_AFTER_SECONDS;
}

/** The edge arrow toward a target `view` (camera space: x right, y up, -z forward), `offAxisDeg` from the centre. */
export interface ArrowHint {
  show: boolean;
  /** Screen angle (rad) of the way to turn: 0 = right, π/2 = up. */
  angleRad: number;
  /** The target is behind the viewer. */
  behind: boolean;
  /** The target is mostly above. */
  up: boolean;
}

export function arrowHint(view: Readonly<Vec3>, offAxisDeg: number, onScreen: boolean): ArrowHint {
  const behind = view[2] > 0;
  const show = behind || !onScreen || offAxisDeg > ARROW_BEYOND_DEG;
  // Behind the viewer: point the way to turn round (left or right), not up or down.
  const angleRad = behind ? (view[0] < 0 ? Math.PI : 0) : Math.hypot(view[0], view[1]) > 1e-6 ? Math.atan2(view[1], view[0]) : Math.PI / 2;
  return { show, angleRad, behind, up: !behind && view[1] > Math.abs(view[0]) };
}

/** BFS order of a figure's lines from its brightest star (the reveal draws them in this order). Line indexes. */
export function revealOrder(lines: readonly (readonly [number, number])[], magOf: (hr: number) => number): number[] {
  const order: number[] = [];
  const used = new Set<number>();
  const reached = new Set<number>();
  const stars = [...new Set(lines.flat())];
  while (order.length < lines.length) {
    // the brightest star not reached yet (a figure in two pieces restarts from its other piece)
    const start = stars.filter((s) => !reached.has(s)).sort((a, b) => magOf(a) - magOf(b))[0];
    if (start === undefined) break;
    const queue = [start];
    reached.add(start);
    while (queue.length) {
      const s = queue.shift()!;
      lines.forEach(([a, b], i) => {
        if (used.has(i) || (a !== s && b !== s)) return;
        used.add(i);
        order.push(i);
        const other = a === s ? b : a;
        if (!reached.has(other)) {
          reached.add(other);
          queue.push(other);
        }
      });
    }
  }
  return order;
}

// ------------------------------------------------------------------------------------------------------------------------
// Words.

const COMPASS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"] as const;

/** The 8-point compass word of an azimuth (°, from north through east). */
export function compassWord(azDeg: number): string {
  return COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8]!;
}

/** How high something stands, in words. */
export function heightWord(altDeg: number): string {
  if (altDeg >= 75) return "머리 위";
  if (altDeg >= 60) return "높이";
  if (altDeg >= 25) return "중간쯤";
  return "낮게";
}

/** "북동쪽 하늘, 중간쯤 (고도 54°)" / "머리 위 (고도 81°)". */
export function whereText(altDeg: number, azDeg: number): string {
  const h = heightWord(altDeg);
  const alt = `고도 ${Math.round(altDeg)}°`;
  return h === "머리 위" ? `머리 위 (${alt})` : `${compassWord(azDeg)}쪽 하늘, ${h} (${alt})`;
}

/** "남동쪽, 고도 20°" (the way the player looks now). */
export function lookText(altDeg: number, azDeg: number): string {
  return `${compassWord(azDeg)}쪽, 고도 ${Math.round(altDeg)}°`;
}

/** Korean clock words: "오후 5시 51분" / "오전 6시". */
export function clockWords(hour: number, minute: number): string {
  const ampm = hour < 12 ? "오전" : "오후";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${ampm} ${h12}시` : `${ampm} ${h12}시 ${minute}분`;
}

/**
 * When the bright stars come out, for the daytime card: "오늘 오후 5시 51분쯤" / "내일 오후 5시 52분쯤", from the KST
 * calendar days of `nowKst` and `duskKst` (y, m, d, hour, minute).
 */
export function duskWords(
  nowKst: { year: number; month: number; day: number },
  duskKst: { year: number; month: number; day: number; hour: number; minute: number },
): string {
  const dayNo = (c: { year: number; month: number; day: number }) => Date.UTC(c.year, c.month - 1, c.day) / 86_400_000;
  const diff = dayNo(duskKst) - dayNo(nowKst);
  const when = diff <= 0 ? "오늘" : diff === 1 ? "내일" : `${duskKst.month}월 ${duskKst.day}일`;
  return `${when} ${clockWords(duskKst.hour, duskKst.minute)}쯤`;
}

/** The card's header count: "가을 발견 2/6". */
export function countText(seasonName: string, found: number, total: number): string {
  return `${seasonName} 발견 ${found}/${total}`;
}

/** The target's shape in a -1..1 box as it stands now: a gnomonic view toward `aim`, the zenith up (the card's picture). */
export function skyShape(
  dirs: readonly Readonly<Vec3>[],
  mags: readonly number[],
  lines: readonly (readonly [number, number])[],
  aim: Readonly<Vec3>,
): { points: { x: number; y: number; r: number }[]; lines: [number, number][]; aim: { x: number; y: number } } {
  // up = the zenith with its part along `aim` removed (north when the aim is overhead); right = forward × up
  const f = aim;
  let ux = -f[1] * f[0];
  let uy = 1 - f[1] * f[1];
  let uz = -f[1] * f[2];
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-6) {
    ux = 0;
    uy = 0;
    uz = -1;
    ul = 1;
  }
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const rx = f[1] * uz - f[2] * uy;
  const ry = f[2] * ux - f[0] * uz;
  const rz = f[0] * uy - f[1] * ux;
  const raw = dirs.map((d) => {
    const depth = Math.max(1e-3, d[0] * f[0] + d[1] * f[1] + d[2] * f[2]);
    return { x: (d[0] * rx + d[1] * ry + d[2] * rz) / depth, y: (d[0] * ux + d[1] * uy + d[2] * uz) / depth };
  });
  const all = [...raw, { x: 0, y: 0 }];
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY, 1e-6) / 2;
  const fit = (p: { x: number; y: number }) => ({ x: (p.x - cx) / half, y: (p.y - cy) / half });
  return {
    points: raw.map((p, i) => ({ ...fit(p), r: Math.min(1, Math.max(0.25, (4.5 - (mags[i] ?? 4)) / 4.5)) })),
    lines: lines.map(([a, b]) => [a, b]),
    aim: fit({ x: 0, y: 0 }),
  };
}
