/**
 * Where the public auto doors' parts are, as plain boxes in world metres (owner 2026-11-17: "자동문이 주위의 물체와 겹치잖아
 * 제발 좀 꼼꼼하게 확인해"). PublicAutoDoor.tsx draws and moves these; doorClearance.test.ts sweeps every leaf over its whole
 * travel against the models' own triangles. One source, so the picture and the check cannot drift apart.
 *
 * A real automatic sliding door never slides across a wall that has things on it: its leaves run in a track of their own,
 * behind fixed glass side-lights or along a clear face of the wall, under an operator header that carries them and the sensor.
 *
 *  - The memorial hall's door (inside, memorial.glb `door__leaf_l/_r`): the room's south wall is a single face at z 6 with a
 *    0.14 m reveal round the 2.2 m opening. The leaves were hung on the ROOM face (z 5.89..6.00) and slid 1 m each way over the
 *    wall: through the tea corner's shelves, sign and green panel on one side and the hall map, its panel and the flower stand on
 *    the other (owner's screenshot). They now hang on the OUTER face, just past the reveal (z 6.145..6.261), from an operator
 *    header on that face, over a sill track: open, they run behind the wall, where nothing is — the room's decor is untouched
 *    and the swept space is behind the wall's collider, where no avatar can stand.
 *  - The memorial's entrance in the village (the building's recessed porch, village.glb): the bi-parting leaves run behind two
 *    fixed glass side-lights across the porch's mouth, under an operator header with its sensor, over a floor track; open, each
 *    leaf stops 3 cm short of the porch's side wall.
 */

export type Vec3 = readonly [number, number, number];
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

export const box = (min: Vec3, max: Vec3): Box => ({ min, max });

/** A box moved by (dx, dy, dz). */
export const shifted = (b: Box, dx: number, dy = 0, dz = 0): Box =>
  box([b.min[0] + dx, b.min[1] + dy, b.min[2] + dz], [b.max[0] + dx, b.max[1] + dy, b.max[2] + dz]);

/** The space a box sweeps when it slides `dx` along x: a straight slide of a box sweeps exactly the hull of its two ends. */
export const sweptX = (b: Box, dx: number): Box =>
  box([Math.min(b.min[0], b.min[0] + dx), b.min[1], b.min[2]], [Math.max(b.max[0], b.max[0] + dx), b.max[1], b.max[2]]);

/** A leaf: its box closed, and how far (signed, along x) it slides when fully open. */
export interface DoorLeaf {
  readonly name: string;
  readonly closed: Box;
  readonly slideX: number;
}

/** A fixed part the door adds (header, track, side-light frames). */
export interface DoorPart {
  readonly name: string;
  readonly box: Box;
}

export interface DoorRig {
  readonly leaves: readonly DoorLeaf[];
  readonly parts: readonly DoorPart[];
}

// ───────────────────────────────────────── the memorial hall's door (inside) ─────────────────────────────────────────

/** The model's leaves as authored (memorial.glb, world metres; checked against the file in doorClearance.test.ts). */
export const HALL_LEAF_AUTHORED = {
  left: box([298.96, 0.012, 5.887], [299.996, 2.6, 6.003]),
  right: box([300.004, 0.012, 5.887], [301.04, 2.6, 6.003]),
} as const;

/** The outer edge of the opening's reveal (the jamb liners and the head end here). */
export const HALL_REVEAL_OUTER_Z = 6.14;

/** How far each model leaf of the hall's door slides when the door is fully open (m): a leaf is 1.04 m wide, the opening 2.08 m clear. */
export const HALL_LEAF_SLIDE_M = 1.0;

/**
 * How far the leaves are moved out from where the model hangs them (+z, m): from the room's face of the wall to its outer face,
 * 5 mm past the reveal (the brush seal's gap).
 */
export const HALL_LEAF_MOUNT_Z = +(HALL_REVEAL_OUTER_Z + 0.005 - HALL_LEAF_AUTHORED.left.min[2]).toFixed(3);

/** The hall door's leaves (as the game hangs them) and the operator header and sill track it adds on the wall's outer face. */
export function hallDoorRig(mountZ = HALL_LEAF_MOUNT_Z): DoorRig {
  const left = shifted(HALL_LEAF_AUTHORED.left, 0, 0, mountZ);
  const right = shifted(HALL_LEAF_AUTHORED.right, 0, 0, mountZ);
  const travelMin = left.min[0] - HALL_LEAF_SLIDE_M - 0.06;
  const travelMax = right.max[0] + HALL_LEAF_SLIDE_M + 0.06;
  const back = left.max[2] + 0.07;
  return {
    leaves: [
      { name: "door__leaf_l", closed: left, slideX: -HALL_LEAF_SLIDE_M },
      { name: "door__leaf_r", closed: right, slideX: HALL_LEAF_SLIDE_M },
    ],
    parts: [
      // the operator: the leaves' carriages run in it, its underside 5 mm over their top rail
      { name: "header", box: box([travelMin, left.max[1] + 0.005, HALL_REVEAL_OUTER_Z + 0.002], [travelMax, left.max[1] + 0.26, back]) },
      // the sill and its guide track, flush with the threshold, under the leaves' 12 mm shoe gap
      { name: "track", box: box([travelMin, 0, HALL_REVEAL_OUTER_Z + 0.002], [travelMax, 0.008, back]) },
    ],
  };
}

// ───────────────────────────────────────── the memorial's entrance (village) ─────────────────────────────────────────

/**
 * The memorial's porch (village.glb): its mouth is the building's front at z -52 (the timber portal stands just outside it), its
 * side walls are at x -2 and 2, its stone floor is at 0.15 and its timber ceiling at 3.55. The shop front at its back
 * (z -53.68..-53.54) stays as it is.
 */
export const ENTRANCE = { x: 0, mouthZ: -52, wallX: 2, floorY: 0.15, ceilingY: 3.55 } as const;

const E_SIDE = 0.005; // clearance to the side walls and the ceiling
const E_HEADER_BOTTOM = 3.1;
const E_LIGHT_Z = [-52.12, -52.07] as const; // the side-lights' frames (outside)
const E_LEAF_Z = [-52.23, -52.18] as const; // the leaves (inside, behind the side-lights)
const E_LEAF_W = 1.0;
const E_SIDE_LIGHT_INNER = 0.98; // the side-lights' inner edge: the leaves overlap it by 2 cm closed
/** How far each entrance leaf slides open (m): it stops 3 cm short of the porch's side wall. */
export const ENTRANCE_SLIDE_M = ENTRANCE.wallX - 0.03 - E_LEAF_W;

export function entranceRig(): DoorRig {
  const { x, wallX, floorY, ceilingY } = ENTRANCE;
  const y0 = floorY + 0.018; // above the track
  const y1 = E_HEADER_BOTTOM - 0.008;
  return {
    leaves: [
      { name: "auto_door_leaf_l", closed: box([x - E_LEAF_W, y0, E_LEAF_Z[0]], [x, y1, E_LEAF_Z[1]]), slideX: -ENTRANCE_SLIDE_M },
      { name: "auto_door_leaf_r", closed: box([x, y0, E_LEAF_Z[0]], [x + E_LEAF_W, y1, E_LEAF_Z[1]]), slideX: ENTRANCE_SLIDE_M },
    ],
    parts: [
      // the side-lights stand on the track's sill, under the header
      { name: "side_light_l", box: box([x - wallX + E_SIDE, floorY + 0.01, E_LIGHT_Z[0]], [x - E_SIDE_LIGHT_INNER, E_HEADER_BOTTOM, E_LIGHT_Z[1]]) },
      { name: "side_light_r", box: box([x + E_SIDE_LIGHT_INNER, floorY + 0.01, E_LIGHT_Z[0]], [x + wallX - E_SIDE, E_HEADER_BOTTOM, E_LIGHT_Z[1]]) },
      { name: "header", box: box([x - wallX + E_SIDE, E_HEADER_BOTTOM, -52.34], [x + wallX - E_SIDE, ceilingY - E_SIDE * 2, ENTRANCE.mouthZ - 0.03]) },
      { name: "sensor", box: box([x - 0.13, E_HEADER_BOTTOM - 0.07, -52.07], [x + 0.13, E_HEADER_BOTTOM, ENTRANCE.mouthZ - 0.03]) },
      { name: "track", box: box([x - wallX + E_SIDE, floorY, -52.3], [x + wallX - E_SIDE, floorY + 0.01, -52.06]) },
    ],
  };
}

/** Whether two boxes overlap by more than `eps` on every axis (touching is not overlapping). */
export function boxesOverlap(a: Box, b: Box, eps = 0.001): boolean {
  for (let k = 0; k < 3; k++) if (a.min[k] >= b.max[k] - eps || b.min[k] >= a.max[k] - eps) return false;
  return true;
}
