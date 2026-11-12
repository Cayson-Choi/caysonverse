import { VILLAGE_LAYOUT } from "./villageLayout";

export type HouseInteriorId = (typeof HOUSE_INTERIOR_IDS)[number];
export type HouseFurnitureKind = "sofa" | "table" | "bed" | "desk" | "wardrobe" | "plant" | "lamp";

export interface HouseFurniture {
  kind: HouseFurnitureKind;
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  height: number;
}

export interface HouseSeat {
  id: string;
  x: number;
  z: number;
  yaw: number;
  seatY: number;
}

export interface HouseInteriorLayout {
  buildingId: HouseInteriorId;
  variant: "pink" | "skyblue" | "yellow" | "white" | "mint";
  width: number;
  depth: number;
  wallHeight: number;
  secondFloorY: number;
  stairX: number;
  stairZ: number;
  furniture: readonly HouseFurniture[];
  seats: readonly HouseSeat[];
}

/** The ten private houses in B layout; public buildings never get keypad interiors. */
export const HOUSE_INTERIOR_IDS = Object.freeze(
  VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house").map((h) => h.id),
) as readonly string[];

const VARIANTS = ["pink", "skyblue", "yellow", "white", "mint"] as const;
const TAU = Math.PI * 2;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Deterministic, low-poly interior dressing for a house. All positions are local to the house interior origin;
 * the client may place that origin in a separate area/instance for each building. Every variant has a different
 * furniture arrangement while retaining the same collision-friendly footprint and a real stair run to floor two.
 */
export function houseInteriorLayout(buildingId: string): HouseInteriorLayout {
  const index = Math.max(0, HOUSE_INTERIOR_IDS.indexOf(buildingId));
  const id = HOUSE_INTERIOR_IDS[index] ?? HOUSE_INTERIOR_IDS[0]!;
  const variant = VARIANTS[index % VARIANTS.length]!;
  const flip = index % 2 === 1 ? -1 : 1;
  const turn = (index % 4) * (Math.PI / 2);
  const furniture: HouseFurniture[] = [
    { kind: "sofa", x: -2.45 * flip, z: 1.85, yaw: 0, width: 2.8, depth: 0.78, height: 0.78 },
    { kind: "table", x: 0.55 * flip, z: 0.7, yaw: turn, width: 1.35, depth: 0.9, height: 0.72 },
    { kind: "bed", x: 2.35 * flip, z: -1.9, yaw: Math.PI / 2, width: 1.65, depth: 2.05, height: 0.58 },
    { kind: "wardrobe", x: -2.85 * flip, z: -2.05, yaw: 0, width: 1.15, depth: 0.52, height: 2.05 },
    { kind: "desk", x: 0.15 * flip, z: -2.55, yaw: Math.PI, width: 1.25, depth: 0.56, height: 0.75 },
    { kind: "plant", x: 3.05 * flip, z: 2.25, yaw: 0, width: 0.38, depth: 0.38, height: 1.25 },
    { kind: "lamp", x: -0.45 * flip, z: 2.55, yaw: 0, width: 0.24, depth: 0.24, height: 1.55 },
  ];
  const seats: HouseSeat[] = [
    { id: `${id}:sofa:0`, x: -2.45 * flip - 0.65 * flip, z: 1.85, yaw: Math.PI / 2 * flip, seatY: 0.48 },
    { id: `${id}:sofa:1`, x: -2.45 * flip + 0.65 * flip, z: 1.85, yaw: Math.PI / 2 * flip, seatY: 0.48 },
    { id: `${id}:table:0`, x: 0.55 * flip, z: 0.7 + 0.82, yaw: Math.PI, seatY: 0.46 },
    { id: `${id}:table:1`, x: 0.55 * flip, z: 0.7 - 0.82, yaw: 0, seatY: 0.46 },
  ];
  return {
    buildingId: id as HouseInteriorId,
    variant,
    width: 8.4,
    depth: 6.6,
    wallHeight: 3.2,
    secondFloorY: 3.2,
    stairX: 2.9 * flip,
    stairZ: 0.25,
    furniture: furniture.map((f) => ({ ...f, x: round(f.x), z: round(f.z), yaw: round(f.yaw % TAU) })),
    seats: seats.map((s) => ({ ...s, x: round(s.x), z: round(s.z), yaw: round(s.yaw % TAU) })),
  };
}

export const HOUSE_INTERIOR_LAYOUTS: Readonly<Record<string, HouseInteriorLayout>> = Object.freeze(
  Object.fromEntries(HOUSE_INTERIOR_IDS.map((id) => [id, houseInteriorLayout(id)])),
);
