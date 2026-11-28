import { describe, expect, it } from "vitest";
import { FileLoader, ImageBitmapLoader, ImageLoader } from "three";
import { createLoadTracker, loadTracker } from "./loadTracker";

type Cb = (v: unknown) => void;
function fakeLoader() {
  const calls: Array<{ url: string; onLoad?: Cb; onError?: Cb }> = [];
  class Fake {
    load(url: string, onLoad?: Cb, _p?: Cb, onError?: Cb) {
      calls.push({ url, onLoad, onError });
      return "ret";
    }
  }
  return { Fake, calls };
}

describe("loadTracker: every file three is fetching, whichever manager", () => {
  it("counts a request from the call until its onLoad or onError, once each, and passes the callbacks through", () => {
    let t = 0;
    const { tracker, trackLoaderPrototype } = createLoadTracker(() => t);
    const { Fake, calls } = fakeLoader();
    trackLoaderPrototype(Fake.prototype);
    trackLoaderPrototype(Fake.prototype); // twice: wrapped once
    const got: unknown[] = [];
    const f = new Fake();
    t = 5;
    expect(f.load("/a.glb", (v) => got.push(v))).toBe("ret");
    f.load("/b.ktx2", undefined, undefined, (e) => got.push(["err", e]));
    f.load("/a.glb"); // a second caller of the same url (FileLoader's dedupe calls each back)
    expect(tracker.pending()).toBe(3);
    expect(tracker.urls().sort()).toEqual(["/a.glb", "/b.ktx2"]);
    expect(tracker.lastChange()).toBe(5);
    t = 9;
    calls[0]!.onLoad!("A");
    calls[0]!.onLoad!("again"); // a loader calling back twice ends it once
    expect(tracker.pending()).toBe(2);
    calls[1]!.onError!("404");
    calls[2]!.onLoad!("A2");
    expect(tracker.pending()).toBe(0);
    expect(tracker.started()).toBe(3);
    expect(tracker.ended()).toBe(3);
    expect(tracker.urls()).toEqual([]);
    expect(tracker.lastChange()).toBe(9);
    expect(got).toEqual(["A", "again", ["err", "404"]]);
  });

  it("a load that throws at once is not left counted", () => {
    const { tracker, trackLoaderPrototype } = createLoadTracker();
    class Bad {
      load(): unknown {
        throw new Error("no");
      }
    }
    trackLoaderPrototype(Bad.prototype as never);
    expect(() => (new Bad() as unknown as { load: (u: string) => void }).load("/x")).toThrow("no");
    expect(tracker.pending()).toBe(0);
  });

  it("is installed on three's three fetching loaders", () => {
    for (const C of [FileLoader, ImageLoader, ImageBitmapLoader]) expect((C.prototype as unknown as { __cvTracked?: boolean }).__cvTracked).toBe(true);
    expect(loadTracker.pending()).toBeGreaterThanOrEqual(0);
  });
});
