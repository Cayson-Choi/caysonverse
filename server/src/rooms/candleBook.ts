import { CANDLE_BURN_MS, type CandleLitPayload } from "@caysonverse/shared/village/messages";

/**
 * The memorial hall's candles, kept by the server (owner 2026-11-13: "초를 켜면 1시간 정도 켜졌다가 꺼지게 … 그럼 누가 와서 켜고
 * 갔는지 알잖아"). One book for the whole process — every village room (a shard) shares it, so a candle lit in one room burns in
 * the hall of every other room too, and a visitor who walks in later sees it and who lit it.
 *
 * A candle burns `CANDLE_BURN_MS` (an hour) from the moment the server accepted it; while it burns the cubby's candle cannot be
 * lit again (the first visitor's name stays on it). Times are the server's wall clock (ms); nothing is written to disk: a server
 * restart puts the candles out (an hour's light, not a record — the cubby's own records come with the families' memorials).
 */
export class CandleBook {
  private readonly lit = new Map<string, { at: number; by: string }>();
  private readonly listeners = new Set<(c: CandleLitPayload) => void>();

  /** Light `cubby`'s candle for `by` at `now`: the new candle, or null when one is already burning there. */
  light(cubby: string, by: string, now: number): CandleLitPayload | null {
    this.prune(now);
    if (this.lit.has(cubby)) return null;
    this.lit.set(cubby, { at: now, by });
    const c: CandleLitPayload = { cubby, by, agoMs: 0 };
    for (const l of [...this.listeners]) l(c);
    return c;
  }

  /** Is `cubby`'s candle burning at `now`? */
  burning(cubby: string, now: number): boolean {
    const c = this.lit.get(cubby);
    return c !== undefined && now - c.at < CANDLE_BURN_MS;
  }

  /** The candles burning at `now`, each with how long ago it was lit. */
  snapshot(now: number): CandleLitPayload[] {
    this.prune(now);
    return [...this.lit].map(([cubby, c]) => ({ cubby, by: c.by, agoMs: Math.max(0, now - c.at) }));
  }

  /** Hear every new candle (a room relays it to its own hall). Returns the unsubscribe. */
  onLit(listener: (c: CandleLitPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drop the candles that have burnt out by `now`. */
  prune(now: number): void {
    for (const [cubby, c] of this.lit) if (now - c.at >= CANDLE_BURN_MS) this.lit.delete(cubby);
  }

  /** Put every candle out (tests). */
  clear(): void {
    this.lit.clear();
  }
}

/** The process's one book. */
export const CANDLES = new CandleBook();
