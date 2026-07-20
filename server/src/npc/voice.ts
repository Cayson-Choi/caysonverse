/**
 * AI 조교 neural voice (design 31 후속 — 발주자: Web Speech 음성이 부자연스러움).
 * Server-side synthesis through Microsoft Edge TTS (msedge-tts, free neural
 * voices): the client posts the NPC line to /api/npc-voice and gets MP3 audio
 * back, so every device hears the SAME natural Korean female voice
 * (ko-KR-SunHi) regardless of what its browser/OS ships. Web Speech stays as
 * the client-side fallback when this endpoint fails.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/** Natural Korean female neural voice (발주자 지정: "edge tts의 여자"). */
export const NPC_VOICE_DEFAULT = "ko-KR-SunHiNeural";

/** Longest line we synthesize (covers NPC_MAX_TOKENS-long replies with slack). */
export const VOICE_MAX_CHARS = 600;

/** Per-IP sliding-window limit — one call per NPC line (greeting + replies). */
export const VOICE_RATE_LIMIT = 20;
export const VOICE_RATE_WINDOW_MS = 60_000;

/** Synthesis timeout (ms) — the upstream websocket must not pin a request. */
export const VOICE_TIMEOUT_MS = 15_000;

/** Cache cap: the greeting repeats for every visitor; replies rarely repeat. */
export const VOICE_CACHE_MAX = 50;

export type VoiceValidation = { ok: true; text: string } | { ok: false; error: string };

/** Validate the request body: a non-empty string within the length cap. */
export function validateVoiceBody(body: unknown): VoiceValidation {
  const text = (body as { text?: unknown } | null | undefined)?.text;
  if (typeof text !== "string" || text.trim().length === 0)
    return { ok: false, error: "text가 필요합니다" };
  if ([...text].length > VOICE_MAX_CHARS)
    return { ok: false, error: `text는 ${VOICE_MAX_CHARS}자 이내여야 합니다` };
  return { ok: true, text: text.trim() };
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
