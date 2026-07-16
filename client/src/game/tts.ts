/**
 * Chat TTS (design 23) — reads chat messages aloud through the browser's
 * built-in SpeechSynthesis, ko-KR first. Pure client: zero server/network
 * change, zero cost; voice quality is whatever the device ships.
 *
 * Policy (binding):
 *  - distance gate: only senders within TTS_RADIUS_M of MY avatar are spoken
 *    (classroom noise control); my own messages are distance 0 → always spoken,
 *  - volume attenuates linearly with distance (1.0 → TTS_MIN_VOLUME at the edge),
 *  - serial queue with a small waiting cap; overflow drops the OLDEST waiting
 *    entry (newest wins) and NEVER cancels the utterance being spoken,
 *  - speech-only length cap (the bubble/log keep the full text),
 *  - no SpeechSynthesis at all (old browsers) → silently inert, zero console spam.
 *
 * The engine is injected (TtsEnv) so the whole policy is unit-testable with a
 * mock; the module-level speakChat/primeTts/stopTts wrap one lazy singleton
 * bound to the real window.speechSynthesis.
 *
 * Known device limits (documented, not fixable client-side):
 *  - iOS: the hardware silent switch mutes SpeechSynthesis output entirely,
 *  - voice availability varies per device/OS — no Korean voice installed means
 *    the engine default reads Korean text with a foreign accent (lang="ko-KR"
 *    still hints the engine), and some engines skip it silently,
 *  - mobile autoplay: the engine must be primed inside a user gesture — the
 *    entry screen's join click calls primeTts() (one silent utterance).
 */

/** The slice of SpeechSynthesisVoice the policy needs (mockable). */
export interface TtsVoiceLike {
  lang: string;
  name: string;
}

/** The slice of SpeechSynthesisUtterance the policy sets (mockable). */
export interface TtsUtteranceLike {
  text: string;
  lang: string;
  volume: number;
  voice: TtsVoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

/** The slice of SpeechSynthesis the policy calls (mockable). */
export interface TtsSynthLike {
  speak(utterance: TtsUtteranceLike): void;
  cancel(): void;
  getVoices(): TtsVoiceLike[];
  addEventListener?(type: "voiceschanged", listener: () => void): void;
}

/** Injected platform: the engine plus an utterance factory (paired with it). */
export interface TtsEnv {
  synth: TtsSynthLike;
  createUtterance(text: string): TtsUtteranceLike;
}

/**
 * Audible radius (m), player-to-player. Deliberately tighter than
 * NAMETAG_MAX_DIST (20, camera-based culling): a voice carrying as far as the
 * furthest readable nametag would make a full classroom loud, and the speech
 * bubble itself has no distance cull to align with. ~15 m ≈ half the lounge.
 */
export const TTS_RADIUS_M = 15;

/** Volume at the radius edge — still audible, clearly "far" (0 m = 1.0). */
export const TTS_MIN_VOLUME = 0.35;

/**
 * Waiting-queue cap, EXCLUDING the utterance being spoken. Three ~seconds-long
 * readings of backlog is the most that still feels live; anything older is
 * stale news and gets dropped (oldest first — the newest message always wins).
 */
export const TTS_MAX_PENDING = 3;

/** Speech-only length cap (code points); the bubble/log keep the full text. */
export const TTS_MAX_SPEECH_CHARS = 80;

/** BCP-47 language hint set on every utterance (voice may still be absent). */
export const TTS_LANG = "ko-KR";

/**
 * Per-utterance watchdog: Chrome is known to occasionally drop onend/onerror
 * (background tabs, engine hiccups), which would jam a serial queue forever.
 * Budget ≈ generous Korean speaking time: base + per-char (80 chars ≈ 21 s cap).
 */
export const TTS_WATCHDOG_BASE_MS = 5000;
export const TTS_WATCHDOG_PER_CHAR_MS = 200;

/**
 * Linear distance attenuation: 1.0 at 0 m down to TTS_MIN_VOLUME at the radius
 * edge, clamped outside the band. Linear (not inverse-square) because utterance
 * volume is perceptual [0..1], not acoustic power — a straight ramp reads as
 * "nearer = louder" without making mid-range senders inaudible.
 */
export function chatVolume(distance: number): number {
  const d = Math.min(Math.max(distance, 0), TTS_RADIUS_M);
  return 1 - (1 - TTS_MIN_VOLUME) * (d / TTS_RADIUS_M);
}

/** Clip to TTS_MAX_SPEECH_CHARS code points (+…) — never splits a surrogate. */
export function clipForSpeech(text: string): string {
  const points = [...text];
  if (points.length <= TTS_MAX_SPEECH_CHARS) return text;
  return points.slice(0, TTS_MAX_SPEECH_CHARS).join("") + "…";
}

/**
 * Voice preference: exact ko-KR (case/underscore tolerant — Android reports
 * "ko_KR") → any ko-* dialect → null (engine default; lang still hints ko-KR).
 */
export function pickKoreanVoice(voices: readonly TtsVoiceLike[]): TtsVoiceLike | null {
  const norm = (lang: string) => lang.toLowerCase().replace(/_/g, "-");
  return (
    voices.find((v) => norm(v.lang) === "ko-kr") ??
    voices.find((v) => norm(v.lang).startsWith("ko")) ??
    null
  );
}

interface PendingSpeech {
  text: string;
  volume: number;
}

/** The serial chat-reading queue over an injected engine (null = inert). */
export class ChatTts {
  private readonly env: TtsEnv | null;
  private readonly pending: PendingSpeech[] = [];
  private playing = false;
  private voice: TtsVoiceLike | null = null;
  private voiceResolved = false;
  private primed = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by dispose() so a stale onend can never advance the NEW queue. */
  private epoch = 0;

  constructor(env: TtsEnv | null) {
    this.env = env;
    if (env) this.resolveVoice(env);
  }

  /**
   * Voice lists load asynchronously on Chrome/Android: getVoices() is [] until
   * a voiceschanged fires. Resolve once from the first NON-EMPTY list and cache
   * for the session (a non-empty list without Korean is a definitive "none").
   */
  private resolveVoice(env: TtsEnv): void {
    const list = env.synth.getVoices();
    if (list.length > 0) {
      this.voice = pickKoreanVoice(list);
      this.voiceResolved = true;
      return;
    }
    env.synth.addEventListener?.("voiceschanged", () => {
      if (this.voiceResolved) return;
      const late = env.synth.getVoices();
      if (late.length === 0) return;
      this.voice = pickKoreanVoice(late);
      this.voiceResolved = true;
    });
  }

  /** Read `text` aloud if the sender is within radius and we are not muted. */
  speak(text: string, distance: number, opts?: { muted?: boolean }): void {
    if (!this.env) return;
    if (opts?.muted) return;
    // Negated <= so a NaN distance (sender-position race) also skips.
    if (!(distance <= TTS_RADIUS_M)) return;
    const clipped = clipForSpeech(text.trim());
    if (!clipped) return;
    this.pending.push({ text: clipped, volume: chatVolume(distance) });
    // Cap the WAITING queue only — the utterance being spoken is never cut.
    while (this.pending.length > TTS_MAX_PENDING) this.pending.shift();
    this.pump();
  }

  /**
   * Autoplay priming: one silent utterance, called from a user gesture (the
   * entry screen's join click). Idempotent; must never throw anywhere.
   */
  prime(): void {
    if (!this.env || this.primed) return;
    this.primed = true;
    try {
      const u = this.env.createUtterance("");
      u.volume = 0;
      u.lang = TTS_LANG;
      this.env.synth.speak(u);
    } catch {
      // Best-effort: a failed prime only means the first real utterance primes.
    }
  }

  /** Room teardown: stop the engine, flush the queue (reconnect remount safe). */
  dispose(): void {
    this.pending.length = 0;
    this.epoch += 1;
    this.playing = false;
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    if (!this.env) return;
    try {
      this.env.synth.cancel();
    } catch {
      // Engine already torn down — nothing left to stop.
    }
  }

  /** Start the next waiting utterance if the engine is idle. */
  private pump(): void {
    if (!this.env || this.playing) return;
    const next = this.pending.shift();
    if (!next) return;
    this.playing = true;
    const epoch = this.epoch;
    let finished = false;
    // Exactly-once advance: engines can double-fire onend/onerror, and the
    // watchdog may race a late onend — the first caller wins, the rest no-op.
    const done = () => {
      if (finished || epoch !== this.epoch) return;
      finished = true;
      if (this.watchdog !== null) {
        clearTimeout(this.watchdog);
        this.watchdog = null;
      }
      this.playing = false;
      this.pump();
    };
    try {
      const u = this.env.createUtterance(next.text);
      u.lang = TTS_LANG;
      u.volume = next.volume;
      u.voice = this.voice; // null → engine default
      u.onend = done;
      u.onerror = done;
      this.watchdog = setTimeout(
        done,
        TTS_WATCHDOG_BASE_MS + TTS_WATCHDOG_PER_CHAR_MS * next.text.length,
      );
      this.env.synth.speak(u);
    } catch {
      done(); // engine rejected this utterance — skip it, keep the queue alive
    }
  }
}

/**
 * Real-platform adapter, or null when SpeechSynthesis is absent (old browsers,
 * node) — the null makes every module-level call below silently inert.
 */
function createDefaultEnv(): TtsEnv | null {
  if (typeof window === "undefined") return null;
  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== "function") return null;
  return {
    synth: {
      // Safe cast: every utterance reaching speak() here was created by
      // createUtterance() below, i.e. it IS a real SpeechSynthesisUtterance.
      speak: (u) => synth.speak(u as unknown as SpeechSynthesisUtterance),
      cancel: () => synth.cancel(),
      getVoices: () => synth.getVoices(),
      addEventListener: (type, listener) => synth.addEventListener(type, listener),
    },
    createUtterance: (text) => new Utterance(text) as unknown as TtsUtteranceLike,
  };
}

let singleton: ChatTts | null = null;

function getChatTts(): ChatTts {
  return (singleton ??= new ChatTts(createDefaultEnv()));
}

/** Read a chat message aloud (see ChatTts.speak). Called from chatSync only. */
export function speakChat(text: string, distance: number, opts?: { muted?: boolean }): void {
  getChatTts().speak(text, distance, opts);
}

/** Prime the engine inside a user gesture (entry-screen join click). */
export function primeTts(): void {
  getChatTts().prime();
}

/** Stop speech and flush the queue (chatSync teardown / reconnect remount). */
export function stopTts(): void {
  getChatTts().dispose();
}
