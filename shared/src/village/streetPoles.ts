/**
 * The village's street lamps and banner (flag) poles as solid colliders (owner 2026-11-15: "가로등은 통과를 해버리네
 * 깃발기둥도 통과를 해버리고"). The Blender village model has no collision boxes for them, so their spots are computed here
 * from the layout exactly as art/village/tools/parts_props.py does (lamp_positions(), banners()), and a square box round each
 * base is added to the map's obstacles next to the signal poles (villageLayout.ts buildVillageGeometry).
 * server/src/tools/villageProps.test.ts reads village.glb and checks every pole's base sits inside its collider.
 */

import type { AABB } from "../collision";
import type { VillageLayout } from "./villageLayout";

/** Half the side (m) of a lamp's collider: its base is a 0.17 m radius disc (parts_props.py lamp()). */
export const LAMP_COLLIDER_HALF = 0.2;
/** Half the side (m) of a banner pole's collider: its base is a 0.12 m radius disc (parts_props.py banners()). */
export const BANNER_COLLIDER_HALF = 0.15;

/** The ring lamps' radius (m): on the outer sidewalk. */
export const RING_LAMP_RADIUS = 38.4;
/** The banner poles' circle radius (m) round the plaza and their angles (deg, atan2(z, x)). */
export const BANNER_RADIUS = 26;
export const BANNER_ANGLES_DEG: readonly number[] = [-100, -80, -50, -20, 30, 55, 125, 150];

export interface PoleSpot {
  x: number;
  z: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Every street lamp's base (plaza lamps, then the ring road's, skipping the lanes' crossings and the bus stop). */
export function lampSpots(layout: Pick<VillageLayout, "plaza" | "lanes">): PoleSpot[] {
  const pts: PoleSpot[] = layout.plaza.lamps.map((p) => ({ x: p.x, z: p.z }));
  const laneAngles: number[] = [];
  for (const lane of layout.lanes) {
    const a = lane.points[0]!;
    laneAngles.push(Math.atan2(a.z, a.x));
    if (lane.points.length > 1) {
      const b = lane.points[1]!;
      laneAngles.push(Math.atan2(b.z, b.x));
    }
  }
  const limit = (7 * Math.PI) / 180;
  for (let k = 0; k < 18; k++) {
    const a = (2 * Math.PI * (k + 0.5)) / 18;
    if (laneAngles.some((la) => Math.abs(wrap(a - la)) < limit)) continue;
    const x = RING_LAMP_RADIUS * Math.cos(a);
    const z = RING_LAMP_RADIUS * Math.sin(a);
    if (Math.abs(x - 38) < 3 && z > -11 && z < -1) continue;
    pts.push({ x, z });
  }
  return pts;
}

/** The banner (flag) poles' bases. */
export function bannerSpots(): PoleSpot[] {
  return BANNER_ANGLES_DEG.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: BANNER_RADIUS * Math.cos(a), z: BANNER_RADIUS * Math.sin(a) };
  });
}

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const boxAt = (s: PoleSpot, h: number): AABB => ({ minX: r6(s.x - h), maxX: r6(s.x + h), minZ: r6(s.z - h), maxZ: r6(s.z + h) });

/** A solid box round every lamp and banner pole (obstacles only: no camera box, the camera passes a thin pole). */
export function streetPoleColliders(layout: Pick<VillageLayout, "plaza" | "lanes">): AABB[] {
  return [...lampSpots(layout).map((s) => boxAt(s, LAMP_COLLIDER_HALF)), ...bannerSpots().map((s) => boxAt(s, BANNER_COLLIDER_HALF))];
}
