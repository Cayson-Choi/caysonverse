/**
 * 별자리 찾기 — the per-frame part, called from StarSky's frame (it has the camera): once a second it reads the sky (day or
 * night, which figures are up, the best target) into the store; every frame, while the card is open at night in first
 * person, it fills the aim, finds the target, and writes the reticle, the edge arrow, the names on the sky and the lines
 * to draw (`lineSpec`, drawn by SkyLines). No allocation on the frame path but the small arrays it reuses; the store is
 * touched only when something changed.
 */

import { Vector3, type PerspectiveCamera } from "three";
import { SEASON_NAME, STAR_NAMES, figureById, figureTitle } from "@caysonverse/shared/village/constellations";
import { altAzOf, angleDeg, nextSunset, seasonAt, type Vec3 } from "@caysonverse/shared/village/skyMath";
import { kstClock } from "@caysonverse/shared/village/sunClock";
import { viewState } from "../../game/viewState";
import { anchorDirection, eqDirection, sky, starAltitudes, starDirection, type FigureGeom } from "./skyRuntime";
import {
  BRIGHT_STAR_MAG,
  BRIGHT_STAR_NEAR_DEG,
  PLANET_NEAR_DEG,
  RETICLE_DEG,
  arrowHint,
  duskWords,
  isFigureUp,
  lookText,
  rankTargets,
  revealOrder,
  showGhost,
  skyShape,
  stepAim,
  whereText,
  type Candidate,
} from "./finderRules";
import { patchFinder, setProgress, useStarFinder, withObjectParticle, type StarFinderState } from "./starFinderStore";
import { markFound, seasonCounts } from "./starProgress";
import { playFoundChime } from "./starChime";

/** Above this sun elevation (°) the finder says "별은 밤에 보여요" (the end of civil dusk: the bright stars are out). */
export const NIGHT_BELOW_DEG = -6;
/** The reveal: one line every `REVEAL_STEP` s, each drawn over `REVEAL_DRAW` s; the stars pulse for `GLOW_SECONDS`. */
export const REVEAL_STEP = 0.08;
export const REVEAL_DRAW = 0.25;
export const GLOW_SECONDS = 0.6;
/** Line brightness: the figure just found, the others found before, the hint's ghost. */
export const LINE_FOUND_NOW = 1;
export const LINE_FOUND = 0.3;
export const LINE_GHOST = 0.15;
/** Names on the sky at once, at most. */
export const MAX_LABELS = 10;
/** The reticle's progress ring: a circle of r = 46 in a 100 x 100 view box (StarFinder.tsx draws it). */
export const RING_LENGTH = 2 * Math.PI * 46;

/** The HUD's elements the frame writes into (registered by StarFinder.tsx while it is mounted). */
export const skyOverlay = {
  reticle: null as HTMLElement | null,
  ring: null as SVGCircleElement | null,
  arrow: null as HTMLElement | null,
  arrowText: null as HTMLElement | null,
  look: null as HTMLElement | null,
  card: null as HTMLElement | null,
  labels: [] as HTMLElement[],
};

/** One figure for SkyLines to draw this frame. */
export interface LineFigure {
  geom: FigureGeom;
  brightness: number;
  /** Seconds since its reveal began (Infinity: fully drawn). */
  revealAge: number;
  /** Line indexes in reveal order (null: as listed). */
  order: number[] | null;
}

/** What SkyLines draws this frame (rebuilt in place). */
export const lineSpec: LineFigure[] = [];

/** The reveal's star pulse: the stars' catalogue indexes and the runtime time it began (-1: none). */
export const glow = { stars: [] as number[], start: -1, now: 0 };

const rt = {
  elapsed: 0,
  aim: 0,
  onTarget: 0,
  lastRefresh: -Infinity,
  lastInfo: -Infinity,
  lastLook: -Infinity,
  wasOpen: false,
  wasPhase: "day" as "day" | "night",
  revealId: null as string | null,
  revealStart: 0,
  revealOrder: null as number[] | null,
  duskAt: -Infinity,
  reticlePx: 0,
  cardBottom: 0,
};

const fwd = new Vector3();
const tmpV = new Vector3();
const dirA: Vec3 = [0, 0, 0];
const dirB: Vec3 = [0, 0, 0];
const fwdArr: Vec3 = [0, 0, 0];
const scr = { x: 0, y: 0 };

function geomOf(id: string | null): FigureGeom | undefined {
  return id ? sky.figures.find((g) => g.figure.id === id) : undefined;
}

/** The finder's status for the DEV probe and the e2e. */
export function finderProbe() {
  const st = useStarFinder.getState();
  const g = geomOf(st.targetId);
  const aimAt = g && sky.catalog ? altAzOf(anchorDirection(g, [0, 0, 0])) : null;
  return {
    targetAlt: aimAt?.altDeg ?? null,
    targetAz: aimAt?.azDeg ?? null,
    aimAllowanceDeg: g?.aimDeg ?? null,
    open: st.open,
    phase: st.phase,
    firstPerson: st.firstPerson,
    targetId: st.targetId,
    foundNow: st.foundNow,
    ghost: st.ghost,
    aim: rt.aim,
    ranking: st.ranking,
    found: Object.keys(st.progress.found),
    aimInfo: st.aimInfo,
    lines: lineSpec.map((l) => ({ id: l.geom.figure.id, brightness: l.brightness })),
  };
}

/** Tests / a scene that unmounts: forget the frame state. */
export function resetFinderRuntime(): void {
  Object.assign(rt, {
    elapsed: 0,
    aim: 0,
    onTarget: 0,
    lastRefresh: -Infinity,
    lastInfo: -Infinity,
    lastLook: -Infinity,
    wasOpen: false,
    wasPhase: "day",
    revealId: null,
    revealStart: 0,
    revealOrder: null,
    duskAt: -Infinity,
    reticlePx: 0,
    cardBottom: 0,
  });
  lineSpec.length = 0;
  glow.stars = [];
  glow.start = -1;
}

/** Once a second (and on opening): day or night, the ranking, the target, its place and picture. */
function refresh(st: StarFinderState, firstPerson: boolean): void {
  const phase = sky.sunElevationDeg > NIGHT_BELOW_DEG ? "day" : "night";
  const patch: Partial<StarFinderState> = { phase, firstPerson, catalogReady: !!sky.catalog };
  if (phase === "day") {
    if (rt.wasPhase === "night" && st.open && rt.wasOpen) patch.notice = "곧 날이 밝아요. 별자리 찾기는 다음 밤에 또 해요.";
    if (sky.utcMs - rt.duskAt > 60_000 || !st.duskText) {
      const dusk = nextSunset(sky.utcMs, NIGHT_BELOW_DEG);
      patch.duskText = dusk === null ? "" : duskWords(kstClock(sky.utcMs), kstClock(dusk));
      rt.duskAt = sky.utcMs;
    }
    patch.targetId = null;
    patch.targetShape = null;
    patch.ranking = [];
  } else if (sky.catalog && st.open) {
    const season = seasonAt(sky.utcMs);
    const cands: Candidate[] = sky.figures.map((g) => ({
      id: g.figure.id,
      season: g.figure.season,
      up: isFigureUp(altAzOf(anchorDirection(g, dirA)).altDeg, starAltitudes(g)),
      anchorAltDeg: altAzOf(dirA).altDeg,
      found: !!st.progress.found[g.figure.id],
    }));
    const ranking = rankTargets(cands, season);
    if (ranking.join() !== st.ranking.join()) patch.ranking = ranking;
    let target = st.targetId;
    if (!st.foundNow && (target === null || !ranking.includes(target))) target = ranking[0] ?? null;
    if (target !== st.targetId) {
      patch.targetId = target;
      patch.ghost = false;
      rt.aim = 0;
      rt.onTarget = 0;
    }
    const g = geomOf(target);
    if (g) {
      anchorDirection(g, dirA);
      const { altDeg, azDeg } = altAzOf(dirA);
      patch.targetWhere = whereText(altDeg, azDeg);
      if (target !== st.targetId || !st.targetShape) {
        const dirs = g.stars.map((i) => starDirection(i, [0, 0, 0]));
        const index = new Map(g.stars.map((s, k) => [s, k]));
        patch.targetShape = skyShape(
          dirs,
          g.stars.map((i) => sky.catalog!.mag[i]!),
          g.lines.map(([a, b]) => [index.get(a)!, index.get(b)!] as [number, number]),
          dirA,
        );
      }
    } else {
      patch.targetShape = null;
      patch.targetWhere = "";
    }
  }
  rt.wasPhase = phase;
  patchFinder(patch);
}

/** The target is found: progress, the reveal, the chime, the words for screen readers. */
function found(st: StarFinderState, g: FigureGeom): void {
  const id = g.figure.id;
  setProgress(markFound(st.progress, id, sky.utcMs));
  const counts = seasonCounts(useStarFinder.getState().progress)[g.figure.season];
  patchFinder({
    foundNow: id,
    ghost: false,
    aimInfo: null,
    announce: `${withObjectParticle(g.figure.name)} 찾았어요! ${SEASON_NAME[g.figure.season]} 발견 ${counts.found}/${counts.total}`,
  });
  rt.revealId = id;
  rt.revealStart = rt.elapsed;
  rt.revealOrder = revealOrder(g.figure.lines, (hr) => sky.catalog!.mag[sky.catalog!.indexOf(hr)] ?? 9);
  glow.stars = g.stars;
  glow.start = rt.elapsed;
  rt.aim = 0;
  playFoundChime();
}

function hide(el: HTMLElement | null): void {
  if (el && !el.hidden) el.hidden = true;
}
function show(el: HTMLElement | null): void {
  if (el && el.hidden) el.hidden = false;
}

/** The frame's step. `width` / `height`: the canvas's CSS size. */
export function finderFrame(camera: PerspectiveCamera, dt: number, width: number, height: number): void {
  rt.elapsed += dt;
  glow.now = rt.elapsed;
  let st = useStarFinder.getState();
  const firstPerson = viewState.mode === "fp" && viewState.blend > 0.95;
  if (rt.elapsed - rt.lastRefresh >= 1 || st.open !== rt.wasOpen || firstPerson !== st.firstPerson) {
    rt.lastRefresh = rt.elapsed;
    refresh(st, firstPerson);
    st = useStarFinder.getState();
  }
  if (st.open !== rt.wasOpen) {
    rt.wasOpen = st.open;
    if (!st.open) rt.revealId = null;
  }
  if (rt.revealId && st.foundNow !== rt.revealId) rt.revealId = null; // "다음 별자리" pressed

  const night = st.phase === "night" && !!sky.catalog;
  const aiming = st.open && night && firstPerson;
  const g = aiming ? geomOf(st.targetId) : undefined;

  camera.getWorldDirection(fwd);
  fwdArr[0] = fwd.x;
  fwdArr[1] = fwd.y;
  fwdArr[2] = fwd.z;

  // ── the aim ──
  if (g && !st.foundNow) {
    anchorDirection(g, dirA);
    const off = angleDeg(fwdArr, dirA);
    rt.aim = stepAim(rt.aim, off <= g.aimDeg, dt);
    rt.onTarget += dt;
    if (!st.ghost && showGhost(rt.onTarget)) patchFinder({ ghost: true });
    if (rt.aim >= 1) {
      found(st, g);
      st = useStarFinder.getState();
    }
    arrow(camera, off, width, height);
  } else {
    if (!aiming) rt.aim = 0;
    hide(skyOverlay.arrow);
  }
  // the found figure's reveal stays clear of the reticle
  reticle(camera, aiming && !st.foundNow, height, !!g && !st.foundNow && rt.aim > 0);

  // ── what the reticle passes over, where the player looks ──
  if (aiming && rt.elapsed - rt.lastInfo >= 0.1) {
    rt.lastInfo = rt.elapsed;
    patchFinder({ aimInfo: st.foundNow ? null : aimInfo() });
  }
  if (st.open && rt.elapsed - rt.lastLook >= 0.25) {
    rt.lastLook = rt.elapsed;
    // where the card ends (the edge arrow keeps below it)
    rt.cardBottom = skyOverlay.card ? skyOverlay.card.getBoundingClientRect().bottom : 0;
  }
  if (st.open && skyOverlay.look && rt.lastLook === rt.elapsed) {
    const { altDeg, azDeg } = altAzOf(fwdArr);
    const text = lookText(altDeg, azDeg);
    if (skyOverlay.look.textContent !== text) skyOverlay.look.textContent = text;
  }

  // ── lines and names ──
  buildLines(st, night);
  labels(camera, width, height);
}

/** The planet or bright star the view's centre is near, in words (null: none). */
function aimInfo(): string | null {
  for (const p of sky.planets) {
    if (angleDeg(fwdArr, eqDirection(p.eq, dirB)) <= PLANET_NEAR_DEG && altAzOf(dirB).altDeg > 0) return `${p.name} — 별이 아니라 행성이에요`;
  }
  const cat = sky.catalog;
  if (!cat) return null;
  for (let i = 0; i < cat.count && cat.mag[i]! <= BRIGHT_STAR_MAG; i++) {
    const name = STAR_NAMES[cat.hr[i]!];
    if (!name) continue;
    if (angleDeg(fwdArr, starDirection(i, dirB)) <= BRIGHT_STAR_NEAR_DEG && altAzOf(dirB).altDeg > 0) return name;
  }
  return null;
}

function reticle(camera: PerspectiveCamera, on: boolean, height: number, active: boolean): void {
  const el = skyOverlay.reticle;
  if (!el) return;
  if (!on) {
    hide(el);
    return;
  }
  show(el);
  const r = Math.round((Math.tan((RETICLE_DEG * Math.PI) / 180) / Math.tan((camera.fov * Math.PI) / 360)) * (height / 2));
  if (r !== rt.reticlePx) {
    rt.reticlePx = r;
    el.style.width = el.style.height = `${2 * r}px`;
    // the card keeps above the reticle (starFinder.css reads this)
    if (typeof document !== "undefined") document.documentElement.style.setProperty("--cv-sky-reticle", `${r}px`);
  }
  const ring = skyOverlay.ring;
  if (ring) {
    const off = (RING_LENGTH * (1 - rt.aim)).toFixed(1);
    if (ring.style.strokeDashoffset !== off) ring.style.strokeDashoffset = off;
  }
  el.classList.toggle("is-aiming", active);
}

function arrow(camera: PerspectiveCamera, offAxisDeg: number, width: number, height: number): void {
  const el = skyOverlay.arrow;
  if (!el) return;
  // the target in camera space (x right, y up, -z forward), and whether it lands on the screen
  tmpV.set(dirA[0], dirA[1], dirA[2]).transformDirection(camera.matrixWorldInverse);
  const view: Vec3 = [tmpV.x, tmpV.y, tmpV.z];
  tmpV.set(camera.position.x + dirA[0] * 500, camera.position.y + dirA[1] * 500, camera.position.z + dirA[2] * 500).project(camera);
  const onScreen = view[2] < 0 && Math.abs(tmpV.x) <= 0.92 && Math.abs(tmpV.y) <= 0.88;
  const hint = arrowHint(view, offAxisDeg, onScreen);
  if (!hint.show) {
    hide(el);
    return;
  }
  show(el);
  // on an ellipse inside the screen's edges; above the middle, it stays under the card
  const mx = width / 2 - 64;
  const sin = Math.sin(hint.angleRad);
  const top = Math.max(72, rt.cardBottom + 48);
  const my = sin > 0 ? Math.max(40, height / 2 - top) : height / 2 - 96;
  let x = width / 2 + Math.cos(hint.angleRad) * mx;
  const y = height / 2 - sin * my;
  // a short screen (a phone under the card): an arrow that would sit on the reticle steps to its side
  const r = rt.reticlePx;
  if (Math.abs(y - height / 2) < r + 36 && Math.abs(x - width / 2) < r + 40) x = width / 2 + (x >= width / 2 ? 1 : -1) * (r + 56);
  el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  const glyph = el.firstElementChild as HTMLElement | null;
  if (glyph) glyph.style.transform = `rotate(${(-hint.angleRad * 180) / Math.PI}deg)`;
  const text = hint.behind ? "뒤쪽이에요 ↻" : hint.up ? "↑ 더 위로" : "";
  if (skyOverlay.arrowText && skyOverlay.arrowText.textContent !== text) skyOverlay.arrowText.textContent = text;
}

function buildLines(st: StarFinderState, night: boolean): void {
  lineSpec.length = 0;
  if (!night) return;
  const showFound = st.open || st.progress.showFound;
  for (const g of sky.figures) {
    const id = g.figure.id;
    if (id === rt.revealId) {
      lineSpec.push({ geom: g, brightness: LINE_FOUND_NOW, revealAge: rt.elapsed - rt.revealStart, order: rt.revealOrder });
    } else if (showFound && st.progress.found[id]) {
      lineSpec.push({ geom: g, brightness: LINE_FOUND, revealAge: Infinity, order: null });
    } else if (st.open && st.ghost && id === st.targetId && !st.foundNow) {
      lineSpec.push({ geom: g, brightness: LINE_GHOST, revealAge: Infinity, order: null });
    }
  }
  // the one being revealed first (its names win the label budget)
  lineSpec.sort((a, b) => b.brightness - a.brightness);
}

function labels(camera: PerspectiveCamera, width: number, height: number): void {
  const pool = skyOverlay.labels;
  let n = 0;
  /** Screen position of a direction into `scr` (CSS px); false when it is low, behind or off screen. */
  const project = (dir: Readonly<Vec3>): boolean => {
    if (altAzOf(dir).altDeg < 3) return false;
    tmpV.set(camera.position.x + dir[0] * 500, camera.position.y + dir[1] * 500, camera.position.z + dir[2] * 500);
    tmpV.applyMatrix4(camera.matrixWorldInverse);
    if (tmpV.z >= 0) return false; // behind
    tmpV.applyMatrix4(camera.projectionMatrix);
    if (Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) return false;
    scr.x = ((tmpV.x + 1) / 2) * width;
    scr.y = ((1 - tmpV.y) / 2) * height;
    return true;
  };
  const put = (x: number, y: number, text: string, kind: "figure" | "star" | "focus", opacity: number, centred: boolean): void => {
    if (n >= pool.length || n >= MAX_LABELS) return;
    const el = pool[n++]!;
    if (el.textContent !== text) el.textContent = text;
    if (el.dataset.kind !== kind) {
      el.dataset.kind = kind;
      el.className = `cv-sky-label is-${kind}`;
    }
    el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)${centred ? " translate(-50%, -100%)" : ""}`;
    el.style.opacity = opacity.toFixed(2);
    show(el);
  };
  const place = (dir: Readonly<Vec3>, text: string, kind: "star", opacity: number): void => {
    if (project(dir)) put(scr.x, scr.y, text, kind, opacity, false);
  };
  /** A figure's name, centred above its highest star on screen. */
  const placeTitle = (g: FigureGeom, text: string, kind: "figure" | "focus", opacity: number): void => {
    let sx = 0;
    let top = Infinity;
    let k = 0;
    for (const i of g.stars) {
      if (!project(starDirection(i, dirB))) continue;
      sx += scr.x;
      top = Math.min(top, scr.y);
      k++;
    }
    if (k > 0) put(sx / k, top, text, kind, opacity, true);
  };
  for (const l of lineSpec) {
    if (l.brightness < LINE_FOUND) continue; // the ghost has no names
    const revealing = l.revealAge !== Infinity;
    const fadeIn = revealing ? Math.min(1, Math.max(0, (l.revealAge - 0.6) / 0.5)) : 1;
    if (fadeIn <= 0) continue;
    const f = l.geom.figure;
    placeTitle(l.geom, figureTitle(f), revealing ? "focus" : "figure", revealing ? fadeIn : 0.75);
    if (revealing) {
      for (const i of l.geom.stars) {
        const name = STAR_NAMES[sky.catalog!.hr[i]!];
        if (name) place(starDirection(i, dirB), name, "star", fadeIn);
      }
    }
  }
  for (let k = n; k < pool.length; k++) hide(pool[k]!);
}

/** The figure's Korean name for an id ("" for none). */
export function figureLabel(id: string | null): string {
  const f = id ? figureById(id) : undefined;
  return f ? figureTitle(f) : "";
}
