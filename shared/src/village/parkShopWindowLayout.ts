import type { ParkShop } from "./parkArea";

export interface ShopWindow {
  /** Centre of the opening on the plaster face and its outward normal. */
  x: number;
  z: number;
  out: [number, 0, number];
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
