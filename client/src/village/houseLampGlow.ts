import { BufferAttribute, type BufferGeometry, type Mesh, type Vector3 } from "three";
import { mirrorClusters } from "./houseMirror";

/**
 * Lamp shades that read as switched on at night (owner 2026-11-21: the house-5 floor lamp was a flat cream cone). The kit puts every shade
 * of a floor in one mesh; this finds each shade (a connected piece), gives its vertices `glowT` (0 at the rim, 1 at the top: the shade
 * shader, houseNight.ts, is brightest at the rim where the bulb shines through) and lists the floor lamps (the wide shades) so the house
 * can lay a soft warm pool of light under each (HouseInterior.tsx `LampPools`, no extra lights).
 */
export interface HouseLamp {
  x: number;
  z: number;
  /** Shade width and its rim / top heights (world). */
  w: number;
  y0: number;
  y1: number;
  /** A floor lamp (the wide shade on a pole), not a table lamp or a wall light. */
  floor: boolean;
}

/** Shades at least this wide whose rim is this high above the floor are floor lamps (kit: 0.34 wide, rim 1.28 m). */
const FLOOR_LAMP_MIN_WIDTH = 0.3;
const FLOOR_LAMP_MIN_RIM = 1.2;

/** Whether `name` is a lamp shade's material. */
export function isLampShadeMaterial(name: string): boolean {
  return name === "M_shade" || name === "E_H_shade";
}

/** Add `glowT` to a shade mesh's geometry (once) and return its shades. */
export function prepareShadeMesh(mesh: Mesh, v: Vector3): HouseLamp[] {
  const g: BufferGeometry = mesh.geometry;
  const pos = g.getAttribute("position");
  mesh.updateWorldMatrix(true, false);
  const t = new Float32Array(pos.count);
  const out: HouseLamp[] = [];
  for (const tri of mirrorClusters(g)) {
    let y0 = Infinity;
    let y1 = -Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const i of tri) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      z0 = Math.min(z0, v.z);
      z1 = Math.max(z1, v.z);
    }
    for (const i of tri) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      t[i] = y1 > y0 ? (v.y - y0) / (y1 - y0) : 0;
    }
    const w = Math.max(x1 - x0, z1 - z0);
    out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w, y0, y1, floor: w >= FLOOR_LAMP_MIN_WIDTH && y0 >= FLOOR_LAMP_MIN_RIM });
  }
  g.setAttribute("glowT", new BufferAttribute(t, 1));
  return out;
}
