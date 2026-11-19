import { Matrix4, Object3D } from "three";
import { PARK_PLANTERS, PARK_TROUGHS } from "@caysonverse/shared/village/parkArea";
import type { Bed } from "../village/veg/flowerPlacement";
import type { Bush } from "../village/veg/shrubs";
import { mulberry32 } from "../village/veg/vegRandom";
import { GeoBuilder, type V3 } from "./geoBuilder";

// Islands beside the two paved approaches and the outer curve of the fountain plaza.
// The long axis follows the path. A bowed centreline opens the islands towards the lawn.
// x, z, angle in degrees, half length, half width, bow in metres
const islands: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [11.7, -89, 90, 5.5, 1.55, -0.6], [-7.7, -82, 90, 4.4, 1.25, 0.5],
  [11.7, -66, 90, 4.8, 1.45, -0.75], [-7.7, -59, 90, 5.2, 1.4, 0.65],
  [11.7, -41, 90, 4.5, 1.3, -0.5], [-7.7, -37, 90, 4.2, 1.3, 0.45],
  [25, -85, 29, 6.8, 1.7, 0.8], [55, -85, -29, 6.8, 1.7, 0.8],
  [81, -102.5, 0, 5.8, 1.4, 0.7], [103, -102.5, 0, 5.2, 1.4, 0.5],
  [139, -102.5, 0, 6.1, 1.5, 0.7], [168, -102.5, 0, 5.4, 1.3, 0.6],
];

const soilY = 0.085;

// The inside edges also bound the planting and the compost, including at the station entrance.
export const raisedParkBeds = [
  ...PARK_TROUGHS,
  ...PARK_PLANTERS.map(p => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2, y: 0.84 })),
].map(t => ({
  kind: "box", plant: "pot", soilProvided: true, out: null,
  x0: t.x0 + 0.10, x1: t.x1 - 0.10, z0: t.z0 + 0.10, z1: t.z1 - 0.10, y: t.y,
} as const));

/** A mitred stone profile, from the foot through the drip edge to the inside wall. */
export function parkTroughStone() {
  const stone = new GeoBuilder();
  // Outset from the opening, height relative to compost, face brightness.
  const profile = [
    [0.11, -0.84, 0.74], [0.11, -0.71, 0.83], [0.07, -0.68, 0.92],
    [0.092, -0.12, 0.86], [0.155, -0.10, 0.72], [0.17, -0.075, 0.86],
    [0.17, 0.045, 0.94], [0.15, 0.07, 1], [0.018, 0.07, 1],
    [0, 0.052, 0.86], [0, -0.10, 0.62],
  ] as const;
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
  for (const bed of raisedParkBeds) {
    const cx = (bed.x0 + bed.x1) / 2, cz = (bed.z0 + bed.z1) / 2;
    for (let side = 0; side < corners.length; side++) {
      const [sx, sz] = corners[side]!, [ex, ez] = corners[(side + 1) % 4]!;
      const nx = sx === ex ? sx : 0, nz = sz === ez ? sz : 0;
      let v = 0;
      for (let i = 1; i < profile.length; i++) {
        const [r0, y0] = profile[i - 1]!, [r1, y1, tint] = profile[i]!;
        const length = Math.hypot(y1 - y0, r1 - r0);
        const n: V3 = [nx * (y1 - y0) / length, (r0 - r1) / length, nz * (y1 - y0) / length];
        const base = stone.vertices;
        for (const [dx, dz, r, h, uvY] of [[sx, sz, r0, y0, v], [ex, ez, r0, y0, v],
          [ex, ez, r1, y1, v + length], [sx, sz, r1, y1, v + length]] as const) {
          const x = cx + dx * (bed.x1 - cx + r), z = cz + dz * (bed.z1 - cz + r);
          stone.rawVertex([x, bed.y + h, z], n, nx ? z : x, uvY, [tint, tint * 0.96, tint * 0.90]);
        }
        stone.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        v += length;
      }
    }
  }
  return stone.build();
}

export function buildParkBorders() {
  const soil = new GeoBuilder();
  const edging = new GeoBuilder();
  const grasses: Matrix4[] = [];
  const bushes: Bush[] = [];
  const flowers: Array<Extract<Bed, { kind: "box" }>> = [];
  const transform = new Object3D();
  const rnd = mulberry32(612);

  for (const bed of raisedParkBeds) {
    const base = soil.vertices;
    for (const [x, z] of [[bed.x0, bed.z0], [bed.x0, bed.z1], [bed.x1, bed.z1], [bed.x1, bed.z0],
      [(bed.x0 + bed.x1) / 2, (bed.z0 + bed.z1) / 2]] as const) {
      const centre = soil.vertices === base + 4;
      const shade = centre ? 0.94 : 0.56;
      soil.rawVertex([x, bed.y - (centre ? 0 : 0.012), z], [0, 1, 0], x, -z, [shade, shade, shade]);
    }
    for (let i = 0; i < 4; i++) soil.idx.push(base + i, base + (i + 1) % 4, base + 4);
  }

  for (const [cx, cz, degrees, length, width, bow] of islands) {
    const yaw = degrees * Math.PI / 180;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const point = (u: number, v: number, y = soilY - 0.04 * Math.hypot(u, v)): V3 => {
      const along = u * length;
      const across = (1 + 0.12 * u) * v * width + bow * (1 - u * u);
      return [cx + along * c - across * s, y, cz + along * s + across * c];
    };
    const soilVertex = (p: V3, shade: number) => soil.rawVertex(p, [0, 1, 0], p[0], p[2], [shade, shade, shade]);
    const centre = soilVertex(point(0, 0), 1);
    const count = Math.ceil(4.4 * length);
    const rim: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count;
      const end = (i + 1) * Math.PI * 2 / count;
      const p = point(Math.cos(a), Math.sin(a), 0.045);
      const q = point(Math.cos(end), Math.sin(end), 0.045);
      rim.push(soilVertex(p, 0.74));
      const dx = q[0] - p[0], dz = q[2] - p[2], chord = Math.hypot(dx, dz);
      const stone = 0.76 + rnd() * 0.17;
      edging.box([(p[0] + q[0]) / 2, 0.063, (p[2] + q[2]) / 2], [dx / chord, 0, dz / chord], [0, 1, 0],
        chord / 2 - 0.006, 0.063, 0.079, [stone, stone * 0.95, stone * 0.87], 1);
    }
    for (let i = 0; i < count; i++) soil.idx.push(centre, rim[(i + 1) % count]!, rim[i]!);

    // Stagger foliage, flowering cushions and blades across the width as well as along the bed.
    for (const u of [-0.67, -0.13, 0.54]) {
      const [x, y, z] = point(u, (rnd() - 0.5) * 0.55);
      const radius = 0.58 + 0.23 * rnd();
      bushes.push({ x, y, z, h: radius * (0.8 + rnd() * 0.35), r: radius, seed: 0.54 + 0.42 * rnd(), cards: [] });
    }
    for (const [u, v] of [[-0.41, -0.26], [0.21, 0.29], [0.77, -0.15]] as const) {
      const [x, y, z] = point(u, v);
      flowers.push({ kind: "box", x0: x - 0.53, x1: x + 0.53, z0: z - 0.44, z1: z + 0.44, y: y - 0.008, plant: "pot", out: null, soilProvided: true });
    }
    for (const [u, v] of [[-0.76, 0.31], [-0.51, 0.49], [-0.28, 0.53], [0.0, -0.52], [0.47, -0.46], [0.72, 0.38]] as const) {
      const [x, , z] = point(u, v);
      transform.position.set(x, 0.06, z);
      transform.rotation.y = rnd() * Math.PI * 2;
      const spread = 1.65 + 0.45 * rnd();
      transform.scale.set(spread, 0.87 + 0.36 * rnd(), spread);
      transform.updateMatrix();
      grasses.push(transform.matrix.clone());
    }
  }
  return { soil: soil.build(), edging: edging.build(), grasses, bushes, flowers };
}

// All park consumers use the same island outlines and plant positions.
let borders: ReturnType<typeof buildParkBorders> | undefined;
export const parkBorders = () => borders ??= buildParkBorders();

/** Three overlapping crowns follow the long axis of a raised trough. Small bedding pockets already form one crown. */
export function parkFlowerCrowns(beds: Array<Extract<Bed, { kind: "box" }>>) {
  return beds.flatMap(b => {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    if (Math.max(w, d) < 1.6 * Math.min(w, d)) return [b];
    const alongX = w > d;
    return [0.23, 0.5, 0.77].map((t, i) => {
      const cross = [0.46, 0.53, 0.48][i]!;
      const x = b.x0 + w * (alongX ? t : cross), z = b.z0 + d * (alongX ? cross : t);
      const hw = w * (alongX ? 0.2 : 0.38), hd = d * (alongX ? 0.38 : 0.2);
      return { ...b, x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd };
    });
  });
}
