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
import { clampFpPitch } from "../../game/viewMode";
import { normalizeAngle } from "../../game/yaw";
import { SKY_FOV_MIN, setSkyZoomGoal, viewState } from "../../game/viewState";
import { anchorDirection, eqDirection, sky, starAltitudes, starDirection, type FigureGeom } from "./skyRuntime";
import {
  BRIGHT_STAR_MAG,
  BRIGHT_STAR_NEAR_DEG,
  PLANET_NEAR_DEG,
  arrowHint,
  duskWords,
  compassWord,
  heightWord,
  isFigureUp,
  lookText,
  rankTargets,
  revealOrder,
  skyShape,
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

/** The HUD's elements the frame writes into (registered by StarFinder.tsx while it is mounted). */
export const skyOverlay = {
  arrow: null as HTMLElement | null,
  arrowText: null as HTMLElement | null,
  look: null as HTMLElement | null,
  zoomText: null as HTMLElement | null,
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
  /** The figure the player picked: its name and its stars' names stay on the sky. */
  focus?: boolean;
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
  /** The card's box (CSS px): names under it are not drawn. */
  cardRect: null as null | { l: number; t: number; r: number; b: number },
  /** The camera turn toward a picked figure (look yaw / pitch, rad) and the yaw we last wrote (to see the player take over). */
  rowText: "",
  turn: null as null | { yaw: number; altRad: number; below: number; spanDeg: number; zoomed?: boolean; lastYaw: number; lastPitch: number },
  /** The zoom readout's last text (written only when it changes). */
  zoomShown: 0,
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
    zoom: viewState.skyZoom,
    zoomGoal: viewState.skyZoomGoal,
    fov: viewState.skyFovBase * viewState.skyZoom,
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
    cardRect: null,
    zoomShown: 0,
    turn: null,
    rowText: "",
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
    rt.turn = null;
  } else if (sky.catalog && st.open) {
    const season = seasonAt(sky.utcMs);
    const rows: Record<string, string> = {};
    const cands: Candidate[] = sky.figures.map((g) => {
      const { altDeg, azDeg } = altAzOf(anchorDirection(g, dirA));
      rows[g.figure.id] = `${compassWord(azDeg)}쪽 · ${heightWord(altDeg)}`;
      return {
        id: g.figure.id,
        season: g.figure.season,
        up: isFigureUp(altDeg, starAltitudes(g)),
        anchorAltDeg: altDeg,
        found: !!st.progress.found[g.figure.id],
      };
    });
    const ranking = rankTargets(cands, season);
    if (ranking.join() !== st.ranking.join()) patch.ranking = ranking;
    const rowText = ranking.map((id) => `${id}=${rows[id]}`).join("|");
    if (rowText !== rt.rowText) {
      rt.rowText = rowText;
      patch.rowInfo = Object.fromEntries(ranking.map((id) => [id, rows[id]!]));
    }
    // The player picks (selectFigure); a pick that has set below the hills is let go.
    let target = st.targetId;
    if (target !== null && !ranking.includes(target)) {
      target = null;
      rt.turn = null;
    }
    if (target !== st.targetId) {
      patch.targetId = target;
      patch.targetShape = null;
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

/**
 * The player picked a figure (a row of the list): it is marked seen (the album), its lines draw themselves on the sky with
 * its name, and the view turns gently toward it (the player dragging the view takes over at once).
 */
export function selectFigure(id: string): void {
  const g = geomOf(id);
  const st = useStarFinder.getState();
  if (!g || !sky.catalog) return;
  const first = !st.progress.found[id];
  if (first) {
    setProgress(markFound(st.progress, id, sky.utcMs));
    playFoundChime();
  }
  const counts = seasonCounts(useStarFinder.getState().progress)[g.figure.season];
  patchFinder({
    targetId: id,
    targetShape: null,
    foundNow: null,
    aimInfo: null,
    announce: `${withObjectParticle(g.figure.name)} 하늘에 그렸어요.${first ? ` ${SEASON_NAME[g.figure.season]} 발견 ${counts.found}/${counts.total}` : ""}`,
  });
  rt.revealId = id;
  rt.revealStart = rt.elapsed;
  rt.revealOrder = revealOrder(g.figure.lines, (hr) => sky.catalog!.mag[sky.catalog!.indexOf(hr)] ?? 9);
  glow.stars = g.stars;
  glow.start = rt.elapsed;
  // the look direction that centres its aim point (the same yaw / pitch convention as CameraRig first-person pose)
  const d = anchorDirection(g, [0, 0, 0]);
  // The card covers the top of the screen (a phone: its top third), so the figure is brought to the lower part: `below` is
  // how far under the middle (share of the screen height) it ends up.
  const portrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth;
  // how wide the figure is on the sky (twice its farthest star from the aim point): the lens narrows to frame it
  let reach = 0;
  for (const i of g.stars) reach = Math.max(reach, angleDeg(d, starDirection(i, dirB)));
  rt.turn = { yaw: Math.atan2(-d[0], -d[2]), altRad: Math.asin(Math.max(-1, Math.min(1, d[1]))), below: portrait ? 0.2 : 0.08, spanDeg: reach * 2, lastYaw: NaN, lastPitch: NaN };
  if (first) patchFinder({ discovery: { id, at: Date.now() } });
  rt.lastRefresh = -Infinity; // refresh the picture and the words now
}

/** The back-to-list button: let go of the pick. */
export function clearSelection(): void {
  rt.turn = null;
  rt.revealId = null;
  patchFinder({ targetId: null, targetShape: null, foundNow: null, aimInfo: null });
}

/** Ease the first-person view toward the picked figure; stops when the player turns the view themselves. */
function stepTurn(dt: number): void {
  let fovDeg: number;
  const t = rt.turn;
  if (!t) return;
  if (viewState.mode !== "fp") {
    rt.turn = null;
    return;
  }
  if (!Number.isNaN(t.lastYaw) && (Math.abs(normalizeAngle(viewState.fpYaw - t.lastYaw)) > 0.004 || Math.abs(viewState.fpPitch - t.lastPitch) > 0.004)) {
    rt.turn = null; // the player's own drag
    return;
  }
  if (!t.zoomed) {
    t.zoomed = true;
    // the vertical fov that shows the whole figure with some air round it (a tall phone: its narrow width decides)
    const need = Math.max(SKY_FOV_MIN, t.spanDeg * 1.6);
    const aspect = typeof window !== "undefined" ? window.innerWidth / Math.max(1, window.innerHeight) : 1.6;
    const vfov = aspect < 1 ? (2 * Math.atan(Math.tan((need * Math.PI) / 360) / aspect) * 180) / Math.PI : need;
    setSkyZoomGoal(vfov / Math.max(1, viewState.skyFovBase));
  }
  fovDeg = viewState.skyZoomGoal * viewState.skyFovBase;
  const dy = normalizeAngle(t.yaw - viewState.fpYaw);
  // looking above the figure by `below` of the view's height puts it that far under the middle
  const goalPitch = clampFpPitch(-(t.altRad + t.below * ((fovDeg * Math.PI) / 180)), true);
  const dp = goalPitch - viewState.fpPitch;
  const k = 1 - Math.exp(-4.2 * dt);
  // at most ~100 deg/s, so a half-turn takes under 2 s and never snaps
  const cap = 1.75 * dt;
  const sy = Math.max(-cap, Math.min(cap, dy * k + Math.sign(dy) * Math.min(Math.abs(dy), 0.02)));
  const sp = Math.max(-cap, Math.min(cap, dp * k + Math.sign(dp) * Math.min(Math.abs(dp), 0.02)));
  viewState.fpYaw = normalizeAngle(viewState.fpYaw + sy);
  viewState.fpPitch = viewState.fpPitch + sp;
  t.lastYaw = viewState.fpYaw;
  t.lastPitch = viewState.fpPitch;
  if (Math.abs(dy) < 0.01 && Math.abs(dp) < 0.01) rt.turn = null;
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
  const picking = st.open && night && firstPerson;
  const g = picking ? geomOf(st.targetId) : undefined;

  camera.getWorldDirection(fwd);
  fwdArr[0] = fwd.x;
  fwdArr[1] = fwd.y;
  fwdArr[2] = fwd.z;

  // the guide: the view turns to the pick; the arrow shows the way while it is off screen
  if (picking) stepTurn(dt);
  else rt.turn = null;
  if (g && !rt.turn) {
    anchorDirection(g, dirA);
    arrow(camera, angleDeg(fwdArr, dirA), width, height, figureTitle(g.figure));
  } else {
    hide(skyOverlay.arrow);
  }

  // ── what the reticle passes over, where the player looks ──
  if (picking && rt.elapsed - rt.lastInfo >= 0.1) {
    rt.lastInfo = rt.elapsed;
    patchFinder({ aimInfo: aimInfo() });
  }
  if (st.open && rt.elapsed - rt.lastLook >= 0.25) {
    rt.lastLook = rt.elapsed;
    // where the card ends (the edge arrow keeps below it)
    const cr = skyOverlay.card ? skyOverlay.card.getBoundingClientRect() : null;
    rt.cardBottom = cr ? cr.bottom : 0;
    rt.cardRect = cr ? { l: cr.left - 20, t: cr.top - 24, r: cr.right + 20, b: cr.bottom + 20 } : null;
  }
  if (st.open && skyOverlay.look && rt.lastLook === rt.elapsed) {
    const { altDeg, azDeg } = altAzOf(fwdArr);
    const text = lookText(altDeg, azDeg);
    if (skyOverlay.look.textContent !== text) skyOverlay.look.textContent = text;
  }

  // the zoom readout ("×2.4"), written when it changes
  if (skyOverlay.zoomText && Math.abs(rt.zoomShown - viewState.skyZoom) > 0.004) {
    rt.zoomShown = viewState.skyZoom;
    skyOverlay.zoomText.textContent = `×${(1 / viewState.skyZoom).toFixed(1)}`;
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

function arrow(camera: PerspectiveCamera, offAxisDeg: number, width: number, height: number, name: string): void {
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
  const text = `${name}${hint.behind ? " · 뒤쪽 ↻" : hint.up ? " · 더 위로" : ""}`;
  if (skyOverlay.arrowText && skyOverlay.arrowText.textContent !== text) skyOverlay.arrowText.textContent = text;
}

function buildLines(st: StarFinderState, night: boolean): void {
  lineSpec.length = 0;
  if (!night) return;
  // The found figures' lines stay on the sky only while "찾은 별자리 선 항상 켜두기" is on (card open or closed); the figure
  // being looked at is drawn while the card is open.
  const showFound = st.progress.showFound;
  for (const g of sky.figures) {
    const id = g.figure.id;
    if (st.open && id === st.targetId) {
      const age = rt.elapsed - rt.revealStart;
      lineSpec.push({ geom: g, brightness: LINE_FOUND_NOW, revealAge: age > 3 ? Infinity : age, order: rt.revealOrder, focus: true });
    } else if (showFound && st.progress.found[id]) {
      lineSpec.push({ geom: g, brightness: LINE_FOUND, revealAge: Infinity, order: null });
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
    const cr = rt.cardRect;
    if (cr && x > cr.l && x < cr.r && y > cr.t && y < cr.b) return; // under the card
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
    const focus = !!l.focus;
    const fadeIn = l.revealAge !== Infinity ? Math.min(1, Math.max(0, (l.revealAge - 0.6) / 0.5)) : 1;
    if (fadeIn <= 0) continue;
    const f = l.geom.figure;
    placeTitle(l.geom, figureTitle(f), focus ? "focus" : "figure", focus ? fadeIn : 0.75);
    if (focus) {
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
