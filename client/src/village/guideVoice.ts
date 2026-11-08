/**
 * The guides' voice (케이슨 마을 Task 9A): plays a pre-generated clip (`/village/voice/<id>.m4a`) for the player who
 * asked — nothing goes over the network, so nobody else hears it. Pure logic over an injected audio factory, so it
 * is unit tested without DOM audio (guideVoice.test.ts).
 *
 *  - One clip at a time: asking another question stops the clip that is playing.
 *  - A second press of the same question while it plays skips it (`press`); `skip()` does the same.
 *  - A hidden tab stops the clip (`setVisible`).
 *  - The game's sound toggle (🔊, soundStore `muted`) mutes it: while muted nothing plays, and muting stops the clip.
 *  - While a clip plays the village music is ducked (`VillageBgm.duck`) and restored when it ends, is skipped, fails
 *    or the controller is disposed.
 *  - The level goes through a Web Audio GainNode when one is available (villageAudio.ts), else `element.volume`.
 *
 * Chat is never spoken (CHAT_VOICE_ENABLED stays false): only a guide's answer has a voice.
 */
import { guideVoiceUrl } from "@caysonverse/shared/village/guides";
import { resumeVillageAudio, routeThroughGain, type GainSink } from "./villageAudio";
import { activeVillageBgm } from "./villageBgm";

/** The music's level while a guide speaks (x its current level) and the glide in and out (ms). */
export const VOICE_DUCK_LEVEL = 0.3;
export const VOICE_DUCK_MS = 250;
export const VOICE_UNDUCK_MS = 700;
/** The clip's own level. */
export const VOICE_LEVEL = 1;

/** The slice of HTMLAudioElement the voice uses. */
export interface VoiceAudio {
  src: string;
  preload: string;
  volume: number;
  readonly paused: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
  addEventListener(type: "ended" | "error", fn: () => void): void;
  removeEventListener(type: "ended" | "error", fn: () => void): void;
}

export interface Duckable {
  duck(level: number, ms: number): void;
  unduck(ms: number): void;
}

export interface GuideVoiceDeps {
  createAudio: () => VoiceAudio;
  /** The music to duck (the live village controller), or null. */
  music: () => Duckable | null;
  /** The game's sound toggle: true = 🔇. */
  muted: () => boolean;
  route?: (audio: VoiceAudio) => GainSink | null;
  resume?: () => void;
}

export interface GuideVoiceState {
  /** The voice id playing now, or null. */
  playing: string | null;
  /** The last voice id asked for (shown as the selected question), or null. */
  asked: string | null;
}

export class GuideVoice {
  private audio: VoiceAudio | null = null;
  private gain: GainSink | null = null;
  private routed = false;
  private st: GuideVoiceState = { playing: null, asked: null };
  private ducked = false;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly deps: GuideVoiceDeps) {}

  state(): GuideVoiceState {
    return this.st;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** The audio element (dev probe), created on first use. */
  element(): VoiceAudio | null {
    return this.audio;
  }

  /** The clip's level now (the gain's, or the element's volume); 0 when nothing plays. */
  level(): number {
    if (!this.audio) return 0;
    return this.gain ? this.gain.level : this.audio.volume;
  }

  isRouted(): boolean {
    return this.gain !== null;
  }

  /**
   * The player chose a question: play its clip, or skip it if that clip is the one playing (a second press).
   * Returns what happened.
   */
  press(voice: string): "play" | "skip" | "muted" | "none" {
    if (this.disposed) return "none";
    if (this.st.playing === voice) {
      this.skip();
      return "skip";
    }
    return this.play(voice);
  }

  /** Play `voice` (stopping any other clip first). */
  play(voice: string): "play" | "muted" | "none" {
    if (this.disposed) return "none";
    this.stopClip();
    this.set({ playing: null, asked: voice });
    if (this.deps.muted()) {
      this.restoreMusic();
      return "muted";
    }
    const a = this.ensureAudio();
    try {
      this.deps.resume?.();
    } catch {
      // best effort
    }
    a.src = guideVoiceUrl(voice);
    try {
      a.currentTime = 0;
    } catch {
      // not seekable yet
    }
    this.setLevel(VOICE_LEVEL);
    this.set({ playing: voice, asked: voice });
    this.duckMusic();
    let result: Promise<void> | void;
    try {
      result = a.play();
    } catch {
      this.finished(voice);
      return "none";
    }
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).then(
        () => {
          // Muted while play() was pending: stop it. Skipped while pending (nothing playing now): make sure it is
          // paused. Replaced by another question: that one owns the element now, leave it.
          if (this.st.playing === voice) {
            if (this.deps.muted()) this.skip();
          } else if (this.st.playing === null) this.pauseQuietly();
        },
        () => this.finished(voice),
      );
    }
    return "play";
  }

  /** Stop the clip now (the answer text stays). */
  skip(): void {
    if (this.st.playing === null) return;
    this.stopClip();
    this.set({ ...this.st, playing: null });
    this.restoreMusic();
  }

  /** The sound toggle changed: muting stops the clip. */
  setMuted(muted: boolean): void {
    if (muted) this.skip();
  }

  /** The tab was hidden (T9A minor): stop the clip so it does not talk to an empty room; the answer text stays. */
  setVisible(visible: boolean): void {
    if (!visible) this.skip();
  }

  /** The dialog closed: stop, and forget the selection. */
  reset(): void {
    this.skip();
    if (this.st.asked !== null) this.set({ playing: null, asked: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.skip();
    this.disposed = true;
    this.listeners.clear();
    const a = this.audio;
    this.audio = null;
    this.gain?.dispose();
    this.gain = null;
    if (!a) return;
    a.removeEventListener("ended", this.onEnded);
    a.removeEventListener("error", this.onEnded);
    try {
      a.pause();
      a.removeAttribute("src");
      a.load();
    } catch {
      // best effort
    }
  }

  // ── internals ──

  private readonly onEnded = (): void => {
    if (this.st.playing !== null) this.finished(this.st.playing);
  };

  private finished(voice: string): void {
    if (this.st.playing !== voice) return;
    this.set({ ...this.st, playing: null });
    this.restoreMusic();
  }

  private ensureAudio(): VoiceAudio {
    if (this.audio) return this.audio;
    const a = this.deps.createAudio();
    a.preload = "auto";
    a.addEventListener("ended", this.onEnded);
    a.addEventListener("error", this.onEnded);
    this.audio = a;
    if (!this.routed) {
      this.routed = true;
      try {
        this.gain = this.deps.route?.(a) ?? null;
      } catch {
        this.gain = null;
      }
      if (this.gain) a.volume = 1;
    }
    return a;
  }

  private setLevel(v: number): void {
    if (!this.audio) return;
    if (this.gain) this.gain.set(v);
    else this.audio.volume = v;
  }

  private stopClip(): void {
    if (!this.audio || this.st.playing === null) return;
    this.pauseQuietly();
  }

  private pauseQuietly(): void {
    try {
      this.audio?.pause();
    } catch {
      // ignore
    }
  }

  private duckMusic(): void {
    if (this.ducked) return;
    this.ducked = true;
    this.deps.music()?.duck(VOICE_DUCK_LEVEL, VOICE_DUCK_MS);
  }

  private restoreMusic(): void {
    if (!this.ducked) return;
    this.ducked = false;
    this.deps.music()?.unduck(VOICE_UNDUCK_MS);
  }

  private set(next: GuideVoiceState): void {
    if (next.playing === this.st.playing && next.asked === this.st.asked) return;
    this.st = next;
    for (const l of [...this.listeners]) l();
  }
}

/** The real browser wiring: one element, through a GainNode where Web Audio exists; ducks the live village music. */
export function createBrowserGuideVoice(muted: () => boolean): GuideVoice {
  return new GuideVoice({
    createAudio: () => new Audio() as unknown as VoiceAudio,
    music: activeVillageBgm,
    muted,
    route: (a) => routeThroughGain(a as unknown as HTMLMediaElement),
    resume: resumeVillageAudio,
  });
}
