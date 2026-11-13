import { describe, expect, it } from "vitest";
import { createVegPark, type Parkable } from "./vegPark";

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    set: (fn: () => void) => {
      pending.set(++id, fn);
      return id;
    },
    clear: (h: unknown) => void pending.delete(h as number),
    flush() {
      for (const [k, fn] of [...pending]) {
        pending.delete(k);
        fn();
      }
    },
  };
}

function veg() {
  const log: string[] = [];
  const v: Parkable & { log: string[] } = {
    log,
    detach: () => log.push("detach"),
    releaseGpu: () => log.push("gpu"),
    dispose: () => log.push("dispose"),
  };
  return v;
}

type V = ReturnType<typeof veg>;

describe("vegPark: the vegetation kept while indoors", () => {
  it("parks (detached) and gives it back for the same tier and mode, once", () => {
    const t = fakeTimers();
    const park = createVegPark<V>(t);
    const release = park.hold();
    const v = veg();
    park.park(v, "high", "new");
    expect(v.log).toEqual(["detach"]);
    t.flush();
    expect(park.take("high", "new")).toBe(v);
    expect(park.take("high", "new")).toBeNull();
    release();
  });

  it("the phone tier frees the GPU buffers while parked", () => {
    const park = createVegPark<V>(fakeTimers());
    park.hold();
    const v = veg();
    park.park(v, "low", "new");
    expect(v.log).toEqual(["detach", "gpu"]);
  });

  it("another tier or mode builds anew: the parked one is freed", () => {
    const park = createVegPark<V>(fakeTimers());
    park.hold();
    const v = veg();
    park.park(v, "high", "new");
    expect(park.take("low", "new")).toBeNull();
    expect(v.log).toContain("dispose");
  });

  it("freed one tick after the scene lets go, also when the model parks after the scene's own cleanup", () => {
    const t = fakeTimers();
    const park = createVegPark<V>(t);
    const release = park.hold();
    const a = veg();
    park.park(a, "high", "new");
    release();
    t.flush();
    expect(a.log).toContain("dispose");
    expect(park.peek()).toBeNull();
    // the scene's cleanup first, the model's park after it
    const release2 = park.hold();
    release2();
    const b = veg();
    park.park(b, "high", "new");
    t.flush();
    expect(b.log).toContain("dispose");
  });

  it("a scene that comes back within the tick keeps it (a reconnect remounts the scene)", () => {
    const t = fakeTimers();
    const park = createVegPark<V>(t);
    const release = park.hold();
    const v = veg();
    park.park(v, "high", "new");
    release();
    park.hold();
    t.flush();
    expect(v.log).not.toContain("dispose");
    expect(park.take("high", "new")).toBe(v);
  });
});
