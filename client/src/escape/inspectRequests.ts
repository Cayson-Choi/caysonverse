/**
 * Which close-up replies the player is still waiting for (AI 학교 탈출, Task 18 review).
 *
 * The server answers an `Inspect` after a network delay. A card the player closed in the meantime (Esc, ✕, the
 * backdrop) must not pop open again when the late answer lands, and an `InspectView` nobody asked for opens
 * nothing. So every ask is stamped with a growing number, closing the card remembers the latest number, and a
 * reply is wanted only when its object was asked for after the last close.
 *
 * Plain module state (like overlayStack.ts): a few numbers, never React state.
 */

let seq = 0;
let closedAt = 0;
const asked = new Map<string, number>();

/** The player (or the open card refreshing itself) is asking for `objectId`'s close-up. Call before sending `Inspect`. */
export function noteInspectRequest(objectId: string): void {
  asked.set(objectId, ++seq);
}

/** Whether a reply for `objectId` answers an ask made since the card was last closed. */
export function acceptInspectReply(objectId: string): boolean {
  return (asked.get(objectId) ?? 0) > closedAt;
}

/** The card is closed (or the classroom reset): every ask so far is stale. */
export function dropInspectRequests(): void {
  closedAt = seq;
  asked.clear();
}
