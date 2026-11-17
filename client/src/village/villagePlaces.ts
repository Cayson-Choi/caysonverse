/**
 * The places named on the top-down map (UX 2026-11-16): an icon and a name over each, and the way a "여기로 가기" walks there.
 * Pure (no three.js, no React): the labels (MapPlaces.tsx) and the walk (mapWalk.ts) read it; villagePlaces.test.ts walks every
 * route with the click planner over the village's real colliders.
 *
 * A route is the way along the village's own paths (the plaza's paving, the lanes, the bus lane, the lake trail): a few
 * waypoints from the plaza out to the place. Each leg is walked as a click there would be (clickPlan.ts plans it, round what
 * is in the way); from somewhere else the walk first goes back along the route nearest the player to the plaza.
 */
import { VILLAGE_LAYOUT, type Point2, type SceneryHouse } from "@caysonverse/shared/village/villageLayout";
import { LAKE_RENTAL_PAD } from "@caysonverse/shared/village/lakeLayout";
import { VILLAGE_LOTS, lotDoorPoint, type LotId } from "@caysonverse/shared/village/villageLots";

export interface MapPlace {
  id: string;
  icon: string;
  name: string;
  /** Where the label sits on the map. */
  label: Point2;
  /** The way there from the plaza: waypoints, the last one the destination (a spot to stand on). */
  route: readonly Point2[];
}

const p = (x: number, z: number): Point2 => ({ x, z });

/** The plaza's hub: south of the fountain on the paving, where newcomers arrive (spawn). Every route starts from here. */
export const PLAZA_HUB = p(0, 15);

/** Out of the plaza toward the bus stop / café / lake (east), and the north lane to the memorial. */
const EAST_EXIT = [p(16, 12), p(30, 1.2)];
const BUS_LANE = [...EAST_EXIT, p(38.5, 1.2)];

/** Where to stand in front of a scenery house's door: 1.2 m beyond its footprint on the door side (its porch is walkable). */
export function houseFront(h: Pick<SceneryHouse, "centre" | "size" | "doorSide">, out = 1.2): Point2 {
  const { centre: c, size: s } = h;
  switch (h.doorSide) {
    case "n":
      return p(c.x, c.z - s.z / 2 - out);
    case "s":
      return p(c.x, c.z + s.z / 2 + out);
    case "e":
      return p(c.x + s.x / 2 + out, c.z);
    case "w":
      return p(c.x - s.x / 2 - out, c.z);
  }
}

/**
 * The way from the plaza's paving to each house: out on the side the house is, round the ring road, up to its door. The houses
 * stand between the ring road's sidewalk (r 39) and the plots, doors toward the road.
 */
const HOUSE_WAYS: Readonly<Record<string, readonly Point2[]>> = {
  house_1: [p(10, -20), p(21, -32)],
  house_2: [p(-10, -20), p(-21, -32)],
  house_3: [p(14, 20), p(29, 29)],
  house_4: [p(-14, 20), p(-31.6, 31)],
  house_5: [p(-20, 8), p(-35, 6), p(-40, -8)],
  house_6: [p(14, 20), p(30, 30), p(42, 34)],
  house_7: [p(10, -20), p(25, -38), p(31, -47)],
  house_8: [p(-14, 20), p(-38, 34), p(-43, 40)],
  house_9: [p(-10, -20), p(-25, -38), p(-31, -47)],
  house_10: [p(-14, 20), p(-34, 27)],
};

function houses(): MapPlace[] {
  return VILLAGE_LAYOUT.sceneryHouses
    .filter((h) => h.kind === "house")
    .map((h) => {
      const n = Number(h.id.replace("house_", ""));
      const front = houseFront(h);
      return { id: h.id, icon: "🏠", name: `${n}번 집`, label: h.centre, route: [...(HOUSE_WAYS[h.id] ?? []), front] };
    });
}

const cafe = VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === "cafe")!;
const memorial = VILLAGE_LAYOUT.memorial.exterior;
const stop = VILLAGE_LAYOUT.busStop.shelter.centre;

/** The waterfall becomes a place once it is inside the walkable village (release 2): until then it has no label. */
function waterfallPlace(): MapPlace[] {
  const w = VILLAGE_LAYOUT.backdrop.waterfall.centre;
  const b = VILLAGE_LAYOUT.areas.village;
  if (w.x < b.minX || w.x > b.maxX || w.z < b.minZ || w.z > b.maxZ) return [];
  return [{ id: "waterfall", icon: "💧", name: "폭포", label: w, route: [w] }];
}

/**
 * The lot buildings (lots v2): the label on the building, the way to just outside its door (the door's arrival spot, where the way out
 * puts a visitor: the button and E are there). 케이슨랜드's gate: to the plaza in front of it.
 */
const LOT_PLACES: ReadonlyArray<{ lot: LotId; icon: string; name: string; way: readonly Point2[] }> = [
  { lot: "lot_school", icon: "🏫", name: "학교", way: [p(16, 12), p(30, 1.2), p(44, 4), p(50, 15)] },
  { lot: "lot_chapel", icon: "⛪", name: "성당", way: [p(10, -20), p(25, -30), p(33, -37)] },
  { lot: "lot_library", icon: "📚", name: "도서관", way: [p(-20, 8), p(-35, 6), p(-44, 12)] },
  { lot: "lot_temple", icon: "🪷", name: "절", way: [p(-10, -20), p(-25, -30), p(-36, -36), p(-48, -34.6)] }, // (round the 석등 on the door's axis)
  { lot: "lot_church", icon: "🔔", name: "교회", way: [p(0, 30), p(0, 44)] },
  { lot: "lot_gate", icon: "🎡", name: "케이슨랜드", way: [p(-14, 20), p(-20, 40), p(-24, 70)] },
];

function lotPlaces(): MapPlace[] {
  return LOT_PLACES.map(({ lot, icon, name, way }) => {
    const l = VILLAGE_LOTS.find((x) => x.id === lot)!;
    const a = lotDoorPoint(l, l.doors[0]!).arrival;
    return { id: lot, icon, name, label: l.centre, route: [...way, p(a.x, a.z)] };
  });
}

/** In the order a crowded map keeps their names (MapPlaces.tsx): the places one goes to first, the plaza (where one usually is), the houses. */
export const MAP_PLACES: readonly MapPlace[] = Object.freeze([
  {
    id: "memorial",
    icon: "🕯️",
    name: "추모관",
    label: memorial.centre,
    // up the north lane (x 0) to just short of the door's pad: the door is opened with E / the button there
    route: [p(-8, 4), p(-14, -14), p(0, -32), p(memorial.arrival.x, memorial.arrival.z + 0.6)],
  },
  { id: "busstop", icon: "🚏", name: "버스정류장", label: stop, route: [...BUS_LANE, p(38.6, -3.6)] },
  { id: "cafe", icon: "☕", name: "카페", label: cafe.centre, route: [...EAST_EXIT, p(33, -8), p(36.5, -15)] },
  {
    id: "lake",
    icon: "🎣",
    name: "케이슨 낚시터",
    label: p(LAKE_RENTAL_PAD.x + 8, LAKE_RENTAL_PAD.z - 8),
    // the bus lane, then the trail (lakeLayout LAKE_TRAIL) to the office's rental pad
    route: [...BUS_LANE, p(52, 0.2), p(66, -6), p(80, -9), p(95.5, -10), p(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z + 2.2)],
  },
  { id: "plaza", icon: "⛲", name: "광장", label: p(0, -7), route: [PLAZA_HUB] },
  ...lotPlaces(),
  ...waterfallPlace(),
  ...houses(),
]);

export function mapPlace(id: string): MapPlace | undefined {
  return MAP_PLACES.find((m) => m.id === id);
}

/** Distance from (x, z) to the segment a-b, and how far along it (0..1) the nearest point is. */
function toSegment(x: number, z: number, a: Point2, b: Point2): { d: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return { d: Math.hypot(a.x + dx * t - x, a.z + dz * t - z), t };
}

/** Within this distance (m) of the plaza's centre the player is on the plaza: the route is walked from its start. */
export const ON_PLAZA_M = 30;
/** Within this distance (m) of a route the player is on it: the walk goes along it, not back across the fields. */
const ON_ROUTE_M = 9;

/**
 * The waypoints from (x, z) to `place`: on the plaza, its route; on another place's way (a lane, the trail), back along
 * that way to the plaza first (or straight on, if it is the same way); elsewhere, from the plaza's hub. Waypoints already
 * behind the player (nearer the start than where they stand on the way) are left out.
 */
export function wayTo(place: MapPlace, x: number, z: number): Point2[] {
  const full = [PLAZA_HUB, ...place.route];
  // where on the target's own way the player is (its nearest segment)
  const along = nearestOn(full, x, z);
  if (along && along.d <= ON_ROUTE_M) return full.slice(along.seg + 1);
  if (Math.hypot(x, z) <= ON_PLAZA_M) return place.route.slice();
  // on another place's way: back along it to the hub, then out
  let back: Point2[] | null = null;
  let bestD = ON_ROUTE_M;
  for (const other of MAP_PLACES) {
    const way = [PLAZA_HUB, ...other.route];
    const at = nearestOn(way, x, z);
    if (at && at.d <= bestD) {
      bestD = at.d;
      back = way.slice(0, at.seg + 1).reverse();
    }
  }
  return [...(back ?? [PLAZA_HUB]), ...place.route];
}

function nearestOn(way: readonly Point2[], x: number, z: number): { seg: number; d: number } | null {
  let best: { seg: number; d: number } | null = null;
  for (let i = 0; i + 1 < way.length; i++) {
    const s = toSegment(x, z, way[i]!, way[i + 1]!);
    if (!best || s.d < best.d) best = { seg: i, d: s.d };
  }
  return best;
}
