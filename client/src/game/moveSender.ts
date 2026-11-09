import { PATCH_RATE_MS } from "@caysonverse/shared/constants";
import type { MovePayload } from "@caysonverse/shared/messages";

/**
 * A time-injected throttle for outbound `move` messages.
 *
 * The 3D component feeds it, every frame, the current wall-clock time, whether
 * the player is moving, and the current pose. This module decides WHEN to emit,
 * calling the injected `send` — it performs no I/O and reads no clock itself, so
 * it is exhaustively unit-testable with fabricated timestamps.
 *
 * Contract (binding, mirrors the server's 10Hz patch rate):
 * - idle: never sends
 * - moving: at most one message per `intervalMs` (the first moving frame emits
 *   immediately so movement starts syncing without a full interval of lag)
 * - on the moving -> idle transition: exactly one final message carrying the
 *   resting pose, so the server converges on the exact stop position
 * - every message carries `t`: the `nowMs` of the frame it was sent from (whole ms,
 *   at least 1), i.e. WHEN the player stood at that pose. The server echoes it as
 *   `Player.moveT` and the other clients replay the walk at those times (playout.ts),
 *   so the walk looks the same on their screens whatever the network did to it.
 */
export interface MoveSender {
  update(nowMs: number, moving: boolean, pose: MovePayload): void;
}

/** The pose stamped with the sender's clock (`MovePayload.t`, whole ms >= 1). */
function stamped(pose: MovePayload, nowMs: number): MovePayload {
  return { x: pose.x, z: pose.z, yaw: pose.yaw, t: Math.max(1, Math.round(nowMs)) };
}

export function createMoveSender(
  send: (payload: MovePayload) => void,
  intervalMs: number = PATCH_RATE_MS,
): MoveSender {
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let wasMoving = false;

  return {
    update(nowMs, moving, pose) {
      if (moving) {
        if (nowMs - lastSentAt >= intervalMs) {
          send(stamped(pose, nowMs));
          lastSentAt = nowMs;
        }
        wasMoving = true;
        return;
      }
      // Not moving. Emit exactly one final message on the stop transition.
      if (wasMoving) {
        send(stamped(pose, nowMs));
        lastSentAt = nowMs;
        wasMoving = false;
      }
    },
  };
}
