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
/** The nearest the eye comes to the cubby's opening (m): never inside the unit, even on a very wide screen. */
const MIN_DIST = 0.75;
/**
 * The lowest the eye goes (m above the hall floor, y = 0). A bottom-row cubby's opening is 0.35 m up; the eye stays at least this
 * high and looks down into it (review 2026-11-15: on a phone the old pose lowered the eye under the floor for the bottom rows).
 */
export const MIN_EYE_HEIGHT = 0.6;
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

function inFurniture(x: number, z: number, boxes: readonly AABB[]): boolean {
  const m = FURNITURE_MARGIN;
  return boxes.some((b) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m);
}

/**
 * The eye and the look point that frame `anchor` in the free part of a screen of `aspect` (width / height) with a vertical field
 * of view of `fovDeg`, the card covering `inset`. The eye is straight out from the opening (along the cubby's facing), at the
 * cubby's height (never under `MIN_EYE_HEIGHT`); the cubby is put in the middle of the free part by turning the look (sideways
 * for a side panel, down for a bottom sheet), never by lowering the eye. When the spot is over furniture (a bench, the letter
 * table) the eye comes closer to the cubby until it is clear, and if it cannot, it rises over it.
 */
export function cubbyFocusPose(
  anchor: CubbyAnchor,
  aspect: number,
  fovDeg: number,
  inset: FocusInset,
  furniture: readonly AABB[] = FURNITURE,
): FocusPose {
  const wall = WALL_BY_BANK.get(anchor.bank);
  const pitch = wall ? wall.cell + wall.frame : 0.4;
  const half = (FOCUS_SPAN_PITCHES * pitch) / 2;
  const a = Math.max(0.2, Math.min(5, Number.isFinite(aspect) ? aspect : 1));
  const tan = Math.tan(((Number.isFinite(fovDeg) ? fovDeg : 50) * Math.PI) / 360);
  const f = Math.min(0.6, Math.max(0, inset.frac));
  // the free part's half-width and half-height, as shares of the whole view's
  const freeW = inset.side === "right" ? 1 - f : 1;
  const freeH = inset.side === "bottom" ? 1 - f : 1;
  const want = Math.max(MIN_DIST, half / (freeW * a * tan), half / (freeH * tan));
  const outX = Math.sin(anchor.yaw);
  const outZ = Math.cos(anchor.yaw);
  // the camera looks into the wall (-out); its right is (cos yaw, 0, -sin yaw)
  const rightX = outZ;
  const rightZ = -outX;
  // the free part's centre on the screen (NDC): left of a right panel, above a bottom sheet
  const cx = inset.side === "right" ? -f : 0;
  const cy = inset.side === "bottom" ? f : 0;
  let ey = Math.max(anchor.y, MIN_EYE_HEIGHT);

  const frame = (dist: number): FocusPose => {
    // up and down: the eye stays where it is and the look tilts so the anchor shows at NDC y = cy
    const elev = Math.atan2(anchor.y - ey, dist); // the anchor's angle above the horizontal, from the eye
    const tilt = elev - Math.atan(cy * tan);
    // the anchor's depth along the (tilted) view axis, and the view's half-width there (m)
    const depth = Math.hypot(dist, anchor.y - ey) * Math.cos(elev - tilt);
    const wHalf = depth * tan * a;
    // sideways: the camera moves along the wall so the anchor shows at NDC x = cx (the look stays square to the wall)
    const tx = anchor.x - rightX * cx * wHalf;
    const tz = anchor.z - rightZ * cx * wHalf;
    return { ex: tx + outX * dist, ey, ez: tz + outZ * dist, tx, ty: ey + dist * Math.tan(tilt), tz };
  };

  // over furniture: come closer (down to MIN_DIST) until the eye is clear of it
  for (let dist = want; dist >= MIN_DIST - 1e-9; dist -= 0.05) {
    const p = frame(dist);
    if (!inFurniture(p.ex, p.ez, furniture)) return p;
  }
  // nowhere clear in front of this cubby: the furthest spot, the eye above the furniture
  ey = Math.max(ey, OVER_FURNITURE_EYE);
  return frame(want);
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
}

const state: FocusState = { anchor: null, inset: { side: "right", frac: 0 }, t: 0, cur: null };

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
  if (state.anchor) {
    const want = cubbyFocusPose(state.anchor, aspect, fovDeg, state.inset);
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
