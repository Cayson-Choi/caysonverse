import { cross, GeoBuilder, norm, type V3 } from "./geoBuilder";

/** Flat stone faces use metre UVs on the dominant plane, including the soffit. */
function face(b: GeoBuilder, points: V3[], color: V3) {
  const [a, c, d] = points as [V3, V3, V3, ...V3[]];
  const n = norm(cross([c[0] - a[0], c[1] - a[1], c[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]]));
  const x = Math.abs(n[0]), y = Math.abs(n[1]), z = Math.abs(n[2]);
  const base = b.vertices;
  for (const p of points) {
    b.rawVertex(p, n, (x > z && x > y ? p[2] : p[0]) / 1.4, (y > z && y > x ? p[2] : p[1]) / 1.4, color);
  }
  for (let i = 1; i < points.length - 1; i++) b.idx.push(base, base + i, base + i + 1);
}

/** Seventeen wedge-cut sandstone voussoirs. The spandrel behind them closes every mortar joint. */
export function addGateArch(b: GeoBuilder, cz: number) {
  const radius = 13.25, cy = 7.2 - radius;
  const maxAngle = Math.asin(7 / radius), count = 17;
  const polar = (a: number, r: number, depth: number): V3 => [40 + r * Math.sin(a), cy + r * Math.cos(a), cz + depth];
  for (let i = 0; i < count; i++) {
    const left = (2 * i / count - 1) * maxAngle, right = (2 * (i + 1) / count - 1) * maxAngle;
    const backing: V3 = [0.80, 0.76, 0.70];
    for (const dir of [-1, 1]) {
      const l = polar(left, radius + 0.055, dir * 1.49), r = polar(right, radius + 0.055, dir * 1.49);
      const panel: V3[] = [l, r, [r[0], 8.205, r[2]], [l[0], 8.205, l[2]]];
      face(b, dir === 1 ? panel : panel.reverse(), backing);
    }
    face(b, [polar(left, radius + 0.055, -1.49), polar(right, radius + 0.055, -1.49),
      polar(right, radius + 0.055, 1.49), polar(left, radius + 0.055, 1.49)], backing);

    // The keystone projects below and in front of the arch. Its head clears the plaque's lower brass lip.
    const key = i === 8, inner = radius - (key ? 0.12 : 0), outer = radius + (key ? 1.12 : 1);
    const depth = key ? 1.78 : 1.62, tone = 0.92 + 0.055 * Math.sin(i * 2.1);
    const block: V3 = [tone, tone * 0.975, tone * 0.94];
    const ring = (z: number, chamfer: number) => {
      const gap = (0.009 + chamfer) / radius;
      return [polar(left + gap, inner + chamfer, z), polar(right - gap, inner + chamfer, z),
        polar(right - gap, outer - chamfer, z), polar(left + gap, outer - chamfer, z)];
    };
    const rings = [ring(-depth, 0.03), ring(-depth + 0.035, 0), ring(depth - 0.035, 0), ring(depth, 0.03)];
    face(b, [...rings[0]!].reverse(), block);
    face(b, rings[3]!, block);
    for (let k = 0; k < 3; k++) for (let edge = 0; edge < 4; edge++) {
      const j = (edge + 1) % 4, near = rings[k]!, far = rings[k + 1]!;
      face(b, [near[edge]!, near[j]!, far[j]!, far[edge]!], block);
    }
  }
}

/** A repoussé star pressed from a sheet, folded from every tip to the raised boss. */
export function addGateStar(b: GeoBuilder, x: number, y: number, z: number, dir: number) {
  const rim = (i: number): V3 => {
    const angle = Math.PI / 2 + dir * i * Math.PI / 5, r = i % 2 ? 0.16 : 0.38;
    return [x + r * Math.cos(angle), y + r * Math.sin(angle), z];
  };
  for (let i = 0; i < 10; i++) face(b, [[x, y, z + dir * 0.103], rim(i), rim(i + 1)], [1, 1, 1]);
}
