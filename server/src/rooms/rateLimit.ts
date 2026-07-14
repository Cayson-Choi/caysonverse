/**
 * Sliding-window rate limiter, kept clock-free: every method takes the current
 * time (`now`, ms) as an argument so the room can supply `Date.now()` in
 * production while tests drive it with explicit timestamps (no fake timers, no
 * wall-clock flakiness).
 */
export class RateWindow {
  private readonly hits: number[] = [];

  /**
   * @param limit    maximum accepted messages within any `windowMs` window
   * @param windowMs length of the sliding window in milliseconds
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 1000,
  ) {}

  /**
   * Record an attempt at time `now`. Returns `true` if it fits within the cap
   * (and is counted), or `false` if it exceeds the cap (dropped, not counted —
   * a dropped attempt never consumes a slot).
   */
  tryAccept(now: number): boolean {
    // Evict hits strictly older than the window (exactly windowMs-old stays).
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && this.hits[0] < cutoff) {
      this.hits.shift();
    }
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
