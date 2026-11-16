import { VILLAGE_LAYOUT, busBoardingDistance, cubbyAnchors, isHouseArea, type AreaId, type CubbyAnchor, type Disc, type VillageLayout } from "@caysonverse/shared/village/villageLayout";
import { houseOffers } from "@caysonverse/shared/village/houseTargets";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { HOUSE_KEYPAD_REACH_M, keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { GUIDE_ASK_LABEL, nearestGuide } from "@caysonverse/shared/village/guides";
import type { InteractTarget } from "../game/interact";
import { BUS_HOLDS, BUS_SEATS, busHoldNumber, busPlaceOf, busSeatNumber, inExitZone, nearestFreeSpot } from "@caysonverse/shared/village/busCabin";

/**
 * What the village offers at a spot (케이슨 마을, Task 4) — pure: the scene hands it the local area and pose at
 * the context button's ~5 Hz pass and gets back the targets for the button and the E key. Today there is one
 * door, the memorial hall's, with two sides: "추모관 들어가기" outside, "밖으로 나가기" inside. Pressing it sends
 * `VillageMsg.UseDoor`; the server decides (villageDoor.ts) and teleports.
 *
 * The server accepts a door within the pad's radius plus 1.3 m of its centre. This offers it a little less
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

export const DOOR_LABEL: Readonly<Record<"village" | "hall", string>> = { village: "추모관 들어가기", hall: "밖으로 나가기" };
/** The word for the 60 px round touch button. */
export const DOOR_SHORT: Readonly<Record<"village" | "hall", string>> = { village: "들어가기", hall: "나가기" };
/** The target id of the memorial hall's door (both sides). */
export const MEMORIAL_DOOR_ID = "memorial_door";
export const KEYPAD_TARGET_PREFIX = "keypad:";
export const KEYPAD_LABEL = "번호키 입력";
export const KEYPAD_SHORT = "번호키";

/**
 * How far (m) outside the boarding area (the bus, the waiting pad and the shelter, villageLayout.ts busBoardingArea) the
 * board button is offered: inside the server's 1.2 m (transitRuntime.ts BUS_BOARD_REACH_M) with a small cushion.
 */
export const BUS_OFFER_REACH_M = 0.8;
export const BUS_RIDE_TARGET_BOARD = "village_bus_board";
export const BUS_RIDE_TARGET_LEAVE = "village_bus_leave";

/** How far past the pad's radius the button is offered (m). The server's own reach is 1.3 (villageDoor.ts DOOR_REACH_M). */
export const DOOR_OFFER_REACH_M = 1.25;
/**
 * Inside, the way out is offered past the pad's edge only in front of the door: at most this far (m) to either side of its
 * centre line (the server's DOOR_INSIDE_HALF_WIDTH_M is 0.8; on the pad itself it is always offered). Round 6 review: the lounge entrance, 1.2 m to the side, offered it.
 */
export const DOOR_INSIDE_OFFER_HALF_WIDTH_M = 0.7;

const NONE: readonly InteractTarget[] = Object.freeze([]);

/** The door pad a player in `area` uses: the building's front door outside, the way out inside. */
export function doorPadFor(area: AreaId, layout: VillageLayout = VILLAGE_LAYOUT): Disc {
  // (a house floor's pads are houseTargets.ts's; villageTargets does not come here for one)
  return area === "village" ? layout.memorial.exterior.doorPad : layout.memorial.interior.doorPad;
}

export function villageTargets(
  area: AreaId,
  x: number,
  z: number,
  layout: VillageLayout = VILLAGE_LAYOUT,
): readonly InteractTarget[] {
  // a house floor: its way out (floor 1) and its stair (both floors), houseTargets.ts
  if (isHouseArea(area)) {
    const offers = houseOffers(area, x, z);
    if (offers.length === 0) return NONE;
    return offers.map((o): InteractTarget => ({ kind: "door", id: o.id, dist: o.dist, icon: o.icon, label: o.label, short: o.short }));
  }
  const pad = doorPadFor(area, layout);
  const dist = Math.hypot(x - pad.centre.x, z - pad.centre.z);
  // on the pad itself always; past its edge (the reach) inside a building only straight in front of the door, on the room's
  // side of it (north, −z; the server's useDoor has the same rule)
  const inFront =
    area === "village" || dist <= pad.radius || (Math.abs(x - pad.centre.x) <= DOOR_INSIDE_OFFER_HALF_WIDTH_M && z <= pad.centre.z);
  if (inFront && dist <= pad.radius + DOOR_OFFER_REACH_M) {
    const label = area === "village" ? DOOR_LABEL.village : DOOR_LABEL.hall;
    const short = area === "village" ? DOOR_SHORT.village : DOOR_SHORT.hall;
    return [{ kind: "door", id: MEMORIAL_DOOR_ID, dist, icon: "🚪", label, short }];
  }
  if (area !== "village") return NONE;
  const keypad = keypadEntries(layout)
    .map((entry) => ({ ...entry, dist: Math.hypot(x - entry.pad.x, z - entry.pad.z) }))
    .filter((entry) => entry.dist <= HOUSE_KEYPAD_REACH_M)
    .sort((a, b) => a.dist - b.dist)[0];
  if (!keypad) return NONE;
  return [{ kind: "object", id: `${KEYPAD_TARGET_PREFIX}${keypad.buildingId}`, dist: keypad.dist, icon: "🔢", label: KEYPAD_LABEL, short: KEYPAD_SHORT }];
}

/**
 * How long until the next bus leaves, for the board button's words while it is not taking riders: "4분" / "20초" (long, the pill and the desktop button;
 * "4분 뒤" for the 60 px touch button): minutes are rounded up so it never says 0분, and both forms agree.
 */
export function busCountdownWords(ms: number): { long: string; short: string } {
  const s = Math.max(0, Math.ceil(ms / 1000));
  // One rounding for every place that shows it (review r4: the phone button said "8분 뒤" while the pill said "7분 8초 뒤"):
  // whole minutes rounded up while boarding is not open yet (more than the boarding window away: always "4분" or more);
  // within it minutes and seconds (review 2026-11-15: "3분 뒤 출발" rounded up from 2:01 read as if boarding had just
  // opened), and seconds alone under a minute.
  const boardS = Math.round(TRANSIT.boardingMs / 1000);
  const words =
    s > boardS ? `${Math.ceil(s / 60)}분` : s >= 60 ? (s % 60 === 0 ? `${s / 60}분` : `${Math.floor(s / 60)}분 ${s % 60}초`) : `${s}초`;
  return { long: words, short: `${words} 뒤` };
}

/**
 * A board/leave target around the east-side stop; the server re-checks the pose and schedule.
 *
 * `boardingNow`: the bus is taking riders (shared transit.ts TRANSIT.boardingMs: the 3 min before each departure, by the server's clock as the
 * bus snapshots carry it, transitSync.ts transitNowMs). `departsInMs`: how long until the next bus leaves.
 *
 * The way to ride stays visible (review 2026-11-15) as a key-less chip (busStopHint.ts: when the next bus leaves and when boarding
 * opens); the board ACTION exists only while the bus stands at the stop with its doors open (2026-11-15 check: the button with a
 * countdown on it while the bus was away was confusing). It gives a free seat in reach the key (`yieldsToSeat`: the shelter's bench and the café chairs 97/98 sit inside
 * or by its area; owner 2026-11-13: 정류장 벤치에 앉을 수가 없어). With boarding open for 3 minutes (owner 2026-11-15)
 * riders wait on the bench like at a real stop, then stand and step towards the bus: no seat is in reach on the pad's
 * road half and at the doors, so there the button has the key (the stop's pill says so). "Leave" never yields, and is
 * offered only while the bus stands at the stop (`busOnRoad` false).
 */
export function villageBusTarget(
  area: AreaId,
  x: number,
  z: number,
  boarded: boolean,
  boardingNow = true,
  departsInMs?: number,
  busOnRoad = false,
): InteractTarget | null {
  if (area !== "village") return null;
  const dist = busBoardingDistance(x, z);
  if (!(dist <= BUS_OFFER_REACH_M)) return null;
  if (boarded) {
    // Out on the lap the doors stay shut (the server refuses a leave): no "버스에서 내리기" / "하차" that does nothing
    // (checker r2). The ride panel says "정류장에 돌아오면 내려요"; back at the stop the button is here again.
    if (busOnRoad) return null;
    return { kind: "object", id: BUS_RIDE_TARGET_LEAVE, dist, icon: "🚌", label: "버스에서 내리기", short: "하차", priority: 2 };
  }
  // Not taking riders (the bus is away, or it stands at the stop with its doors still shut): no action at all (2026-11-15
  // check: "E 버스 타기 · 10분 뒤 출발" showed on PC while the bus was away). The stop's timetable chip (busStopHint.ts, no
  // key) says when it comes and when boarding opens.
  if (!boardingNow || busOnRoad) return null;
  void departsInMs;
  return {
    kind: "object",
    id: BUS_RIDE_TARGET_BOARD,
    dist,
    icon: "🚌",
    label: "버스 타기",
    short: "탑승",
    priority: 2,
    yieldsToSeat: true,
  };
}

/** The target ids inside the bus: `bus_sit:seat:<index>` / `bus_sit:hold:<index>` (sit down / take hold) and `bus_stand` (get up). */
export const BUS_SIT_TARGET_PREFIX = "bus_sit:";
export const BUS_STAND_TARGET_ID = "bus_stand";

/**
 * What the bus offers a rider aboard (owner 2026-11-15: sit or stand, walk inside): free in the aisle, the nearest free
 * seat or hold spot in reach (a backed seat only from its front: busCabin.ts nearestFreeSpot) — "앉기" or "손잡이 잡기";
 * in front of the middle door while the bus stands, "내리기" first; seated or holding, "일어나기". `taken`: the busSeat numbers
 * other riders hold. Nothing here is a world target (the door, a guide): aboard, those are not in reach.
 */
export function villageBusCabinTargets(
  busSeat: number,
  ahead: number,
  right: number,
  taken: ReadonlySet<number>,
  busOnRoad: boolean,
  riders?: ReadonlyArray<{ ahead: number; right: number }>,
  yaw?: number,
): readonly InteractTarget[] {
  const place = busPlaceOf(busSeat);
  const out: InteractTarget[] = [];
  if (place.kind !== "free") {
    out.push({ kind: "object", id: BUS_STAND_TARGET_ID, dist: 0, icon: "🧍", label: "일어나기", short: "일어나기", priority: 2 });
    return out;
  }
  if (!busOnRoad && inExitZone(ahead, right)) {
    out.push({ kind: "object", id: BUS_RIDE_TARGET_LEAVE, dist: 0, icon: "🚪", label: "버스에서 내리기", short: "하차", priority: 4 });
  }
  const takenSeats = new Set<number>();
  const takenHolds = new Set<number>();
  BUS_SEATS.forEach((_s, i) => {
    if (taken.has(busSeatNumber(i))) takenSeats.add(i);
  });
  BUS_HOLDS.forEach((_h, i) => {
    if (taken.has(busHoldNumber(i))) takenHolds.add(i);
  });
  const spot = nearestFreeSpot(ahead, right, takenSeats, takenHolds, riders, yaw);
  if (spot) {
    out.push(
      spot.kind === "seat"
        ? { kind: "object", id: `${BUS_SIT_TARGET_PREFIX}seat:${spot.index}`, dist: spot.dist, icon: "🪑", label: `앉기 (${BUS_SEATS[spot.index]!.id}번 자리)`, short: "앉기", priority: 3 }
        : { kind: "object", id: `${BUS_SIT_TARGET_PREFIX}hold:${spot.index}`, dist: spot.dist, icon: "✋", label: "손잡이 잡고 서기", short: "잡기", priority: 3 },
    );
  }
  return out;
}

/** The spot a `bus_sit:` target id names (`seat` or `hold`, and its index), or null. */
export function parseBusSitTarget(id: string): { kind: "seat" | "hold"; index: number } | null {
  if (!id.startsWith(BUS_SIT_TARGET_PREFIX)) return null;
  const [kind, idx] = id.slice(BUS_SIT_TARGET_PREFIX.length).split(":");
  const index = Number(idx);
  if ((kind !== "seat" && kind !== "hold") || !Number.isInteger(index)) return null;
  return { kind, index };
}

/** How near (m, on the ground) to a cubby column its close-up is offered (brief: 1.2 m). The server lets a candle be lit from 1.5 m. */
export const CUBBY_REACH_M = 1.2;
/** The target id prefix of a cubby column: `cubby:<bank>_<col>`. */
export const CUBBY_TARGET_PREFIX = "cubby:";
export const CUBBY_LABEL = "가까이 보기";
/** The touch button says the same as the PC one (round 6 review: "칸 보기" on a phone, "가까이 보기" on a PC). */
export const CUBBY_SHORT = CUBBY_LABEL;

/** A column of cubbies: its wall and column, where it stands on the floor (the anchors' x, z) and its rows' anchors (bottom first). */
export interface CubbyColumn {
  key: string;
  bank: CubbyAnchor["bank"];
  wall: CubbyAnchor["wall"];
  col: number;
  x: number;
  z: number;
  rows: readonly CubbyAnchor[];
}

/** The hall's cubby columns (`<bank>_<col>`, e.g. `A_11`), built from the layout's anchors. */
export function cubbyColumns(layout: VillageLayout = VILLAGE_LAYOUT): CubbyColumn[] {
  const byKey = new Map<string, CubbyAnchor[]>();
  for (const a of cubbyAnchors(layout)) {
    const key = `${a.bank}_${a.col}`;
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(a);
  }
  return [...byKey.entries()].map(([key, rows]) => {
    rows.sort((a, b) => a.row - b.row);
    return { key, bank: rows[0]!.bank, wall: rows[0]!.wall, col: rows[0]!.col, x: rows[0]!.x, z: rows[0]!.z, rows };
  });
}

const COLUMNS: readonly CubbyColumn[] = cubbyColumns();
const COLUMN_BY_KEY: ReadonlyMap<string, CubbyColumn> = new Map(COLUMNS.map((c) => [c.key, c]));

/** The column of a key (`A_11`) or a target id (`cubby:A_11`), or null. */
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

/**
 * A free seat nearer than this (m) wins over a guide in reach: the hall desk is asked from round its two visitor chairs, and
 * standing at a chair's side (review 2026-11-15) or in the gap between the two chairs (up to ~1.2 m from either seat point,
 * which sits deep in the chair) must offer "앉기", not "문의하기".
 */
export const GUIDE_SEAT_YIELD_M = 1.3;

/** The guide of the player's area within its reach (2.2 m; the hall desk 4.0 m): "문의하기" opens its questions (GuideDialog). */
export function guideTarget(area: AreaId, x: number, z: number): InteractTarget | null {
  const near = nearestGuide(area, x, z);
  if (!near) return null;
  return { kind: "object", id: `${GUIDE_TARGET_PREFIX}${near.guide.id}`, dist: near.dist, icon: "💬", label: GUIDE_ASK_LABEL, short: GUIDE_SHORT, beatsSeatBeyond: GUIDE_SEAT_YIELD_M };
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
      // a magnifier, not a candle: the button opens the close-up (review 2026-11-14: "🕯️ 보기" read as "light a candle")
      icon: "🔍",
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
