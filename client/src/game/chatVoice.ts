/**
 * Neural chat voices (design 34 후속 — 발주자: 캐릭터 대화도 Edge TTS로, 남자
 * 캐릭터는 남성·여자 캐릭터는 여성 목소리). Chat messages are synthesized by
 * the same server endpoint as the NPC voice (/api/npc-voice) with the SENDER
 * character's gender, then played through one serial queue: one message at a
 * time, a small pending cap (oldest dropped), distance-attenuated volume — the
 * exact gating/volume model the old Web Speech queue used (tts.ts constants).
 * Failures skip silently: Edge TTS or nothing (발주자: 다른 목소리 금지).
 */

import { speechOnlyText } from "@caysonverse/shared/speech";
import { SERVER_URL } from "../net/endpoint";
import { TTS_MAX_PENDING, TTS_RADIUS_M, chatVolume, clipForSpeech } from "./tts";

export type ChatVoiceGender = "male" | "female";

interface QueueItem {
  text: string;
  volume: number;
  gender: ChatVoiceGender;
}

const queue: QueueItem[] = [];
let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let playing = false;

function cleanup(): void {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  current = null;
}

async function playNext(): Promise<void> {
  if (playing) return;
  const item = queue.shift();
  if (!item) return;
  playing = true;
  try {
    const res = await fetch(`${SERVER_URL}/api/npc-voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: item.text, gender: item.gender }),
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = item.volume;
        current = audio;
        currentUrl = url;
        await new Promise<void>((resolve) => {
          const done = () => {
            cleanup();
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.play().catch(done); // autoplay blocked ⇒ skip this line
        });
      }
    }
  } catch {
    // network/synthesis failure — skip the line, keep the queue moving
  }
  playing = false;
  void playNext();
}

/**
 * Queue one chat message for neural speech. Same gates as the old queue:
 * muted ⇒ skip, beyond TTS_RADIUS_M (or unknown distance) ⇒ skip, art/emoji
 * filtered to prose (empty ⇒ skip), long messages clipped for speech only.
 */
export function speakChatNeural(
  text: string,
  distance: number,
  gender: ChatVoiceGender,
  muted: boolean,
): void {
  if (muted) return;
  if (typeof Audio === "undefined") return; // window-less test env
  if (!Number.isFinite(distance) || distance > TTS_RADIUS_M) return;
  const speech = speechOnlyText(clipForSpeech(text));
  if (!speech) return;
  while (queue.length > TTS_MAX_PENDING) queue.shift(); // oldest dropped
  queue.push({ text: speech, volume: chatVolume(distance), gender });
  void playNext();
}

/** Stop everything (world teardown). Safe to call anytime. */
export function stopChatVoice(): void {
  queue.length = 0;
  current?.pause();
  cleanup();
}
