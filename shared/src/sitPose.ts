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
  /** How far behind the root the back of the torso is (m): where a backrest's face must be on a backed seat. */
  torsoBehindRoot: 0.71,
} as const;

/**
 * How far in front of a seat's FRONT EDGE the root goes (m): 0.03 m past the backs of the calves, so the hanging
 * shins clear the edge, and the hips are 0.147 m onto the seat — the butt (0.1 to 0.25 m behind the edge) rests on
 * the front half of a park bench, the way a short-legged sitter perches.
 */
export const SIT_ROOT_AHEAD = SIT_POSE.calvesBehindRoot + 0.03;

/**
 * How far in FRONT of a backrest's face the root goes on a backed seat (m): the torso's back is 0.71 m behind the root, so the
 * back just touches the backrest (the lean-back pose then settles into it). The seat in front of the backrest is deeper than the
 * hanging calves reach, so a sofa's cushion front is clipped like a bench's edge (benchClip.ts).
 */
export const BACKED_ROOT_AHEAD = SIT_POSE.torsoBehindRoot + 0.01;

/**
 * The seat kinds' sit poses (houses interior design 6.2, node extras `pose`): `chair` = the Sit_Chair_* clips above (a seat with a
 * seat surface, feet hanging), `floor` = cross-legged on the floor, a cushion, a 보료 or a low floor sofa (Sit_Floor_* clips).
 * Absent on a seat means `chair`. Names match the houses contract (houseAreas.ts): `perch` (a seat 0.6-0.75 m high, e.g. a bar stool)
 * has no clip of its own yet and plays the chair clips; `floor` (seat surface 0.03-0.3 m) plays Sit_Floor_*, also on a backed 보료 / floor sofa
 * (the lean-back of leanBack.ts applies to it like to any backed seat).
 */
export type SeatPoseKind = "chair" | "perch" | "floor";

/**
 * The cross-legged floor pose (`Sit_Floor_Idle`, also the last frame of `Sit_Floor_Down` and the first of `Sit_Floor_StandUp`),
 * measured like SIT_POSE (root at the origin, model facing +z; client/src/game/sitPose.test.ts re-measures the GLB):
 *  - the lowest point of the butt and the legs is at the root's floor (`contactY`), so a cushion `seatY` m high just lifts the
 *    sitter by `seatY` (a floor sofa's seat cushion, a 보료 mat: the same);
 *  - the hips bone is 0.06 m behind the root and 0.08 m up; the knees stick out 0.41 m to each side (outer edge) and the toes reach 0.51 m in
 *    front of the root; the back of the torso is 0.31 m behind the root, the back of the head 0.46 m — so a backed floor seat
 *    (a floor sofa) needs its backrest face `torsoBehindRoot` behind the root.
 */
export const FLOOR_SIT_POSE = {
  /** Height above the root's floor of the lowest point of the seated body (m): a seat surface is lifted by its own height. */
  contactY: 0,
  /** How far behind the root the hips are while seated (m). */
  hipsBehindRoot: 0.06,
  /** How far in front of the root the toes reach (m): a table's edge in front of the sitter must stay beyond this. */
  toesAheadOfRoot: 0.51,
  /** How far to each side of the root the knees reach (m): a cushion must be at least twice this wide, centred on the root. */
  kneesSideways: 0.41,
  /** How far behind the root the back of the torso is (m): where a backrest's face must be on a backed floor seat. */
  torsoBehindRoot: 0.31,
} as const;

/** How far (m) to raise the seated avatar so the sit pose's butt rests on a seat surface `seatY` m high. */
export function liftForSeatY(seatY: number | undefined, pose: SeatPoseKind = "chair"): number {
  const contact = pose === "floor" ? FLOOR_SIT_POSE.contactY : SIT_POSE.contactY;
  return seatY === undefined ? 0 : seatY - contact;
}
