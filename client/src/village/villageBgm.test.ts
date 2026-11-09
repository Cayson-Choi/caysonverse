import { beforeEach, describe, expect, it } from "vitest";
import {
  BGM_ACTIVATION_GESTURES,
  BGM_CONFIRM_S,
  BGM_FADE_IN_MS,
  BGM_FALLBACK_MS,
  BGM_GESTURES,
  BGM_SRC,
  BGM_STORAGE_KEY,
  VillageBgm,
  activeVillageBgm,
  mountVillageBgm,
  resetVillageBgmCarry,
  type BgmAudio,
} from "./villageBgm";
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
  /** Every deferred play() call in order, to settle each one on its own (a late refusal of the first, ...). */
  pendings: { resolve: () => void; reject: () => void }[] = [];
  play() {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    if (this.deferPlay)
      return new Promise<void>((res, rej) => {
        const resolve = () => {
          this.paused = false;
          res();
        };
        this.resolvePending = resolve;
        this.pendings.push({ resolve, reject: () => rej(new Error("NotAllowedError")) });
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
  /** Applied to every element created from now on (the plain fallback element is created inside a gesture). */
  const newAudio = { deferPlay: false };
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
        a.deferPlay = newAudio.deferPlay;
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
    newAudio,
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
    expect(() => s.gesture("click")).not.toThrow();
    await flush();
    expect(a.paused).toBe(true);
    expect(s.listenerCount()).toBeGreaterThan(0);
    a.rejectPlay = false;
    s.gesture("click");
    await flush();
    expect(a.paused).toBe(false);
    expect(s.listenerCount()).toBe(0);
  });

  it("a refused pointerdown play() turns the fast path off: the next gesture that plays is an activation event", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.rejectPlay = true;
    s.gesture("pointerdown");
    await flush();
    expect(a.playCalls).toBe(1);
    a.rejectPlay = false;
    s.gesture("pointerdown"); // the next tap: no play() before the finger lifts
    s.gesture("touchstart");
    expect(a.playCalls).toBe(1);
    s.gesture("pointerup");
    expect(a.playCalls).toBe(2);
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

  it("one tap fires several gesture events: a pending fast-path play() is played again once, in pointerup, and the fade goes on", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.deferPlay = true;
    s.gesture("pointerdown");
    s.gesture("touchstart");
    expect(a.playCalls).toBe(1);
    s.advance(750, bgm);
    s.gesture("pointerup");
    s.gesture("touchend");
    s.gesture("click");
    expect(a.playCalls).toBe(2);
    expect(a.volume).toBeCloseTo(0.175, 3); // the replay does not restart the fade
    for (const p of a.pendings) p.resolve(); // both calls resolve together
    await flush();
    expect(a.paused).toBe(false);
    expect(s.ticking()).toBe(1);
    expect(s.listenerCount()).toBe(0);
    s.advance(750, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
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

/** Owner report 2026-11-10: silent in Samsung Internet, fine in Chrome and KakaoTalk. */
describe("VillageBgm in a browser that only plays inside an activation event (Samsung Internet)", () => {
  /** One finger tap, in the order Chromium dispatches it. */
  const TAP = ["pointerdown", "touchstart", "pointerup", "touchend", "click"] as const;

  it("the activation events are pointerup, touchend, click and keydown, and all of them are listened to", () => {
    expect([...BGM_ACTIVATION_GESTURES].sort()).toEqual(["click", "keydown", "pointerup", "touchend"]);
    for (const t of BGM_ACTIVATION_GESTURES) expect(BGM_GESTURES).toContain(t);
    expect(BGM_ACTIVATION_GESTURES).not.toContain("pointerdown");
    expect(BGM_ACTIVATION_GESTURES).not.toContain("touchstart");
  });

  it("the fast-path play() refused LATE: the same tap's pointerup plays again and the music starts", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.deferPlay = true;
    for (const t of TAP) s.gesture(t);
    expect(a.playCalls).toBe(2); // pointerdown (fast path), pointerup (the activation)
    a.pendings[0]!.reject(); // the browser refuses the pointerdown play() after the tap is over
    await flush();
    expect(bgm.hasStarted()).toBe(false);
    a.pendings[1]!.resolve(); // the pointerup play() is accepted
    await flush();
    expect(a.paused).toBe(false);
    expect(bgm.hasStarted()).toBe(true);
    expect(s.listenerCount()).toBe(0);
    s.advance(BGM_FADE_IN_MS, bgm);
    expect(a.volume).toBeCloseTo(0.35, 3);
  });

  it("before the fix this stayed silent on every tap: each tap now plays inside its activation event", async () => {
    // A browser that refuses every play() outside an activation event, late: only the pointerup call can succeed.
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.deferPlay = true;
    for (const t of TAP) s.gesture(t);
    a.pendings[0]!.reject();
    a.pendings[1]!.reject(); // this tap's both calls refused (a pause aborts every pending play())
    await flush();
    expect(bgm.hasStarted()).toBe(false);
    expect(s.listenerCount()).toBe(BGM_GESTURES.length);
    a.deferPlay = false;
    s.gesture("pointerdown"); // the next tap: the fast path is off now
    s.gesture("touchstart");
    expect(a.playCalls).toBe(2);
    s.gesture("pointerup");
    expect(a.playCalls).toBe(3);
    await flush();
    expect(a.paused).toBe(false);
    expect(bgm.hasStarted()).toBe(true);
  });

  it("a refusal at once (KakaoTalk's WebView) still plays on the same tap's pointerup", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.rejectPlay = true;
    s.gesture("pointerdown");
    await flush(); // the rejection settles before the finger lifts
    s.gesture("touchstart");
    a.rejectPlay = false;
    s.gesture("pointerup");
    s.gesture("touchend");
    s.gesture("click");
    expect(a.playCalls).toBe(2);
    await flush();
    expect(a.paused).toBe(false);
  });

  it("accepted, then paused by the browser before it really played: it listens again and the next tap plays it in pointerup", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    s.gesture("pointerdown");
    await flush();
    expect(bgm.hasStarted()).toBe(true);
    expect(s.listenerCount()).toBe(0);
    a.paused = true; // the browser stopped it
    s.advance(100, bgm);
    expect(bgm.hasStarted()).toBe(false);
    expect(s.ticking()).toBe(0);
    expect(s.listenerCount()).toBe(BGM_GESTURES.length);
    s.gesture("pointerdown"); // the fast path is off: that start did not hold
    expect(a.playCalls).toBe(1);
    s.gesture("pointerup");
    expect(a.playCalls).toBe(2);
    await flush();
    expect(a.paused).toBe(false);
    expect(bgm.hasStarted()).toBe(true);
    expect(s.listenerCount()).toBe(0);
  });

  it("after BGM_CONFIRM_S of real playback, an outside pause (a call, another app) is left alone as before", async () => {
    const s = setup();
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    s.gesture("click");
    await flush();
    a.currentTime = BGM_CONFIRM_S + 0.1;
    s.advance(100, bgm);
    a.paused = true;
    s.advance(100, bgm);
    expect(bgm.hasStarted()).toBe(true);
    expect(s.listenerCount()).toBe(0);
    expect(a.playCalls).toBe(1);
  });

  it("with the fast path off, the swap to the plain element waits for the tap's pointerup", async () => {
    const s = setup({ route: "gain", ctxState: "suspended" });
    const bgm = s.make();
    bgm.arm();
    const a = s.audios[0]!;
    a.rejectPlay = true;
    s.gesture("pointerdown"); // refused: the fast path goes off
    await flush();
    a.rejectPlay = false;
    s.gesture("pointerup"); // accepted into a context that never runs
    await flush();
    expect(bgm.hasStarted()).toBe(true);
    s.advance(BGM_FALLBACK_MS, bgm);
    s.gesture("pointerdown");
    s.gesture("touchstart");
    expect(bgm.isFallback()).toBe(false);
    s.gesture("pointerup");
    expect(bgm.isFallback()).toBe(true);
    await flush();
    expect(s.audios[1]!.paused).toBe(false);
  });

  it("the plain fallback element played at a pointerdown and refused late is played again in the same tap's pointerup", async () => {
    const s = setup({ route: "gain", ctxState: "suspended" });
    const bgm = s.make();
    bgm.arm();
    s.gesture("touchend"); // accepted into a context that never runs
    await flush();
    s.advance(BGM_FALLBACK_MS, bgm);
    s.newAudio.deferPlay = true; // this browser holds the plain element's play() pending to refuse it late
    s.gesture("pointerdown"); // swaps to the plain element and plays it
    expect(bgm.isFallback()).toBe(true);
    const plain = s.audios[1]!;
    expect(plain.playCalls).toBe(1);
    s.gesture("touchstart");
    s.gesture("pointerup");
    s.gesture("touchend");
    expect(plain.playCalls).toBe(2);
    plain.pendings[0]!.reject();
    plain.pendings[1]!.resolve();
    await flush();
    expect(plain.paused).toBe(false);
    expect(bgm.hasStarted()).toBe(true);
    expect(s.listenerCount()).toBe(0);
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
