/**
 * The time of day, stepped (Task 7A): the clock's target read every 10 s, the look eased toward it every frame, and
 * the one place the scene's parts read what to show. Plain state, no React and no three objects (so it is unit-tested
 * with a fake clock, dayNightDriver.test.ts); `DayNight.tsx` writes it into the scene's lights, fog and exposure
 * every frame and `VillageModel` writes it into the model's materials.
 *
 *  - `outdoor` — the look of the open village now: eased toward `dayNightAt(clock)`, whose target is re-read every
 *    `TARGET_SECONDS`. It is also what the memorial hall's windows show of the sky (Task 9 reads `outdoor`).
 *  - `applied` — what the scene shows: `outdoor`, or while the local player is in the hall the hall's warm indoor
 *    light (`indoorState`), never the night blend. It switches the instant the area does (a door's curtain is down).
 *  - The first step, and any jump of the clock (the server's time arriving after a device clock that was wrong), snap
 *    instead of easing: a visitor at night never sees a day-lit frame swing to night.
 */

import { TARGET_SECONDS, cloneState, copyState, dayNightAt, easeState, indoorState, type DayNightState } from "./dayNightBlend";
import { villageClock, type VillageClock } from "./villageClock";

export interface DayNightDriver {
  /** What the scene shows right now (eased). */
  readonly applied: DayNightState;
  /** The open village's look right now (eased), whatever area the player is in. */
  readonly outdoor: DayNightState;
  /** The look the open village is easing toward. */
  readonly target: DayNightState;
  /**
   * Advance by `dt` seconds. `indoor`: the local player is in the memorial hall. Returns true when `applied` may have
   * changed (always, but for a zero step).
   */
  step(dt: number, indoor: boolean): boolean;
  /** Forget everything: the next step snaps to the clock (a scene that unmounts, a test). */
  reset(): void;
}

export function createDayNightDriver(clock: Pick<VillageClock, "nowMs" | "jumps"> = villageClock): DayNightDriver {
  const indoor = indoorState();
  const outdoor = cloneState(indoor);
  const target = cloneState(indoor);
  const applied = cloneState(indoor);
  let sinceTarget = 0;
  let lastJumps = -1;
  let started = false;

  const readTarget = (): void => {
    copyState(target, dayNightAt(clock.nowMs()));
    sinceTarget = 0;
  };

  return {
    applied,
    outdoor,
    target,
    step(dt, inHall) {
      const jumps = clock.jumps();
      if (!started || jumps !== lastJumps) {
        started = true;
        lastJumps = jumps;
        readTarget();
        copyState(outdoor, target); // snap
      } else {
        sinceTarget += Math.max(0, dt);
        if (sinceTarget >= TARGET_SECONDS) readTarget();
        easeState(outdoor, target, dt);
      }
      copyState(applied, inHall ? indoor : outdoor);
      return true;
    },
    reset() {
      started = false;
      lastJumps = -1;
      sinceTarget = 0;
    },
  };
}

/** The game's one driver: the village's clock. */
export const dayNight: DayNightDriver = createDayNightDriver();

/** The slice of `document` the visibility reset uses (a test passes a fake). */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Snap to the clock when the tab comes back (Task 7A review m-e). A hidden tab gets no frames, and the scene clamps
 * a frame's step to 1 s, so after a long absence the driver would read the clock only ~10 frames later and then glide
 * for seconds from a stale look. Resetting makes the next step a snap. Returns the unbind.
 */
export function resetOnVisible(doc: VisibilitySource, driver: Pick<DayNightDriver, "reset"> = dayNight): () => void {
  const onChange = (): void => {
    if (doc.visibilityState === "visible") driver.reset();
  };
  doc.addEventListener("visibilitychange", onChange);
  return () => doc.removeEventListener("visibilitychange", onChange);
}
