/**
 * 케이슨 마을's background music (owner request 2026-11-08): one looping track, played only while the village
 * scene is mounted. The controller is pure logic over an injected audio element, clock, scheduler and gesture
 * target, so it is unit tested without any DOM audio (villageBgm.test.ts).
 *
 *  - Browsers refuse autoplay: the first user gesture starts it with a fade-in. A rejected `play()` never throws;
 *    the next gesture tries again.
 *  - Volume = area level (0.35 outside, 0.15 in the memorial hall) x speech duck x fade envelope. Each of the three
 *    glides on its own ramp, so a door or a guide's voice never makes the sound jump.
 *  - The loop fades out over the last 2 s and fades in again at the restart, so the song's end does not cut.
 *  - Hidden tab: paused; visible again: resumed with a fade-in.
 *  - The on/off choice persists (localStorage, try/catch, default on).
 *  - `dispose()` pauses and releases the element.
 *  - Task 9A: the level goes to a Web Audio GainNode when `route` gives one (villageAudio.ts; iOS Safari ignores
 *    `element.volume`), else to `element.volume`. A guide's clip ducks the music through `duck` / `unduck`.
 *  - iOS (final review I1): `touchstart` and a touch `pointerdown` do not count as a user activation, so the gesture
 *    listeners include `touchend`, `pointerup` and `click`. Every gesture and every AudioContext `statechange` resumes
 *    the context whenever it is not "running" ("interrupted" after a call or a screen lock included), and the
 *    listeners stay armed until the context really runs. A routed element plays into a stopped graph otherwise, so
 *    if the context still is not running `BGM_FALLBACK_MS` after an accepted play, the next gesture swaps to a plain,
 *    unrouted element and plays that (`isFallback()`).
 *  - The game's sound toggle (`setMuted`) silences the music too (final review m4), without changing the music choice.
 *  - A remount (a reconnect re-keys the scene) carries "the music had started" over, so it plays again without a new
 *    tap where the browser allows it (final review m3).
 */
import {
  onVillageAudioState,
  resumeVillageAudio,
  routeThroughGain,
  villageAudioState,
  type GainSink,
} from "./villageAudio";

export const BGM_SRC = "/audio/village/village_bgm1.mp3";
export const BGM_STORAGE_KEY = "cv-village-bgm";
export const BGM_LEVEL_OUTSIDE = 0.35;
export const BGM_LEVEL_HALL = 0.15;
export const BGM_FADE_IN_MS = 1500;
export const BGM_HALL_MS = 1000;
export const BGM_LOOP_FADE_S = 2;
const TICK_MS = 100;
/** If the AudioContext is still not running this long after an accepted play, a gesture swaps to plain playback. */
export const BGM_FALLBACK_MS = 2500;
/** The first-gesture events. iOS only counts touchend / pointerup / click / keydown as a user activation. */
export const BGM_GESTURES = ["pointerdown", "pointerup", "touchstart", "touchend", "click", "keydown"] as const;

/** The slice of HTMLAudioElement the controller uses. */
export interface BgmAudio {
  src: string;
  loop: boolean;
  preload: string;
  volume: number;
  readonly paused: boolean;
  currentTime: number;
  readonly duration: number;
  play(): Promise<void> | void;
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
}

export interface BgmDeps {
  createAudio: () => BgmAudio;
  now: () => number;
  /** Repeats `fn` every `ms`; returns the cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** Where the first-gesture listeners go (the window). */
  gestureTarget: {
    addEventListener(type: string, fn: () => void, opts?: unknown): void;
    removeEventListener(type: string, fn: () => void): void;
  };
  storage?: () => Pick<Storage, "getItem" | "setItem">;
  /** Route the element through a GainNode (villageAudio.ts); null/absent falls back to `element.volume`. */
  route?: (audio: BgmAudio) => GainSink | null;
  /** Resume the shared AudioContext; called inside every gesture until it runs. */
  resume?: () => void;
  /** The shared AudioContext's state ("running", "suspended", "interrupted", "none"); absent = treated as running. */
  audioState?: () => string;
  /** Subscribe to the AudioContext's state changes; returns the unsubscribe. */
  onAudioState?: (fn: () => void) => () => void;
}

/** A value that glides linearly to a target. */
class Ramp {
  private from: number;
  private to: number;
  private t0 = 0;
  private ms = 0;
  constructor(v: number) {
    this.from = this.to = v;
  }
  value(now: number): number {
    if (this.ms <= 0 || now >= this.t0 + this.ms) return this.to;
    if (now <= this.t0) return this.from;
    return this.from + (this.to - this.from) * ((now - this.t0) / this.ms);
  }
  go(to: number, ms: number, now: number): void {
    this.from = this.value(now);
    this.to = to;
    this.t0 = now;
    this.ms = ms;
  }
  jump(v: number): void {
    this.from = this.to = v;
    this.ms = 0;
  }
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export class VillageBgm {
  private audio: BgmAudio | null;
  private readonly areaLevel = new Ramp(BGM_LEVEL_OUTSIDE);
  private readonly duckFactor = new Ramp(1);
  private readonly fade = new Ramp(0);
  private enabled: boolean;
  private visible = true;
  private started = false; // a play() has been accepted
  private startedAt = 0;
  private pending = false; // a play() has not settled yet
  private muted = false; // the game's sound toggle
  private fallback = false; // swapped to a plain, unrouted element
  private offState: (() => void) | null = null;
  private armed = false; // gesture listeners attached
  private cancelTick: (() => void) | null = null;
  private lastTime = 0;
  private listeners = new Set<() => void>();
  private gain: GainSink | null = null;

  constructor(private readonly deps: BgmDeps) {
    const a = deps.createAudio();
    a.src = BGM_SRC;
    a.loop = true;
    a.preload = "none";
    a.volume = 0;
    this.audio = a;
    try {
      this.gain = deps.route?.(a) ?? null;
    } catch {
      this.gain = null;
    }
    if (this.gain) {
      a.volume = 1; // the gain does the level
      this.gain.set(0);
      try {
        this.offState = deps.onAudioState?.(this.onAudioState) ?? null;
      } catch {
        this.offState = null;
      }
    }
    this.enabled = this.loadEnabled();
  }

  /** True once the music swapped to a plain element because the AudioContext never ran. */
  isFallback(): boolean {
    return this.fallback;
  }

  /** True once a play() was accepted (and not switched off since). */
  hasStarted(): boolean {
    return this.started;
  }

  /** True when the level goes through a Web Audio GainNode (not `element.volume`). */
  isRouted(): boolean {
    return this.gain !== null;
  }

  /** The level the music plays at now (the gain's, or the element's volume). */
  level(): number {
    return this.gain ? this.gain.level : (this.audio?.volume ?? 0);
  }

  /** The speech duck factor now (1 = not ducked), for the dev probe. */
  duckLevel(): number {
    return this.duckFactor.value(this.deps.now());
  }

  /** Listen for the first user gesture (call once after construction). */
  arm(): void {
    if (this.armed || !this.audio) return;
    this.armed = true;
    for (const t of BGM_GESTURES) this.deps.gestureTarget.addEventListener(t, this.onGesture, { passive: true });
  }

  private disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    for (const t of BGM_GESTURES) this.deps.gestureTarget.removeEventListener(t, this.onGesture);
  }

  private readonly onGesture = (): void => {
    if (!this.audio) return;
    if (!this.started) {
      if (!this.pending) this.tryPlay();
      else this.resumeCtx();
      return;
    }
    // Playing, but the routed graph is not running (an iOS touchstart, or "interrupted" after a lock).
    this.resumeCtx();
    if (this.ctxRunning()) {
      this.disarm();
      return;
    }
    if (this.gain && this.deps.now() - this.startedAt >= BGM_FALLBACK_MS) this.unroute();
  };

  /** The AudioContext changed state: running -> stop listening; anything else -> try to resume and listen again. */
  private readonly onAudioState = (): void => {
    if (!this.audio || !this.gain) return;
    if (this.ctxRunning()) {
      if (this.started) this.disarm();
      return;
    }
    this.resumeCtx();
    if (this.started) this.arm();
  };

  /** True when the music is audible as far as the context goes: not routed, or the context runs. */
  private ctxRunning(): boolean {
    if (!this.gain) return true;
    const st = this.deps.audioState?.() ?? "running";
    return st === "running" || st === "none";
  }

  private resumeCtx(): void {
    try {
      this.deps.resume?.();
    } catch {
      // best effort
    }
  }

  /**
   * The context never ran: drop the GainNode route and play a plain element instead (inside this gesture). On iOS its
   * volume is fixed, so it plays at full level; still better than silence.
   */
  private unroute(): void {
    const old = this.audio;
    if (!old) return;
    let at = 0;
    try {
      at = old.currentTime;
    } catch {
      at = 0;
    }
    this.offState?.();
    this.offState = null;
    this.gain?.dispose();
    this.gain = null;
    this.stopTick();
    try {
      old.pause();
      old.removeAttribute("src");
      old.load();
    } catch {
      // best effort
    }
    const a = this.deps.createAudio();
    a.src = BGM_SRC;
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    try {
      a.currentTime = at;
    } catch {
      // not seekable yet
    }
    this.audio = a;
    this.fallback = true;
    this.started = false;
    this.tryPlay();
  }

  /** The audio element (dev probes and the e2e check read its state). */
  element(): BgmAudio | null {
    return this.audio;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.saveEnabled(on);
    if (on) this.tryPlay();
    else this.halt();
    for (const l of [...this.listeners]) l();
  }

  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  /** In the memorial hall the music goes quiet. */
  setHall(inHall: boolean): void {
    this.areaLevel.go(inHall ? BGM_LEVEL_HALL : BGM_LEVEL_OUTSIDE, BGM_HALL_MS, this.deps.now());
    this.apply();
  }

  /** Lower the music to `level` (0..1 of its volume) over `ms`, e.g. while a guide speaks. */
  duck(level: number, ms: number): void {
    this.duckFactor.go(clamp01(level), ms, this.deps.now());
    this.apply();
  }

  unduck(ms: number): void {
    this.duck(1, ms);
  }

  /** The tab was hidden / shown. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) this.halt(true);
    else if (this.started) this.tryPlay();
  }

  /** The game's sound toggle: muted pauses the music (the music choice is kept); unmuting (a click) plays it again. */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) this.halt(true);
    else this.tryPlay();
  }

  /** Play now if the browser allows it (a remount after a reconnect); a refusal leaves it waiting for a gesture. */
  resumeAfterRemount(): void {
    if (!this.started) this.tryPlay();
  }

  /** Advance the ramps and the loop fade; the scheduler calls it, and tests call it by hand. */
  tick(): void {
    this.apply();
  }

  dispose(): void {
    this.disarm();
    this.offState?.();
    this.offState = null;
    this.stopTick();
    this.listeners.clear();
    this.gain?.dispose();
    this.gain = null;
    const a = this.audio;
    if (!a) return;
    this.audio = null;
    try {
      a.pause();
      a.removeAttribute("src");
      a.load();
    } catch {
      // Releasing is best effort.
    }
  }

  // ── internals ──

  private tryPlay(): void {
    const a = this.audio;
    if (!a || !this.enabled || !this.visible || this.muted) return;
    this.resumeCtx();
    this.fade.jump(0);
    this.fade.go(1, BGM_FADE_IN_MS, this.deps.now());
    this.apply();
    let result: Promise<void> | void;
    try {
      result = a.play();
    } catch {
      return; // refused synchronously: the next gesture tries again
    }
    const accepted = () => {
      this.pending = false;
      if (this.audio !== a) return;
      // Switched off while play() was pending (halt() paused and re-armed): a browser that still resolves must not
      // leave the music playing with the toggle showing off (music review minor 1).
      if (!this.enabled) {
        this.pauseQuietly(a);
        return;
      }
      if (!this.started) this.startedAt = this.deps.now();
      this.started = true;
      // Keep listening until the routed context really runs (iOS: a touchstart play into a suspended graph).
      if (this.ctxRunning()) this.disarm();
      else this.resumeCtx();
      // Hidden or muted while pending: stay paused; becoming visible / unmuted resumes it.
      if (!this.visible || this.muted) {
        this.pauseQuietly(a);
        return;
      }
      this.startTick();
    };
    if (result && typeof (result as Promise<void>).then === "function") {
      this.pending = true;
      (result as Promise<void>).then(accepted, () => {
        this.pending = false;
        // Autoplay refused: stay armed, try on the next gesture.
      });
    } else accepted();
  }

  private pauseQuietly(a: BgmAudio): void {
    try {
      a.pause();
    } catch {
      // ignore
    }
  }

  /** Pause now. `keepStarted`: a hidden tab resumes by itself when it is visible again. */
  private halt(keepStarted = false): void {
    const a = this.audio;
    if (!a) return;
    this.stopTick();
    try {
      a.pause();
    } catch {
      // ignore
    }
    if (!keepStarted) {
      this.started = false;
      this.arm(); // switched on again by a click, or by the next gesture
    }
  }

  private startTick(): void {
    if (this.cancelTick) return;
    this.cancelTick = this.deps.schedule(() => this.tick(), TICK_MS);
  }

  private stopTick(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private apply(): void {
    const a = this.audio;
    if (!a) return;
    const now = this.deps.now();
    // Loop: fade out over the last 2 s; after the wrap, fade in again.
    let loopGain = 1;
    const dur = a.duration;
    const t = a.currentTime;
    if (Number.isFinite(dur) && dur > BGM_LOOP_FADE_S) {
      loopGain = clamp01((dur - t) / BGM_LOOP_FADE_S);
      if (t < this.lastTime - 1) {
        this.fade.jump(0);
        this.fade.go(1, BGM_FADE_IN_MS, now);
      }
    }
    this.lastTime = t;
    const v = clamp01(this.areaLevel.value(now) * this.duckFactor.value(now) * this.fade.value(now) * loopGain);
    if (this.gain) this.gain.set(v);
    else a.volume = v;
  }

  private loadEnabled(): boolean {
    try {
      return this.deps.storage?.().getItem(BGM_STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  }

  private saveEnabled(on: boolean): void {
    try {
      this.deps.storage?.().setItem(BGM_STORAGE_KEY, on ? "1" : "0");
    } catch {
      // Storage blocked: the choice holds for this session only.
    }
  }
}

/** The real browser wiring: the element goes through a GainNode where Web Audio exists. */
export function createBrowserBgm(): VillageBgm {
  return new VillageBgm({
    route: (a) => routeThroughGain(a as unknown as HTMLMediaElement),
    resume: resumeVillageAudio,
    audioState: villageAudioState,
    onAudioState: onVillageAudioState,
    createAudio: () => new Audio() as unknown as BgmAudio,
    now: () => performance.now(),
    schedule: (fn, ms) => {
      const id = window.setInterval(fn, ms);
      return () => window.clearInterval(id);
    },
    gestureTarget: window,
    storage: () => localStorage,
  });
}

declare global {
  interface Window {
    /** Dev only: the village music controller, for the e2e checks. */
    __cvBgm?: VillageBgm;
  }
}

/** What VillageBgmButton's mount effect touches, injected so the effect is tested without a DOM. */
export interface BgmMountEnv {
  create: () => VillageBgm;
  doc: {
    readonly visibilityState: string;
    addEventListener(type: "visibilitychange", fn: () => void): void;
    removeEventListener(type: "visibilitychange", fn: () => void): void;
  };
  setBgm: (bgm: VillageBgm | null) => void;
  setOn: (on: boolean) => void;
  /** Dev only: where `__cvBgm` is published (null in production). */
  probe: { __cvBgm?: VillageBgm } | null;
}

/**
 * VillageBgmButton's mount effect: create and arm the controller, follow the tab's visibility, publish it; the
 * returned cleanup disposes it. Under StrictMode React runs mount, cleanup, mount: the first controller is disposed
 * before the second exists, so one element stays live (villageBgm.test.ts).
 */
let active: VillageBgm | null = null;
/** The last controller had started its music when it was disposed (a reconnect remount): the next one resumes. */
let carryStarted = false;

/** Forget the carried "started" (tests). */
export function resetVillageBgmCarry(): void {
  carryStarted = false;
}

/** The village's live music controller (the guides' voice ducks it), or null outside the village. */
export function activeVillageBgm(): VillageBgm | null {
  return active;
}

export function mountVillageBgm(env: BgmMountEnv): () => void {
  const c = env.create();
  active = c;
  c.arm();
  const carry = carryStarted;
  carryStarted = false;
  const sync = () => env.setOn(c.isEnabled());
  const unsub = c.subscribe(sync);
  const onVisibility = () => c.setVisible(env.doc.visibilityState !== "hidden");
  env.doc.addEventListener("visibilitychange", onVisibility);
  onVisibility();
  sync();
  if (carry) c.resumeAfterRemount();
  env.setBgm(c);
  if (env.probe) env.probe.__cvBgm = c;
  return () => {
    env.doc.removeEventListener("visibilitychange", onVisibility);
    unsub();
    carryStarted = (c.hasStarted() || carry) && c.isEnabled();
    c.dispose();
    if (env.probe && env.probe.__cvBgm === c) delete env.probe.__cvBgm;
    if (active === c) active = null;
    env.setBgm(null);
  };
}
