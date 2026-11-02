/**
 * A lone member's long press on a coop switch (AI 학교 탈출, Task 19) — the bit of state between the context
 * button, the messages and the ring on screen.
 *
 *   press    the finger / E key goes down on a switch the button called a hold  → `HoldStart` is sent
 *   confirm  the server's `hold` event (on: true) says it really began          → the ring starts
 *   stop     the server ended it (`hold` on: false, or `coopDone`)              → the ring goes, the press stays
 *   release  the finger / key comes up (or any other way out)                   → `HoldEnd` is sent
 *
 * The ring is drawn from the server's confirmation, not from the press: a press the server ignores (the coop is
 * done, a teammate just arrived) shows nothing, and a confirmed ring finishes about when the server's
 * `coopDone` does. `pressed` outlives a stop on purpose: the release must still send `HoldEnd` (the server
 * accepts it whatever its own state; it can only end the sender's own hold).
 *
 * Plain module state like uiCapture.ts. The ring is exposed as one object that changes identity only when it
 * starts or stops, so a React `useSyncExternalStore` over it renders twice per hold, not per frame.
 */

export interface HoldRing {
  objectId: string;
  /** performance.now() when the server's confirmation arrived. */
  since: number;
}

let pressed: string | null = null;
/** True once the confirmation for the current press has been used (or the server stopped it): no second ring for one press. */
let spent = false;
let ring: HoldRing | null = null;
const listeners: (() => void)[] = [];

function emit(): void {
  // Snapshot: a listener may unsubscribe while we call.
  for (const fn of listeners.slice()) fn();
}

/** The ring to draw, or null. The same object until the ring starts or stops. */
export function getHoldRing(): HoldRing | null {
  return ring;
}

/** Subscribe to the ring starting / stopping; returns the disposer. */
export function subscribeHold(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
}

/** The finger / key went down on switch `objectId`. A press that is already held keeps its switch. */
export function holdPress(objectId: string): void {
  if (pressed !== null) return;
  pressed = objectId;
  spent = false;
}

/** The server confirmed the hold of `objectId`: the ring starts at `nowMs`, if that is the switch being pressed. */
export function holdConfirmed(objectId: string, nowMs: number): void {
  if (pressed !== objectId || spent || ring !== null) return;
  spent = true;
  ring = { objectId, since: nowMs };
  emit();
}

/** The server ended the hold (cancelled or done). The ring goes; the press stays until it is released. */
export function holdStopped(): void {
  spent = true;
  if (ring === null) return;
  ring = null;
  emit();
}

/** The finger / key came up. Returns the switch to send `HoldEnd` for, or null when nothing was pressed. */
export function holdRelease(): string | null {
  const id = pressed;
  pressed = null;
  spent = false;
  if (ring !== null) {
    ring = null;
    emit();
  }
  return id;
}

/** Forget everything (the scene started or ended). */
export function resetHold(): void {
  pressed = null;
  spent = false;
  if (ring !== null) {
    ring = null;
    emit();
  }
}
