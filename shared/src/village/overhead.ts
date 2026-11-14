/**
 * What is over a player's head, for the jump (owner, 2026-11-13: "정류장 건물 안에서 점프하면 천장으로 머리가 뚫고 나와").
 * A jump is a display-only hop (client/src/game/jump.ts): the avatar's group is lifted by a parabola with a 1 m apex. Under a
 * roof that apex put the head through it. `jumpHeadroom` says how far the avatar can rise from where it stands: the gap
 * between the avatar's top (its own, `avatarTop`; hats count) and the lowest roof or ceiling over that spot. The client
 * clamps the hop with it (`jumpOffsetY`, softly); the open village has no roof: infinite headroom, jumps unchanged.
 *
 * The roofs the game knows: the bus shelter's (`BUS_SHELTER_ROOF`, villageLayout.ts, also a camera slab), the memorial
 * hall's drawn ceiling and the private houses' (`wallHeight`: the whole area is under it). The café's awnings, the porch
 * roofs and parasols are baked scenery with no collider or volume of their own: they have no headroom to clamp to.
 */

import type { AABB } from "../collision";
import { BUS_SHELTER_ROOF, VILLAGE_LAYOUT, isHouseArea, type AreaId, type VillageLayout } from "./villageLayout";
import { HOUSE_INTERIOR_LAYOUTS } from "./houseInterior";

/**
 * An avatar's top (m above its feet) when the caller does not know the real one: a bare head is 2.18 m (the client
 * measures each avatar's own, hats included: BuiltAvatar.topY; the beanie 2.48, the space helmet 2.46, the wizard hat 2.69).
 */
export const AVATAR_TOP_M = 2.2;
/** Air (m) the clamped head keeps under the roof's underside. */
export const HEAD_CLEARANCE_M = 0.03;
/** The memorial hall's drawn ceiling (m): the camera's slab sits higher (4.4) but the plaster is at 3.4 (villageLayout.ts HALL_CEILING_DROP). */
export const HALL_DRAWN_CEILING_M = 3.4;
/** How far (m) past a roof's edge the head still counts as under it (the avatar's radius less the hat's slack). */
export const ROOF_EDGE_MARGIN_M = 0.2;
/** Headroom grows this much (m) per metre walked out from under a roof's edge, so a hop in the air eases free of it. */
export const HEADROOM_FEATHER = 3;

/** Headroom beyond this (m) is the open sky: no clamp at all. */
export const OPEN_AIR_M = 10;

/** A roof or ceiling over part of the village area. */
export interface OverheadVolume {
  id: string;
  /** The ground it covers (x, z). */
  box: AABB;
  /** The height of its underside (m above the floor). */
  underside: number;
}

/** The roofs of the open village that a player can stand under. */
export function villageOverheads(layout: Pick<VillageLayout, "busStop"> = VILLAGE_LAYOUT): readonly OverheadVolume[] {
  const c = layout.busStop.shelter.centre;
  const r = BUS_SHELTER_ROOF;
  return [{ id: "bus_shelter_roof", box: { minX: c.x - r.halfX, maxX: c.x + r.halfX, minZ: c.z - r.halfZ, maxZ: c.z + r.halfZ }, underside: r.underside }];
}

const distanceTo = (b: AABB, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

/** The height (m) of the lowest roof or ceiling over (x, z) in `area`, with the edge margin; Infinity in the open. */
export function ceilingAbove(x: number, z: number, area: AreaId, layout: Pick<VillageLayout, "busStop"> = VILLAGE_LAYOUT): number {
  if (area === "hall") return HALL_DRAWN_CEILING_M;
  if (isHouseArea(area)) {
    const house = HOUSE_INTERIOR_LAYOUTS[area.slice("house:".length)];
    return house ? house.wallHeight : Infinity;
  }
  let low = Infinity;
  for (const v of villageOverheads(layout)) if (distanceTo(v.box, x, z) <= ROOF_EDGE_MARGIN_M && v.underside < low) low = v.underside;
  return low;
}

/**
 * How high (m) an avatar standing at (x, z) may rise before its head meets a roof: 0..Infinity. Eased over the roof's edge
 * (`HEADROOM_FEATHER`): outside the roof's margin it grows with the distance, so it never jumps as a hopper walks out.
 */
export function jumpHeadroom(x: number, z: number, area: AreaId, avatarTop: number = AVATAR_TOP_M, layout: Pick<VillageLayout, "busStop"> = VILLAGE_LAYOUT): number {
  if (area === "hall") return Math.max(0, HALL_DRAWN_CEILING_M - avatarTop - HEAD_CLEARANCE_M);
  if (isHouseArea(area)) return Math.max(0, ceilingAbove(x, z, area, layout) - avatarTop - HEAD_CLEARANCE_M);
  let room = Infinity;
  for (const v of villageOverheads(layout)) {
    const d = distanceTo(v.box, x, z);
    const here = Math.max(0, v.underside - avatarTop - HEAD_CLEARANCE_M) + HEADROOM_FEATHER * Math.max(0, d - ROOF_EDGE_MARGIN_M);
    if (here < room) room = here;
  }
  return room > OPEN_AIR_M ? Infinity : room;
}
