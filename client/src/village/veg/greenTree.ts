import { DAY_SUN_DIRECTION } from "../dayNightBlend";
import { mulberry32, valueNoise3 } from "./vegRandom";
import type { Branch } from "./cherryTree";
import type { Vec3 } from "./vegLod";

/** The plaza's large zelkova (the round deck tree visible in the user's screenshot). */
export interface GreenTreeSpec {
  name: string;
  base: Vec3;
  H: number;
  R: number;
  seed: number;
  limbs: number;
  trunkRadius: number;
}

export interface GreenCluster {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  size: number;
  light: number;
  seed: number;
}

export interface GreenCrown {
  spec: GreenTreeSpec;
  twigs: Branch[];
  clusters: GreenCluster[];
  bounds: { x: number; y: number; z: number; r: number };
}

/** Game-space coordinates: Blender V(x,z,y) exports to game (x,y,-z). */
export const PLAZA_ZELKOVA: GreenTreeSpec = {
  name: "plaza_zelkova",
  base: [-25, 0.46, 5],
  H: 13.5,
  R: 8.5,
  seed: 7,
  limbs: 7,
  trunkRadius: 0.62,
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Grow one rounded, lacy broadleaf crown from the preserved trunk's seven main limbs. */
export function growGreen(spec: GreenTreeSpec = PLAZA_ZELKOVA): GreenCrown {
  const rand = mulberry32(spec.seed * 7919 + 17);
  const forkH = spec.H * 0.30;
  const fork: Vec3 = add(spec.base, [0, forkH, 0]);
  const twigs: Branch[] = [];
  const branchEnds: Vec3[] = [];

  for (let i = 0; i < spec.limbs; i++) {
    const az = (i / spec.limbs) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const el = 0.38 + rand() * 0.32;
    const dir: Vec3 = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const L = Math.min(spec.R * (0.72 + rand() * 0.2) / Math.max(0.4, Math.cos(el)), spec.H * 0.85);
    const p0 = add(fork, [0, -0.08, 0]);
    const p1 = add(p0, mul(dir, L * 0.34));
    const p2 = add(p0, add(mul(dir, L * 0.7), [0, L * 0.08, 0]));
    const p3 = add(p0, add(mul(dir, L), [0, -L * 0.025, 0]));
    const r0 = spec.trunkRadius * 0.34;
    const branch: Branch = { pts: [p0, p1, p2, p3], radii: [r0, r0 * 0.7, r0 * 0.42, 0.018] };
    twigs.push(branch);
    branchEnds.push(p3);

    // Two secondary branches on each main limb make the crown read as a tree rather than a sphere of leaves.
    for (let j = 0; j < 2; j++) {
      const t = 0.38 + rand() * 0.38;
      const q0 = t < 0.55 ? add(p1, mul(sub(p2, p1), t / 0.55)) : add(p2, mul(sub(p3, p2), (t - 0.55) / 0.45));
      const az2 = az + (rand() - 0.5) * 1.4;
      const el2 = el + (rand() - 0.45) * 0.35;
      const d2: Vec3 = [Math.cos(az2) * Math.cos(el2), Math.sin(el2), Math.sin(az2) * Math.cos(el2)];
      const q1 = add(q0, mul(d2, L * (0.36 + rand() * 0.12)));
      twigs.push({ pts: [q0, add(q0, mul(d2, L * 0.18)), q1], radii: [r0 * 0.2, r0 * 0.11, 0.009] });
      branchEnds.push(q1);
    }
  }

  const crownY = spec.base[1] + forkH + (spec.H - forkH) * 0.52;
  const clusters: GreenCluster[] = [];
  const sun = norm(DAY_SUN_DIRECTION as Vec3);
  // A few hundred closed clusters leave irregular sky gaps while staying below the rich-tier budget.
  const count = spec.name === "plaza_zelkova" ? 320 : 110;
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const rr = Math.sqrt(Math.max(0, 1 - u * u));
    const rho = 0.48 + Math.sqrt(rand()) * 0.58;
    const p: Vec3 = [
      spec.base[0] + rr * Math.cos(th) * spec.R * rho,
      crownY + u * spec.H * 0.23 * rho,
      spec.base[2] + rr * Math.sin(th) * spec.R * rho,
    ];
    // Low-frequency holes make the canopy lacy from below and avoid a single smooth green shell.
    if (valueNoise3(p[0] / 1.8, p[1] / 1.8, p[2] / 1.8, spec.seed + 11) > 0.79) continue;
    const outward = norm([p[0] - spec.base[0], (p[1] - crownY) * 1.5, p[2] - spec.base[2]]);
    const light = Math.min(1.1, 0.55 + 0.28 * Math.max(0, outward[1]) + 0.18 * Math.max(0, outward[0] * sun[0] + outward[1] * sun[1] + outward[2] * sun[2]));
    clusters.push({
      x: p[0],
      y: p[1],
      z: p[2],
      nx: outward[0],
      ny: outward[1],
      nz: outward[2],
      size: 0.62 + rand() * 0.28,
      light,
      seed: rand(),
    });
  }

  let radius = 0;
  for (const c of clusters) radius = Math.max(radius, Math.hypot(c.x - spec.base[0], c.y - crownY, c.z - spec.base[2]) + c.size);
  return {
    spec,
    twigs,
    clusters,
    bounds: { x: spec.base[0], y: crownY, z: spec.base[2], r: Math.max(radius, spec.R + 1) },
  };
}
