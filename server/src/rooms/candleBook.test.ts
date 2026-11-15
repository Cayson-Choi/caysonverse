import { afterEach, describe, expect, it } from "vitest";
import { CANDLE_BURN_MS } from "@caysonverse/shared/village/messages";
import { CandleBook } from "./candleBook";

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
});
