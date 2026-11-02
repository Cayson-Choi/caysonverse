import { INSPECT_REACH, type EscapePhase } from "@caysonverse/shared/escape/constants";
import type { ObjectKind, RoomContent } from "@caysonverse/shared/escape/messages";
import type { ObjectAnchor, VisualBinding } from "@caysonverse/shared/school/counselMap";
import type { InteractTarget } from "../game/interact";

/**
 * What a classroom offers the context button at a spot (AI 학교 탈출, Task 18): the puzzle objects whose
 * anchor is within reach. Pure — the scene's target source feeds it the room's anchors, content, flags
 * and bindings at the button's ~5 Hz pass (never per frame).
 *
 * Reach is the server's own rule (EscapeRoom.inReach): on the ground plane, distance squared <=
 * (anchor.reach ?? INSPECT_REACH) squared, so a button shown here is one the server will answer.
 * An object whose model node is `hide`n by a set flag (the flashlight once it is in the bag) is gone from
 * the room and offers nothing — only a binding for the object's OWN node counts: taking the film from the
 * note box hides the film (`obj__uv_film`), not the box.
 *
 * Icons / words by the object's kind (RoomContent.objects): inspect 🔍 "조사하기", screen 📺 "화면 보기",
 * door 🚪 "마지막 문", switch 🔑 "열쇠 돌리기" — a lone member (solo) cannot press it with a partner, so it
 * becomes a 3 s hold, "3초 길게 누르기" (`hold: true`).
 */

const NODE_PREFIX = "obj__";

/**
 * A coop key switch outranks a plain inspect target in the context button's pick (InteractTarget.priority): its standing
 * spot is about as far from the anchor as a note's or a drawer's is, so "nearest wins" often offered the note instead of the key.
 */
export const COOP_PRIORITY = 1;

/** One shared empty answer: the common case (nothing within reach) allocates nothing. */
const NONE: InteractTarget[] = [];

/** Whether `node` is exactly `obj__<objectId>` (no string is built to compare). */
function nodeIsObject(node: string, objectId: string): boolean {
  return (
    node.length === NODE_PREFIX.length + objectId.length &&
    node.startsWith(NODE_PREFIX) &&
    node.startsWith(objectId, NODE_PREFIX.length)
  );
}

/** Whether a `hide` binding of this object's own node has its flag on. */
function isHidden(objectId: string, flags: readonly string[], visuals: readonly VisualBinding[]): boolean {
  for (let i = 0; i < visuals.length; i++) {
    const v = visuals[i];
    if (v.effect === "hide" && nodeIsObject(v.node, objectId) && flags.includes(v.flag)) return true;
  }
  return false;
}

/** The kind the room's content gave this object, or null. */
export function objectKindOf(content: RoomContent | null, objectId: string): ObjectKind | null {
  if (content === null) return null;
  const objects = content.objects;
  for (let i = 0; i < objects.length; i++) if (objects[i].id === objectId) return objects[i].kind;
  return null;
}

/** Whether objects can be used right now: the game is on (play, finale) and the teacher has not paused — the server's gate. */
export function escapeActionsLive(v: { phase: EscapePhase; paused: boolean }): boolean {
  return !v.paused && (v.phase === "play" || v.phase === "finale");
}

function targetFor(kind: ObjectKind, id: string, dist: number, solo: boolean): InteractTarget {
  switch (kind) {
    case "screen":
      return { kind: "object", id, dist, icon: "📺", label: "화면 보기", short: "화면" };
    case "door":
      return { kind: "object", id, dist, icon: "🚪", label: "마지막 문", short: "문" };
    case "switch":
      return solo
        ? { kind: "object", id, dist, icon: "🔑", label: "3초 길게 누르기", short: "길게", hold: true, priority: COOP_PRIORITY }
        : { kind: "object", id, dist, icon: "🔑", label: "열쇠 돌리기", short: "열쇠", priority: COOP_PRIORITY };
    case "inspect":
      return { kind: "object", id, dist, icon: "🔍", label: "조사하기", short: "조사" };
  }
}

export function escapeTargets(
  x: number,
  z: number,
  anchors: readonly ObjectAnchor[],
  content: RoomContent,
  flags: readonly string[],
  visuals: readonly VisualBinding[],
  solo: boolean,
): InteractTarget[] {
  let out: InteractTarget[] = NONE;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const reach = a.reach ?? INSPECT_REACH;
    const dx = x - a.x;
    const dz = z - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach * reach) continue;
    const kind = objectKindOf(content, a.id);
    if (kind === null || isHidden(a.id, flags, visuals)) continue;
    if (out === NONE) out = [];
    out.push(targetFor(kind, a.id, Math.sqrt(d2), solo));
  }
  return out;
}
