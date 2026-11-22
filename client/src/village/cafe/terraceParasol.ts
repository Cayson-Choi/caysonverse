import type { BufferGeometry } from "three";
import { MATTE, MeshBuilder, type V3 } from "./meshBuilder";

const white: V3 = [1, 1, 1];
const up: V3 = [0, 1, 0];
const below = (p: V3, drop: number): V3 => [p[0], p[1] - drop, p[2]];

/** Each source triangle is one gore, with a peak and two rib ends. Keep its footprint and the pole already in the terrace. */
export function terraceParasol(sails: BufferGeometry): BufferGeometry {
  const b = new MeshBuilder();
  const pos = sails.getAttribute("position");
  for (let i = 0; i < pos.count; i += 3) {
    const p: V3[] = [i, i + 1, i + 2].map(j => [pos.getX(j), pos.getY(j), pos.getZ(j)]);
    p.sort((a, c) => c[1] - a[1]);
    const [peak, a, c] = p as [V3, V3, V3];
    // Sort the two corners round the pole so adjoining gores contribute exactly one rib each.
    const cross = (a[0] - peak[0]) * (c[2] - peak[2]) - (a[2] - peak[2]) * (c[0] - peak[0]);
    const [left, right] = cross > 0 ? [a, c] : [c, a];
    const angle = Math.atan2(left[2] - peak[2], left[0] - peak[0]);
    const sector = (Math.round(angle * 4 / Math.PI) + 8) % 8;
    const face = (r: number, s: number): V3 => [
      peak[0] + r * (left[0] + (right[0] - left[0]) * s - peak[0]),
      peak[1] + (left[1] - peak[1]) * (0.53 * r + 0.47 * r * r) - 0.045 * Math.sin(Math.PI * s) * r,
      peak[2] + r * (left[2] + (right[2] - left[2]) * s - peak[2]),
    ];
    const uv = (r: number, s: number): [number, number] => [(sector % 2) * 0.5 + 0.025 + 0.45 * s, 0.91 - 0.68 * r];
    const span = 3;
    for (let col = 0; col < span; col++) {
      const s0 = col / span, s1 = (col + 1) / span;
      for (let row = 0; row < 3; row++) {
        const r0 = row / 3, r1 = (row + 1) / 3;
        b.quad(face(r0, s0), face(r1, s0), face(r1, s1), face(r0, s1), white, MATTE, up,
          [uv(r0, s0), uv(r1, s0), uv(r1, s1), uv(r0, s1)]);
      }
      const e0 = face(1, s0), e1 = face(1, s1);
      const hem = (s: number) => 0.075 + 0.036 * Math.sin(Math.PI * s);
      const outside: V3 = [e0[0] - peak[0], 0, e0[2] - peak[2]];
      b.quad(e0, below(e0, hem(s0)), below(e1, hem(s1)), e1, white, MATTE, outside,
        [uv(1, s0), [uv(1, s0)[0], 0.13], [uv(1, s1)[0], 0.13], uv(1, s1)]);
    }
    const rib = [0, 1 / 3, 2 / 3, 1].map(r => below(face(r, 0), 0.016));
    b.tube(rib, 0.011, white, MATTE, 5);
    b.tube([below(peak, 0.49), rib[2]!], 0.009, white, MATTE, 5);
    if (sector === 0) {
      b.lathe(peak[0], peak[2], [[0.032, peak[1] - 0.54], [0.054, peak[1] - 0.52],
        [0.054, peak[1] - 0.48], [0.032, peak[1] - 0.46]], white, MATTE, 10);
      b.lathe(peak[0], peak[2], [[0.055, peak[1] - 0.015], [0.045, peak[1] + 0.018],
        [0.02, peak[1] + 0.038], [0, peak[1] + 0.041]], white, MATTE, 10);
    }
  }
  const g = b.build();
  g.deleteAttribute("aMat");
  g.deleteAttribute("color");
  return g;
}
