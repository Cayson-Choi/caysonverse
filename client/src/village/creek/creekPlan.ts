import { CASCADES, bedAt, creekLevelAt, feederLevelAt, shoreAt, splatStone, splatWeir, type CreekGrid } from "./creekMap";
import { mulberry32, type StoneSpec } from "./creekStones";

/**
 * Where the creek's stones, pebbles and reeds go (deterministic from the ground grid): a stone sill at each of the two small
 * cascades, a diagonal row of stepping stones above the eastern one, a few boulders on the banks and in the water, pebbles
 * along both waterlines, and reed clumps behind them. Positions follow the real carved channel (`shoreAt`), not the layout's
 * straight segments, so a stone always sits in the water or on the bank it is meant for.
 */

export interface ReedClump {
  x: number;
  y: number;
  z: number;
  /** Height (m). */
  h: number;
  seed: number;
  /** 0 reeds .. 1 sedge tufts (shorter, wider). */
  sedge: number;
}

export interface CreekPlan {
  stones: StoneSpec[];
  /** Pebbles (small round stones) along the waterlines and the bed. */
  pebbles: StoneSpec[];
  reeds: ReedClump[];
  foam: Float32Array;
  /** The stepping stones' centres (for tests and the walk note). */
  stepping: { x: number; z: number; top: number }[];
  /** Where the water ends: the feeder's culvert (south end) and the creek's (west end). */
  mouths: { feeder: { x: number; z: number }; creek: { x: number; z: number } };
}

export interface PlanOptions {
  /** The light tier: fewer pebbles and reeds, rougher meshes. */
  low: boolean;
  foam: Float32Array;
  /** The falls' walkable flat stones by the plunge pool (layout waterfall.slabs): drawn here as real river stones. */
  slabs?: readonly { centre: { x: number; z: number }; radiusX: number; radiusZ: number; yaw: number; top: number }[];
}

/** The footbridge's gap (x), where nothing is placed (layout stream.bridgeGap, with a margin). */
const BRIDGE_X: readonly [number, number] = [-29, -19];
/** Nothing is placed beyond these x (the walkable creek ends at x +-95). */
const X_LIMIT = 96;
/** The creek proper starts here (x); west of it the feeder stream runs north-south from the falls. */
const CREEK_X0 = -98;

const inBridge = (x: number) => x > BRIDGE_X[0] && x < BRIDGE_X[1];


/**
 * A stone headwall with an arched opening (a culvert mouth), built from the creek's own stones: three courses of blocks either
 * side of the opening, a ring of arch stones over it, a dark cavity behind. `(x, z)` is the opening's foot on the waterline,
 * `yaw` turns the wall (its stones' long axis lies along the wall), `out` is the unit direction from the wall toward the water.
 */
export function headwall(x: number, z: number, level: number, yaw: number, out: readonly [number, number], rnd: () => number, nextSeed: () => number, detail: number): StoneSpec[] {
  const specs: StoneSpec[] = [];
  const u: [number, number] = [Math.cos(yaw), -Math.sin(yaw)]; // along the wall
  const at = (a: number, w: number) => ({ x: x + u[0] * a + out[0] * w, z: z + u[1] * a + out[1] * w });
  const R = 0.8; // the opening's radius
  const spring = level + 0.05; // where the arch springs from
  // the dark cavity: one big near-black stone set back inside the opening
  const cav = at(0, -0.5);
  specs.push({ x: cav.x, z: cav.z, top: spring + R, rx: R * 0.95, rz: 0.4, depth: R + 0.9, yaw, flat: 0.2, seed: nextSeed(), tone: 0.04, detail: 3 });
  // the arch: seven stones round the half circle
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = Math.PI * (k + 0.5) / n;
    const p = at(-Math.cos(a) * (R + 0.2), 0.05);
    const cy = spring + Math.sin(a) * (R + 0.2);
    specs.push({ x: p.x, z: p.z, top: cy + 0.2, rx: 0.3, rz: 0.4, depth: 0.42, yaw: yaw + (Math.PI / 2 - a) * 0.0, flat: 0.8, seed: nextSeed(), tone: 0.95 + rnd() * 0.12, detail });
  }
  // the wall: courses of blocks beside and above the opening
  for (let course = 0; course < 4; course++) {
    const y = level - 0.25 + course * 0.42;
    for (let a = -2.2; a <= 2.2; a += 0.62) {
      const inOpening = Math.abs(a) < R + 0.45 && y < spring + R + 0.25;
      if (inOpening) continue;
      const aa = a + (course % 2) * 0.3 + (rnd() - 0.5) * 0.08;
      const p = at(aa, 0.12 + (rnd() - 0.5) * 0.06);
      specs.push({ x: p.x, z: p.z, top: y + 0.4, rx: 0.34, rz: 0.36, depth: 0.5, yaw, flat: 0.85, seed: nextSeed(), tone: 0.9 + rnd() * 0.2, detail });
    }
  }
  // wing stones in the bank on both sides
  for (const s of [-1, 1]) {
    const p = at(s * 2.7, 0.5);
    specs.push({ x: p.x, z: p.z, top: level + 0.7, rx: 0.5, rz: 0.55, depth: 0.9, yaw: rnd() * 6, flat: 0.4, seed: nextSeed(), tone: 0.92 + rnd() * 0.15, detail });
  }
  return specs;
}

export function planCreek(grid: CreekGrid, o: PlanOptions): CreekPlan {
  const rnd = mulberry32(20261118);
  const stones: StoneSpec[] = [];
  const pebbles: StoneSpec[] = [];
  const reeds: ReedClump[] = [];
  const stepping: CreekPlan["stepping"] = [];
  const foam = o.foam;
  const detailStone = o.low ? 3 : 5;
  const detailBoulder = o.low ? 4 : 6;
  let seed = 100;
  const nextSeed = () => ++seed;
  const bed = (x: number, z: number) => {
    const y = bedAt(grid, x, z);
    return Number.isNaN(y) ? -1 : y;
  };

  // ── the two cascades: a sill of stones from bank to bank, the plunge pool's boulders, the foam churn ──
  CASCADES.forEach((c, ci) => {
    const shore = shoreAt(grid, c.x - 0.4, c.upY);
    const z0 = shore.north - 0.5;
    const z1 = shore.south + 0.5;
    for (let z = z0; z <= z1; z += 0.62) {
      const zz = z + (rnd() - 0.5) * 0.12;
      const x = c.x + (rnd() - 0.5) * 0.18;
      // the crest is just under the upstream water: the sheet slides over it
      const top = c.upY - 0.025 + (rnd() - 0.5) * 0.06;
      const b = Math.min(bed(x - 0.2, zz), bed(x + 0.2, zz));
      stones.push({
        x,
        z: zz,
        top: Math.max(top, b + 0.12),
        rx: 0.36 + rnd() * 0.12,
        rz: 0.46 + rnd() * 0.14,
        depth: Math.max(0.35, top - b + 0.2),
        yaw: (rnd() - 0.5) * 0.5,
        flat: 0.75,
        seed: nextSeed(),
        tone: 0.92 + rnd() * 0.16,
        detail: detailStone,
      });
    }
    splatWeir(foam, c.x + 0.25, shore.north, shore.south);
    // the plunge pool: boulders in the white water below the sill
    const count = ci === 0 ? 4 : 5;
    for (let k = 0; k < count; k++) {
      const x = c.x + 0.9 + rnd() * 2.6;
      const zz = shore.north + 0.5 + rnd() * (shore.south - shore.north - 1.0);
      const top = c.downY + 0.1 + rnd() * 0.3;
      const b = bed(x, zz);
      const r = 0.28 + rnd() * 0.3;
      stones.push({ x, z: zz, top, rx: r, rz: r * (0.8 + rnd() * 0.4), depth: Math.max(0.3, top - b + 0.15), yaw: rnd() * 6.28, flat: 0.45, seed: nextSeed(), tone: 0.88 + rnd() * 0.2, detail: detailStone });
      splatStone(foam, x, zz, r * 0.95, 0.9);
    }
  });

  // ── the stepping stones: a diagonal row across the creek above the eastern cascade (the owner's picture) ──
  {
    const c = CASCADES[1];
    const level = c.upY;
    const xa = c.x - 5.0;
    const xb = c.x - 2.3;
    const shoreA = shoreAt(grid, xa, level);
    const shoreB = shoreAt(grid, xb, level);
    const n = 6;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n + (rnd() - 0.5) * 0.06;
      const x = xa + (xb - xa) * t + (rnd() - 0.5) * 0.35;
      const zS = shoreA.south + (shoreB.south - shoreA.south) * t;
      const zN = shoreA.north + (shoreB.north - shoreA.north) * t;
      const z = zN - 0.2 + (zS - zN + 0.4) * t + (rnd() - 0.5) * 0.25;
      const top = level + 0.17 + (rnd() - 0.5) * 0.07;
      const b = bed(x, z);
      const rx = 0.5 + rnd() * 0.2;
      const rz = 0.42 + rnd() * 0.2;
      stones.push({ x, z, top, rx, rz, depth: Math.max(0.4, top - b + 0.2), yaw: rnd() * 3.1, flat: 0.9, seed: nextSeed(), tone: 0.97 + rnd() * 0.12, detail: detailStone });
      stepping.push({ x, z, top });
      if (b < level) splatStone(foam, x, z, Math.max(rx, rz) * 0.9, 0.85);
    }
  }

  // ── boulders: big rocks on the banks and a few half in the water, none at the bridge ──
  const boulderXs = [-86, -71, -57, -47, -34, -14, -3, 11, 21, 41, 52, 63, 77, 88];
  boulderXs.forEach((bx, i) => {
    if (inBridge(bx)) return;
    const level = creekLevelAt(bx);
    const shore = shoreAt(grid, bx, level);
    const inWater = i % 4 === 1;
    const side = i % 2 === 0 ? -1 : 1;
    const rx = 0.55 + rnd() * 0.55;
    const rz = rx * (0.7 + rnd() * 0.4);
    if (inWater) {
      const z = shore.centre + (rnd() - 0.5) * (shore.south - shore.north) * 0.55;
      const top = level + 0.28 + rnd() * 0.28;
      const b = bed(bx, z);
      stones.push({ x: bx, z, top, rx, rz, depth: Math.max(0.5, top - b + 0.25), yaw: rnd() * 6.28, flat: 0.35, seed: nextSeed(), tone: 0.9 + rnd() * 0.15, detail: detailBoulder });
      splatStone(foam, bx, z, Math.max(rx, rz) * 0.9, 1);
    } else {
      const edge = side < 0 ? shore.north : shore.south;
      const z = edge + side * (0.3 + rnd() * 0.9);
      const ground = bed(bx, z);
      const top = Math.max(ground + 0.1, level + 0.18) + 0.28 + rnd() * 0.3;
      stones.push({ x: bx, z, top, rx, rz, depth: Math.max(0.55, top - ground + 0.2), yaw: rnd() * 6.28, flat: 0.3, seed: nextSeed(), tone: 0.9 + rnd() * 0.18, detail: detailBoulder });
      // a smaller companion beside it
      const r2 = rx * 0.45;
      const z2 = z + side * (0.9 + rnd() * 0.5);
      const g2 = bed(bx + 0.8, z2);
      stones.push({ x: bx + 0.8 + rnd() * 0.4, z: z2, top: g2 + 0.12 + r2 * 0.5, rx: r2, rz: r2 * 0.85, depth: 0.45, yaw: rnd() * 6.28, flat: 0.3, seed: nextSeed(), tone: 0.9 + rnd() * 0.18, detail: detailStone });
    }
  });

  // ── pebbles along both waterlines and a few on the bed ──
  const pebbleStep = o.low ? 1.3 : 0.8;
  for (let x = CREEK_X0; x < X_LIMIT; x += pebbleStep) {
    if (inBridge(x)) continue;
    const level = creekLevelAt(x);
    const shore = shoreAt(grid, x, level);
    for (const side of [-1, 1] as const) {
      if (rnd() < 0.3) continue;
      const edge = side < 0 ? shore.north : shore.south;
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const px = x + (rnd() - 0.5) * pebbleStep;
        const pz = edge + side * (rnd() * 0.9 - 0.45);
        const gy = bed(px, pz);
        const r = 0.035 + rnd() * rnd() * 0.12;
        pebbles.push({ x: px, z: pz, top: gy + r * 0.55, rx: r * (1.1 + rnd() * 0.5), rz: r, depth: r * 1.2, yaw: rnd() * 6.28, flat: 0.5, seed: nextSeed(), tone: 0.8 + rnd() * 0.35, detail: 1 });
      }
    }
    // a few on the bed, under the water
    if (rnd() < 0.5) {
      const pz = shore.centre + (rnd() - 0.5) * (shore.south - shore.north) * 0.8;
      const r = 0.05 + rnd() * 0.1;
      pebbles.push({ x, z: pz, top: bed(x, pz) + r * 0.5, rx: r * 1.2, rz: r, depth: r * 1.2, yaw: rnd() * 6.28, flat: 0.4, seed: nextSeed(), tone: 0.75 + rnd() * 0.3, detail: 1 });
    }
  }

  // ── reeds and sedge tufts behind the waterline ──
  const reedStep = o.low ? 2.8 : 1.5;
  for (let x = CREEK_X0 + 2; x < X_LIMIT; x += reedStep) {
    const level = creekLevelAt(x);
    const shore = shoreAt(grid, x, level);
    for (const side of [-1, 1] as const) {
      const near = Math.abs(x - -24) < 5; // thicker by the footbridge
      if (rnd() < (near ? 0.15 : 0.3)) continue;
      const rx = x + (rnd() - 0.5) * reedStep;
      const edge = side < 0 ? shore.north : shore.south;
      const rz = edge + side * (0.05 + rnd() * 0.55);
      if (inBridge(rx) && Math.abs(rz - 75) < 4.5) continue;
      reeds.push({ x: rx, y: bed(rx, rz), z: rz, h: 0.7 + rnd() * 0.6, seed: nextSeed(), sedge: rnd() < 0.35 ? 1 : 0 });
    }
  }
  // ── the feeder stream from the falls (x about -108, running south to the creek): pebbles, reeds, a boulder here and there ──
  const crossX = (z: number, level: number): { west: number; east: number; centre: number } => {
    let best = Infinity;
    let bx = -108;
    for (let x = -120; x < -98; x += 0.1) {
      const y = bed(x, z);
      if (y < best) {
        best = y;
        bx = x;
      }
    }
    let west = bx;
    let east = bx;
    for (let x = bx; x > bx - 9; x -= 0.05) {
      if (bed(x, z) > level) break;
      west = x;
    }
    for (let x = bx; x < bx + 9; x += 0.05) {
      if (bed(x, z) > level) break;
      east = x;
    }
    return { west, east, centre: bx };
  };
  const fStep = o.low ? 1.6 : 0.9;
  let fi = 0;
  for (let z = -54; z < 64; z += fStep) {
    const level = feederLevelAt(z);
    const c = crossX(z, level);
    if (c.east - c.west < 0.4) continue;
    fi++;
    for (const side of [-1, 1] as const) {
      const edge = side < 0 ? c.west : c.east;
      if (rnd() < 0.3) continue;
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const pz = z + (rnd() - 0.5) * fStep;
        const px = edge + side * (rnd() * 0.9 - 0.45);
        const r = 0.035 + rnd() * rnd() * 0.12;
        pebbles.push({ x: px, z: pz, top: bed(px, pz) + r * 0.55, rx: r * (1.1 + rnd() * 0.5), rz: r, depth: r * 1.2, yaw: rnd() * 6.28, flat: 0.5, seed: nextSeed(), tone: 0.8 + rnd() * 0.35, detail: 1 });
      }
      if (fi % (o.low ? 3 : 2) === 0 && rnd() > 0.35) {
        const px = edge + side * (0.05 + rnd() * 0.5);
        reeds.push({ x: px, y: bed(px, z), z, h: 0.7 + rnd() * 0.6, seed: nextSeed(), sedge: rnd() < 0.35 ? 1 : 0 });
      }
    }
    // a boulder on the bank every so often, one half in the water
    if (fi % 13 === 5) {
      const side = fi % 26 === 5 ? -1 : 1;
      const edge = side < 0 ? c.west : c.east;
      const rx = 0.5 + rnd() * 0.5;
      const px = edge + side * (0.3 + rnd() * 0.7);
      const g = bed(px, z);
      stones.push({ x: px, z, top: Math.max(g, level) + 0.3 + rnd() * 0.3, rx, rz: rx * 0.8, depth: 0.7, yaw: rnd() * 6.28, flat: 0.3, seed: nextSeed(), tone: 0.9 + rnd() * 0.18, detail: detailBoulder });
    }
    if (fi % 17 === 9 && c.east - c.west > 1.2) {
      const px = c.centre + (rnd() - 0.5) * (c.east - c.west) * 0.4;
      const r = 0.4 + rnd() * 0.25;
      stones.push({ x: px, z, top: level + 0.2 + rnd() * 0.2, rx: r, rz: r * 0.85, depth: 0.6, yaw: rnd() * 6.28, flat: 0.4, seed: nextSeed(), tone: 0.9 + rnd() * 0.15, detail: detailStone });
      splatStone(foam, px, z, r * 0.95, 0.9);
    }
  }
  let mouths: CreekPlan["mouths"] = { feeder: { x: 0, z: 0 }, creek: { x: 0, z: 0 } };
  // ── the falls' stepping slabs: the same flat tops (they are walkable), as real stones with a rounded edge ──
  for (const s of o.slabs ?? []) {
    stones.push({ x: s.centre.x, z: s.centre.z, top: s.top + 0.02, rx: s.radiusX * 0.98, rz: s.radiusZ * 0.98, depth: 0.5, yaw: s.yaw, flat: 1, seed: nextSeed(), tone: 0.98 + rnd() * 0.1, detail: detailBoulder });
  }
  // ── the ends: the feeder runs into a culvert at its south end, the creek comes out of one at its west end ──
  {
    // the feeder's last wet row
    let zEnd = -54;
    for (let z = -54; z < 66; z += 0.5) {
      const c = crossX(z, feederLevelAt(z));
      if (c.east - c.west >= 0.8) zEnd = z;
    }
    const cf = crossX(zEnd, feederLevelAt(zEnd));
    stones.push(...headwall(cf.centre, zEnd + 0.9, feederLevelAt(zEnd), 0, [0, -1], rnd, nextSeed, detailStone));
    // the creek's first wet column
    const level = creekLevelAt(CREEK_X0);
    let xEnd = -90;
    const zc0 = shoreAt(grid, -90, level).centre;
    for (let x = -90; x > -118; x -= 0.25) {
      if (bed(x, zc0) > level) break;
      xEnd = x;
    }
    stones.push(...headwall(xEnd - 0.7, zc0, level, Math.PI / 2, [1, 0], rnd, nextSeed, detailStone));
    mouths = { feeder: { x: cf.centre, z: zEnd }, creek: { x: xEnd, z: zc0 } };
  }
  return { stones, pebbles, reeds, foam, stepping, mouths };
}
