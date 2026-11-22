import { CANDLE_BURN_MS, type CandleLitPayload, type CandleOutPayload } from "@caysonverse/shared/village/messages";

/**
 * The memorial hall's candles, kept by the server (owner 2026-11-13: "초를 켜면 1시간 정도 켜졌다가 꺼지게 … 그럼 누가 와서 켜고
 * 갔는지 알잖아"). One book for the whole process — every village room (a shard) shares it, so a candle lit in one room burns in
 * the hall of every other room too, and a visitor who walks in later sees it and who lit it.
 *
 * A candle burns `CANDLE_BURN_MS` (an hour) from the moment the server accepted it; while it burns the cubby's candle cannot be
 * lit again (the first visitor's name stays on it). Since 2026-11-20 (owner: "촛불을 밝힐 수도 있고 끌 수도 있게") it can also be put
 * out before the hour is up — by whoever lit it (`Lighter`: the same device key, else the same tab, else the same session), or by
 * the cubby's family (the room checks that); then it can be lit again by anyone. Times are the server's wall clock (ms); nothing
 * is written to disk: a server restart puts the candles out (an hour's light, not a record — the cubby's own records come with the
 * families' memorials, in SQLite, which this does not touch).
 */

/** Who lit a candle: their nickname for the card, and what identifies them again (null parts are unknown). */
export interface Lighter {
  nickname: string;
  sessionId: string;
  /** The device-key hash the session joined with (survives a reload and a new tab on the same device). */
  keyHash: string | null;
  /** The tab's own id (survives a reconnect of the same tab). */
  tabId: string | null;
}

/** Is `who` the same visitor as `lit` (device key first, then tab, then session)? */
export function sameLighter(lit: Omit<Lighter, "nickname">, who: Omit<Lighter, "nickname">): boolean {
  if (lit.keyHash !== null && who.keyHash !== null) return lit.keyHash === who.keyHash;
  if (lit.tabId !== null && who.tabId !== null) return lit.tabId === who.tabId;
  return lit.sessionId !== "" && lit.sessionId === who.sessionId;
}

type Lit = { at: number } & Lighter;

export class CandleBook {
  private readonly lit = new Map<string, Lit>();
  private readonly listeners = new Set<(c: CandleLitPayload) => void>();
  private readonly outListeners = new Set<(c: CandleOutPayload) => void>();

  /**
   * Light `cubby`'s candle for `by` at `now`: the new candle, or null when one is already burning there. `by` is a nickname (old
   * callers, tests) or the full `Lighter`.
   */
  light(cubby: string, by: string | Lighter, now: number): CandleLitPayload | null {
    this.prune(now);
    if (this.lit.has(cubby)) return null;
    const who: Lighter = typeof by === "string" ? { nickname: by, sessionId: "", keyHash: null, tabId: null } : by;
    this.lit.set(cubby, { at: now, ...who });
    const c: CandleLitPayload = { cubby, by: who.nickname, agoMs: 0, ...(who.sessionId ? { sid: who.sessionId } : {}) };
    for (const l of [...this.listeners]) l(c);
    return c;
  }

  /** Is `cubby`'s candle burning at `now`? */
  burning(cubby: string, now: number): boolean {
    const c = this.lit.get(cubby);
    return c !== undefined && now - c.at < CANDLE_BURN_MS;
  }

  /** Who lit `cubby`'s burning candle (null: none burns). */
  lighter(cubby: string, now: number): Lighter | null {
    const c = this.lit.get(cubby);
    if (c === undefined || now - c.at >= CANDLE_BURN_MS) return null;
    return { nickname: c.nickname, sessionId: c.sessionId, keyHash: c.keyHash, tabId: c.tabId };
  }

  /**
   * Put `cubby`'s candle out (the room has checked who may): the notice, or null when none was burning. `by` is the nickname of
   * whoever put it out.
   */
  putOut(cubby: string, by: string, now: number): CandleOutPayload | null {
    if (!this.burning(cubby, now)) {
      this.prune(now);
      return null;
    }
    this.lit.delete(cubby);
    const c: CandleOutPayload = { cubby, by };
    for (const l of [...this.outListeners]) l(c);
    return c;
  }

  /**
   * The candles burning at `now`, each with how long ago it was lit. With `viewer`, each also says whether that visitor lit it
   * (`mine`, for the "촛불 끄기" button after a reload); a snapshot never carries the lighter's session id.
   */
  snapshot(now: number, viewer?: Omit<Lighter, "nickname">): CandleLitPayload[] {
    this.prune(now);
    return [...this.lit].map(([cubby, c]) => ({
      cubby,
      by: c.nickname,
      agoMs: Math.max(0, now - c.at),
      ...(viewer && sameLighter(c, viewer) ? { mine: true } : {}),
    }));
  }

  /** Hear every new candle (a room relays it to its own hall). Returns the unsubscribe. */
  onLit(listener: (c: CandleLitPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Hear every candle put out (a room relays it to its own hall). Returns the unsubscribe. */
  onOut(listener: (c: CandleOutPayload) => void): () => void {
    this.outListeners.add(listener);
    return () => {
      this.outListeners.delete(listener);
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
