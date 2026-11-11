import type { AutoDoorConfig, AutoDoorState } from "@caysonverse/shared/village/autoDoor";

/**
 * Convert the shared auto-door phase into an animation amount. The server remains the authority for crossing;
 * this value is only the local visual opening of the public entrance.
 */
export function autoDoorOpenAmount(state: AutoDoorState, nowMs: number, config: AutoDoorConfig): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(state.phaseSinceMs)) return 0;
  const elapsed = Math.max(0, nowMs - state.phaseSinceMs);
  switch (state.phase) {
    case "closed":
      return 0;
    case "opening":
      return config.openingMs <= 0 ? 1 : Math.min(1, elapsed / config.openingMs);
    case "open":
      return 1;
    case "closing":
      return config.closingMs <= 0 ? 0 : Math.max(0, 1 - elapsed / config.closingMs);
  }
}
