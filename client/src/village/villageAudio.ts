/**
 * The village's Web Audio route (Task 9A, folding in the music review's minor 3): iOS Safari ignores
 * `HTMLMediaElement.volume` (it is read-only there), so a fade, the hall duck or the voice duck set on the element
 * does nothing on an iPhone. Each element is routed instead through its own GainNode on one shared AudioContext:
 * `element -> MediaElementSource -> Gain -> destination`, and the level is set on the gain.
 *
 * Where there is no AudioContext (old browsers, a test without a DOM) or routing throws, `routeThroughGain` returns
 * null and the caller falls back to `element.volume`.
 *
 * The context starts "suspended" until a user gesture; `resumeVillageAudio()` is called from the gestures that start
 * the music or a guide's clip. iOS also parks it in "interrupted" after a call or a screen lock (final review I1), so
 * it resumes from any state other than "running" (and "closed"). `onVillageAudioState` reports every state change so
 * the music can re-arm its gesture listeners until the context really runs.
 */

/** A level for one routed element. */
export interface GainSink {
  /** The level (0..1). */
  set(level: number): void;
  readonly level: number;
  /** Disconnect the nodes (the element is released by its owner). */
  dispose(): void;
}

type AudioContextCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let unavailable = false;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** The shared context, created on first use; null when the browser has none. */
export function villageAudioContext(): AudioContext | null {
  if (ctx || unavailable) return ctx;
  const Ctor = audioContextCtor();
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    ctx = new Ctor();
  } catch {
    unavailable = true;
    ctx = null;
  }
  return ctx;
}

/** Resume the context inside a user gesture (best effort, never throws): any state but "running"/"closed". */
export function resumeVillageAudio(): void {
  const c = ctx;
  const state = c?.state as string | undefined;
  if (!c || state === "running" || state === "closed") return;
  try {
    void c.resume().catch(() => {});
  } catch {
    // ignore
  }
}

/** The context's state ("running", "suspended", "interrupted", "closed", or "none" without a context). */
export function villageAudioState(): string {
  return ctx ? ctx.state : "none";
}

/** Call `fn` on every state change of the shared context; returns the unsubscribe (a no-op without a context). */
export function onVillageAudioState(fn: () => void): () => void {
  const c = ctx;
  if (!c || typeof c.addEventListener !== "function") return () => {};
  try {
    c.addEventListener("statechange", fn);
  } catch {
    return () => {};
  }
  return () => {
    try {
      c.removeEventListener("statechange", fn);
    } catch {
      // ignore
    }
  };
}

/**
 * Route `el` through a GainNode on the shared context. The element's own volume is set to 1 (the gain does the
 * level). Returns null when Web Audio is not available; the caller then sets `el.volume`.
 */
export function routeThroughGain(el: HTMLMediaElement): GainSink | null {
  const c = villageAudioContext();
  if (!c) return null;
  try {
    const source = c.createMediaElementSource(el);
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(c.destination);
    el.volume = 1;
    let level = 0;
    return {
      set(v: number) {
        const next = Math.min(1, Math.max(0, v));
        if (next === level) return;
        level = next;
        try {
          gain.gain.setValueAtTime(next, c.currentTime);
        } catch {
          gain.gain.value = next;
        }
      },
      get level() {
        return level;
      },
      dispose() {
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          // already disconnected
        }
      },
    };
  } catch {
    return null;
  }
}
