/**
 * The curtain over a door (케이슨 마을, Task 4): the village's door is a teleport, 300 m away, and a cut with
 * nothing to cover it feels like a glitch. Pressing the door covers the screen (`FADE_IN_MS`) and ONLY THEN asks
 * the server to move us (when the curtain reports it has closed, `closed()`, or a little after the time it should
 * have): the answer comes back (a few tens of milliseconds) to a screen that is already black, so the cut itself
 * is never seen. When the server has moved us (the area changed) the new place is uncovered
 * (`FADE_OUT_MS` to open): 0.4 s plus the round trip. If the request cannot be sent any more (we walked out of
 * reach while the curtain closed), or the server never answers (it drops a press outside the door's reach or inside
 * its 1-per-second cap, silently), the cover opens by itself after `FAIL_SAFE_MS` instead of blacking out the
 * screen for good. A request that throws opens it at once (the fail-safe is armed BEFORE the request is made).
 *
 * The server allows one door use per second per player (villageDoor.ts `DOOR_RATE`), so a press within that second
 * of our last request is ignored here with no curtain: it would be dropped by the server without a word and only
 * black the screen for `FAIL_SAFE_MS`.
 *
 * A small state machine with an injected clock and timers, so the order is unit-tested; `DoorFade.tsx` only
 * draws `covered`. Never React state for the timing.
 */

export const FADE_IN_MS = 200;
export const FADE_OUT_MS = 200;
export const FAIL_SAFE_MS = 1500;
/** The quiet time (ms) after a door request in which another press is ignored: the server's `DOOR_RATE.windowMs`. */
export const DOOR_COOLDOWN_MS = 1000;
/**
 * How long past `FADE_IN_MS` the request waits for the cover's own "closed" report (`closed()`: the curtain's
 * transition ended) before it goes out anyway. A transition starts on the first frame after the style change, so on
 * a slow device it runs a frame or more behind a plain timer: waiting for it is what keeps the cut hidden.
 */
export const CLOSE_GRACE_MS = 150;

export interface FadeClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface DoorFadeModel {
  /** True while the screen is covered (or closing); false once it is opening or clear. */
  covered(): boolean;
  /**
   * The door was pressed: start covering, and once the cover has closed call `send` (it asks the server; it
   * returns false when there is nothing to ask any more, which opens the cover at once). A press while already
   * covered, or within `DOOR_COOLDOWN_MS` of the last request sent, is ignored: one door use at a time, and
   * never one the server would drop.
   */
  begin(send: () => boolean): void;
  /** The curtain finished closing (the transition ended): the pending request goes out now. */
  closed(): void;
  /** The local player's area changed (the server moved us): uncover as soon as the cover has closed. */
  arrived(): void;
  /** Drop everything (the scene is going away). */
  reset(): void;
  subscribe(listener: () => void): () => void;
}

const REAL_CLOCK: FadeClock = {
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createDoorFade(clock: FadeClock = REAL_CLOCK): DoorFadeModel {
  let covered = false;
  let coveredAt = 0;
  let timer: unknown = null;
  /** When the last request went out (the clock's time), for the cool-down; -Infinity before the first. */
  let lastSentAt = Number.NEGATIVE_INFINITY;
  /** The request waiting for the cover to close. */
  let pending: (() => boolean) | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  const clear = (): void => {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };
  const uncover = (): void => {
    clear();
    pending = null;
    if (!covered) return;
    covered = false;
    notify();
  };

  /**
   * The cover has closed (reported, or the grace ran out): send the request, then wait for the server. The fail-safe
   * is armed first, and a request that does not go out — it returns false, or it throws — opens the cover at once
   * (a throw still propagates), so nothing the request does can leave the screen black.
   */
  function closed(): void {
    const send = pending;
    if (send === null) return;
    pending = null;
    clear();
    timer = clock.setTimer(uncover, FAIL_SAFE_MS);
    let sent = false;
    try {
      sent = send();
      if (sent) lastSentAt = clock.now();
    } finally {
      if (!sent) uncover();
    }
  }

  return {
    covered: () => covered,
    begin(send) {
      if (covered) return;
      if (clock.now() - lastSentAt < DOOR_COOLDOWN_MS) return; // the server would drop it
      covered = true;
      coveredAt = clock.now();
      pending = send;
      notify();
      clear();
      timer = clock.setTimer(closed, FADE_IN_MS + CLOSE_GRACE_MS);
    },
    closed,
    arrived() {
      if (!covered) return;
      pending = null; // the move happened without our asking (or already answered): nothing left to send
      clear();
      const wait = Math.max(0, coveredAt + FADE_IN_MS - clock.now());
      timer = clock.setTimer(uncover, wait);
    },
    reset() {
      clear();
      pending = null;
      lastSentAt = Number.NEGATIVE_INFINITY; // a new scene is a new connection: the server's cap starts fresh
      if (covered) {
        covered = false;
        notify();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The one curtain of the village scene. */
export const doorFade: DoorFadeModel = createDoorFade();
