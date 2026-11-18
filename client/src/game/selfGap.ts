/**
 * How near the camera is to the own avatar (docs/designs/bus-controls.md, owner 2026-11-18: "정류장에서 줌인을 하다보면 이렇게
 * 캐릭터 내부까지 들어가 있는 상태가 되기도 해"). The chibi avatar is 2.19 m tall with a 1 m wide head (and a crown): its head and
 * body are taken as one upright capsule round the body's vertical line, from 0.8 m under the head's centre up to it, 0.6 m
 * round. A third-person camera nearer than SELF_GAP.hide to that capsule would show the inside of the head or fill the
 * screen with it: the own body is hidden (a clean look past the shoulder), and shown again past SELF_GAP.show (no flicker).
 *
 * Pure (unit-tested); the coordinates are any frame with y up (the world, or the bus's own: ahead, up, right).
 */

/** The head's centre over the feet (m), standing: the chibi's head runs from its head bone (1.22 m) to the top (2.19 m). */
export const SELF_HEAD_CENTRE = 1.7;

export const SELF_CAPSULE = {
  /** the capsule's axis runs from this far under the head's centre (the body) ... */
  below: 0.8,
  /** ... to this far under it (m): the head's centre */
  top: 0,
  /** its radius (m): half the 1 m head, and the hair and crown over it */
  radius: 0.6,
} as const;

/** Hidden when the camera is nearer than `hide` (m) to the capsule; shown again past `show`. */
export const SELF_GAP = { hide: 0.6, show: 0.75 } as const;
/**
 * Outdoors (no building's camera limit) the margin is wider: a lens the spring arm pulled to 0.6-0.9 m off the head (the parked bus
 * behind at the stop) still showed the 1 m head over half the screen. Indoors the reviewed rules keep the body in view (seat framing,
 * INDOOR_SELF_HIDE_DISTANCE): there the 0.6 m minimum alone applies.
 */
export const SELF_GAP_OUTDOOR = { hide: 0.9, show: 1.05 } as const;

/** The camera's distance (m) to the avatar's head-and-body capsule (0 inside it). */
export function selfGap(camX: number, camY: number, camZ: number, bodyX: number, bodyZ: number, headCentreY: number): number {
  const y0 = headCentreY - SELF_CAPSULE.below;
  const y1 = headCentreY - SELF_CAPSULE.top;
  const cy = camY < y0 ? y0 : camY > y1 ? y1 : camY;
  const d = Math.hypot(camX - bodyX, camY - cy, camZ - bodyZ);
  return Math.max(0, d - SELF_CAPSULE.radius);
}

/** The hidden flag with its hysteresis: hidden under `band.hide` (SELF_GAP by default), shown again only past `band.show`. */
export function stepSelfGapHidden(wasHidden: boolean, gap: number, band: { hide: number; show: number } = SELF_GAP): boolean {
  return wasHidden ? gap < band.show : gap < band.hide;
}
