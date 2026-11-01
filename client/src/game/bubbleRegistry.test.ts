import { describe, it, expect, vi, afterEach } from "vitest";
import { SPEECH_BUBBLE_MS, MAX_VISIBLE_BUBBLES } from "@caysonverse/shared/constants";
import { BubbleRegistry, type BubbleEntry } from "./bubbleRegistry";

describe("BubbleRegistry", () => {
  it("stores and returns a visible bubble for a session", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "안녕", 0);
    expect(reg.get("a", 0)?.text).toBe("안녕");
  });

  it("returns null for an unknown session", () => {
    const reg = new BubbleRegistry();
    expect(reg.get("nobody", 0)).toBeNull();
  });

  it("replaces the current bubble on a newer message from the same session", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    const first = reg.get("a", 0)!;
    reg.set("a", "bye", 100);
    const second = reg.get("a", 100)!;
    expect(second.text).toBe("bye");
    // A newer message resets the seq forward so followers can detect the change.
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it("refreshes the TTL when replaced (does not expire on the old timer)", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    reg.set("a", "bye", 5000); // replaced late in the first bubble's life
    expect(reg.get("a", 5000)?.text).toBe("bye");
    expect(reg.get("a", 5000 + SPEECH_BUBBLE_MS - 1)?.text).toBe("bye");
    expect(reg.get("a", 5000 + SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("expires a bubble exactly SPEECH_BUBBLE_MS after it was set", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    expect(reg.get("a", SPEECH_BUBBLE_MS - 1)?.text).toBe("hi");
    expect(reg.get("a", SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("removes a bubble on demand (leaving avatar)", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    reg.remove("a");
    expect(reg.get("a", 0)).toBeNull();
  });

  it("hides the oldest when more than MAX_VISIBLE_BUBBLES are active", () => {
    const reg = new BubbleRegistry();
    const total = MAX_VISIBLE_BUBBLES + 1;
    for (let i = 0; i < total; i++) reg.set(`s${i}`, `m${i}`, i); // all within TTL
    const now = total;

    // The very first (oldest) is hidden; every newer one stays visible.
    expect(reg.get("s0", now)).toBeNull();
    for (let i = 1; i < total; i++) {
      expect(reg.get(`s${i}`, now)?.text).toBe(`m${i}`);
    }
  });

  it("re-shows a replaced oldest bubble and evicts the new oldest", () => {
    const reg = new BubbleRegistry();
    const total = MAX_VISIBLE_BUBBLES + 1;
    for (let i = 0; i < total; i++) reg.set(`s${i}`, `m${i}`, i);

    // Replacing s0 makes it the newest → visible again; s1 is now the oldest.
    reg.set("s0", "again", total);
    const now = total;
    expect(reg.get("s0", now)?.text).toBe("again");
    expect(reg.get("s1", now)).toBeNull();
  });

  it("clears all bubbles", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "hi", 0);
    reg.set("b", "yo", 0);
    reg.clear();
    expect(reg.get("a", 0)).toBeNull();
    expect(reg.get("b", 0)).toBeNull();
  });

  describe("visibleInto", () => {
    it("writes nothing for an empty registry, and empties the caller's array first", () => {
      const reg = new BubbleRegistry();
      const out: BubbleEntry[] = [{ sid: "stale", text: "x", expiresAt: 1, seq: 1 }];
      expect(reg.visibleInto(out, 0)).toBe(0);
      expect(out).toEqual([]);
    });

    it("lists exactly the bubbles get() would return, and drops expired ones", () => {
      const reg = new BubbleRegistry();
      reg.set("a", "one", 0);
      reg.set("b", "two", 3000);
      const out: BubbleEntry[] = [];
      expect(reg.visibleInto(out, 3000)).toBe(2);
      expect(out.map((e) => e.sid).sort()).toEqual(["a", "b"]);
      expect(out.find((e) => e.sid === "a")).toBe(reg.get("a", 3000));
      // "a" expires at SPEECH_BUBBLE_MS; "b" is still up.
      expect(reg.visibleInto(out, SPEECH_BUBBLE_MS)).toBe(1);
      expect(out[0].sid).toBe("b");
      expect(reg.visibleInto(out, 3000 + SPEECH_BUBBLE_MS)).toBe(0);
    });

    it("hides the oldest beyond MAX_VISIBLE_BUBBLES, like get() and snapshot()", () => {
      const reg = new BubbleRegistry();
      const total = MAX_VISIBLE_BUBBLES + 3;
      for (let i = 0; i < total; i++) reg.set(`s${i}`, `m${i}`, i);
      const out: BubbleEntry[] = [];
      expect(reg.visibleInto(out, total)).toBe(MAX_VISIBLE_BUBBLES);
      const ids = out.map((e) => e.sid).sort();
      expect(ids).toEqual(
        reg
          .snapshot(total)
          .map((e) => e.sid)
          .sort(),
      );
      for (let i = 0; i < 3; i++) expect(ids).not.toContain(`s${i}`);
      for (const e of out) expect(reg.get(e.sid, total)).toBe(e);
    });
  });
});

describe("BubbleRegistry — pruning is skipped until something can expire", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** How many times a Map was iterated with for-of while `fn` ran (prune walks `entries` that way). */
  function mapWalks(fn: () => void): number {
    const real = Map.prototype[Symbol.iterator];
    let walks = 0;
    vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function (this: Map<unknown, unknown>) {
      walks++;
      return real.call(this);
    });
    fn();
    vi.restoreAllMocks();
    return walks;
  }

  it("get() does not walk the entries on every call while nothing has expired", () => {
    const reg = new BubbleRegistry();
    for (let i = 0; i < 10; i++) reg.set("p" + i, "hi", 1000 + i);
    // 100 avatars each ask once per frame: none of those calls may walk the whole map.
    const walks = mapWalks(() => {
      for (let i = 0; i < 100; i++) reg.get("p" + (i % 10), 2000);
    });
    expect(walks).toBe(0);
  });

  it("still expires the earliest bubble on time, and later ones on theirs", () => {
    const reg = new BubbleRegistry();
    reg.set("early", "a", 0);
    reg.set("late", "b", 4000);
    expect(reg.get("early", SPEECH_BUBBLE_MS - 1)?.text).toBe("a");
    expect(reg.get("early", SPEECH_BUBBLE_MS)).toBeNull();
    expect(reg.get("late", SPEECH_BUBBLE_MS)?.text).toBe("b");
    expect(reg.get("late", 4000 + SPEECH_BUBBLE_MS - 1)?.text).toBe("b");
    expect(reg.get("late", 4000 + SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("a refreshed bubble outlives its first deadline even though the skip bound is older", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "first", 0);
    reg.set("b", "other", 100);
    reg.set("a", "second", 5000); // the bound (0 + TTL) is now stale
    expect(reg.get("a", SPEECH_BUBBLE_MS)?.text).toBe("second"); // walk happens, a is kept
    expect(reg.get("b", 100 + SPEECH_BUBBLE_MS - 1)?.text).toBe("other");
    expect(reg.get("b", 100 + SPEECH_BUBBLE_MS)).toBeNull(); // b really expired at 100 + TTL
    expect(reg.get("a", 5000 + SPEECH_BUBBLE_MS - 1)?.text).toBe("second");
    expect(reg.get("a", 5000 + SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("a removed earliest bubble never makes a later one expire early or late", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "x", 0);
    reg.set("b", "y", 3000);
    reg.remove("a");
    expect(reg.get("b", 3000 + SPEECH_BUBBLE_MS - 1)?.text).toBe("y");
    expect(reg.get("b", 3000 + SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("clear() resets the bound: a bubble set afterwards at an earlier time still expires", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "x", 50000);
    reg.clear();
    reg.set("b", "y", 0);
    expect(reg.get("b", SPEECH_BUBBLE_MS - 1)?.text).toBe("y");
    expect(reg.get("b", SPEECH_BUBBLE_MS)).toBeNull();
  });

  it("snapshot() and visibleInto() also see an expiry right on time", () => {
    const reg = new BubbleRegistry();
    reg.set("a", "x", 0);
    const out: BubbleEntry[] = [];
    expect(reg.visibleInto(out, SPEECH_BUBBLE_MS - 1)).toBe(1);
    expect(reg.visibleInto(out, SPEECH_BUBBLE_MS)).toBe(0);
    reg.set("b", "y", 10000);
    expect(reg.snapshot(10000).map((b) => b.sid)).toEqual(["b"]);
  });
});
