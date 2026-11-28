import { BufferGeometry, Float32BufferAttribute } from "three";

/** Sides of the rebuilt top: round at a phone's arm's length (the baked top was an octagon). */
export const TERRACE_TOP_SIDES = 48;

/**
 * The café terrace's round bistro tables (prop sweep 2026-11-28): village.glb bakes each top as an octagon, which a phone camera over
 * the table shows as eight flat facets. Given the taken faces of one top (world metres), this rebuilds it as a true disc of the same
 * centre, radius and thickness: a flat top, an eased upper edge, a straight rim, an eased lower edge and the underside, with smooth
 * normals and metre UVs (the top planar in x/z; the rim by arc length and height), divided by `tile` for the PBR set.
 */
export function terraceTableTop(faces: BufferGeometry, tile = 1, sides = TERRACE_TOP_SIDES): BufferGeometry {
  const pos = faces.getAttribute("position");
  let sx = 0, sz = 0, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    sx += pos.getX(i);
    sz += pos.getZ(i);
    y0 = Math.min(y0, pos.getY(i));
    y1 = Math.max(y1, pos.getY(i));
  }
  // the centre: the middle of the extent (the vertex mean leans toward the side with more vertices)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i));
  }
  void sx; void sz;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  let r = 0;
  for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz));
  const t = Math.max(0.01, y1 - y0);
  const e = Math.min(0.006, t * 0.3);
  // the section (radius, height) from the top's centre round the edge to the underside's centre, with its outward normal
  const prof: Array<[number, number, number, number]> = [
    [0, y1, 0, 1], [r - e * 2, y1, 0, 1], [r - e * 0.6, y1 - e * 0.15, 0.6, 0.8], [r, y1 - e, 1, 0],
    [r, y0 + e, 1, 0], [r - e * 0.6, y0 + e * 0.15, 0.6, -0.8], [r - e * 2, y0, 0, -1], [0, y0, 0, -1],
  ];
  const P: number[] = [], N: number[] = [], U: number[] = [];
  let arc = 0;
  const arcs = prof.map((p, i) => (i === 0 ? 0 : (arc += Math.hypot(p[0] - prof[i - 1]![0], p[1] - prof[i - 1]![1]))));
  for (let i = 0; i < prof.length; i++) {
    const [pr, py, nr, ny] = prof[i]!;
    const flat = Math.abs(ny) === 1;
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = cx + pr * c, z = cz + pr * s;
      P.push(x, py, z);
      N.push(nr * c, ny, nr * s);
      if (flat) U.push(x / tile, z / tile);
      else U.push((a * r) / tile, arcs[i]! / tile);
    }
  }
  const idx: number[] = [];
  const ring = sides + 1;
  for (let i = 0; i < prof.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * ring + k, b = a + ring;
      // the section runs down and out: wind so the faces look out of the disc (top up, rim out, underside down)
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new Float32BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
