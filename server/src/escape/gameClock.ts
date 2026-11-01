/**
 * Game time of one escape room (AI 학교 탈출, Task 7): real time since the start minus every
 * pause. All engine times (lock-submit gap, hint gap, coop window, solo hold, persuasion
 * cool-down) use it, so a teacher's pause freezes them all (Review Focus 4).
 *
 * Pure bookkeeping: the caller passes the real time (ms) on every call; no timers inside.
 */
export class GameClock {
  private readonly start: number;
  /** Total length of the pauses that are over. */
  private pausedTotal = 0;
  /** Real time the current pause began, or null while running. */
  private pausedAt: number | null = null;
  /** Game time added by `skip` (tests only). */
  private skipped = 0;

  constructor(startReal: number) {
    this.start = startReal;
  }

  /** Game time (ms) at real time `real`. */
  now(real: number): number {
    const pausing = this.pausedAt === null ? 0 : real - this.pausedAt;
    return real - this.start - this.pausedTotal - pausing + this.skipped;
  }

  /** Stops game time. Pausing while paused changes nothing. */
  pause(real: number): void {
    if (this.pausedAt === null) this.pausedAt = real;
  }

  /** Lets game time run again. Resuming while running changes nothing. */
  resume(real: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotal += real - this.pausedAt;
    this.pausedAt = null;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Tests only: moves game time forward by `ms`. Throws outside the test runner (process.env.VITEST). */
  skip(ms: number): void {
    if (!process.env.VITEST) throw new Error("GameClock.skip is for tests only");
    if (!Number.isFinite(ms) || ms < 0) throw new Error("GameClock.skip needs a finite ms >= 0");
    this.skipped += ms;
  }
}
