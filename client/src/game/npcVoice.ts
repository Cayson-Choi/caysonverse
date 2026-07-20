/**
 * AI 조교 neural voice playback (design 31 후속): fetch the server-synthesized
 * MP3 (/api/npc-voice, Edge TTS ko-KR-SunHi) and play it through one shared
 * Audio element. Returns whether playback actually started so the caller can
 * fall back to the browser's Web Speech voice on any failure (endpoint down,
 * autoplay blocked, decoding error).
 *
 * A new line always replaces the currently-playing one — the 조교 never talks
 * over herself.
 */

import { SERVER_URL } from "../net/endpoint";

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** Stop the active line (panel close / next line). Safe to call anytime. */
export function stopNpcVoice(): void {
  if (current) {
    current.pause();
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Play `text` through the neural voice. Resolves false → caller falls back. */
export async function playNpcVoice(text: string): Promise<boolean> {
  if (typeof Audio === "undefined") return false; // window-less test env
  try {
    const res = await fetch(`${SERVER_URL}/api/npc-voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size === 0) return false;
    stopNpcVoice();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    currentUrl = url;
    audio.onended = () => {
      if (current === audio) stopNpcVoice();
    };
    await audio.play(); // rejects when autoplay is blocked → fallback
    return true;
  } catch {
    return false;
  }
}
