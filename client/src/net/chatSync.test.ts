import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageType } from "@caysonverse/shared/messages";
import type { ChatBroadcast } from "@caysonverse/shared/messages";
import { startChatSync, type ChatRoom } from "./chatSync";
import { speakChatNeural } from "../game/chatVoice";
import { CHAT_VOICE_ENABLED, speakChat } from "../game/tts";
import { useChatStore } from "../stores/chatStore";
import { useSoundStore } from "../stores/soundStore";

/**
 * Chat is never read aloud (owner decision 2026-11-03: "음성은 빼버려 음성이 너무 기계음 같아서 안좋아"). The
 * chat line still reaches the log and the speech bubble; what must NOT happen is any speech: no neural clip
 * (an Audio element fed by a /api/npc-voice fetch) and no Web Speech utterance. The platform is stubbed with
 * spies, so these tests see a call whatever module made it.
 */

type Player = { voice: number; x: number; z: number };

interface Harness {
  room: ChatRoom;
  chat: (m: ChatBroadcast) => void;
  stop: () => void;
}

function harness(players: Record<string, Player>): Harness {
  const handlers = new Map<string, (m: unknown) => void>();
  const room = {
    sessionId: "me",
    state: { players: { get: (sid: string) => players[sid] } },
    onMessage: (type: string, cb: (m: unknown) => void) => {
      handlers.set(type, cb);
      return () => void handlers.delete(type);
    },
  } as ChatRoom;
  const stop = startChatSync(room);
  return { room, chat: (m) => handlers.get(MessageType.Chat)?.(m), stop };
}

const audioCtor = vi.fn();
const fetchSpy = vi.fn(async () => new Response(new Blob(["x"]), { status: 200 }));
const speakSpy = vi.fn();
const utteranceCtor = vi.fn();

beforeEach(() => {
  audioCtor.mockClear();
  fetchSpy.mockClear();
  speakSpy.mockClear();
  utteranceCtor.mockClear();
  class FakeAudio {
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      audioCtor();
    }
    play(): Promise<void> {
      queueMicrotask(() => this.onended?.()); // the clip "ends" at once, so a started speech never jams the queue
      return Promise.resolve();
    }
    pause(): void {}
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", fetchSpy);
  // A browser WITH a speech engine: Web Speech must stay silent too.
  vi.stubGlobal("window", {
    speechSynthesis: { speak: speakSpy, cancel: vi.fn(), getVoices: () => [{ lang: "ko-KR", name: "ko" }], addEventListener: vi.fn() },
    SpeechSynthesisUtterance: function (this: object) {
      utteranceCtor();
    },
  });
  useSoundStore.setState({ muted: false });
  useChatStore.getState().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Let any queued promise work run, so a wrongly started speech would have reached fetch / Audio by now. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function expectSilence(): void {
  expect(audioCtor).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(speakSpy).not.toHaveBeenCalled();
  expect(utteranceCtor).not.toHaveBeenCalled();
}

describe("chat voice is switched off", () => {
  it("the flag is false", () => {
    expect(CHAT_VOICE_ENABLED).toBe(false);
  });

  it("my own line and a nearby neighbour's line reach the log, but nothing is spoken", async () => {
    const h = harness({
      me: { voice: 0, x: 0, z: 0 },
      near: { voice: 1, x: 3, z: 0 },
      far: { voice: 0, x: 90, z: 0 },
    });
    h.chat({ sid: "me", name: "나", text: "안녕하세요" });
    h.chat({ sid: "near", name: "이웃", text: "반가워요" });
    h.chat({ sid: "far", name: "먼 사람", text: "멀리서 안녕" });
    await settle();

    // The bubble / log path is untouched…
    expect(useChatStore.getState().log.map((e) => e.text)).toEqual(["안녕하세요", "반가워요", "멀리서 안녕"]);
    // …and no voice, neural or browser, was asked for.
    expectSilence();
    h.stop();
  });

  it("stays silent for either voice value, a sender missing from the state, and an unmuted sound toggle", async () => {
    const h = harness({ me: { voice: 1, x: 0, z: 0 } });
    useSoundStore.setState({ muted: false });
    h.chat({ sid: "me", name: "나", text: "여자 목소리 값" });
    h.chat({ sid: "ghost", name: "유령", text: "상태에 없는 사람" }); // a join/leave race
    await settle();
    expectSilence();
    h.stop();
  });

  it("the speaking entry points themselves are inert, called directly", async () => {
    speakChatNeural("안녕하세요", 0, "male", false);
    speakChatNeural("안녕하세요", 0, "female", false);
    speakChat("안녕하세요", 0);
    await settle();
    expectSilence();
  });

  it("tearing the sync down is safe and leaves the log empty", () => {
    const h = harness({ me: { voice: 0, x: 0, z: 0 } });
    h.chat({ sid: "me", name: "나", text: "안녕하세요" });
    expect(() => h.stop()).not.toThrow();
    expect(useChatStore.getState().log).toEqual([]);
  });
});
