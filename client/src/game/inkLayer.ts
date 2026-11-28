import {
  ACESFilmicToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  Vector3,
  type AmbientLight,
  type Camera,
  type DirectionalLight,
  type Fog,
  type FogExp2,
  type HemisphereLight,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import {
  INK_MAX_H,
  INK_MAX_W,
  affineError,
  clipOf,
  inkBucket,
  inkGrid,
  inkLabels,
  lightFromProbe,
  makeTone,
  screenGrid,
  standardLight,
  toneKey,
  type InkFog,
  type InkLabel,
  type SceneLightLike,
  type ToneCurveId,
} from "./inkLabels";
import { postChainFrames } from "./renderScale";

/**
 * The ink layer (inkLabels.ts): each frame, after the scene is drawn and before the label overlay is drawn (NametagSystem's
 * after-effect), it picks the signs worth drawing crisp, tests their cells against the frame's depth buffer (WebGL2 occlusion
 * queries, read a frame or two later), reads back a few board pixels for their light (a pixel-pack buffer and a fence, read when
 * the fence has passed: no stall), and lays out what the overlay draws. Then the overlay draws it (`draw`), and each sign is told
 * whether its 3D lettering shows (`setInk`).
 *
 * Runs only where it helps: the scene drawn to the canvas itself (not the rich tier's post chain, whose depth is in its own target)
 * at clearly fewer pixels than the device has (a phone at dpr 1 on a dpr-3 screen). Everywhere else every sign shows its own
 * lettering, as before.
 *
 * Cost on a phone (per frame, the signs on screen): a projection of each registered sign's corners, one tiny depth-tested draw and
 * one query per cell of the signs drawn (2 x 2..8 cells, at most MAX_SIGNS signs), one 3x3 read-back per sign every PROBE_EVERY
 * frames, and the overlay's drawImage of each sign's raster (re-rasterized only when its size steps a quarter octave or its light
 * changes). No GPU texture: the rasters are 2D canvases in device px, dropped a few seconds after a sign is last drawn.
 */

/** At most this many signs are drawn crisp at once (the biggest on screen). */
export const MAX_SIGNS = 5;
/** A sign smaller than this on screen (its height, device px) keeps its 3D lettering. */
export const MIN_SIGN_PX = 14;
/** A query result older than this many frames is too old to draw from. */
const FRESH_FRAMES = 5;
/** Each sign's board is read back every this many frames. */
const PROBE_EVERY = 12;
/**
 * One affine map draws a sign while its quad's miss (affineError, device px) is under this: the best fit puts each corner off by a
 * quarter of it, at most one canvas pixel on a dpr-3 phone, the board's own precision there.
 */
const STRIP_ERR = 12;
/** A raster not drawn for this many frames is dropped. */
const DROP_AFTER = 240;
/** The canvas draws the scene at less than this share of the device's pixels: the ink layer runs. */
export const INK_DPR_SHARE = 0.8;
/**
 * The occlusion proxy stands this far in front of the sign (m; and 0.4% of the distance): the sign's own board, rim and frame
 * (the gate's moulding stands 2.5 cm proud) never hide it.
 */
const PROXY_LIFT = 0.03;
/**
 * The "anything in front of it?" test is made on each cell grown by this margin (framebuffer px) plus three frames of the sign's
 * own motion on screen (and twice the parallax of the eye's travel): a wall coming in over the sign is caught before it reaches a
 * cell, so the results' frame or two of delay never shows letters over it. Capped.
 */
const GUARD_PX = 1.5;
const GUARD_MAX = 64;
/** A guard wider than this (fb px) means the eye or the sign moves fast: a sign with any cell partly hidden is left to WebGL then. */
const FAST_GUARD = 6;
/**
 * A wider ring round each cell (fb px, on top of the guard): which cells have something in front of them within it. While that set
 * changes from one result to the next, something is moving near the sign (a car, an avatar, a wall sliding past as the eye walks)
 * and the sign is left to WebGL's own lettering (its depth test has no delay) until it holds still.
 */
const RING_PX = 24;
/** The eye moved this far in one frame (m), or a sign this far on screen (fb px): a cut, every result before it is void. */
const CUT_STEP = 0.75;
const CUT_PX = 60;

interface Raster {
  canvas: HTMLCanvasElement;
  key: string;
}

interface SignState {
  label: InkLabel;
  cols: number;
  rows: number;
  /** Per cell "anything in front of it" (depth GREATER on the cell grown by the guard), per column the same on the wider ring. */
  blockers: WebGLQuery[];
  rings: WebGLQuery[];
  pending: boolean;
  /** The frame the in-flight queries were issued on, and the results: bit (row * cols + col) per cell. */
  issued: number;
  seen: number;
  seenBefore: number;
  blocked: number;
  /** The ring results, this one and the one before (-1: none yet). */
  ring: number;
  ringBefore: number;
  /** The last cut it saw (a frame number): results issued on or before it are void. */
  cutFrame: number;
  /** The cells drawn: nothing in front of them (nor within the guard) in the last two results (`seen & seenBefore`). */
  mask: number;
  maskFrame: number;
  /** The guard (fb px) the in-flight blocker queries were grown by, and the one the last result had. */
  guardIssued: number;
  guard: number;
  /** The sign's centre on screen last frame (device px; NaN: none) for its speed. */
  lastX: number;
  lastY: number;
  speed: number;
  fog: InkFog | null;
  light: [number, number, number] | null;
  probeFrame: number;
  probing: boolean;
  raster: Raster | null;
  lastDrawn: number;
  /** Whether its 3D lettering shows (what it was last told). */
  ink3d: boolean;
  /** This frame: its screen grid (device px) and whether it is drawn. */
  grid: number[];
  gridCols: number;
  sub: number;
  /** Drawn strip by strip (a strong perspective), else in one map. */
  strips: boolean;
  drawn: boolean;
  size: number;
}

interface ProbeBatch {
  buffer: WebGLBuffer;
  sync: WebGLSync | null;
  signs: SignState[];
}

export interface InkStats {
  active: boolean;
  registered: number;
  candidates: number;
  drawn: number;
  cells: number;
  /** Time spent in update (ms, the last frame) and summed since start, and the frames counted. */
  ms: number;
  totalMs: number;
  frames: number;
  rasters: number;
  rasterMs: number;
}

const VERT = `#version 300 es
in vec4 aPos;
void main() { gl_Position = aPos; }`;
const FRAG = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;

function curveOf(renderer: WebGLRenderer): ToneCurveId {
  const t = renderer.toneMapping;
  if (t === NeutralToneMapping) return "neutral";
  if (t === ACESFilmicToneMapping) return "aces";
  if (t === LinearToneMapping) return "linear";
  if (t === NoToneMapping) return "none";
  return "neutral";
}

/** The object and all its ancestors are visible, and its root is `scene`. */
function shownIn(object: Object3D, scene: Object3D): boolean {
  let o: Object3D = object;
  for (;;) {
    if (!o.visible) return false;
    if (!o.parent) return o === scene;
    o = o.parent;
  }
}

export class InkLayer {
  private readonly states = new Map<InkLabel, SignState>();
  private frame = 0;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private verts = new Float32Array(6 * 4 * 64);
  private readonly batches: ProbeBatch[] = [];
  private readonly freeBuffers: WebGLBuffer[] = [];
  private lastChain = -1;
  private active = false;
  /** The GL path failed once (a missing feature, a driver error): the signs keep their own lettering from then on. */
  private broken = false;
  private overlayW = 1;
  private readonly lastEye = new Vector3(Number.NaN, 0, 0);
  private eyeStep = 0;
  private readonly lights: SceneLightLike[] = [];
  private curve: ToneCurveId = "neutral";
  private exposure = 1;
  private readonly drawList: SignState[] = [];
  private fontsVersion = 0;
  readonly stats: InkStats = { active: false, registered: 0, candidates: 0, drawn: 0, cells: 0, ms: 0, totalMs: 0, frames: 0, rasters: 0, rasterMs: 0 };

  constructor() {
    // a raster drawn before the page's fonts were in may have used a fallback face: redraw them once they are
    if (typeof document !== "undefined")
      void document.fonts?.ready.then(() => {
        this.fontsVersion++;
      });
  }

  /** Whether the ink layer runs for this renderer now (see the class comment). */
  private wantActive(renderer: WebGLRenderer, deviceDpr: number): boolean {
    const chain = postChainFrames();
    const chainRan = chain !== this.lastChain;
    this.lastChain = chain;
    if (chainRan) return false;
    // DEV/E2E: the signs as WebGL alone draws them (the before/after shots: e2e/text-crisp-signs.mjs)
    if (import.meta.env.DEV && (globalThis as { __cvInkOff?: boolean }).__cvInkOff) return false;
    if (this.broken || typeof WebGL2RenderingContext === "undefined") return false;
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext) || gl.isContextLost()) return false;
    // what the layer needs of WebGL2 (a browser may leave some out): occlusion queries, fences, pixel-pack buffers
    if (!hasInkFeatures(gl)) return false;
    return renderer.getPixelRatio() < INK_DPR_SHARE * deviceDpr;
  }

  /**
   * This frame's work (after the scene is drawn, before the overlay): which signs, their cells' queries and probes, their layout
   * on a `W` x `H` device-px overlay.
   */
  update(renderer: WebGLRenderer, scene: Object3D, camera: Camera, W: number, H: number, deviceDpr: number): void {
    try {
      this.updateInner(renderer, scene, camera, W, H, deviceDpr);
    } catch {
      // never let the signs' lettering break the frame: give every sign its own lettering back, for good
      this.fail(renderer);
    }
  }

  /** Off for good: every sign's own lettering back, nothing drawn, GL state handed back to three. */
  private fail(renderer: WebGLRenderer): void {
    this.broken = true;
    this.active = false;
    this.stats.active = false;
    this.drawList.length = 0;
    for (const s of this.states.values()) {
      s.drawn = false;
      s.pending = false;
      this.setInk(s, true);
    }
    try {
      renderer.resetState();
    } catch {
      /* the context may be gone */
    }
  }

  private updateInner(renderer: WebGLRenderer, scene: Object3D, camera: Camera, W: number, H: number, deviceDpr: number): void {
    const t0 = performance.now();
    this.overlayW = W;
    this.frame++;
    this.drawList.length = 0;
    const labels = inkLabels();
    this.stats.registered = labels.size;
    // forget the signs that left
    for (const [label, s] of this.states)
      if (!labels.has(label)) {
        this.release(s);
        this.states.delete(label);
      }
    const active = labels.size > 0 && this.wantActive(renderer, deviceDpr);
    if (active !== this.active) {
      this.active = active;
      if (!active) for (const s of this.states.values()) this.setInk(s, true);
    }
    this.stats.active = active;
    if (!active) {
      for (const s of this.states.values()) s.drawn = false;
      this.stats.candidates = 0;
      this.stats.drawn = 0;
      this.stats.cells = 0;
      return;
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!this.ensureGl(gl)) {
      this.active = false;
      return;
    }
    this.curve = curveOf(renderer);
    this.exposure = renderer.toneMappingExposure;
    // the eye's travel since the last frame (m): the parallax a wall in front of a sign can sweep with
    const ex0 = camera.matrixWorld.elements[12]!;
    const ey0 = camera.matrixWorld.elements[13]!;
    const ez0 = camera.matrixWorld.elements[14]!;
    this.eyeStep = Number.isNaN(this.lastEye.x) ? 0 : Math.hypot(ex0 - this.lastEye.x, ey0 - this.lastEye.y, ez0 - this.lastEye.z);
    this.lastEye.set(ex0, ey0, ez0);
    this.lights.length = 0;
    let lightsRead = false;

    // results that came in: occlusion and probes
    for (const s of this.states.values()) this.readQueries(gl, s);
    this.readProbes(gl);

    // the candidates: shown, in front, facing the eye, on screen, big enough; the biggest MAX_SIGNS
    const view = camera.matrixWorldInverse.elements;
    const proj = camera.projectionMatrix.elements;
    const cands: SignState[] = [];
    for (const label of labels) {
      let s = this.states.get(label);
      if (!s) {
        const { cols, rows } = inkGrid(label.w, label.h);
        s = { label, cols, rows, blockers: [], rings: [], pending: false, issued: -1, seen: 0, seenBefore: 0, blocked: 0, ring: -1, ringBefore: -1, cutFrame: -1, mask: 0, maskFrame: -1e9, guardIssued: 0, guard: 0, lastX: Number.NaN, lastY: Number.NaN, speed: 0, fog: null, light: null, probeFrame: -1e9, probing: false, raster: null, lastDrawn: -1e9, ink3d: true, grid: [], gridCols: 0, sub: 1, strips: false, drawn: false, size: 0 };
        this.states.set(label, s);
      }
      s.drawn = false;
      if (!shownIn(label.object, scene)) {
        s.lastX = Number.NaN;
        continue;
      }
      const m = label.object.matrixWorld.elements;
      if (!screenGrid(m, label.w, label.h, 1, 1, view, proj, W, H, s.grid)) continue;
      const g = s.grid;
      // corners: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
      const ux = g[2]! - g[0]!;
      const uy = g[3]! - g[1]!;
      const vx = g[4]! - g[0]!;
      const vy = g[5]! - g[1]!;
      if (!(ux * vy - uy * vx > 0)) continue; // its back to the eye
      const hPx = Math.max(Math.hypot(vx, vy), Math.hypot(g[6]! - g[2]!, g[7]! - g[3]!));
      if (hPx < MIN_SIGN_PX) continue;
      const x0 = Math.min(g[0]!, g[2]!, g[4]!, g[6]!);
      const x1 = Math.max(g[0]!, g[2]!, g[4]!, g[6]!);
      const y0 = Math.min(g[1]!, g[3]!, g[5]!, g[7]!);
      const y1 = Math.max(g[1]!, g[3]!, g[5]!, g[7]!);
      if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) continue;
      // the perspective: one best-fit affine map is enough while the quad's fourth corner is missed by under STRIP_ERR, else strips
      const err = affineError(g[0]!, g[1]!, g[2]!, g[3]!, g[4]!, g[5]!, g[6]!, g[7]!);
      // (the board under it is drawn at the canvas's coarser pixels: a few device px of miss is not seen; strips have seams)
      const n = err < STRIP_ERR ? 1 : Math.min(16, Math.ceil(Math.sqrt(err / STRIP_ERR)));
      s.strips = n > 1;
      s.sub = n > 1 ? Math.max(1, Math.ceil(n / s.cols)) : 1;
      s.size = (x1 - x0) * (y1 - y0);
      // its speed on screen (device px a frame)
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      s.speed = Number.isNaN(s.lastX) ? 0 : Math.hypot(cx - s.lastX, cy - s.lastY);
      s.lastX = cx;
      s.lastY = cy;
      // a cut (the eye jumped, or the sign leapt across the screen): every result before it is void, its history starts over
      if (this.eyeStep > CUT_STEP || s.speed * (renderer.getContext().drawingBufferWidth / Math.max(1, W)) > CUT_PX) {
        s.seen = 0;
        s.ring = -1;
        s.mask = 0;
        s.cutFrame = this.frame;
      }
      cands.push(s);
    }
    cands.sort((a, b) => b.size - a.size);
    if (cands.length > MAX_SIGNS) cands.length = MAX_SIGNS;
    this.stats.candidates = cands.length;

    // queries for the candidates whose last ones are in
    const eye = camera.matrixWorld.elements;
    const issue: SignState[] = [];
    let cells = 0;
    for (const s of cands)
      if (!s.pending) {
        issue.push(s);
        cells += s.cols * s.rows + s.cols;
      }
    // probes (sign with a probe, its cell seen, its turn)
    const probe: SignState[] = [];
    for (const s of cands) {
      const p = s.label.probe;
      const m = s.label.object.matrixWorld.elements;
      s.fog = p && !s.label.lit ? null : fogOver(scene as Scene, m, view);
      if (s.label.lit === "standard") {
        if (!lightsRead) {
          readLights(scene, this.lights);
          lightsRead = true;
        }
        const nl = Math.hypot(m[8]!, m[9]!, m[10]!) || 1;
        s.light = standardLight([m[8]! / nl, m[9]! / nl, m[10]! / nl], this.lights);
        continue;
      }
      if (!p) {
        const l = s.label.light?.() ?? 1;
        s.light = [l, l, l];
        continue;
      }
      if (s.probing || this.frame - s.probeFrame < (s.light ? PROBE_EVERY : 1)) continue;
      if (this.frame - s.maskFrame > FRESH_FRAMES) continue;
      const col = Math.min(s.cols - 1, Math.max(0, Math.floor(((p.x + s.label.w / 2) / s.label.w) * s.cols)));
      const row = Math.min(s.rows - 1, Math.max(0, Math.floor(((s.label.h / 2 - p.y) / s.label.h) * s.rows)));
      if (!(s.mask & (1 << (row * s.cols + col)))) continue;
      probe.push(s);
    }
    if (issue.length > 0 || probe.length > 0) this.gpuWork(renderer, gl, issue, cells, probe, view, proj, eye);
    this.stats.cells = cells;

    // what is drawn: a fresh mask with a cell seen, a light known
    let drawn = 0;
    for (const s of cands) {
      if (this.frame - s.maskFrame > FRESH_FRAMES || s.mask === 0 || !s.light) continue;
      // moving fast with a cell partly hidden, or something moving near it: WebGL's own lettering (its depth test is exact) until
      // it settles
      if (s.guard > FAST_GUARD && s.blocked !== 0) continue;
      if (s.ring !== s.ringBefore) continue;
      // it moved further on screen this frame than its last result's guard reaches (a camera cut, a fast turn): that result cannot
      // vouch for where it is now; and a cut starts its history over
      const speedFb = s.speed * (gl.drawingBufferWidth / Math.max(1, W));
      if (speedFb > Math.max(s.guard, 4) || s.cutFrame === this.frame) continue;
      const gc = s.cols * s.sub;
      if (!screenGrid(s.label.object.matrixWorld.elements, s.label.w, s.label.h, gc, s.rows, view, proj, W, H, s.grid)) continue;
      s.gridCols = gc;
      s.drawn = true;
      this.drawList.push(s);
      drawn++;
    }
    this.stats.drawn = drawn;
    const dt = performance.now() - t0;
    this.stats.ms = dt;
    this.stats.totalMs += dt;
    this.stats.frames++;
  }

  /**
   * Draw this frame's signs on the overlay's context (device px); push the rects drawn on `dirty` (x, y, w, h). Then tell each sign
   * whether its 3D lettering shows. Returns how many were drawn.
   */
  draw(ctx: CanvasRenderingContext2D | null, dirty: number[], W: number, H: number): number {
    let n = 0;
    if (ctx && typeof ctx.setTransform === "function" && typeof ctx.clip === "function") {
      for (const s of this.drawList) {
        const img = this.raster(s);
        if (!img) {
          s.drawn = false;
          continue;
        }
        this.drawSign(ctx, s, img, dirty, W, H);
        s.lastDrawn = this.frame;
        n++;
      }
    } else for (const s of this.drawList) s.drawn = false;
    for (const s of this.states.values()) {
      this.setInk(s, !s.drawn);
      if (s.raster && this.frame - s.lastDrawn > DROP_AFTER) {
        s.raster.canvas.width = 0;
        s.raster = null;
      }
    }
    this.drawList.length = 0;
    return n;
  }

  private setInk(s: SignState, on: boolean): void {
    if (s.ink3d === on) return;
    s.ink3d = on;
    s.label.setInk(on);
  }

  /** The sign's raster at its bucket size and light (cached). */
  private raster(s: SignState): HTMLCanvasElement | null {
    if (typeof document === "undefined" || !s.light) return null;
    const g = s.grid;
    const gc = s.gridCols;
    const rows = s.rows;
    const at = (i: number, j: number) => 2 * (j * (gc + 1) + i);
    // its size on screen: the longer of each pair of opposite edges
    const top = Math.hypot(g[at(gc, 0)]! - g[at(0, 0)]!, g[at(gc, 0) + 1]! - g[at(0, 0) + 1]!);
    const bottom = Math.hypot(g[at(gc, rows)]! - g[at(0, rows)]!, g[at(gc, rows) + 1]! - g[at(0, rows) + 1]!);
    const left = Math.hypot(g[at(0, rows)]! - g[at(0, 0)]!, g[at(0, rows) + 1]! - g[at(0, 0) + 1]!);
    const right = Math.hypot(g[at(gc, rows)]! - g[at(gc, 0)]!, g[at(gc, rows) + 1]! - g[at(gc, 0) + 1]!);
    const wb = inkBucket(Math.max(top, bottom), INK_MAX_W);
    const hb = inkBucket(Math.max(left, right), INK_MAX_H);
    const desat = s.label.desaturate?.() ?? 0;
    const key = `${wb}x${hb}|${toneKey(s.light, this.curve, this.exposure, s.fog, desat)}|${this.fontsVersion}`;
    if (s.raster && s.raster.key === key) return s.raster.canvas;
    const t0 = performance.now();
    const canvas = s.raster?.canvas ?? document.createElement("canvas");
    canvas.width = wb;
    canvas.height = hb;
    const c2 = canvas.getContext("2d");
    if (!c2) return null;
    // the painter draws at the sign's own aspect, squeezed to the raster (one raster px = one screen px both ways)
    const nominalW = hb * (s.label.w / s.label.h);
    c2.setTransform(wb / nominalW, 0, 0, 1, 0, 0);
    s.label.paint(c2, nominalW, hb, makeTone(s.light, this.curve, this.exposure, s.fog, desat));
    s.raster = { canvas, key };
    this.stats.rasters++;
    this.stats.rasterMs += performance.now() - t0;
    return canvas;
  }

  /** One sign: strip by strip (each its own affine map), clipped to the cells seen. */
  private drawSign(ctx: CanvasRenderingContext2D, s: SignState, img: HTMLCanvasElement, dirty: number[], W: number, H: number): void {
    const g = s.grid;
    const gc = s.gridCols;
    const rows = s.rows;
    const iw = img.width;
    const ih = img.height;
    const at = (i: number, j: number) => 2 * (j * (gc + 1) + i);
    const full = s.mask === (1 << (s.cols * rows)) - 1;
    ctx.globalAlpha = 1;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < g.length; k += 2) {
      x0 = Math.min(x0, g[k]!);
      x1 = Math.max(x1, g[k]!);
      y0 = Math.min(y0, g[k + 1]!);
      y1 = Math.max(y1, g[k + 1]!);
    }
    // `sub` strips per query column (1: the whole sign in one map). Each strip is drawn with the affine map that fits its four
    // projected corners best (least squares: each corner off by a quarter of the quad's miss), clipped to its cells that were seen.
    // One strip needs no clip when every cell was seen; the cells of one strip form one path (no seams inside it).
    const strips = s.strips ? gc : 1;
    for (let k = 0; k < strips; k++) {
      const i0 = strips === 1 ? 0 : k;
      const i1 = strips === 1 ? gc : k + 1;
      const cols0 = strips === 1 ? 0 : Math.floor(k / s.sub);
      const cols1 = strips === 1 ? s.cols : cols0 + 1;
      let any = false;
      for (let r = 0; r < rows; r++) for (let c = cols0; c < cols1; c++) if (s.mask & (1 << (r * s.cols + c))) any = true;
      if (!any) continue;
      const clip = !(strips === 1 && full);
      ctx.save();
      if (clip) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        for (let r = 0; r < rows; r++)
          for (let c = cols0; c < cols1; c++) {
            if (!(s.mask & (1 << (r * s.cols + c)))) continue;
            // the cell's quad on the grid (a query column spans `sub` grid columns), widened half a pixel along the strip
            const ga = strips === 1 ? c * s.sub : i0;
            const gb = strips === 1 ? (c + 1) * s.sub : i1;
            const ax = g[at(ga, r)]!, ay = g[at(ga, r) + 1]!;
            const bx = g[at(gb, r)]!, by = g[at(gb, r) + 1]!;
            const cx = g[at(gb, r + 1)]!, cy = g[at(gb, r + 1) + 1]!;
            const dx = g[at(ga, r + 1)]!, dy = g[at(ga, r + 1) + 1]!;
            const ul = Math.hypot(bx - ax, by - ay) || 1;
            const e = strips === 1 ? 0 : 0.5;
            const ex = ((bx - ax) / ul) * e;
            const ey = ((by - ay) / ul) * e;
            ctx.moveTo(ax - ex, ay - ey);
            ctx.lineTo(bx + ex, by + ey);
            ctx.lineTo(cx + ex, cy + ey);
            ctx.lineTo(dx - ex, dy - ey);
            ctx.closePath();
          }
        ctx.clip();
      }
      // the best-fit affine map of the strip's quad: source x in [sx, sx + sw], y in [0, ih]
      const p0x = g[at(i0, 0)]!, p0y = g[at(i0, 0) + 1]!;
      const p1x = g[at(i1, 0)]!, p1y = g[at(i1, 0) + 1]!;
      const p2x = g[at(i0, rows)]!, p2y = g[at(i0, rows) + 1]!;
      const p3x = g[at(i1, rows)]!, p3y = g[at(i1, rows) + 1]!;
      const ux = (p1x - p0x + p3x - p2x) / 2;
      const uy = (p1y - p0y + p3y - p2y) / 2;
      const vx = (p2x - p0x + p3x - p1x) / 2;
      const vy = (p2y - p0y + p3y - p1y) / 2;
      const ox = (p0x + p1x + p2x + p3x) / 4 - ux / 2 - vx / 2;
      const oy = (p0y + p1y + p2y + p3y) / 4 - uy / 2 - vy / 2;
      const sx = (i0 / gc) * iw;
      const sw = ((i1 - i0) / gc) * iw;
      const a = ux / sw;
      const b = uy / sw;
      const c = vx / ih;
      const d = vy / ih;
      ctx.setTransform(a, b, c, d, ox - a * sx, oy - b * sx);
      if (strips === 1) ctx.drawImage(img, 0, 0);
      else {
        const s0 = Math.max(0, Math.floor(sx) - 1);
        const s1 = Math.min(iw, Math.ceil(sx + sw) + 1);
        ctx.drawImage(img, s0, 0, s1 - s0, ih, s0, 0, s1 - s0, ih);
      }
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const X0 = Math.max(0, Math.floor(x0) - 2);
    const Y0 = Math.max(0, Math.floor(y0) - 2);
    const X1 = Math.min(W, Math.ceil(x1) + 2);
    const Y1 = Math.min(H, Math.ceil(y1) + 2);
    if (X1 > X0 && Y1 > Y0) dirty.push(X0, Y0, X1 - X0, Y1 - Y0);
  }

  // ───────────────────────────── WebGL ─────────────────────────────

  private ensureGl(gl: WebGL2RenderingContext): boolean {
    if (this.gl === gl && this.program && this.vao && this.vbo) return true;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const o = gl.createShader(type)!;
      gl.shaderSource(o, src);
      gl.compileShader(o);
      return o;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, FRAG);
    const p = gl.createProgram();
    if (!p) return false;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.deleteProgram(p);
      return false;
    }
    this.program = p;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    if (!this.vao || !this.vbo) return false;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    // queries and buffers made for an older context are gone with it
    for (const s of this.states.values()) {
      s.blockers.length = 0;
      s.rings.length = 0;
      s.pending = false;
      s.probing = false;
    }
    this.batches.length = 0;
    this.freeBuffers.length = 0;
    return true;
  }

  private readQueries(gl: WebGL2RenderingContext, s: SignState): void {
    if (!s.pending) return;
    const n = s.cols * s.rows;
    // the last query issued is the last to come in
    if (!gl.getQueryParameter(s.rings[s.cols - 1]!, gl.QUERY_RESULT_AVAILABLE)) return;
    for (let i = 0; i < n; i++) if (!gl.getQueryParameter(s.blockers[i]!, gl.QUERY_RESULT_AVAILABLE)) return;
    for (let i = 0; i < s.cols; i++) if (!gl.getQueryParameter(s.rings[i]!, gl.QUERY_RESULT_AVAILABLE)) return;
    s.pending = false;
    if (s.issued <= s.cutFrame) return;
    let blocked = 0;
    let ring = 0;
    for (let i = 0; i < n; i++) if (gl.getQueryParameter(s.blockers[i]!, gl.QUERY_RESULT)) blocked |= 1 << i;
    for (let i = 0; i < s.cols; i++) if (gl.getQueryParameter(s.rings[i]!, gl.QUERY_RESULT)) ring |= 1 << i;
    const recent = s.maskFrame > -1e9 && s.issued - s.maskFrame <= FRESH_FRAMES * 2;
    s.ringBefore = recent ? s.ring : -1;
    s.ring = ring;
    // a cell shows once nothing stood in front of it (nor near it: the guard) in two results running; it goes at once
    const all = n >= 31 ? -1 : (1 << n) - 1;
    const clear = all & ~blocked;
    s.seenBefore = recent ? s.seen : 0;
    s.seen = clear;
    s.blocked = blocked;
    s.mask = clear & s.seenBefore;
    s.guard = s.guardIssued;
    s.maskFrame = s.issued;
  }

  private readProbes(gl: WebGL2RenderingContext): void {
    for (let k = 0; k < this.batches.length; ) {
      const b = this.batches[k]!;
      if (b.sync && gl.getSyncParameter(b.sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
        k++;
        continue;
      }
      if (b.sync) gl.deleteSync(b.sync);
      const px = new Uint8Array(b.signs.length * 36);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      b.signs.forEach((s, i) => {
        s.probing = false;
        const p = s.label.probe;
        if (!p) return;
        let r = 0;
        let g = 0;
        let bl = 0;
        for (let q = 0; q < 9; q++) {
          r += px[i * 36 + q * 4]!;
          g += px[i * 36 + q * 4 + 1]!;
          bl += px[i * 36 + q * 4 + 2]!;
        }
        const albedo = parseHex(p.albedo);
        s.light = lightFromProbe([r / 9 / 255, g / 9 / 255, bl / 9 / 255], albedo, this.curve, this.exposure, s.label.desaturate?.() ?? 0);
      });
      this.freeBuffers.push(b.buffer);
      this.batches.splice(k, 1);
    }
  }

  private gpuWork(renderer: WebGLRenderer, gl: WebGL2RenderingContext, issue: SignState[], cells: number, probe: SignState[], view: ArrayLike<number>, proj: ArrayLike<number>, eye: ArrayLike<number>): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bw = gl.drawingBufferWidth;
    const bh = gl.drawingBufferHeight;
    if (cells > 0) {
      // per cell its grown quad (6 vertices x 4), per column the ring's (the same)
      if (this.verts.length < cells * 48) this.verts = new Float32Array(cells * 48 * 2);
      const v = this.verts;
      let k = 0;
      const ex = eye[12]!;
      const ey = eye[13]!;
      const ez = eye[14]!;
      for (const s of issue) {
        const m = s.label.object.matrixWorld.elements;
        // lift the proxy toward the eye: its local +z is the face's normal; the lift in local units (the matrix may scale)
        const sc = Math.hypot(m[8]!, m[9]!, m[10]!) || 1;
        const dist = Math.hypot(ex - m[12]!, ey - m[13]!, ez - m[14]!);
        const lz = (PROXY_LIFT + dist * 0.004) / sc;
        const { w, h } = s.label;
        // the guard: its own speed on screen (device px -> fb px) and the parallax of the eye's travel at its distance, 3 frames
        const fbPerDevice = bw / Math.max(1, this.overlayW);
        const parallax = (this.eyeStep * proj[5]! * 0.5 * bh) / Math.max(0.3, dist);
        const guard = Math.min(GUARD_MAX, GUARD_PX + 3 * Math.max(s.speed * fbPerDevice, 2 * parallax));
        s.guardIssued = guard;
        const gx = (2 * guard) / bw;
        const gy = (2 * guard) / bh;
        const rx = (2 * (guard + RING_PX)) / bw;
        const ry = (2 * (guard + RING_PX)) / bh;
        // a quad of the plane (local x0..x1, y0..y1 at the lift) grown on screen by (ax, ay) in clip units, each corner outward
        const quad = (x0: number, x1: number, y0: number, y1: number, ax: number, ay: number) => {
          const pts: Array<[number, number, number, number]> = [[x0, y0, -1, 1], [x1, y0, 1, 1], [x1, y1, 1, -1], [x0, y0, -1, 1], [x1, y1, 1, -1], [x0, y1, -1, -1]];
          for (const [x, y, sx, sy] of pts) {
            clipOf(m, x, y, lz, view, proj, v, k);
            const cw = v[k + 3]!;
            v[k] = v[k]! + sx * ax * cw;
            v[k + 1] = v[k + 1]! + sy * ay * cw;
            k += 4;
          }
        };
        // blocked: each cell grown by the guard
        for (let r = 0; r < s.rows; r++)
          for (let c = 0; c < s.cols; c++) quad(-w / 2 + (w * c) / s.cols, -w / 2 + (w * (c + 1)) / s.cols, h / 2 - (h * r) / s.rows, h / 2 - (h * (r + 1)) / s.rows, gx, gy);
        // the ring: each column (all rows) grown by the guard and the ring
        for (let c = 0; c < s.cols; c++) quad(-w / 2 + (w * c) / s.cols, -w / 2 + (w * (c + 1)) / s.cols, h / 2, -h / 2, rx, ry);
      }
      gl.viewport(0, 0, bw, bh);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.enable(gl.DEPTH_TEST);
      // a sample of a grown quad BEHIND what is drawn there passes: something nearer stands over it
      gl.depthFunc(gl.GREATER);
      gl.depthMask(false);
      gl.depthRange(0, 1);
      gl.colorMask(false, false, false, false);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      if (this.verts.byteLength > (gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) as number)) gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.verts, 0, k);
      let quadAt = 0;
      for (const s of issue) {
        const n = s.cols * s.rows;
        while (s.blockers.length < n) s.blockers.push(newQuery(gl));
        while (s.rings.length < s.cols) s.rings.push(newQuery(gl));
        for (let i = 0; i < n + s.cols; i++) {
          const q = i < n ? s.blockers[i]! : s.rings[i - n]!;
          gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
          gl.drawArrays(gl.TRIANGLES, quadAt * 6, 6);
          gl.endQuery(gl.ANY_SAMPLES_PASSED);
          quadAt++;
        }
        s.pending = true;
        s.issued = this.frame;
      }
      gl.bindVertexArray(null);
    }
    if (probe.length > 0 && this.batches.length < 3) {
      const buffer = this.freeBuffers.pop() ?? gl.createBuffer();
      if (buffer) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, Math.max(probe.length, MAX_SIGNS) * 36, gl.STREAM_READ);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
        const c4 = [0, 0, 0, 0];
        const signs: SignState[] = [];
        for (const s of probe) {
          const p = s.label.probe!;
          clipOf(s.label.object.matrixWorld.elements, p.x, p.y, 0, view, proj, c4, 0);
          if (!(c4[3]! > 0.05)) continue;
          const x = Math.round(((c4[0]! / c4[3]!) * 0.5 + 0.5) * bw) - 1;
          const y = Math.round(((c4[1]! / c4[3]!) * 0.5 + 0.5) * bh) - 1;
          if (x < 0 || y < 0 || x + 3 > bw || y + 3 > bh) continue;
          gl.readPixels(x, y, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, signs.length * 36);
          s.probing = true;
          s.probeFrame = this.frame;
          signs.push(s);
        }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        if (signs.length > 0) this.batches.push({ buffer, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), signs });
        else this.freeBuffers.push(buffer);
      }
    }
    // three keeps its own record of the GL state: it is no longer true
    renderer.resetState();
  }

  private release(s: SignState): void {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) for (const q of [...s.blockers, ...s.rings]) gl.deleteQuery(q);
    s.blockers.length = 0;
    s.rings.length = 0;
    if (s.raster) s.raster.canvas.width = 0;
    s.raster = null;
    // a probe in flight for it is read and dropped with its batch
  }

  /** Every sign's 3D lettering back, the GL objects freed. */
  dispose(): void {
    for (const s of this.states.values()) {
      this.setInk(s, true);
      this.release(s);
    }
    this.states.clear();
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      for (const b of this.batches) {
        if (b.sync) gl.deleteSync(b.sync);
        gl.deleteBuffer(b.buffer);
      }
      for (const b of this.freeBuffers) gl.deleteBuffer(b);
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.vbo) gl.deleteBuffer(this.vbo);
    }
    this.batches.length = 0;
    this.freeBuffers.length = 0;
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.gl = null;
  }
}

function parseHex(css: string): [number, number, number] {
  const h = css.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(f.slice(0, 2), 16) / 255, parseInt(f.slice(2, 4), 16) / 255, parseInt(f.slice(4, 6), 16) / 255];
}

/** A query object, or a throw (the caller falls back to WebGL's own lettering). */
function newQuery(gl: WebGL2RenderingContext): WebGLQuery {
  const q = gl.createQuery();
  if (!q) throw new Error("no query");
  return q;
}

/** The WebGL2 features the ink layer uses are there (a stub or a stripped-down browser may lack some). */
export function hasInkFeatures(gl: WebGL2RenderingContext): boolean {
  const g = gl as unknown as Record<string, unknown>;
  return (
    ["createQuery", "beginQuery", "endQuery", "getQueryParameter", "fenceSync", "getSyncParameter", "getBufferSubData", "createVertexArray", "readPixels"].every((k) => typeof g[k] === "function") &&
    typeof gl.ANY_SAMPLES_PASSED === "number" &&
    typeof gl.PIXEL_PACK_BUFFER === "number"
  );
}

/** The scene's lights for `standardLight`: its direct children (where PlayShell puts the sun and the sky light). */
function readLights(scene: Object3D, out: SceneLightLike[]): void {
  const t = new Vector3();
  const u = new Vector3();
  for (const o of scene.children) {
    const l = o as Partial<DirectionalLight & HemisphereLight & AmbientLight> & Object3D;
    if (!o.visible || !(l as { isLight?: boolean }).isLight) continue;
    const k = l.intensity ?? 1;
    const c = l.color ? [l.color.r * k, l.color.g * k, l.color.b * k] : [0, 0, 0];
    if ((l as { isDirectionalLight?: boolean }).isDirectionalLight && l.target) {
      t.setFromMatrixPosition(o.matrixWorld);
      u.setFromMatrixPosition(l.target.matrixWorld);
      t.sub(u).normalize();
      out.push({ kind: "directional", color: c, dir: [t.x, t.y, t.z] });
    } else if ((l as { isHemisphereLight?: boolean }).isHemisphereLight && l.groundColor) {
      t.setFromMatrixPosition(o.matrixWorld).normalize();
      out.push({ kind: "hemisphere", color: c, ground: [l.groundColor.r * k, l.groundColor.g * k, l.groundColor.b * k], dir: [t.x, t.y, t.z] });
    } else if ((l as { isAmbientLight?: boolean }).isAmbientLight) out.push({ kind: "ambient", color: c });
  }
}

/** The scene's fog over a sign whose world matrix is `m` (three's fog_fragment: linear smoothstep, or exp2), or null for none. */
function fogOver(scene: Scene, m: ArrayLike<number>, view: ArrayLike<number>): InkFog | null {
  const fog = scene.fog as (Fog & FogExp2) | null;
  if (!fog) return null;
  const depth = -(view[2]! * m[12]! + view[6]! * m[13]! + view[10]! * m[14]! + view[14]!);
  let f: number;
  if ((fog as { isFogExp2?: boolean }).isFogExp2) f = 1 - Math.exp(-(fog.density * fog.density) * depth * depth);
  else {
    const t = Math.min(1, Math.max(0, (depth - fog.near) / Math.max(1e-6, fog.far - fog.near)));
    f = t * t * (3 - 2 * t);
  }
  if (!(f > 0.002)) return null;
  return { rgb: [fog.color.r, fog.color.g, fog.color.b], f };
}
