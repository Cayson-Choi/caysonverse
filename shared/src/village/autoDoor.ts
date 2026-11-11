/**
 * Pure state machine for proximity-operated public-building doors.
 *
 * The browser may use this for animation, but the server remains authoritative
 * about whether a player may cross a building boundary. A door never starts
 * closing while a player is in its doorway, and a new approach during closing
 * reverses it before it can trap the player.
 */

export type AutoDoorPhase = "closed" | "opening" | "open" | "closing";

export interface AutoDoorState {
  phase: AutoDoorPhase;
  /** Start time of the current phase, in the caller's monotonic clock. */
  phaseSinceMs: number;
  /** First time the door was clear enough to begin its close delay, or null while held. */
  clearSinceMs: number | null;
}

export interface AutoDoorObservation {
  /** Distances to players who can enter this door, in metres. */
  readonly playerDistancesM: readonly number[];
  /** True while a player occupies the threshold or the closing sweep. */
  readonly doorwayOccupied: boolean;
}

export interface AutoDoorConfig {
  /** Distance that starts or keeps the door open. */
  approachRadiusM: number;
  /** Time for the opening animation. */
  openingMs: number;
  /** Time for the closing animation. */
  closingMs: number;
  /** Grace period after the threshold is clear before closing starts. */
  closeDelayMs: number;
}

export const PUBLIC_AUTO_DOOR: Readonly<AutoDoorConfig> = Object.freeze({
  approachRadiusM: 2.75,
  openingMs: 420,
  closingMs: 620,
  closeDelayMs: 1_200,
});

export const CLOSED_AUTO_DOOR: Readonly<AutoDoorState> = Object.freeze({
  phase: "closed",
  phaseSinceMs: 0,
  clearSinceMs: null,
});

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function occupied(o: AutoDoorObservation, c: AutoDoorConfig): boolean {
  if (o.doorwayOccupied) return true;
  return o.playerDistancesM.some((d) => Number.isFinite(d) && d <= c.approachRadiusM);
}

function phase(state: AutoDoorState, next: AutoDoorPhase, nowMs: number): AutoDoorState {
  return { phase: next, phaseSinceMs: nowMs, clearSinceMs: null };
}

/** Advance one deterministic door step. `nowMs` must be monotonic for one door. */
export function stepAutoDoor(
  state: AutoDoorState,
  nowMs: number,
  observation: AutoDoorObservation,
  config: AutoDoorConfig = PUBLIC_AUTO_DOOR,
): AutoDoorState {
  if (!finiteNonNegative(nowMs) || !finiteNonNegative(state.phaseSinceMs)) return state;
  if (!finiteNonNegative(config.approachRadiusM) || !finiteNonNegative(config.openingMs) || !finiteNonNegative(config.closingMs) || !finiteNonNegative(config.closeDelayMs)) return state;
  const now = Math.max(nowMs, state.phaseSinceMs);
  const wantsOpen = occupied(observation, config);

  switch (state.phase) {
    case "closed":
      return wantsOpen ? phase(state, "opening", now) : state;
    case "opening":
      if (now - state.phaseSinceMs < config.openingMs) return state;
      return wantsOpen ? phase(state, "open", now) : { phase: "open", phaseSinceMs: now, clearSinceMs: now };
    case "open": {
      if (wantsOpen) return state.clearSinceMs === null ? state : { ...state, clearSinceMs: null };
      const clearSince = state.clearSinceMs ?? now;
      if (now - clearSince < config.closeDelayMs) return { ...state, clearSinceMs: clearSince };
      return phase(state, "closing", now);
    }
    case "closing":
      if (wantsOpen) return phase(state, "opening", now);
      return now - state.phaseSinceMs >= config.closingMs ? phase(state, "closed", now) : state;
  }
}

/** Whether the threshold can safely accept a player during this frame. */
export function autoDoorPassable(state: AutoDoorState): boolean {
  return state.phase !== "closed";
}

