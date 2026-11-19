import { Matrix4, Object3D } from "three";
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

export function buildParkBorders() {
  const soil = new GeoBuilder();
  const edging = new GeoBuilder();
  const grasses: Matrix4[] = [];
  const bushes: Bush[] = [];
  const flowers: Array<Extract<Bed, { kind: "box" }>> = [];
  const transform = new Object3D();
  const rnd = mulberry32(612);

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
