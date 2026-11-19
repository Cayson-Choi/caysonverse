import { PARK_SHOPS, type ParkShop } from "@caysonverse/shared/village/parkArea";
import type { Bed } from "../village/veg/flowerPlacement";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { addLathe } from "./parkShapes";

export interface ShopWindow {
  /** Centre of the opening on the plaster face and its outward normal. */
  x: number;
  z: number;
  out: V3;
  front: boolean;
}

export function shopWindows(s: ParkShop): ShopWindow[] {
  const end = s.w / 2;
  const face = s.x + s.faces * s.d / 2;
  const back = s.x - s.faces * s.d / 2;
  return [
    ...[end - 4.6, end - 1.55].map((offset): ShopWindow => ({ x: face, z: s.z + offset, out: [s.faces, 0, 0], front: true })),
    ...[-1, 1].map((side): ShopWindow => ({ x: back, z: s.z + side * end * 0.55, out: [-s.faces, 0, 0], front: false })),
    ...[-1, 1].map((side): ShopWindow => ({ x: s.x, z: s.z + side * end, out: [0, 0, side], front: false })),
  ];
}

/** The sill overhangs the box's back edge. Roots are in the exposed soil, below its lip. */
export const WINDOW_BOX = { offset: 0.62, soilY: 1.335, depth: 0.32, width: 1.65, side: 0.045 } as const;

export function windowBed(w: ShopWindow): Extract<Bed, { kind: "box" }> {
  const { offset, depth, width, side, soilY } = WINDOW_BOX;
  const cx = w.x + w.out[0] * offset;
  const cz = w.z + w.out[2] * offset;
  const hx = (w.out[0] ? depth : width) / 2 - side - 0.025;
  const hz = (w.out[2] ? depth : width) / 2 - side - 0.025;
  return { kind: "box", x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz, y: soilY, plant: "window", out: [w.out[0], w.out[2]], soilProvided: true };
}

export const SHOP_WINDOW_BEDS = PARK_SHOPS.flatMap(s => shopWindows(s).map(windowBed));

type WindowPoint = (forward: number, y: number, across: number) => V3;
const Y: V3 = [0, 1, 0];

function curtains(cloth: GeoBuilder, at: WindowPoint, face: V3): void {
  for (const side of [-1, 1]) {
    const start = cloth.vertices;
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      const phase = t * Math.PI * 5;
      const pleat = Math.cos(phase);
      const shade = 0.8 + 0.15 * pleat;
      const color: V3 = [0.90 * shade, 0.77 * shade, 0.60 * shade];
      for (const top of [false, true]) {
        const y = top ? 2.72 : 1.99 + 0.12 * t + 0.025 * pleat;
        const across = side * (0.705 - t * (top ? 0.43 : 0.24));
        cloth.rawVertex(at(0.30 + 0.026 * pleat, y, across), face, t, Number(top), color);
      }
      if (i > 0) {
        const j = start + 2 * i;
        cloth.idx.push(j - 2, j - 1, j, j, j - 1, j + 1);
      }
    }
  }
}

function shopDisplay(goods: GeoBuilder, id: string, at: WindowPoint, face: V3): void {
  for (const [index, lateral] of [-0.42, 0.08, 0.40].entries()) {
    const [x, y, z] = at(0.345, 1.78, lateral);
    if (id === "photo") {
      goods.box([x, y + 0.075, z], face, Y, 0.055, 0.075, 0.102, [0.085, 0.076, 0.064]);
      goods.cylinder(at(0.39, y + 0.08, lateral), at(0.445, y + 0.08, lateral), 0.047, 0.051, 10, [0.22, 0.23, 0.21], true);
    } else if (id === "bakery") {
      addLathe(goods, x, z, [[0.076, 0], [0.105, 0.024], [0.09, 0.077], [0.046, 0.106], [0, 0.112]], [0.64, 0.32 + index * 0.026, 0.105], 1, 10, y);
    } else {
      // Turned wooden tops at the toy shop and lidded ceramic canisters at the others.
      const profile: [number, number][] = id === "toys"
        ? [[0.016, 0], [0.086, 0.072], [0.069, 0.10], [0.018, 0.118], [0.014, 0.158], [0, 0.158]]
        : [[0.050, 0], [0.076, 0.024], [0.075, 0.12], [0.054, 0.15], [0.063, 0.16], [0.025, 0.18], [0, 0.20]];
      const colors: V3[] = [[0.29, 0.41, 0.31], [0.54, 0.22, 0.12], [0.72, 0.61, 0.42]];
      addLathe(goods, x, z, profile, colors[index]!, 1, 10, y);
    }
  }
}

export function addShopWindow(w: ShopWindow, id: string, wood: GeoBuilder, cloth: GeoBuilder, glass: GeoBuilder, shutter: V3): void {
  const f = w.out;
  const at: WindowPoint = (d, y, l) => [w.x + f[0] * d - f[2] * l, y, w.z + f[2] * d + f[0] * l];
  const frame: V3 = [0.92, 0.88, 0.76];
  // A projecting casement. Even the wall's widest timber (0.21 m) sits behind the lining.
  wood.box(at(0.22, 2.10, 0), f, Y, 0.014, 0.665, 0.745, [0.16, 0.122, 0.09], 1);
  for (const side of [-1, 1]) {
    wood.box(at(0.28, 2.10, side * 0.752), f, Y, 0.213, 0.70, 0.045, frame, 1);
    wood.box(at(0.28, 2.10 + side * 0.666, 0), f, Y, 0.213, 0.047, 0.715, frame, 1);
    // The open shutters have a recessed panel and inclined louvres between the stiles.
    const l = side * 1.15;
    wood.box(at(0.145, 2.10, l), f, Y, 0.042, 0.70, 0.302, shutter, 1);
    const tilt = 0.38;
    const bladeNormal: V3 = [f[0] * Math.cos(tilt), Math.sin(tilt), f[2] * Math.cos(tilt)];
    const bladeUp: V3 = [-f[0] * Math.sin(tilt), Math.cos(tilt), -f[2] * Math.sin(tilt)];
    for (let i = -3; i <= 3; i++) wood.box(at(0.207, 2.10 + i * 0.166, l), bladeNormal, bladeUp, 0.014, 0.086, 0.249, shutter, 1);
  }
  curtains(cloth, at, f);
  if (w.front) {
    wood.box(at(0.35, 1.748, 0), f, Y, 0.115, 0.032, 0.705, [0.52, 0.34, 0.21], 1);
    shopDisplay(cloth, id, at, f);
  }
  // One outward-facing pane. Interior display, recess, mullion and sill are at distinct depths.
  const p = glass.vertices;
  for (const [l, y] of [[-0.712, 1.47], [-0.712, 2.73], [0.712, 2.73], [0.712, 1.47]] as const) {
    glass.rawVertex(at(0.477, y, l), f, l, y, [1, 1, 1]);
  }
  glass.idx.push(p, p + 1, p + 2, p, p + 2, p + 3);
  wood.box(at(0.488, 2.10, 0), f, Y, 0.025, 0.628, 0.021, frame, 1);
  wood.box(at(0.49, 2.14, 0), f, Y, 0.026, 0.023, 0.713, frame, 1);
  wood.box(at(0.275, 1.405, 0), f, Y, 0.257, 0.045, 0.865, frame, 1);

  const { depth, width, side, offset, soilY } = WINDOW_BOX;
  const timber: V3 = [0.52, 0.315, 0.182];
  for (const dir of [-1, 1]) {
    wood.box(at(offset + dir * (depth - side) / 2, 1.235, 0), f, Y, side / 2, 0.128, width / 2, timber, 1);
    wood.box(at(offset, 1.235, dir * (width - side) / 2), f, Y, depth / 2 - side, 0.128, side / 2, timber, 1);
    wood.box(at(0.42, 1.082, dir * 0.53), f, Y, 0.34, 0.025, 0.03, [0.11, 0.10, 0.08], 1);
    wood.cylinder(at(0.11, 0.83, dir * 0.53), at(0.66, 1.063, dir * 0.53), 0.021, 0.021, 5, [0.11, 0.10, 0.08]);
  }
  wood.box(at(offset, 1.12, 0), f, Y, depth / 2 - side, 0.012, width / 2 - side, timber, 1);
  // Damp compost under the plants. A low ridge breaks up the surface inside the wood lip.
  const soil = cloth.vertices;
  for (let i = 0; i <= 12; i++) {
    const l = (i / 12 - 0.5) * (width - 2 * side);
    for (const row of [-1, 0, 1]) {
      const grain = 0.5 + 0.5 * Math.sin(i * 45.87 + row * 13 + w.z);
      const rise = row === 0 ? 0.01 + 0.009 * grain : 0;
      cloth.rawVertex(at(offset + row * (depth / 2 - side), soilY + rise, l), Y, l, row, [0.068 + grain * 0.03, 0.033 + grain * 0.018, 0.017 + grain * 0.009]);
    }
    if (i > 0) for (let j = 0; j < 2; j++) {
      const a = soil + (i - 1) * 3 + j;
      cloth.idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  }
}
