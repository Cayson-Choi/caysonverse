import { describe, expect, it } from "vitest";
import { KeptSlot } from "./keptMemo";

describe("KeptSlot", () => {
  it("makes once for the same inputs, however many renders ask", () => {
    const dropped: number[] = [];
    const slot = new KeptSlot<{ n: number }>((v) => dropped.push(v.n));
    const a = {};
    let made = 0;
    const make = () => ({ n: ++made });
    const v1 = slot.get([a, 1], make);
    for (let i = 0; i < 20; i++) expect(slot.get([a, 1], make)).toBe(v1);
    expect(made).toBe(1);
    expect(dropped).toEqual([]);
  });

  it("frees an undrawn value when the inputs change, keeps a drawn one for its component", () => {
    const dropped: number[] = [];
    const slot = new KeptSlot<{ n: number }>((v) => dropped.push(v.n));
    let made = 0;
    const make = () => ({ n: ++made });
    slot.get(["x"], make); // never drawn (the render was thrown away, then the inputs changed)
    const drawn = slot.get(["y"], make);
    expect(dropped).toEqual([1]);
    slot.commit(drawn);
    slot.get(["z"], make); // a tier switch: the drawn one is its component's to free
    expect(dropped).toEqual([1]);
  });

  it("hands out a new value after the component released the old one", () => {
    const slot = new KeptSlot<{ n: number }>(() => {});
    let made = 0;
    const make = () => ({ n: ++made });
    const deps = ["m"];
    const v = slot.get(deps, make);
    slot.commit(v);
    slot.release(v);
    const w = slot.get(deps, make);
    expect(w).not.toBe(v);
    expect(made).toBe(2);
  });

  it("ignores commit / release of a value it no longer holds", () => {
    const dropped: number[] = [];
    const slot = new KeptSlot<{ n: number }>((v) => dropped.push(v.n));
    let made = 0;
    const make = () => ({ n: ++made });
    const old = slot.get(["a"], make);
    slot.commit(old);
    const now = slot.get(["b"], make);
    slot.release(old);
    expect(slot.get(["b"], make)).toBe(now);
    slot.commit(old);
    slot.get(["c"], make); // `now` was never drawn: freed
    expect(dropped).toEqual([2]);
  });
});
