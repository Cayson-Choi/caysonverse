/**
 * Where the seated avatar's body is, in the avatar's own frame — the facts a seat needs to put a sitter ON it
 * (케이슨 마을's benches). Measured from character.glb's `Sit_Chair_Idle` (also the last frame of `Sit_Chair_Down` and
 * the first of `Sit_Chair_StandUp`), skinned, with the root at the origin and the model facing +z:
 *
 *  - the hips bone sits 0.397 m BEHIND the root, 0.481 m up; the clip moves the body back off the root as it sits;
 *  - the lowest point of the seated body under the hips (the bottom of the butt and thighs, z -0.50..-0.40) is at
 *    y 0.399 bare, 0.38 in trousers: the seat surface goes at `SIT_POSE.contactY`;
 *  - the backs of the calves hang 0.22 m behind the root, straight down from the knees (0.16 m behind the root);
 *    the feet hang under the knees, their soles 0.27 m up — the toy figure's legs are short, so on any seat of
 *    ordinary height the feet dangle, like a child's;
 *  - the back of the torso is 0.71 m behind the root, the back of the big head 0.92 m.
 *
 * The legacy world's chairs predate this and keep the pose as authored (no lift, the root on the chair's centre).
 * client/src/game/sitPose.test.ts re-measures the GLB and fails if a new export moves the pose.
 */

export const SIT_POSE = {
  /** How far behind the root the hips are while seated (m). */
  hipsBehindRoot: 0.397,
  /** Height above the root's floor of the lowest point of the seated butt (m): where a seat surface must be. */
  contactY: 0.39,
  /** How far behind the root the backs of the hanging calves are (m). A seat's front edge must stay behind this. */
  calvesBehindRoot: 0.22,
} as const;

/**
 * How far in front of a seat's FRONT EDGE the root goes (m): 0.03 m past the backs of the calves, so the hanging
 * shins clear the edge, and the hips are 0.147 m onto the seat — the butt (0.1 to 0.25 m behind the edge) rests on
 * the front half of a park bench, the way a short-legged sitter perches.
 */
export const SIT_ROOT_AHEAD = SIT_POSE.calvesBehindRoot + 0.03;

/** How far (m) to raise the seated avatar so the sit pose's butt rests on a seat surface `seatY` m high. */
export function liftForSeatY(seatY: number | undefined): number {
  return seatY === undefined ? 0 : seatY - SIT_POSE.contactY;
}
