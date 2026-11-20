import { GeoBuilder, type V3 } from "./geoBuilder";

const POOL = 0.94;
const BOWL = 2.77;

/** Two pools and eight ballistic streams in one transparent draw. The lower ends enter the impact ripples. */
export function parkFountainWater() {
  const b = new GeoBuilder();
  const up: V3 = [0, 1, 0];
  function pool(radius: number, height: number, sides: number) {
    const centre = b.rawVertex([0, height, 0], up, 0, 0, [0.16, 0.39, 0.44]);
    for (let i = 0; i < sides; i++) {
      const a = 2 * Math.PI * i / sides, x = radius * Math.cos(a), z = radius * Math.sin(a);
      b.rawVertex([x, height, z], up, x * 0.68, -z * 0.68, [0.24, 0.54, 0.57]);
    }
    for (let i = 0; i < sides; i++) b.idx.push(centre, centre + 1 + (i + 1) % sides, centre + 1 + i);
  }
  pool(4.045, POOL, 72);
  pool(1.59, BOWL, 56);

  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    const points: V3[] = [];
    for (let j = 0; j <= 12; j++) {
      const t = j / 12;
      const r = 1.42 + 1.90 * t;
      const y = BOWL - 0.025 + (POOL - BOWL) * t + 3.45 * t * (1 - t);
      points.push([c * r, y, s * r]);
    }
    b.tube(points, 0.043, 7, [0.58, 0.81, 0.87]);

    // Broken water at the point of impact; the crest rolls back into the pool on both sides.
    const base = b.vertices, sides = 14;
    for (const [ring, y, shade] of [[0.048, 0.002, 0.63], [0.107, 0.044, 1], [0.205, 0.001, 0.58]] as const) {
      for (let k = 0; k < sides; k++) {
        const th = k * 2 * Math.PI / sides;
        const r = ring * (1 + 0.11 * Math.cos(3 * th + i));
        const x = 3.32 * c + r * Math.cos(th), z = 3.32 * s + r * Math.sin(th);
        b.rawVertex([x, POOL + y * (1 + 0.25 * Math.sin(5 * th + i)), z],
          up, x * 0.68, -z * 0.68, [0.58 * shade, 0.86 * shade, 0.90 * shade]);
      }
    }
    for (let ring = 0; ring < 2; ring++) for (let k = 0; k < sides; k++) {
      const p = base + ring * sides + k, q = base + ring * sides + (k + 1) % sides;
      b.idx.push(p, q, p + sides, q, q + sides, p + sides);
    }
  }
  return b.build();
}
