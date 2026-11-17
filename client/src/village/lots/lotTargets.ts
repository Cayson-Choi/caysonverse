/**
 * What the lot buildings offer (L5 / lots v2, pure): their doors' pads and the interaction slots.
 *
 *  - Doors (contract 2 / 11): the five rooms are open from phase 1 — standing at a door pad offers "<건물> 들어가기" (a `door` target:
 *    the curtain closes and the server's UseDoor takes the visitor into the room, `useLotDoor`); inside, the way out offers "밖으로
 *    나가기". 케이슨랜드's gate stays shut ("곧 문을 열어요").
 *  - Slots (contract 5): every `slot__` of the lots, as inert hooks (`onLotSlot`).
 */
import {
  LOTS_WITH_MODEL,
  LOT_DOOR_INSIDE_HALF_WIDTH_M,
  VILLAGE_LOTS,
  lotDoorPoint,
  lotRoomDoor,
  lotRoomOf,
  lotRoomOfDoor,
  lotSlots,
  type LotSlot,
  type LotSlotKind,
  type LotId,
} from "@caysonverse/shared/village/villageLots";
import type { InteractTarget } from "../../game/interact";

export const LOT_DOOR_TARGET_PREFIX = "lotdoor:";
/** A room's way out (`lotexit:<unit>`) and a room's door from outside (`lotenter:<door>`): door targets (the curtain, UseDoor). */
export const LOT_ENTER_TARGET_PREFIX = "lotenter:";
export const LOT_EXIT_TARGET_PREFIX = "lotexit:";
/** How far past a door pad's radius (m) its offer reaches (the memorial door's reach, villageTargets DOOR_OFFER_REACH_M). */
export const LOT_DOOR_OFFER_REACH_M = 0.6;

export interface LotDoorPad {
  door: string;
  lot: LotId;
  x: number;
  z: number;
  radius: number;
  /** "soon": 케이슨랜드's closed gate; "enter": a room behind it. */
  kind: "soon" | "enter";
}

/** Every lot door a player can stand at: the rooms' doors and the gate. */
export const LOT_DOOR_PADS: readonly LotDoorPad[] = Object.freeze(
  VILLAGE_LOTS.filter((l) => LOTS_WITH_MODEL.includes(l.id)).flatMap((l) =>
    l.doors
      .filter((d) => d.entry !== "walk_in")
      .map((d): LotDoorPad => {
        const p = lotDoorPoint(l, d);
        return { door: d.id, lot: l.id, x: p.pad.x, z: p.pad.z, radius: p.pad.radius, kind: lotRoomOfDoor(d.id) ? "enter" : "soon" };
      }),
  ),
);

export function lotDoorNotice(pad: Pick<LotDoorPad, "kind" | "lot">): string {
  if (pad.kind === "soon") return "🎡 케이슨랜드는 곧 문을 열어요. 조금만 기다려 주세요!";
  const name = VILLAGE_LOTS.find((l) => l.id === pad.lot)?.name ?? "건물";
  return `${name}에 들어가요.`;
}

/** The short name of a lot for its door button ("학교", "성당"…: the last word of the building's name). */
export function lotShortName(lot: LotId): string {
  const name = VILLAGE_LOTS.find((l) => l.id === lot)?.name ?? "";
  return name.split(" ").pop() || name;
}

/**
 * The lot door in reach of (x, z) in the village: a room's door as a `door` target ("성당 들어가기"), the gate as an object ("곧 문을
 * 열어요"), or null.
 */
export function lotDoorTarget(x: number, z: number): InteractTarget | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best: { p: LotDoorPad; dist: number } | null = null;
  for (const p of LOT_DOOR_PADS) {
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist > p.radius + LOT_DOOR_OFFER_REACH_M || (best && dist >= best.dist)) continue;
    best = { p, dist };
  }
  if (!best) return null;
  const { p, dist } = best;
  if (p.kind === "soon") return { kind: "object", id: `${LOT_DOOR_TARGET_PREFIX}${p.door}`, dist, icon: "🎡", label: "곧 문을 열어요", short: "곧 열어요", yieldsToSeat: true };
  // a bench beside a door (the school's, the church's porch) keeps the key when it is in reach
  return { kind: "door", id: `${LOT_ENTER_TARGET_PREFIX}${p.door}`, dist, icon: "🚪", label: `${lotShortName(p.lot)} 들어가기`, short: "들어가기", yieldsToSeat: true };
}

/** Inside a room: its way out when (x, z) is within reach (past the pad only straight in front of the door, the server's rule). */
export function lotExitTarget(area: string, x: number, z: number): InteractTarget | null {
  const r = lotRoomOf(area);
  if (!r || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const pad = lotRoomDoor(r).exitPad;
  const dist = Math.hypot(x - pad.x, z - pad.z);
  const inFront = dist <= pad.radius || (Math.abs(x - pad.x) <= LOT_DOOR_INSIDE_HALF_WIDTH_M - 0.1 && z >= pad.z);
  if (!inFront || dist > pad.radius + LOT_DOOR_OFFER_REACH_M) return null;
  return { kind: "door", id: `${LOT_EXIT_TARGET_PREFIX}${r.unit.id}`, dist, icon: "🚪", label: "밖으로 나가기", short: "나가기" };
}

export function lotDoorPadById(targetId: string): LotDoorPad | null {
  if (!targetId.startsWith(LOT_DOOR_TARGET_PREFIX)) return null;
  const id = targetId.slice(LOT_DOOR_TARGET_PREFIX.length);
  return LOT_DOOR_PADS.find((p) => p.door === id) ?? null;
}

// ───────────────────────────── interaction slots (inert hooks) ─────────────────────────────

export interface LotSlotHook {
  lot: LotId;
  slot: LotSlot;
}

/** Every lot slot (exterior ones in the world, interior ones in their unit's frame), lot by lot. */
export const LOT_SLOT_HOOKS: readonly LotSlotHook[] = Object.freeze(
  VILLAGE_LOTS.filter((l) => LOTS_WITH_MODEL.includes(l.id)).flatMap((l) => lotSlots(l).map((slot) => ({ lot: l.id, slot }))),
);

type SlotHandler = (hook: LotSlotHook) => void;
const handlers = new Map<LotSlotKind, Set<SlotHandler>>();

/** Register what a slot kind will do (the economy, later). Returns the unregister. Nothing calls it yet. */
export function onLotSlot(kind: LotSlotKind, fn: SlotHandler): () => void {
  let set = handlers.get(kind);
  if (!set) handlers.set(kind, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

/** The handlers registered for a kind (for the economy's own tests). */
export function lotSlotHandlers(kind: LotSlotKind): number {
  return handlers.get(kind)?.size ?? 0;
}

/** The slots of one kind (e.g. every `sell_counter`), for the economy to find its place. */
export function lotSlotsOf(kind: LotSlotKind): LotSlotHook[] {
  return LOT_SLOT_HOOKS.filter((h) => h.slot.kind === kind);
}
