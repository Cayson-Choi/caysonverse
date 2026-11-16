import { VILLAGE_LAYOUT, type CubbyAnchor, type CubbyWall } from "@caysonverse/shared/village/villageLayout";
import { MEMORIAL_COLLIDERS } from "@caysonverse/shared/village/generated/memorialColliders";
import type { AABB } from "@caysonverse/shared/collision";

/**
 * The close-up camera of a memorial cubby (케이슨 마을 추모관; owner 2026-11-13: "가운데 칸은 잘 보이는데 윗칸은 보기가 힘들잖아"):
 * while a cubby's card is open the camera glides to a spot straight in front of THAT cubby, at its own height, looking into it —
 * the top row is framed exactly like the middle one. The card covers part of the screen (a side panel on a wide screen, a sheet
 * at the bottom of a phone), so the cubby is framed in the part left free.
 *
 * Pure pose math plus one small module state (which cubby, how far the glide has gone) that CameraRig reads every frame
 * (`stepCubbyFocus`) and LocalPlayer reads to hide the own body in front of the lens (`cubbyFocusWeight`).
 */

export interface FocusPose {
  /** The eye. */
  ex: number;
  ey: number;
  ez: number;
  /** Where it looks. */
  tx: number;
  ty: number;
  tz: number;
}

/** What the card covers: `side` the screen edge it sits on, `frac` the share of the width (right) or height (bottom) it takes. */
export interface FocusInset {
  side: "right" | "bottom";
  frac: number;
}

/** How many cubby pitches the free part of the screen shows across its narrower side: the cubby and half a neighbour each side. */
export const FOCUS_SPAN_PITCHES = 2.4;
/** The glide in and out (s). */
export const FOCUS_GLIDE_S = 0.55;
/**
 * The close-up's zoom (owner 2026-11-17: "마우스로 스크롤로 더 가깝게 아니면 조금 더 뒤로"): a factor on the span the screen shows.
 * 1 = the default framing (the cubby and half a neighbour each side); the nearest shows about a third of that (the photo nearly
 * fills the free part), the farthest 1.8 x (the neighbouring cubbies round it). Eased, clamped at both ends, kept for the session.
 */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 1.8;
/** One wheel notch / button press / pinch step multiplies or divides the zoom by this. */
export const ZOOM_STEP = 1.18;
/** The nearest the eye comes to the opening when zoomed in (m): the glass door is 6 mm out and the near plane 0.2 m off the eye. */
export const ZOOM_MIN_DIST = 0.34;
/** The nearest the eye comes to the cubby's opening (m): never inside the unit, even on a very wide screen. */
const MIN_DIST = 0.75;
/**
 * The lowest the eye goes (m above the hall floor, y = 0). A bottom-row cubby's centre is 0.345 m up. Review 2026-11-15: on a phone
 * the old pose lowered the eye under the floor for the bottom rows (to centre the cubby over the sheet) — the eye now never goes
 * under the cubby's own centre and turns the look instead. Round 7 review: held at 0.6 m it looked down into a bottom-row cubby,
 * a tilted trapezoid; at the cubby's height it looks straight in, the uprights upright.
 */
export const MIN_EYE_HEIGHT = 0.3;
/** How far the eye keeps from a piece of furniture's footprint (m), so the near plane does not cut into it. */
const FURNITURE_MARGIN = 0.18;
/** Over a piece of furniture the eye cannot get clear of, it rises to at least this height (m): above benches and tables. */
const OVER_FURNITURE_EYE = 1.35;

const WALL_BY_BANK: ReadonlyMap<string, CubbyWall> = new Map(VILLAGE_LAYOUT.memorial.interior.cubbyWalls.map((w) => [w.bank, w]));

/** The hall's furniture footprints the eye must stay out of: everything but the walls and the cubby banks themselves. */
const FURNITURE: readonly AABB[] = MEMORIAL_COLLIDERS.filter((b) => {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  return Math.max(w, d) < 5; // walls (13-16 m) and the banks (6.1-7.7 m long) are not furniture
});
/**
 * The solid parts the eye can never be in or near, at any height: the walls and the cubby banks (and the niche). Review 2026-11-15
 * (round 5): zone B's last column slid the eye sideways into zone E's bank, so half the screen was the inside of its cubbies.
 */
const SOLID: readonly AABB[] = MEMORIAL_COLLIDERS.filter((b) => !FURNITURE.includes(b));
/** How far (m) the eye keeps from a wall or a cubby bank (the near plane is 0.2 m off the eye in the hall's 50° view). */
export const SOLID_MARGIN = 0.25;

function inBoxes(x: number, z: number, boxes: readonly AABB[], m: number): boolean {
  return boxes.some((b) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m);
}

function inFurniture(x: number, z: number, boxes: readonly AABB[]): boolean {
  return inBoxes(x, z, boxes, FURNITURE_MARGIN);
}

/**
 * The eye and the look point that frame `anchor` in the free part of a screen of `aspect` (width / height) with a vertical field
 * of view of `fovDeg`, the card covering `inset`. The eye is out from the opening (along the cubby's facing), at the cubby's height
 * (never under `MIN_EYE_HEIGHT`); the cubby is put in the middle of the free part by turning the look (sideways for a side panel,
 * down for a bottom sheet), never by lowering the eye. For a side panel the eye first moves along the wall so the look stays square
 * to it; where that would bring it into or near another wall or cubby bank (a corner column) it moves less, or the other way, and the
 * look turns instead. When the spot is over furniture (a bench, the letter table) the eye comes closer to the cubby until it is
 * clear, and if it cannot, it rises over it.
 */
export function cubbyFocusPose(
  anchor: CubbyAnchor,
  aspect: number,
  fovDeg: number,
  inset: FocusInset,
  furniture: readonly AABB[] = FURNITURE,
  solid: readonly AABB[] = SOLID,
  zoom = 1,
): FocusPose {
  const wall = WALL_BY_BANK.get(anchor.bank);
  const pitch = wall ? wall.cell + wall.frame : 0.4;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1));
  const half = (FOCUS_SPAN_PITCHES * pitch * z) / 2;
  const minDist = z < 1 ? Math.max(ZOOM_MIN_DIST, MIN_DIST * z) : MIN_DIST;
  const a = Math.max(0.2, Math.min(5, Number.isFinite(aspect) ? aspect : 1));
  const tan = Math.tan(((Number.isFinite(fovDeg) ? fovDeg : 50) * Math.PI) / 360);
  const f = Math.min(0.6, Math.max(0, inset.frac));
  // the free part's half-width and half-height, as shares of the whole view's
  const freeW = inset.side === "right" ? 1 - f : 1;
  const freeH = inset.side === "bottom" ? 1 - f : 1;
  const want = Math.max(minDist, half / (freeW * a * tan), half / (freeH * tan));
  const outX = Math.sin(anchor.yaw);
  const outZ = Math.cos(anchor.yaw);
  // the camera looks into the wall (-out); its right is (cos yaw, 0, -sin yaw)
  const rightX = outZ;
  const rightZ = -outX;
  // the free part's centre on the screen (NDC): left of a right panel, above a bottom sheet
  const cx = inset.side === "right" ? -f : 0;
  const cy = inset.side === "bottom" ? f : 0;
  const tanH = tan * a;
  let ey = Math.max(anchor.y, MIN_EYE_HEIGHT);

  /** The pose with the eye `dist` out from the wall and `side` (m) along it from the anchor (+ = the camera's right). */
  const pose = (dist: number, side: number): FocusPose => {
    const ex = anchor.x + rightX * side + outX * dist;
    const ez = anchor.z + rightZ * side + outZ * dist;
    // the anchor seen from the eye: H across the floor, at angle phi right of straight-in, dy above the eye
    const H = Math.hypot(dist, side);
    const phi = Math.atan2(-side, dist);
    const dy = anchor.y - ey;
    // the look turns so the anchor is alpha right of it: NDC x = H sin(alpha) / (depth tanH) = cx, the depth along the tilted look
    // depending on alpha too (a few fixed-point steps settle it)
    let alpha = Math.atan(cx * tanH);
    let h = H;
    let tilt = 0;
    for (let i = 0; i < 6; i++) {
      h = H * Math.cos(alpha); // the anchor's depth along the level look
      const elev = Math.atan2(dy, h);
      tilt = elev - Math.atan(cy * tan); // up and down: the eye stays, the look tilts so the anchor shows at NDC y = cy
      const depth = Math.hypot(h, dy) * Math.cos(elev - tilt);
      const sinA = H > 1e-9 ? (cx * tanH * depth) / H : 0;
      alpha = Math.asin(Math.max(-0.99, Math.min(0.99, sinA)));
    }
    h = H * Math.cos(alpha);
    tilt = Math.atan2(dy, h) - Math.atan(cy * tan);
    const psi = phi - alpha;
    // the look's level direction: -out turned by psi toward the right
    const lx = -outX * Math.cos(psi) + rightX * Math.sin(psi);
    const lz = -outZ * Math.cos(psi) + rightZ * Math.sin(psi);
    return { ex, ey, ez, tx: ex + lx * h, ty: ey + h * Math.tan(tilt), tz: ez + lz * h };
  };
  /** The sideways offset that keeps the look square to the wall (the anchor at NDC x = cx). */
  const squareSide = (dist: number): number => {
    const elev = Math.atan2(anchor.y - ey, dist);
    const tilt = elev - Math.atan(cy * tan);
    const depth = Math.hypot(dist, anchor.y - ey) * Math.cos(elev - tilt);
    return -cx * depth * tanH;
  };
  const clear = (p: FocusPose): boolean => !inBoxes(p.ex, p.ez, solid, SOLID_MARGIN);

  /** At `dist`: the square sideways spot, else the nearest clear one (less, then the other way), or null. */
  const at = (dist: number, avoidFurniture: boolean): FocusPose | null => {
    const s0 = squareSide(dist);
    const ok = (p: FocusPose) => clear(p) && (!avoidFurniture || !inFurniture(p.ex, p.ez, furniture));
    const first = pose(dist, s0);
    if (s0 === 0) return ok(first) ? first : null;
    if (ok(first)) return first;
    // step from the square spot back through 0 and beyond, the smallest change first
    const step = 0.05 * Math.sign(s0);
    for (let k = 1; k <= 60; k++) {
      const s = s0 - step * k;
      const p = pose(dist, s);
      if (ok(p)) return p;
    }
    return null;
  };

  // over furniture: come closer (down to MIN_DIST) until the eye is clear of it
  for (let dist = want; dist >= minDist - 1e-9; dist -= 0.05) {
    const p = at(dist, true);
    if (p) return p;
  }
  // nowhere clear in front of this cubby: the furthest spot clear of the walls and banks, the eye above the furniture
  ey = Math.max(ey, OVER_FURNITURE_EYE);
  return at(want, false) ?? pose(want, 0);
}

/** Ease in and out (smoothstep). */
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

interface FocusState {
  anchor: CubbyAnchor | null;
  inset: FocusInset;
  /** 0..1, linear in time; eased when read. */
  t: number;
  /** The pose being drawn (follows the wanted one smoothly when the cubby changes while open). */
  cur: FocusPose | null;
  /** The zoom asked for, and the one drawn (eased toward it). */
  zoom: number;
  zoomCur: number;
}

const state: FocusState = { anchor: null, inset: { side: "right", frac: 0 }, t: 0, cur: null, zoom: 1, zoomCur: 1 };

/** Zoom the close-up: `dir` < 0 closer, > 0 farther, by `steps` steps (a pinch passes a fraction). Clamped. */
export function nudgeCubbyZoom(dir: number, steps = 1): number {
  const k = Math.pow(ZOOM_STEP, Math.sign(dir) * Math.abs(steps));
  state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom * k));
  return state.zoom;
}

/** Set the zoom directly (a pinch: the ratio of finger spreads), clamped. */
export function setCubbyZoom(zoom: number): number {
  if (Number.isFinite(zoom)) state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return state.zoom;
}

/** The zoom asked for (1 = default). */
export function cubbyZoom(): number {
  return state.zoom;
}

/** Back to the default framing. */
export function resetCubbyZoom(): void {
  state.zoom = 1;
  state.zoomCur = 1;
}

/** Look at `anchor` (null: glide back to the player's own camera). */
export function setCubbyFocus(anchor: CubbyAnchor | null): void {
  state.anchor = anchor;
}

/** The cubby looked at, or null. */
export function cubbyFocusAnchor(): CubbyAnchor | null {
  return state.anchor;
}

/** What the open card covers (CubbyView measures its panel). */
export function setCubbyFocusInset(inset: FocusInset): void {
  state.inset = inset;
}

/** How far the glide has gone, eased (0: the player's camera, 1: the close-up). */
export function cubbyFocusWeight(): number {
  return ease(state.t);
}

/**
 * Advance the glide by `dt` seconds and give the close-up pose and its weight for this frame (`out` is written; the weight is
 * returned, 0 when there is nothing to draw).
 */
export function stepCubbyFocus(dt: number, aspect: number, fovDeg: number, out: FocusPose): number {
  const step = Math.max(0, Math.min(0.1, dt)) / FOCUS_GLIDE_S;
  state.t = state.anchor ? Math.min(1, state.t + step) : Math.max(0, state.t - step);
  // the zoom eases toward what was asked (about a quarter of a second)
  state.zoomCur += (state.zoom - state.zoomCur) * (1 - Math.exp(-Math.max(0, dt) * 9));
  if (Math.abs(state.zoom - state.zoomCur) < 1e-4) state.zoomCur = state.zoom;
  if (state.anchor) {
    const want = cubbyFocusPose(state.anchor, aspect, fovDeg, state.inset, FURNITURE, SOLID, state.zoomCur);
    if (!state.cur || state.t <= step) state.cur = { ...want };
    else {
      // another row or column while open: the close-up slides there instead of jumping
      const k = 1 - Math.exp(-Math.max(0, dt) * 7);
      const c = state.cur;
      c.ex += (want.ex - c.ex) * k;
      c.ey += (want.ey - c.ey) * k;
      c.ez += (want.ez - c.ez) * k;
      c.tx += (want.tx - c.tx) * k;
      c.ty += (want.ty - c.ty) * k;
      c.tz += (want.tz - c.tz) * k;
    }
  } else if (state.t === 0) {
    state.cur = null;
  }
  if (!state.cur || state.t === 0) return 0;
  Object.assign(out, state.cur);
  return ease(state.t);
}

/** Drop everything at once (the hall was left, a reconnect): no glide back. */
export function resetCubbyFocus(): void {
  state.anchor = null;
  state.t = 0;
  state.cur = null;
}
