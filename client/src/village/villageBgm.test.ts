import { describe, expect, it } from "vitest";
import { BGM_SRC, BGM_STORAGE_KEY, VillageBgm, type BgmAudio } from "./villageBgm";

class FakeAudio implements BgmAudio {
  src = "";
  loop = false;
  preload = "auto";
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 180;
  playCalls = 0;
  rejectPlay = false;
  released = false;
  play() {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {
    this.released = true;
  }
}

function setup(opts: { stored?: string | null; storageThrows?: boolean } = {}) {
  let t = 0;
  const audios: FakeAudio[] = [];
  const handlers = new Map<string, Set<() => void>>();
  const store = new Map<string, string>();
  if (opts.stored != null) store.set(BGM_STORAGE_KEY, opts.stored);
  let ticking = 0;
  const make = () =>
    new VillageBgm({
      createAudio: () => {
        const a = new FakeAudio();
        audios.push(a);
        return a;
      },
      now: () => t,
      schedule: () => {
        ticking++;
        return () => {
          ticking--;
        };
      },
      gestureTarget: {
        addEventListener: (type, fn) => void (handlers.get(type) ?? handlers.set(type, new Set()).get(type)!).add(fn),
        removeEventListener: (type, fn) => void handlers.get(type)?.delete(fn),
      },
      storage: () => {
        if (opts.storageThrows) throw new Error("blocked");
        return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
      },
    });
  const gesture = (type = "pointerdown") => [...(handlers.get(type) ?? [])].forEach((f) => f());
  const advance = (ms: number, bgm: VillageBgm) => {
    t += ms;
    bgm.tick();
  };
  const listenerCount = () => [...handlers.values()].reduce((n, s) => n + s.size, 0);
  return { make, audios, gesture, advance, store, listenerCount, ticking: () => ticking };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("VillageBgm", () => {
  it("creates a lazy, looping element and stays silent until the first gesture", () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    expect(a.src).toBe(BGM_SRC);
    expect(a.loop).toBe(true);
    expect(a.preload).toBe("none");
    expect(a.playCalls).toBe(0);
    expect(a.paused).toBe(true);
  });

  it("starts on the first gesture with a 1.5 s fade-in to 0.35, then stops listening", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture("keydown");
    await flush();
    const a = s.audios[0]!;
    expect(a.paused).toBe(false);
    expect(a.volume).toBe(0);
    s.advance(750, bgm);
    expect(a.volume).toBeCloseTo(0.175, 3);
    s.advance(750, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
    expect(s.listenerCount()).toBe(0);
    expect(s.ticking()).toBe(1);
  });

  it("a rejected play() does not throw and the next gesture tries again", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.rejectPlay = true;
    expect(() => s.gesture()).not.toThrow();
    await flush();
    expect(a.paused).toBe(true);
    expect(s.listenerCount()).toBeGreaterThan(0);
    a.rejectPlay = false;
    s.gesture();
    await flush();
    expect(a.paused).toBe(false);
    expect(s.listenerCount()).toBe(0);
  });

  it("ducks to 0.15 over 1 s in the hall and restores outside", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    s.advance(2000, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
    bgm.setHall(true);
    s.advance(500, bgm);
    expect(a.volume).toBeCloseTo(0.25, 3);
    s.advance(500, bgm);
    expect(a.volume).toBeCloseTo(0.15, 3);
    bgm.setHall(false);
    s.advance(1000, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
  });

  it("duck(level, ms) and unduck(ms) scale the music for a guide's voice", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    s.advance(2000, bgm);
    bgm.duck(0.4, 200);
    s.advance(200, bgm);
    expect(a.volume).toBeCloseTo(0.14, 3);
    bgm.unduck(200);
    s.advance(200, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
  });

  it("pauses when the tab is hidden and fades back in when visible", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    s.advance(2000, bgm);
    bgm.setVisible(false);
    expect(a.paused).toBe(true);
    expect(s.ticking()).toBe(0);
    bgm.setVisible(true);
    await flush();
    expect(a.paused).toBe(false);
    expect(a.volume).toBe(0);
    s.advance(1500, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
  });

  it("a tab hidden before any gesture does not start, and a hidden tab stays silent when music is off", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    bgm.setVisible(false);
    s.gesture();
    await flush();
    expect(s.audios[0]!.playCalls).toBe(0);
    bgm.setVisible(true);
    expect(s.audios[0]!.playCalls).toBe(0);
  });

  it("fades out over the last 2 s of the loop and fades in at the restart", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    s.advance(2000, bgm);
    a.currentTime = 178;
    bgm.tick();
    expect(a.volume).toBeCloseTo(0.35, 3);
    a.currentTime = 179;
    bgm.tick();
    expect(a.volume).toBeCloseTo(0.175, 3);
    a.currentTime = 179.9;
    bgm.tick();
    expect(a.volume).toBeLessThan(0.02);
    a.currentTime = 0.1; // the native loop wrapped
    bgm.tick();
    expect(a.volume).toBeCloseTo(0, 2);
    s.advance(1500, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
  });

  it("the toggle persists, defaults to on, pauses, and plays again", async () => {
    const s = setup();
    const bgm = s.make();
    expect(bgm.isEnabled()).toBe(true);
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    let notified = 0;
    bgm.subscribe(() => notified++);
    bgm.toggle();
    expect(bgm.isEnabled()).toBe(false);
    expect(a.paused).toBe(true);
    expect(s.store.get(BGM_STORAGE_KEY)).toBe("0");
    expect(notified).toBe(1);
    bgm.toggle();
    await flush();
    expect(a.paused).toBe(false);
    expect(s.store.get(BGM_STORAGE_KEY)).toBe("1");
  });

  it("a stored 0 starts off and a gesture plays nothing", async () => {
    const s = setup({ stored: "0" });
    const bgm = s.make();
    expect(bgm.isEnabled()).toBe(false);
    bgm.arm();
    s.gesture();
    await flush();
    expect(s.audios[0]!.playCalls).toBe(0);
    bgm.setEnabled(true);
    await flush();
    expect(s.audios[0]!.paused).toBe(false);
  });

  it("survives localStorage throwing", async () => {
    const s = setup({ storageThrows: true });
    const bgm = s.make();
    expect(bgm.isEnabled()).toBe(true);
    expect(() => bgm.toggle()).not.toThrow();
    expect(bgm.isEnabled()).toBe(false);
  });

  it("dispose pauses, releases the element, drops listeners and the timer", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    bgm.dispose();
    expect(a.paused).toBe(true);
    expect(a.src).toBe("");
    expect(a.released).toBe(true);
    expect(s.ticking()).toBe(0);
    expect(s.listenerCount()).toBe(0);
    expect(() => bgm.toggle()).not.toThrow();
    expect(() => bgm.tick()).not.toThrow();
  });

  it("a StrictMode double mount (create, dispose, create) leaves one live element and one set of listeners", async () => {
    const s = setup();
    const first = s.make();
    first.arm();
    first.dispose();
    const second = s.make();
    second.arm();
    expect(s.audios.filter((a) => !a.released && a.src !== "").length).toBe(1);
    expect(s.listenerCount()).toBe(3);
    s.gesture();
    await flush();
    expect(s.audios[0]!.playCalls).toBe(0);
    expect(s.audios[1]!.paused).toBe(false);
  });
});
