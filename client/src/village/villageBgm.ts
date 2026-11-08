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
 */

export const BGM_SRC = "/audio/village/village_bgm1.mp3";
export const BGM_STORAGE_KEY = "cv-village-bgm";
export const BGM_LEVEL_OUTSIDE = 0.35;
export const BGM_LEVEL_HALL = 0.15;
export const BGM_FADE_IN_MS = 1500;
export const BGM_HALL_MS = 1000;
export const BGM_LOOP_FADE_S = 2;
const TICK_MS = 100;
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

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
  private readonly level = new Ramp(BGM_LEVEL_OUTSIDE);
  private readonly duckFactor = new Ramp(1);
  private readonly fade = new Ramp(0);
  private enabled: boolean;
  private visible = true;
  private started = false; // a play() has been accepted
  private armed = false; // gesture listeners attached
  private cancelTick: (() => void) | null = null;
  private lastTime = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly deps: BgmDeps) {
    const a = deps.createAudio();
    a.src = BGM_SRC;
    a.loop = true;
    a.preload = "none";
    a.volume = 0;
    this.audio = a;
    this.enabled = this.loadEnabled();
  }

  /** Listen for the first user gesture (call once after construction). */
  arm(): void {
    if (this.armed || !this.audio) return;
    this.armed = true;
    for (const t of GESTURES) this.deps.gestureTarget.addEventListener(t, this.onGesture, { passive: true });
  }

  private disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    for (const t of GESTURES) this.deps.gestureTarget.removeEventListener(t, this.onGesture);
  }

  private readonly onGesture = (): void => {
    this.tryPlay();
  };

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
    this.level.go(inHall ? BGM_LEVEL_HALL : BGM_LEVEL_OUTSIDE, BGM_HALL_MS, this.deps.now());
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

  /** Advance the ramps and the loop fade; the scheduler calls it, and tests call it by hand. */
  tick(): void {
    this.apply();
  }

  dispose(): void {
    this.disarm();
    this.stopTick();
    this.listeners.clear();
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
    if (!a || !this.enabled || !this.visible) return;
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
      if (this.audio !== a) return;
      this.started = true;
      this.disarm();
      this.startTick();
    };
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).then(accepted, () => {
        // Autoplay refused: stay armed, try on the next gesture.
      });
    } else accepted();
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
    a.volume = clamp01(this.level.value(now) * this.duckFactor.value(now) * this.fade.value(now) * loopGain);
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

/** The real browser wiring. */
export function createBrowserBgm(): VillageBgm {
  return new VillageBgm({
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
