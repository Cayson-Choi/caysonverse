import { beforeEach, describe, expect, it } from "vitest";
import { BGM_FALLBACK_MS, BGM_GESTURES, BGM_SRC, BGM_STORAGE_KEY, VillageBgm, activeVillageBgm, mountVillageBgm, resetVillageBgmCarry, type BgmAudio } from "./villageBgm";
import type { GainSink } from "./villageAudio";

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
  /** Hold play() pending until `resolvePending()` (a browser still loading or deciding). */
  deferPlay = false;
  resolvePending: (() => void) | null = null;
  play() {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    if (this.deferPlay)
      return new Promise<void>((res) => {
        this.resolvePending = () => {
          this.paused = false;
          res();
        };
      });
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

class FakeGain implements GainSink {
  level = -1;
  sets: number[] = [];
  disposed = false;
  set(v: number) {
    this.level = v;
    this.sets.push(v);
  }
  dispose() {
    this.disposed = true;
  }
}

function setup(
  opts: { stored?: string | null; storageThrows?: boolean; route?: "gain" | "none" | "throws"; ctxState?: string } = {},
) {
  /** The shared AudioContext's state as the routed controller sees it; `setCtx` fires a statechange. */
  const ctx = { state: opts.ctxState ?? "running", fns: new Set<() => void>() };
  const setCtx = (state: string) => {
    ctx.state = state;
    for (const f of [...ctx.fns]) f();
  };
  let t = 0;
  const audios: FakeAudio[] = [];
  const handlers = new Map<string, Set<() => void>>();
  const store = new Map<string, string>();
  if (opts.stored != null) store.set(BGM_STORAGE_KEY, opts.stored);
  let ticking = 0;
  const gains: FakeGain[] = [];
  let resumes = 0;
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
      ...(opts.route
        ? {
            route: () => {
              if (opts.route === "throws") throw new Error("no AudioContext");
              if (opts.route === "none") return null;
              const g = new FakeGain();
              gains.push(g);
              return g;
            },
            resume: () => void resumes++,
            audioState: () => ctx.state,
            onAudioState: (fn: () => void) => {
              ctx.fns.add(fn);
              return () => void ctx.fns.delete(fn);
            },
          }
        : {}),
    });
  const gesture = (type = "pointerdown") => [...(handlers.get(type) ?? [])].forEach((f) => f());
  const advance = (ms: number, bgm: VillageBgm) => {
    t += ms;
    bgm.tick();
  };
  const listenerCount = () => [...handlers.values()].reduce((n, s) => n + s.size, 0);
  return {
    make,
    audios,
    gains,
    gesture,
    advance,
    store,
    listenerCount,
    setCtx,
    ctxListeners: () => ctx.fns.size,
    ticking: () => ticking,
    resumes: () => resumes,
  };
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

  it("a tab hidden before any gesture does not start, and showing it again does not start it either", async () => {
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

  it("a hidden tab stays silent when music is off: switched off while hidden, showing the tab plays nothing", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    expect(a.playCalls).toBe(1);
    bgm.setVisible(false);
    bgm.setEnabled(false);
    bgm.setVisible(true);
    s.gesture(); // a gesture while off plays nothing either
    await flush();
    expect(a.playCalls).toBe(1);
    expect(a.paused).toBe(true);
  });

  it("switched off while play() is still pending: the late resolve pauses it again (music review minor 1)", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.deferPlay = true;
    s.gesture();
    expect(a.playCalls).toBe(1);
    bgm.setEnabled(false); // halt(): pause() and re-arm, while play() has not settled
    a.resolvePending!(); // this browser still resolves it
    await flush();
    expect(a.paused).toBe(true);
    expect(bgm.isEnabled()).toBe(false);
    expect(s.ticking()).toBe(0);
  });

  it("hidden while play() is pending: stays paused, and resumes when the tab is shown", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.deferPlay = true;
    s.gesture();
    bgm.setVisible(false);
    a.resolvePending!();
    await flush();
    expect(a.paused).toBe(true);
    a.deferPlay = false;
    bgm.setVisible(true);
    await flush();
    expect(a.paused).toBe(false);
    expect(a.playCalls).toBe(2);
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
    expect(s.listenerCount()).toBe(BGM_GESTURES.length);
    s.gesture();
    await flush();
    expect(s.audios[0]!.playCalls).toBe(0);
    expect(s.audios[1]!.paused).toBe(false);
  });

  it("routes the level through a GainNode when one is given: the element stays at volume 1 (iOS ignores it)", async () => {
    const s = setup({ route: "gain" });
    const bgm = s.make();
    expect(bgm.isRouted()).toBe(true);
    const a = s.audios[0]!;
    const g = s.gains[0]!;
    expect(a.volume).toBe(1);
    expect(g.level).toBe(0);
    bgm.arm();
    s.gesture();
    await flush();
    expect(s.resumes()).toBe(1); // the context is resumed inside the gesture
    s.advance(750, bgm);
    expect(g.level).toBeCloseTo(0.175, 3); // the fade-in on the gain
    s.advance(750, bgm);
    expect(g.level).toBeCloseTo(0.35, 3);
    bgm.setHall(true);
    s.advance(1000, bgm);
    expect(g.level).toBeCloseTo(0.15, 3); // the hall duck on the gain
    bgm.duck(0.3, 200);
    s.advance(200, bgm);
    expect(g.level).toBeCloseTo(0.045, 3); // the voice duck on the gain
    expect(bgm.level()).toBeCloseTo(0.045, 3);
    expect(bgm.duckLevel()).toBeCloseTo(0.3, 3);
    bgm.unduck(200);
    s.advance(200, bgm);
    expect(g.level).toBeCloseTo(0.15, 3);
    expect(a.volume).toBe(1); // never touched
    bgm.dispose();
    expect(g.disposed).toBe(true);
  });

  it("falls back to element.volume when there is no AudioContext (route gives null or throws)", async () => {
    for (const route of ["none", "throws"] as const) {
      const s = setup({ route });
      const bgm = s.make();
      expect(bgm.isRouted()).toBe(false);
      bgm.arm();
      s.gesture();
      await flush();
      s.advance(1500, bgm);
      expect(s.audios[0]!.volume).toBeCloseTo(0.35, 3);
      expect(bgm.level()).toBeCloseTo(0.35, 3);
    }
  });
});

/** VillageBgmButton's effect (mountVillageBgm) run the way React StrictMode runs it: mount, cleanup, mount. */
describe("VillageBgmButton mount effect under StrictMode", () => {
  function env(s: ReturnType<typeof setup>) {
    const docListeners = new Set<() => void>();
    const doc = {
      visibilityState: "visible",
      addEventListener: (_: "visibilitychange", fn: () => void) => void docListeners.add(fn),
      removeEventListener: (_: "visibilitychange", fn: () => void) => void docListeners.delete(fn),
    };
    const bgmStates: (VillageBgm | null)[] = [];
    const onStates: boolean[] = [];
    const probe: { __cvBgm?: VillageBgm } = {};
    const e = {
      create: s.make,
      doc,
      setBgm: (b: VillageBgm | null) => void bgmStates.push(b),
      setOn: (on: boolean) => void onStates.push(on),
      probe,
    };
    return { e, doc, docListeners, bgmStates, onStates, probe };
  }

  it("mount, cleanup, mount leaves one live controller, one element, one set of listeners and the probe on the live one", async () => {
    const s = setup();
    const t = env(s);
    const cleanup1 = mountVillageBgm(t.e); // StrictMode: mount ...
    cleanup1(); // ... cleanup ...
    const cleanup2 = mountVillageBgm(t.e); // ... mount again
    const live = t.bgmStates.at(-1)!;
    expect(t.bgmStates).toEqual([expect.any(VillageBgm), null, live]);
    expect(t.bgmStates[0]).not.toBe(live);
    expect(t.probe.__cvBgm).toBe(live);
    expect(activeVillageBgm()).toBe(live);
    expect(s.audios.filter((a) => !a.released && a.src !== "").length).toBe(1);
    expect(s.listenerCount()).toBe(BGM_GESTURES.length); // the live controller's gesture listeners only
    expect(t.docListeners.size).toBe(1);
    expect(t.onStates.at(-1)).toBe(true);
    s.gesture();
    await flush();
    expect(s.audios[0]!.playCalls).toBe(0); // the disposed one never plays
    expect(s.audios[1]!.paused).toBe(false);
    // the hall effect (setHall on the live controller) still works after the double mount
    live.setHall(true);
    s.advance(1500, live);
    expect(s.audios[1]!.volume).toBeCloseTo(0.15, 3);
    // the visibility listener drives the live controller
    t.doc.visibilityState = "hidden";
    for (const fn of t.docListeners) fn();
    expect(s.audios[1]!.paused).toBe(true);
    cleanup2();
    expect(t.bgmStates.at(-1)).toBeNull();
    expect(t.probe.__cvBgm).toBeUndefined();
    expect(activeVillageBgm()).toBeNull();
    expect(t.docListeners.size).toBe(0);
    expect(s.listenerCount()).toBe(0);
    expect(s.audios[1]!.released).toBe(true);
  });

  it("the on/off chip follows the stored choice and the toggle", () => {
    const s = setup({ stored: "0" });
    const t = env(s);
    const cleanup = mountVillageBgm(t.e);
    expect(t.onStates.at(-1)).toBe(false);
    t.bgmStates.at(-1)!.toggle();
    expect(t.onStates.at(-1)).toBe(true);
    cleanup();
  });
});

/** Final review I1: iOS gestures, a suspended or interrupted AudioContext, and the plain-element fallback. */
describe("VillageBgm on iOS (AudioContext not running)", () => {
  it("listens for touchend, pointerup, click and keydown, which iOS counts as a user activation", () => {
    for (const t of ["touchend", "pointerup", "click", "keydown"]) expect(BGM_GESTURES).toContain(t);
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    expect(s.listenerCount()).toBe(BGM_GESTURES.length);
  });

  it("one tap fires several gesture events: a pending play() is not started again", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.deferPlay = true;
    s.gesture("pointerdown");
    s.gesture("pointerup");
    s.gesture("touchend");
    s.gesture("click");
    expect(a.playCalls).toBe(1);
    a.resolvePending!();
    await flush();
    expect(a.paused).toBe(false);
  });

  it("suspended: a play accepted into a suspended context keeps listening and resumes on every gesture until it runs", async () => {
    const s = setup({ route: "gain", ctxState: "suspended" });
    const bgm = s.make();
    bgm.arm();
    s.gesture("touchstart"); // iOS: play() accepted, resume() refused
    await flush();
    const a = s.audios[0]!;
    expect(a.paused).toBe(false);
    expect(bgm.hasStarted()).toBe(true);
    expect(s.listenerCount()).toBe(BGM_GESTURES.length); // not disarmed
    const before = s.resumes();
    s.gesture("touchend");
    expect(s.resumes()).toBe(before + 1);
    expect(a.playCalls).toBe(1); // the element is not played again
    s.setCtx("running"); // the touchend's resume() took effect
    expect(s.listenerCount()).toBe(0);
    expect(bgm.isFallback()).toBe(false);
  });

  it("interrupted (a call or a screen lock): the statechange resumes and re-arms, and the next gesture resumes it", async () => {
    const s = setup({ route: "gain" });
    const bgm = s.make();
    bgm.arm();
    s.gesture("click");
    await flush();
    expect(s.listenerCount()).toBe(0);
    const before = s.resumes();
    s.setCtx("interrupted");
    expect(s.resumes()).toBe(before + 1);
    expect(s.listenerCount()).toBe(BGM_GESTURES.length);
    s.gesture("touchend");
    expect(s.resumes()).toBe(before + 2);
    s.setCtx("running");
    expect(s.listenerCount()).toBe(0);
    expect(s.audios.length).toBe(1);
  });

  it("the context never runs: after BGM_FALLBACK_MS a gesture swaps to a plain, unrouted element and plays it", async () => {
    const s = setup({ route: "gain", ctxState: "suspended" });
    const bgm = s.make();
    bgm.arm();
    s.gesture("touchend");
    await flush();
    s.advance(1000, bgm);
    s.gesture("touchend"); // too early: still waiting for the context
    expect(s.audios.length).toBe(1);
    s.advance(BGM_FALLBACK_MS, bgm);
    s.gesture("touchend");
    expect(s.audios.length).toBe(2);
    expect(s.gains[0]!.disposed).toBe(true);
    expect(s.audios[0]!.released).toBe(true);
    expect(s.ctxListeners()).toBe(0);
    await flush();
    const plain = s.audios[1]!;
    expect(plain.src).toBe(BGM_SRC);
    expect(plain.loop).toBe(true);
    expect(plain.paused).toBe(false);
    expect(bgm.isFallback()).toBe(true);
    expect(bgm.isRouted()).toBe(false);
    expect(s.listenerCount()).toBe(0);
    s.advance(1500, bgm);
    expect(plain.volume).toBeCloseTo(0.35, 3);
  });

  it("interrupted after long playback: the first tap's resume keeps the route (no fallback from the old start time)", async () => {
    const s = setup({ route: "gain" });
    const bgm = s.make();
    bgm.arm();
    s.gesture("click");
    await flush();
    s.advance(60000, bgm); // a minute of music
    s.setCtx("interrupted"); // a call or a lock
    s.advance(30000, bgm); // the phone stays locked a while
    s.gesture("touchend"); // the first tap after unlocking: resume() is async, the state still reads "interrupted"
    s.gesture("click");
    expect(s.audios.length).toBe(1);
    expect(bgm.isFallback()).toBe(false);
    s.setCtx("running");
    expect(bgm.isRouted()).toBe(true);
    expect(s.listenerCount()).toBe(0);
  });

  it("the fallback waits for BGM_FALLBACK_MS of non-running time from the first gesture after it stopped", async () => {
    const s = setup({ route: "gain" });
    const bgm = s.make();
    bgm.arm();
    s.gesture("click");
    await flush();
    s.setCtx("suspended");
    s.advance(10000, bgm);
    s.gesture("touchend"); // starts the wait
    s.advance(BGM_FALLBACK_MS - 100, bgm);
    s.gesture("touchend");
    expect(bgm.isFallback()).toBe(false);
    s.advance(200, bgm);
    s.gesture("touchend");
    expect(bgm.isFallback()).toBe(true);
  });

  it("dispose drops the statechange listener", () => {
    const s = setup({ route: "gain" });
    const bgm = s.make();
    expect(s.ctxListeners()).toBe(1);
    bgm.dispose();
    expect(s.ctxListeners()).toBe(0);
  });
});

describe("VillageBgm and the game's sound toggle (final review m4)", () => {
  it("muting pauses the music without changing the stored choice; unmuting plays it again", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    s.gesture();
    await flush();
    const a = s.audios[0]!;
    bgm.setMuted(true);
    expect(a.paused).toBe(true);
    expect(bgm.isEnabled()).toBe(true);
    expect(s.store.get(BGM_STORAGE_KEY)).toBeUndefined();
    s.gesture();
    await flush();
    expect(a.paused).toBe(true);
    bgm.setMuted(false);
    await flush();
    expect(a.paused).toBe(false);
  });

  it("muted from the start: gestures play nothing until it is unmuted", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.setMuted(true);
    bgm.arm();
    s.gesture();
    await flush();
    expect(s.audios[0]!.playCalls).toBe(0);
    bgm.setMuted(false);
    await flush();
    expect(s.audios[0]!.paused).toBe(false);
  });
});

describe("VillageBgm across a reconnect remount (final review m3)", () => {
  beforeEach(() => resetVillageBgmCarry());
  const doc = () => ({
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  it("music that had started plays again on the next mount without a new gesture", async () => {
    const s = setup();
    const e = { create: s.make, doc: doc(), setBgm: () => {}, setOn: () => {}, probe: null };
    const c1 = mountVillageBgm(e);
    s.gesture();
    await flush();
    c1();
    const c2 = mountVillageBgm(e);
    await flush();
    expect(s.audios[1]!.playCalls).toBe(1);
    expect(s.audios[1]!.paused).toBe(false);
    c2();
    const c3 = mountVillageBgm(e); // c2's music had started too
    await flush();
    expect(s.audios[2]!.paused).toBe(false);
    c3();
  });

  it("music that never started (or was switched off) does not start on the next mount", async () => {
    const s = setup();
    const e = { create: s.make, doc: doc(), setBgm: () => {}, setOn: () => {}, probe: null };
    mountVillageBgm(e)();
    const c2 = mountVillageBgm(e);
    await flush();
    expect(s.audios[1]!.playCalls).toBe(0);
    s.gesture();
    await flush();
    activeVillageBgm()!.setEnabled(false);
    c2();
    const c3 = mountVillageBgm(e);
    await flush();
    expect(s.audios[2]!.playCalls).toBe(0);
    c3();
  });
});
