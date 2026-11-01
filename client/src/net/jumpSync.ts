/**
 * Bridge the room's jump broadcast into the module JUMP REGISTRY (the hop each
 * avatar's render loop plays). Mirrors emojiSync.ts, with one difference: the
 * server relays a jump to everyone EXCEPT the sender (the sender already played its
 * own hop the instant it pressed, `localJump`). Our own sid is still ignored here as a
 * guard — an echo replayed ~RTT later would restart the animation mid-air.
 * Returns a teardown that unregisters the handler and clears the registry.
 */

import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { JumpBroadcast } from "@caysonverse/shared/messages";
import { jumpRegistry } from "../game/jump";

export function startJumpSync(room: Room<WorldState>, selfSid: string): () => void {
  const off = room.onMessage(MessageType.Jump, (m: JumpBroadcast) => {
    if (m.sid === selfSid) return; // own echo: already playing locally
    jumpRegistry.set(m.sid, performance.now());
  });

  return () => {
    off();
    jumpRegistry.clear();
  };
}
