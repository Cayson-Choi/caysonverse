import { afterEach, describe, expect, it } from "vitest";
import { CANDLE_BURN_MS } from "@caysonverse/shared/village/messages";
import { CandleBook, sameLighter } from "./candleBook";

describe("CandleBook — the server keeps each candle an hour, with who lit it", () => {
  const book = new CandleBook();
  afterEach(() => book.clear());

  it("a candle burns an hour from when it was lit, then goes out", () => {
    expect(book.light("M1-A-r3-c11", "케이슨", 1000)).toEqual({ cubby: "M1-A-r3-c11", by: "케이슨", agoMs: 0 });
    expect(book.burning("M1-A-r3-c11", 1000 + CANDLE_BURN_MS - 1)).toBe(true);
    expect(book.burning("M1-A-r3-c11", 1000 + CANDLE_BURN_MS)).toBe(false);
    expect(book.snapshot(1000 + CANDLE_BURN_MS)).toEqual([]);
  });

  it("while it burns it cannot be lit again: the first visitor's name stays", () => {
    book.light("c", "밥이", 0);
    expect(book.light("c", "캐럴", 32 * 60_000)).toBeNull();
    expect(book.snapshot(32 * 60_000)).toEqual([{ cubby: "c", by: "밥이", agoMs: 32 * 60_000 }]);
    // burnt out: lit again, by the new visitor
    expect(book.light("c", "캐럴", CANDLE_BURN_MS)).toEqual({ cubby: "c", by: "캐럴", agoMs: 0 });
  });

  it("every room hears a new candle (the book is shared by the shards); an unsubscribed one does not", () => {
    const heard: string[] = [];
    const off = book.onLit((c) => heard.push(`${c.cubby}:${c.by}`));
    book.light("a", "x", 0);
    book.light("a", "y", 1); // refused: not heard
    off();
    book.light("b", "z", 2);
    expect(heard).toEqual(["a:x"]);
  });

  it("put out (owner 2026-11-20): the candle is forgotten, every room hears it, and anyone may light it again", () => {
    const heard: string[] = [];
    const off = book.onOut((c) => heard.push(`${c.cubby}:${c.by}`));
    expect(book.putOut("c", "x", 0)).toBeNull(); // nothing burns
    book.light("c", { nickname: "밥이", sessionId: "s1", keyHash: "k1", tabId: "t1" }, 0);
    expect(book.lighter("c", 10)).toEqual({ nickname: "밥이", sessionId: "s1", keyHash: "k1", tabId: "t1" });
    expect(book.putOut("c", "밥이", 10)).toEqual({ cubby: "c", by: "밥이" });
    expect(book.burning("c", 10)).toBe(false);
    expect(book.lighter("c", 10)).toBeNull();
    expect(book.light("c", "캐럴", 20)).toEqual({ cubby: "c", by: "캐럴", agoMs: 0 });
    off();
    book.putOut("c", "캐럴", 30);
    expect(heard).toEqual(["c:밥이"]);
  });

  it("a burnt-out candle cannot be put out (it is already gone)", () => {
    book.light("c", "x", 0);
    expect(book.putOut("c", "x", CANDLE_BURN_MS)).toBeNull();
  });

  it("the lighter is known again by device key, else tab, else session; a snapshot marks the viewer's own candles", () => {
    expect(sameLighter({ sessionId: "s1", keyHash: "k", tabId: "t1" }, { sessionId: "s2", keyHash: "k", tabId: "t2" })).toBe(true);
    expect(sameLighter({ sessionId: "s1", keyHash: "k", tabId: "t" }, { sessionId: "s1", keyHash: "other", tabId: "t" })).toBe(false);
    expect(sameLighter({ sessionId: "s1", keyHash: null, tabId: "t" }, { sessionId: "s2", keyHash: "k", tabId: "t" })).toBe(true);
    expect(sameLighter({ sessionId: "s1", keyHash: null, tabId: null }, { sessionId: "s1", keyHash: null, tabId: null })).toBe(true);
    expect(sameLighter({ sessionId: "", keyHash: null, tabId: null }, { sessionId: "", keyHash: null, tabId: null })).toBe(false);
    book.light("a", { nickname: "밥이", sessionId: "s1", keyHash: "k1", tabId: null }, 0);
    book.light("b", "캐럴", 0);
    expect(book.light("z", { nickname: "밥이", sessionId: "s1", keyHash: "k1", tabId: null }, 0)).toEqual({ cubby: "z", by: "밥이", agoMs: 0, sid: "s1" });
    expect(book.snapshot(5, { sessionId: "s9", keyHash: "k1", tabId: null })).toEqual([
      { cubby: "a", by: "밥이", agoMs: 5, mine: true },
      { cubby: "b", by: "캐럴", agoMs: 5 },
      { cubby: "z", by: "밥이", agoMs: 5, mine: true },
    ]);
  });
});
