/**
 * 케이슨랜드 성벽 (owner 2026-11-20: "케이슨 랜드 전체를 성벽으로 둘러싸는거지"): one storybook castle curtain wall round the whole park, so
 * the gate is the only way in. The SAME wall stands twice, as everything about the park does:
 *
 *  - in the park (park-local metres): round the playable bounds and the coaster's circuit, its north side running into the gate
 *    arch's two towers (ParkWorld GateArch, x 29.5 .. 50.5 at z -186.5): `PARK_WALL_PLAN`;
 *  - in the village (world metres): round the park's skyline (the 0.4-scale stand-in behind the south gate, skylinePlacement), its
 *    north side running into the village gatehouse (lot_gate: the domed turrets and the main towers, x -34 .. -14, z 92.4 .. 95):
 *    `VILLAGE_WALL_PLAN`. Its front face stands just beyond the village's walk bounds (z 95), so no walkable ground is lost.
 *
 * A plan is straight runs (the wall's centreline, with the side that faces OUT of the park) and round towers (at the corners and every
 * ~50 m). The client builds the stone from it (client/src/land/castleWallGeometry.ts); the colliders below come from the same numbers.
 * Pure data, browser-safe.
 */
import type { AABB, CameraBox } from "../collision";

/** The wall's section (m): every plan uses the same stones. */
export const WALL = Object.freeze({
  /** Centreline to either face of the body. */
  halfThickness: 1.3,
  /** The footing's plinth stands this far proud of the body on both faces (up to ~1 m above the ground). */
  footing: 0.25,
  /** The outer parapet projects this far past the outer face (on its corbels, 8 m up). */
  parapetOut: 0.3,
  /** The wall-walk's height above the ground. */
  walk: 8.85,
  /** The merlons' tops. */
  top: 11.15,
  /** Round towers: radius of the shaft, and the parapet's (it overhangs on a corbelled flare). */
  towerR: 3.1,
  towerParapetR: 3.5,
  /** The towers' merlon tops and the roof's apex (the gilt finial rises above it). */
  towerTop: 13.9,
  roofApex: 20.6,
  /** The length one wall module covers (the stone texture tiles every 3 m: two tiles a module). */
  module: 6,
});

export interface WallRun {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** The horizontal unit normal pointing OUT of the enclosure. */
  out: readonly [number, number];
  /** The run's end at a / b is seen (it stops in the open, not inside a tower): the client closes the wall's section there with stone. */
  capA?: boolean;
  capB?: boolean;
}
export interface WallTower {
  x: number;
  z: number;
}
export interface WallPlan {
  runs: readonly WallRun[];
  towers: readonly WallTower[];
  /** Where the banners and the lamps on the towers look (the viewer: the park's plaza inside, the village's square outside). */
  facing: { x: number; z: number };
}

/** Points every <= `spacing` m strictly between a run's ends (the corner towers are listed once, on their own). */
function between(r: Pick<WallRun, "ax" | "az" | "bx" | "bz">, spacing: number): WallTower[] {
  const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
  const n = Math.max(1, Math.ceil(len / spacing));
  const out: WallTower[] = [];
  for (let i = 1; i < n; i++) out.push({ x: r.ax + ((r.bx - r.ax) * i) / n, z: r.az + ((r.bz - r.az) * i) / n });
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ───────────────────────────────────────── the park (park-local metres) ─────────────────────────────────────────

/**
 * The park's ring (centrelines). x: 1.5 m beyond the walk bounds (-170 .. 380), so the inner face is the bounds' edge; z: the gate's
 * line in the north (the arch's towers stand on it) and well south of the coaster's circuit (track and supports end at z 61).
 */
export const PARK_WALL_RECT = Object.freeze({ minX: -171.5, maxX: 381.5, minZ: -186.5, maxZ: 76.5 });
/** The gate arch's towers (ParkWorld: x 29.5 .. 33 and 47 .. 50.5): the north runs end half a metre inside them. */
const PARK_GATE_GAP = Object.freeze({ minX: 30, maxX: 50 });

function parkPlan(): WallPlan {
  const R = PARK_WALL_RECT;
  const runs: WallRun[] = [
    { ax: R.minX, az: R.minZ, bx: PARK_GATE_GAP.minX, bz: R.minZ, out: [0, -1] },
    { ax: PARK_GATE_GAP.maxX, az: R.minZ, bx: R.maxX, bz: R.minZ, out: [0, -1] },
    { ax: R.maxX, az: R.minZ, bx: R.maxX, bz: R.maxZ, out: [1, 0] },
    { ax: R.maxX, az: R.maxZ, bx: R.minX, bz: R.maxZ, out: [0, 1] },
    { ax: R.minX, az: R.maxZ, bx: R.minX, bz: R.minZ, out: [-1, 0] },
  ];
  const towers: WallTower[] = [
    { x: R.minX, z: R.minZ },
    { x: R.maxX, z: R.minZ },
    { x: R.maxX, z: R.maxZ },
    { x: R.minX, z: R.maxZ },
    // the north runs: from the corners to the gate's towers (no new tower beside the gate: its own two stand there)
    ...between({ ax: R.minX, az: R.minZ, bx: 31.25, bz: R.minZ }, 55),
    ...between({ ax: 48.75, az: R.minZ, bx: R.maxX, bz: R.minZ }, 55),
    ...between(runs[2]!, 55),
    ...between(runs[3]!, 55),
    ...between(runs[4]!, 55),
  ].map((t) => ({ x: round2(t.x), z: round2(t.z) }));
  return { runs, towers, facing: { x: 40, z: -112 } };
}
export const PARK_WALL_PLAN: WallPlan = Object.freeze(parkPlan());

// ───────────────────────────────────────── the village (world metres) ─────────────────────────────────────────

/** The village gatehouse (lot_gate's shell): the main towers' inner faces bound the gate passage, the turrets end the front. */
export const VILLAGE_GATE_PASSAGE = Object.freeze({ minX: -27, maxX: -21 });
/** The village's walk bounds end at z 95: the wall's front face stands just beyond (a body of radius 0.4 at the edge touches nothing). */
export const VILLAGE_WALL_FRONT_Z = 95.45;
/**
 * The village ring (centrelines): round the skyline's footprint (world x -94 .. 104, z 102 .. 209: the coaster's far side at about
 * z 205) with room to spare, the far corners kept inside the outer ground's mesh radius (236 m from the square).
 */
export const VILLAGE_WALL_RECT = Object.freeze({ minX: -102, maxX: 108, minZ: VILLAGE_WALL_FRONT_Z + WALL.halfThickness + WALL.footing, maxZ: 207.5 });
/** The north side's towers stand back (into the park) so their fronts stay out of the walk bounds. */
const VILLAGE_NORTH_TOWER_Z = VILLAGE_WALL_FRONT_Z + WALL.towerParapetR;

function villagePlan(): WallPlan {
  const R = VILLAGE_WALL_RECT;
  const G = VILLAGE_GATE_PASSAGE;
  const runs: WallRun[] = [
    // the north side: from the corners into the gatehouse, ending flush with the main towers' inner faces (the gate passage)
    // (their ends there are seen from the gateway, behind the open leaves: closed with stone)
    { ax: R.minX, az: R.minZ, bx: G.minX, bz: R.minZ, out: [0, -1], capB: true },
    { ax: G.maxX, az: R.minZ, bx: R.maxX, bz: R.minZ, out: [0, -1], capA: true },
    { ax: R.maxX, az: R.minZ, bx: R.maxX, bz: R.maxZ, out: [1, 0] },
    { ax: R.maxX, az: R.maxZ, bx: R.minX, bz: R.maxZ, out: [0, 1] },
    { ax: R.minX, az: R.maxZ, bx: R.minX, bz: R.minZ, out: [-1, 0] },
  ];
  const towers: WallTower[] = [
    { x: R.minX, z: R.minZ },
    { x: R.maxX, z: R.minZ },
    { x: R.maxX, z: R.maxZ },
    { x: R.minX, z: R.maxZ },
    // the north side's towers: between the corners and the gatehouse's turrets (x -34 / -14), set back off the walk bounds
    ...between({ ax: R.minX, az: VILLAGE_NORTH_TOWER_Z, bx: -34, bz: VILLAGE_NORTH_TOWER_Z }, 55),
    ...between({ ax: -14, az: VILLAGE_NORTH_TOWER_Z, bx: R.maxX, bz: VILLAGE_NORTH_TOWER_Z }, 55),
    ...between(runs[2]!, 60),
    ...between(runs[3]!, 60),
    ...between(runs[4]!, 60),
  ].map((t) => ({ x: round2(t.x), z: round2(t.z) }));
  return { runs, towers, facing: { x: 0, z: 0 } };
}
export const VILLAGE_WALL_PLAN: WallPlan = Object.freeze(villagePlan());

// ───────────────────────────────────────── colliders ─────────────────────────────────────────

/**
 * The plan's solids: each run's body as a box (`outerSeal` stretches the north runs out to a line, so no strip outside the wall can be
 * walked into through the gate) and each tower's square. Camera boxes carry the wall's height (the camera may rise over it).
 */
export function wallSolids(plan: WallPlan, outerSeal?: { z: number }): { obstacles: AABB[]; cameraBoxes: CameraBox[] } {
  const obstacles: AABB[] = [];
  const cameraBoxes: CameraBox[] = [];
  // the solid at a body's height: the body and its footing (the parapet overhangs 8 m up, over everyone's head)
  const h = WALL.halfThickness + WALL.footing;
  for (const r of plan.runs) {
    const b: AABB = {
      minX: round2(Math.min(r.ax, r.bx) - (r.out[0] !== 0 ? h : 0)),
      maxX: round2(Math.max(r.ax, r.bx) + (r.out[0] !== 0 ? h : 0)),
      minZ: round2(Math.min(r.az, r.bz) - (r.out[1] !== 0 ? h : 0)),
      maxZ: round2(Math.max(r.az, r.bz) + (r.out[1] !== 0 ? h : 0)),
    };
    if (outerSeal && r.out[1] < 0) b.minZ = Math.min(b.minZ, outerSeal.z);
    obstacles.push(b);
    cameraBoxes.push({ ...b, height: WALL.top });
  }
  const t = WALL.towerParapetR;
  for (const tw of plan.towers) {
    const b: AABB = { minX: round2(tw.x - t), maxX: round2(tw.x + t), minZ: round2(tw.z - t), maxZ: round2(tw.z + t) };
    obstacles.push(b);
    cameraBoxes.push({ ...b, height: WALL.towerTop });
  }
  return { obstacles, cameraBoxes };
}

/** The park's wall solids: the north strip outside the wall (z -190 .. the wall) is sealed off, the arch's passage stays open. */
export const PARK_WALL_SOLIDS = Object.freeze(wallSolids(PARK_WALL_PLAN, { z: -190 }));
/** The village's wall solids (beyond the walk bounds but for the north towers' fronts: the camera stays out of the stone). */
export const VILLAGE_WALL_SOLIDS = Object.freeze(wallSolids(VILLAGE_WALL_PLAN));

/** The shortest distance (m) from (x, z) to a plan's wall: its runs' centrelines and its towers' centres less their radius. */
export function distanceToWall(plan: WallPlan, x: number, z: number): number {
  let d = Infinity;
  for (const r of plan.runs) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(x - (r.ax + dx * t), z - (r.az + dz * t)) - WALL.halfThickness);
  }
  for (const tw of plan.towers) d = Math.min(d, Math.hypot(x - tw.x, z - tw.z) - WALL.towerParapetR);
  return d;
}
