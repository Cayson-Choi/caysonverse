import { VILLAGE_LAYOUT, cubbyAnchors, type AreaId, type CubbyAnchor, type Disc, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { GUIDE_ASK_LABEL, nearestGuide } from "@caysonverse/shared/village/guides";
import type { InteractTarget } from "../game/interact";

/**
 * What the village offers at a spot (케이슨 마을, Task 4) — pure: the scene hands it the local area and pose at
 * the context button's ~5 Hz pass and gets back the targets for the button and the E key. Today there is one
 * door, the memorial hall's, with two sides: "추모관 들어가기" outside, "밖으로 나가기" inside. Pressing it sends
 * `VillageMsg.UseDoor`; the server decides (villageDoor.ts) and teleports.
 *
 * The server accepts a door within the pad's radius plus 0.9 m of its centre. This offers it a little less
 * (`DOOR_OFFER_REACH_M`): our pose runs a few centimetres ahead of the one the server knows, so a button shown at
 * the very edge could be pressed just outside what the server accepts and be dropped without a word. Both
 * arrival points (the way out lands 2.2 m from the outside pad's centre, the way in 1.6 m from the inside one)
 * are still inside, so the button comes back after a door — a second press is possible once the server's
 * one-per-second cap has passed, which is fine.
 *
 * Inside the hall (Task 9) the cubbies are offered too: within `CUBBY_REACH_M` of a cubby column (the seven cubbies of a
 * column share one spot on the floor), "가까이 보기" opens the close-up card on that column (CubbyView). The nearest
 * column wins; the door outranks a cubby (priority), though the two are never within reach of the same spot.
 */

export const DOOR_LABEL: Readonly<Record<AreaId, string>> = { village: "추모관 들어가기", hall: "밖으로 나가기" };
/** The word for the 60 px round touch button. */
export const DOOR_SHORT: Readonly<Record<AreaId, string>> = { village: "들어가기", hall: "나가기" };
/** The target id of the memorial hall's door (both sides). */
export const MEMORIAL_DOOR_ID = "memorial_door";

/** The bus target uses the same server-side 4.5 m gate, with a small client cushion. */
export const BUS_OFFER_REACH_M = 4.2;
export const BUS_RIDE_TARGET_BOARD = "village_bus_board";
export const BUS_RIDE_TARGET_LEAVE = "village_bus_leave";

/** How far past the pad's radius the button is offered (m). The server's own reach is 0.9 (villageDoor.ts DOOR_REACH_M). */
export const DOOR_OFFER_REACH_M = 0.7;

const NONE: readonly InteractTarget[] = Object.freeze([]);

/** The door pad a player in `area` uses: the building's front door outside, the way out inside. */
export function doorPadFor(area: AreaId, layout: VillageLayout = VILLAGE_LAYOUT): Disc {
  return area === "village" ? layout.memorial.exterior.doorPad : layout.memorial.interior.doorPad;
}

export function villageTargets(
  area: AreaId,
  x: number,
  z: number,
  layout: VillageLayout = VILLAGE_LAYOUT,
): readonly InteractTarget[] {
  const pad = doorPadFor(area, layout);
  const dist = Math.hypot(x - pad.centre.x, z - pad.centre.z);
  if (!(dist <= pad.radius + DOOR_OFFER_REACH_M)) return NONE; // also false for NaN
  return [{ kind: "door", id: MEMORIAL_DOOR_ID, dist, icon: "🚪", label: DOOR_LABEL[area], short: DOOR_SHORT[area] }];
}

/** A board/leave target around the east-side stop; the server re-checks the pose and schedule. */
export function villageBusTarget(area: AreaId, x: number, z: number, boarded: boolean): InteractTarget | null {
  if (area !== "village") return null;
  const dist = Math.hypot(x - VILLAGE_LAYOUT.busStop.bus.centre.x, z - VILLAGE_LAYOUT.busStop.bus.centre.z);
  if (!(dist <= BUS_OFFER_REACH_M)) return null;
  return {
    kind: "object",
    id: boarded ? BUS_RIDE_TARGET_LEAVE : BUS_RIDE_TARGET_BOARD,
    dist,
    icon: "🚌",
    label: boarded ? "버스에서 내리기" : "버스 타기",
    short: boarded ? "하차" : "탑승",
    priority: 2,
  };
}

/** How near (m, on the ground) to a cubby column its close-up is offered (brief: 1.2 m). The server lets a candle be lit from 1.5 m. */
export const CUBBY_REACH_M = 1.2;
/** The target id prefix of a cubby column: `cubby:<wall>_<col>`. */
export const CUBBY_TARGET_PREFIX = "cubby:";
export const CUBBY_LABEL = "가까이 보기";
export const CUBBY_SHORT = "보기";

/** A column of cubbies: its wall and column, where it stands on the floor (the anchors' x, z) and its rows' anchors (bottom first). */
export interface CubbyColumn {
  key: string;
  wall: CubbyAnchor["wall"];
  col: number;
  x: number;
  z: number;
  rows: readonly CubbyAnchor[];
}

/** The hall's cubby columns (`<wall>_<col>`), built from the layout's anchors. */
export function cubbyColumns(layout: VillageLayout = VILLAGE_LAYOUT): CubbyColumn[] {
  const byKey = new Map<string, CubbyAnchor[]>();
  for (const a of cubbyAnchors(layout)) {
    const key = `${a.wall}_${a.col}`;
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(a);
  }
  return [...byKey.entries()].map(([key, rows]) => {
    rows.sort((a, b) => a.row - b.row);
    return { key, wall: rows[0]!.wall, col: rows[0]!.col, x: rows[0]!.x, z: rows[0]!.z, rows };
  });
}

const COLUMNS: readonly CubbyColumn[] = cubbyColumns();
const COLUMN_BY_KEY: ReadonlyMap<string, CubbyColumn> = new Map(COLUMNS.map((c) => [c.key, c]));

/** The column of a key (`n_10`) or a target id (`cubby:n_10`), or null. */
export function cubbyColumn(keyOrId: string): CubbyColumn | null {
  const key = keyOrId.startsWith(CUBBY_TARGET_PREFIX) ? keyOrId.slice(CUBBY_TARGET_PREFIX.length) : keyOrId;
  return COLUMN_BY_KEY.get(key) ?? null;
}

/** The nearest cubby column within `CUBBY_REACH_M` of (x, z), and how far it is; null when none is. */
export function nearestCubbyColumn(x: number, z: number, columns: readonly CubbyColumn[] = COLUMNS): { column: CubbyColumn; dist: number } | null {
  let best: { column: CubbyColumn; dist: number } | null = null;
  for (const c of columns) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d <= CUBBY_REACH_M && (best === null || d < best.dist)) best = { column: c, dist: d };
  }
  return best;
}

/** The target id prefix of a guide (Task 9A): `guide:<id>`. */
export const GUIDE_TARGET_PREFIX = "guide:";
export const GUIDE_SHORT = "문의";

/** The guide of the player's area within `GUIDE_REACH_M` (2.2 m): "문의하기" opens its questions (GuideDialog). */
export function guideTarget(area: AreaId, x: number, z: number): InteractTarget | null {
  const near = nearestGuide(area, x, z);
  if (!near) return null;
  return { kind: "object", id: `${GUIDE_TARGET_PREFIX}${near.guide.id}`, dist: near.dist, icon: "💬", label: GUIDE_ASK_LABEL, short: GUIDE_SHORT };
}

/**
 * Everything the village offers at a spot: the door (`villageTargets`), the guide within reach (Task 9A: "문의하기"),
 * and inside the hall the nearest cubby column's close-up. The door comes first (priority 1) over a cubby; a guide in
 * reach of a door gets the door's priority, so the nearer of the two wins. A guide and a cubby always go by distance,
 * the guide winning a tie (final fix: the cubby takes the guide's priority, so a door in reach no longer makes a
 * farther guide beat a nearer cubby).
 *
 * `panelOpen`: the cubby card or a guide's questions are open, so nothing is offered and the E / action button is gone
 * (final fix: pressing it there would act on the world behind the panel).
 */
export function villageAndHallTargets(area: AreaId, x: number, z: number, panelOpen = false): readonly InteractTarget[] {
  if (panelOpen) return NONE;
  const doors = villageTargets(area, x, z);
  const out: InteractTarget[] = doors.map((d) => ({ ...d, priority: 1 }));
  const raw = guideTarget(area, x, z);
  // The hall desk's reach meets the way out's (pad r 1.4 + 0.7) between the arrival point and the desk: there the
  // nearer of the two wins (same priority as the door), so E at the desk asks the desk instead of leaving the hall.
  const guide = raw && doors.length > 0 ? { ...raw, priority: 1 } : raw;
  if (guide) out.push(guide); // before the cubby: an exact tie goes to the guide
  const near = area === "hall" ? nearestCubbyColumn(x, z) : null;
  if (near) {
    const cubby: InteractTarget = {
      kind: "object",
      id: `${CUBBY_TARGET_PREFIX}${near.column.key}`,
      dist: near.dist,
      icon: "🕯️",
      label: CUBBY_LABEL,
      short: CUBBY_SHORT,
    };
    out.push(guide?.priority !== undefined ? { ...cubby, priority: guide.priority } : cubby);
  }
  if (out.length === 0) return NONE;
  // A door alone keeps its plain shape (no priority), as before.
  if (out.length === 1 && doors.length === 1) return doors;
  return out;
}
