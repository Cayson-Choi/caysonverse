import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import type { ReedClump } from "./creekPlan";
import { mulberry32 } from "./creekStones";

/**
 * Reed and sedge clumps: curved, tapering blades (a four-ring ribbon each, bent like a real leaf), grouped in clumps of 8 to
 * 16, every clump of the creek in one geometry. The colour is in the vertices (dark green foot, brighter blade, a pale
 * straw tip); the sway is the material's (CreekPatch). The geometry is volumetric enough for a first-person look: blades
 * lean and cross, none is a flat card standing in a row.
 */

const RINGS = 4;

export function reedGeometry(clumps: readonly ReedClump[]): BufferGeometry | null {
  if (!clumps.length) return null;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  for (const c of clumps) {
    const rnd = mulberry32(c.seed * 31 + 7);
    const blades = c.sedge ? 13 + Math.floor(rnd() * 5) : 7 + Math.floor(rnd() * 4);
    for (let b = 0; b < blades; b++) {
      const ang = rnd() * Math.PI * 2;
      const rad = rnd() * (c.sedge ? 0.2 : 0.13);
      const bx = c.x + Math.cos(ang) * rad;
      const bz = c.z + Math.sin(ang) * rad;
      const h = c.h * (c.sedge ? 0.55 : 1) * (0.65 + rnd() * 0.5);
      const dir = ang + (rnd() - 0.5) * 1.2; // leans away from the clump's middle, mostly
      const lean = (c.sedge ? 0.45 : 0.22) + rnd() * 0.3;
      const w = (c.sedge ? 0.028 : 0.022) * (0.8 + rnd() * 0.5);
      const face = rnd() * Math.PI; // the ribbon's facing
      const tone = 0.8 + rnd() * 0.35;
      const base = pos.length / 3;
      for (let r = 0; r <= RINGS; r++) {
        const t = r / RINGS;
        // bend: the blade leans out progressively (a quadratic arc) and droops at the tip
        const out = lean * h * t * t;
        const y = h * (t - 0.22 * t * t * (c.sedge ? 1.4 : 0.5)) - 0.04;
        const cx = bx + Math.cos(dir) * out;
        const cz = bz + Math.sin(dir) * out;
        const half = w * (1 - t * t * 0.92) * (c.sedge ? 1 : 1);
        const fx = Math.cos(face), fz = Math.sin(face);
        pos.push(cx - fx * half, c.y + y, cz - fz * half, cx + fx * half, c.y + y, cz + fz * half);
        // normal: perpendicular to the ribbon, tipped up a little along the arc
        const nx = -fz, nz = fx;
        nor.push(nx, 0.35, nz, nx, 0.35, nz);
        const g = tone * (0.45 + 0.55 * t);
        const straw = t > 0.8 ? (t - 0.8) * 2.2 : 0;
        const rr = 0.2 * g + 0.45 * straw * tone;
        const gg = 0.38 * g + 0.3 * straw * tone;
        const bb = 0.08 * g + 0.1 * straw * tone;
        col.push(rr, gg, bb, rr, gg, bb);
        sway.push(t * t, t * t);
      }
      for (let r = 0; r < RINGS; r++) {
        const a = base + r * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("aSway", new Float32BufferAttribute(sway, 1));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  return g;
}
