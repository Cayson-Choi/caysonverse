/**
 * Pure exponential-backoff schedule for the fresh-join fallback (the "server
 * restarted mid-lecture" path). Returns the full list of inter-attempt delays in
 * milliseconds up front, so the reconnection driver can iterate it with an
 * injected timer — this module reads no clock and performs no I/O, so it is
 * exhaustively unit-testable.
 *
 * Contract (binding, from the brief): 1s, 2s, 4s, 8s… doubling from 1s, each
 * delay capped at 8s, total budget ≈ 30s. A delay is included while the running
 * total spent SO FAR is still under the budget, so the schedule is finite and
 * lands near ~30s (six attempts by default: 1+2+4+8+8+8 = 31s).
 */
export interface BackoffOptions {
  /** First delay (ms) — doubled each attempt. Default 1000. */
  baseMs?: number;
  /** Per-delay ceiling (ms). Default 8000. */
  capMs?: number;
  /** Total time budget (ms) the schedule may span. Default 30000. */
  budgetMs?: number;
}

export function reconnectBackoffMs(opts: BackoffOptions = {}): number[] {
  const baseMs = opts.baseMs ?? 1000;
  const capMs = opts.capMs ?? 8000;
  const budgetMs = opts.budgetMs ?? 30000;

  const delays: number[] = [];
  let spent = 0;
  // Include another attempt while the time already committed is under budget.
  for (let attempt = 0; spent < budgetMs; attempt++) {
    const delay = Math.min(capMs, baseMs * 2 ** attempt);
    delays.push(delay);
    spent += delay;
  }
  return delays;
}
