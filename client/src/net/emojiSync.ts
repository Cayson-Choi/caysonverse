/**
 * Bridge the room's emoji broadcast into the module EMOJI REGISTRY (3D
 * float-up sprites, read by each avatar's render loop — outside React state).
 * Mirrors chatSync.ts: both self and remote reactions come from the broadcast
 * here (never a local echo). Returns a teardown that unregisters the handler
 * and clears the registry.
 */

import type { Room } from "@colyseus/sdk";
import type { WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import type { EmojiBroadcast } from "@caysonverse/shared/messages";
import { emojiRegistry } from "../game/emojiRegistry";

export function startEmojiSync(room: Room<WorldState>): () => void {
  const off = room.onMessage(MessageType.Emoji, (m: EmojiBroadcast) => {
    emojiRegistry.set(m.sid, m.index, performance.now());
  });

  return () => {
    off();
    emojiRegistry.clear();
  };
}
