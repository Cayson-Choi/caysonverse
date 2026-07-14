/**
 * Bridge the room's announcement SCHEMA STATE into the zustand announce store.
 * Uses the Colyseus 0.17 Callbacks API (`getStateCallbacks(room)` →
 * `$(state).listen("announcement", cb, immediate)`), mirroring remoteSync.ts.
 *
 * `listen(..., true)` fires immediately with the current value, so a client that
 * joins AFTER an announcement was set still shows the banner — the whole point
 * of putting the banner in schema state rather than a broadcast. Returns a
 * teardown that detaches the listener and resets the store.
 */

import { getStateCallbacks, type Room } from "@colyseus/sdk";
// TYPE-ONLY: schema decorators must never enter the browser bundle.
import type { WorldState } from "@caysonverse/shared/schema";
import { useAnnounceStore } from "../stores/announceStore";

export function startAnnounceSync(room: Room<WorldState>): () => void {
  const $ = getStateCallbacks(room);

  const off = $(room.state).listen(
    "announcement",
    (value: string) => {
      useAnnounceStore.getState().setText(value ?? "");
    },
    true, // immediate → replay the current banner for late joiners
  );

  return () => {
    off();
    useAnnounceStore.getState().setText("");
  };
}
