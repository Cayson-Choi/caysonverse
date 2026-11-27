/**
 * The server's refusal notices (fix/net-sync), wired on every room the client adopts (connection.ts `setRoom`):
 *  - `MoveRefused`: a Move of mine was refused — the self-correction (remoteSync.ts) judges it at the end of a heal window (my pose
 *    sent again for a small gap, put back where the server has me for a large one), even when no synced field changed;
 *  - `ActionRefused`: a door / stair / bench press was refused because the server has me out of its reach — the door's curtain and
 *    the park's loading screen go at once, a short line says why, and the same self-correction heals the gap, so the next press works.
 * Before this both were silent: the button seemed to do nothing, and nothing ever brought the two positions back together.
 */
import { MessageType } from "@caysonverse/shared/messages";
import { VillageServerMsg, type ActionRefusedPayload } from "@caysonverse/shared/village/messages";
import { serverRefused } from "../game/sentMoves";
import { useClickHint } from "../stores/clickHintStore";
import { doorFade } from "../village/doorFadeModel";
import { endAreaLoading } from "../land/areaLoading";

/** The short line for each refused press (plain, with what to do). */
export const ACTION_REFUSED_TEXT: Record<ActionRefusedPayload["action"], string> = {
  door: "문에서 조금 멀어요. 문 앞에서 다시 눌러 주세요.",
  stair: "계단에서 조금 멀어요. 계단 앞에서 다시 눌러 주세요.",
  sit: "자리에서 조금 멀어요. 가까이 가서 다시 눌러 주세요.",
};

/** What a refused press does on this client (exported for the tests). */
export function onActionRefused(m: Partial<ActionRefusedPayload> | null | undefined): void {
  const action = m?.action;
  if (action === "door" || action === "stair") {
    doorFade.refused();
    endAreaLoading();
  }
  const text = action ? ACTION_REFUSED_TEXT[action] : undefined;
  if (text) useClickHint.getState().show(text);
  serverRefused();
}

interface NoticeRoom {
  onMessage<T = unknown>(type: string, callback: (message: T) => void): unknown;
}

const wired = new WeakSet<object>();

/** Listen for both notices on `room` (once per room object). */
export function wireServerRefusals(room: NoticeRoom): void {
  if (wired.has(room)) return;
  wired.add(room);
  room.onMessage(MessageType.MoveRefused, () => serverRefused());
  room.onMessage<ActionRefusedPayload>(VillageServerMsg.ActionRefused, onActionRefused);
}
