/**
 * AI 조교 neural voice (design 31 후속 — 발주자: Web Speech 음성이 부자연스러움).
 * Server-side synthesis through Microsoft Edge TTS (msedge-tts, free neural
 * voices): the client posts the NPC line to /api/npc-voice and gets MP3 audio
 * back, so every device hears the SAME natural Korean female voice
 * (ko-KR-SunHi) regardless of what its browser/OS ships. Web Speech stays as
 * the client-side fallback when this endpoint fails.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { speechOnlyText } from "@caysonverse/shared/speech";

/** Natural Korean female neural voice (발주자 지정: "edge tts의 여자"). */
export const NPC_VOICE_DEFAULT = "ko-KR-SunHiNeural";

/**
 * Gender → Edge neural voice (design 34 후속: 채팅 낭독도 Edge TTS로, 남자
 * 캐릭터는 남성 목소리·여자 캐릭터는 여성 목소리). The NPC keeps the female
 * default; chat requests pick per-character.
 */
export const VOICES_BY_GENDER = {
  female: "ko-KR-SunHiNeural",
  male: "ko-KR-InJoonNeural",
} as const;

export type VoiceGender = keyof typeof VOICES_BY_GENDER;

/** Longest line we synthesize (covers NPC_MAX_TOKENS-long replies with slack). */
export const VOICE_MAX_CHARS = 600;

/**
 * Per-IP sliding-window limit. Sized for CHAT listening too (design 34 후속):
 * a client requests one synthesis per heard message (queue-capped locally),
 * plus its own NPC lines.
 */
export const VOICE_RATE_LIMIT = 40;
export const VOICE_RATE_WINDOW_MS = 60_000;

/** Synthesis timeout (ms) — the upstream websocket must not pin a request. */
export const VOICE_TIMEOUT_MS = 15_000;

/** Cache cap: the greeting repeats for every visitor; replies rarely repeat. */
export const VOICE_CACHE_MAX = 50;

export type VoiceValidation =
  | { ok: true; text: string; gender: VoiceGender }
  | { ok: false; error: string };

/**
 * Validate the request body and reduce it to SPEAKABLE prose. The same
 * speech-only filter as the client (defense in depth + one canonical cache
 * key): emojis and ASCII-art lines are dropped HERE too, so the voice can
 * never read a pictograph or a drawing aloud regardless of the caller. The
 * length cap applies to the prose that will actually be spoken — a long reply
 * whose bulk is a drawing still speaks its one-line caption. Nothing speakable
 * ⇒ rejected (the client treats that as "don't speak").
 */
export function validateVoiceBody(body: unknown): VoiceValidation {
  const raw = (body as { text?: unknown } | null | undefined)?.text;
  const genderRaw = (body as { gender?: unknown } | null | undefined)?.gender;
  if (typeof raw !== "string") return { ok: false, error: "text가 필요합니다" };
  if (raw.length > 8_000) return { ok: false, error: "text가 너무 깁니다" };
  // Absent gender ⇒ female (the NPC default); anything else must be a known key.
  const gender: VoiceGender = genderRaw === undefined ? "female" : (genderRaw as VoiceGender);
  if (!(gender in VOICES_BY_GENDER)) return { ok: false, error: "알 수 없는 음성입니다" };
  const text = speechOnlyText(raw);
  if (text.length === 0) return { ok: false, error: "낭독할 텍스트가 없습니다" };
  if ([...text].length > VOICE_MAX_CHARS)
    return { ok: false, error: `낭독 텍스트는 ${VOICE_MAX_CHARS}자 이내여야 합니다` };
  return { ok: true, text, gender };
}

/** Tiny FIFO cache (insertion-ordered Map): oldest entry evicted at the cap. */
export class VoiceCache {
  private readonly map = new Map<string, Buffer>();

  constructor(private readonly max: number = VOICE_CACHE_MAX) {}

  get(key: string): Buffer | undefined {
    return this.map.get(key);
  }

  set(key: string, value: Buffer): void {
    if (this.map.size >= this.max && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Synthesize `text` to an MP3 buffer. A fresh MsEdgeTTS per call — the lib's
 * websocket session is not built for concurrent streams, and setup cost is well
 * under the synthesis time. Rejects on stream error or the caller's timeout.
 */
export async function synthesizeVoice(
  text: string,
  voice: string = process.env.NPC_VOICE || NPC_VOICE_DEFAULT,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("voice synthesis timeout")),
      VOICE_TIMEOUT_MS,
    );
    audioStream.on("data", (c: Buffer) => chunks.push(c));
    audioStream.on("end", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) reject(new Error("empty audio"));
      else resolve(buf);
    });
    audioStream.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
