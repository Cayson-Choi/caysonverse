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

/**
 * The leaves' shown opening, moved toward the phase's goal (open/opening: 1, closing/closed: 0) at the door's own speed. The
 * phase's clock alone (`autoDoorOpenAmount`) snaps a half-shut door back to fully shut when someone steps in while it closes
 * (a reversal restarts "opening" from 0): the leaves would jump through whoever is in the doorway. Moving the shown amount
 * instead keeps them continuous: they turn round where they are.
 */
export function stepShownOpening(shown: number, state: AutoDoorState, dtMs: number, config: AutoDoorConfig): number {
  const from = Number.isFinite(shown) ? Math.min(1, Math.max(0, shown)) : 0;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const goal = state.phase === "opening" || state.phase === "open" ? 1 : 0;
  if (goal === 1) return config.openingMs <= 0 ? 1 : Math.min(1, from + dt / config.openingMs);
  return config.closingMs <= 0 ? 0 : Math.max(0, from - dt / config.closingMs);
}

/** Every avatar's distance to the door's pad (the local player first, then the others in this area), and whether any stands in the doorway. */
export function doorObservation(
  pad: { x: number; z: number },
  local: { x: number; z: number },
  others: readonly { x: number; z: number }[],
  doorwayM: number,
): { playerDistancesM: number[]; doorwayOccupied: boolean } {
  const playerDistancesM = [local, ...others].map((p) => Math.hypot(p.x - pad.x, p.z - pad.z)).filter((d) => Number.isFinite(d));
  return { playerDistancesM, doorwayOccupied: playerDistancesM.some((d) => d <= doorwayM) };
}
