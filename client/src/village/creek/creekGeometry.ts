import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import { CASCADES, CREEK_RECT, centreZ, type CreekGrid, type GroundSource } from "./creekMap";

/**
 * Geometry the creek patch cuts or builds from the village model: the bank/bed overlay (a copy of the ground triangles in
 * the channel), the water meshes reshaped (the old glassy cascade strips cut out, the shore pushed out so the water's own
 * depth fade draws the edge), and the cascades' falling sheets.
 */

const inRect = (x: number, z: number): boolean => x >= CREEK_RECT.x0 && x <= CREEK_RECT.x1 && z >= CREEK_RECT.z0 && z <= CREEK_RECT.z1;

/** The ground triangles that dip into the channel (any corner lower than 1 cm below the lawn), as an indexed geometry, 1.2 cm up. */
export function bankGeometry(sources: readonly GroundSource[], inside: (x: number, z: number) => boolean = inRect): BufferGeometry | null {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const src of sources) {
    const p = src.position;
    const ind = src.index;
    const n = ind ? ind.length : p.length / 3;
    const remap = new Map<number, number>();
    const take = (v: number): number => {
      let k = remap.get(v);
      if (k === undefined) {
        k = pos.length / 3;
        pos.push(p[v * 3]!, p[v * 3 + 1]! + 0.012, p[v * 3 + 2]!);
        remap.set(v, k);
      }
      return k;
    };
    for (let t = 0; t < n; t += 3) {
      const a = ind ? ind[t]! : t;
      const b = ind ? ind[t + 1]! : t + 1;
      const c = ind ? ind[t + 2]! : t + 2;
      const ya = p[a * 3 + 1]!, yb = p[b * 3 + 1]!, yc = p[c * 3 + 1]!;
      if (Math.min(ya, yb, yc) > -0.01) continue;
      const cx = (p[a * 3]! + p[b * 3]! + p[c * 3]!) / 3;
      const cz = (p[a * 3 + 2]! + p[b * 3 + 2]! + p[c * 3 + 2]!) / 3;
      if (!inside(cx, cz)) continue;
      idx.push(take(a), take(b), take(c));
    }
  }
  if (!idx.length) return null;
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * A creek water mesh, reshaped (a new geometry; the loader's own stays untouched): the sloped faces (the old cascade
 * strips) are cut out, and the vertices on the two shores move 0.7 m outward, so the waterline is where the water's depth
 * reaches zero (the shader's fade), not where the old ribbon happened to end.
 */
export function reshapeWater(source: BufferGeometry, grid: CreekGrid): BufferGeometry {
  const g = source.clone();
  const pos = g.getAttribute("position");
  const centres = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (!inRect(x, z) || x < -100 || z < 60) continue; // the feeder (running north-south) keeps its ribbon
    const key = Math.round(x * 2);
    let c = centres.get(key);
    if (c === undefined) {
      c = centreZ(grid, key / 2);
      centres.set(key, c);
    }
    const d = z - c;
    if (Math.abs(d) > 1.5) pos.setZ(i, z + Math.sign(d) * 0.7);
  }
  pos.needsUpdate = true;
  const ind = g.getIndex();
  const keep: number[] = [];
  const n = ind ? ind.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const a = ind ? ind.getX(t) : t;
    const b = ind ? ind.getX(t + 1) : t + 1;
    const c = ind ? ind.getX(t + 2) : t + 2;
    const ys = [pos.getY(a), pos.getY(b), pos.getY(c)];
    if (Math.max(...ys) - Math.min(...ys) > 0.01) continue;
    keep.push(a, b, c);
  }
  g.setIndex(new Uint32BufferAttribute(keep, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * The falling sheet of one cascade: from the sill's crest it slides forward and drops on a curve to the lower water.
 * uv.x = metres across, uv.y = 0 at the lip .. 1 at the foot.
 */
export function sheetGeometry(cascadeIndex: number, z0: number, z1: number): BufferGeometry {
  const c = CASCADES[cascadeIndex]!;
  const rings = 9;
  const across = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const x = c.x + 0.05 + 0.62 * t;
    const y = c.upY - 0.012 + (c.downY - c.upY + 0.03) * Math.pow(t, 2.0); // the foot stays 1.8 cm over the lower water (no z-fight)
    for (let a = 0; a <= across; a++) {
      const s = a / across;
      // the sheet bellies a little forward in the middle, where the water runs deepest
      const belly = 0.05 * Math.sin(Math.PI * s) * t;
      pos.push(x + belly, y, z0 + (z1 - z0) * s);
      uv.push((z1 - z0) * s, t);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < across; a++) {
      const i = r * (across + 1) + a;
      idx.push(i, i + 1, i + across + 1, i + 1, i + across + 2, i + across + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  return g;
}
