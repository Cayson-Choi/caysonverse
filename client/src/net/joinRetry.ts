/**
 * Pure, time-injectable retry helper for a room join.
 *
 * Why this exists: a `client.join(WORLD_ROOM)` can fail with the matchmake code
 * 521 ("no rooms found") in TWO situations that look identical on the wire but
 * mean opposite things:
 *   - the singleton world is genuinely FULL (locked) → a terminal capacity notice;
 *   - the world has not been (re)created YET — the server's boot window, where the
 *     transport accepts matchmake requests a sub-ms before
 *     `matchMaker.createRoom(WORLD_ROOM)` resolves (see server/src/index.ts), or a
 *     brief room-death gap. Retrying a moment later succeeds.
 * So a 521 must be RETRIED a few times before it is treated as "full".
 *
 * The module reads no clock and performs no I/O: the caller injects both the
 * `attempt` and the `sleep`, so unit tests drive the whole schedule with a fake
 * clock and no real timers — matching the discipline of the other net/ pure
 * modules (backoff, reconnectPolicy).
 */

export interface RetryWhileOptions<T> {
  /** The operation to (re)try — e.g. `() => client.join(WORLD_ROOM, params)`. */
  attempt: () => Promise<T>;
  /** True ⇒ this error is worth retrying (e.g. a capacity-shaped 521). */
  shouldRetry: (err: unknown) => boolean;
  /**
   * Inter-attempt delays (ms). Its length is EXACTLY the number of retries after
   * the first attempt, so total attempts = `delaysMs.length + 1`.
   */
  delaysMs: number[];
  /** Injected delay (kept out of this module so it stays clock-free/testable). */
  sleep: (ms: number) => Promise<void>;
}

/**
 * Try `attempt()`, retrying while `shouldRetry` holds and delays remain.
 * Returns the first success. RE-THROWS the LAST error when the error is not
 * retryable (surfaced immediately) or every delay has been spent — so the caller
 * maps that final error to a user-facing notice.
 */
export async function retryWhile<T>(opts: RetryWhileOptions<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; ; i++) {
    try {
      return await opts.attempt();
    } catch (err) {
      lastErr = err;
      // Non-retryable, or the schedule is exhausted → give up with the last error.
      if (!opts.shouldRetry(err) || i >= opts.delaysMs.length) throw lastErr;
      await opts.sleep(opts.delaysMs[i]);
    }
  }
}
