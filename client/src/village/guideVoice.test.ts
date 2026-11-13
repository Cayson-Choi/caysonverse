import { describe, expect, it } from "vitest";
import { GuideVoice, VOICE_DUCK_LEVEL, type Duckable, type VoiceAudio } from "./guideVoice";
import type { GainSink } from "./villageAudio";

class FakeAudio implements VoiceAudio {
  src = "";
  preload = "";
  volume = 0.5;
  paused = true;
  currentTime = 0;
  plays: string[] = [];
  rejectPlay = false;
  deferPlay = false;
  resolvePending: (() => void) | null = null;
  released = false;
  private handlers = new Map<string, Set<() => void>>();
  play() {
    this.plays.push(this.src);
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    if (this.deferPlay)
      return new Promise<void>((res) => {
        this.resolvePending = () => {
          this.paused = false;
          res();
        };
      });
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {
    this.released = true;
  }
  addEventListener(type: string, fn: () => void) {
    (this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.handlers.get(type)?.delete(fn);
  }
  fire(type: "ended" | "error") {
    this.paused = true;
    for (const f of [...(this.handlers.get(type) ?? [])]) f();
  }
  listenerCount() {
    return [...this.handlers.values()].reduce((n, s) => n + s.size, 0);
  }
}

class FakeMusic implements Duckable {
  level = 1;
  calls: string[] = [];
  duck(level: number, ms: number) {
    this.level = level;
    this.calls.push(`duck ${level} ${ms}`);
  }
  unduck(ms: number) {
    this.level = 1;
    this.calls.push(`unduck ${ms}`);
  }
}

function setup(opts: { muted?: boolean; gain?: boolean; noMusic?: boolean } = {}) {
  const audios: FakeAudio[] = [];
  const music = new FakeMusic();
  let muted = opts.muted ?? false;
  const gains: GainSink[] = [];
  const v = new GuideVoice({
    createAudio: () => {
      const a = new FakeAudio();
      audios.push(a);
      return a;
    },
    music: () => (opts.noMusic ? null : music),
    muted: () => muted,
    ...(opts.gain
      ? {
          route: () => {
            let level = 0;
            const g: GainSink = {
              set: (x) => void (level = x),
              get level() {
                return level;
              },
              dispose: () => {},
            };
            gains.push(g);
            return g;
          },
        }
      : {}),
  });
  return { v, audios, music, gains, setMuted: (m: boolean) => (muted = m) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("GuideVoice (Task 9A)", () => {
  it("plays the chosen answer's clip and ducks the music until it ends", () => {
    const s = setup();
    expect(s.v.press("plaza_guide_1")).toBe("play");
    const a = s.audios[0]!;
    expect(a.src).toBe("/village/voice/plaza_guide_1.m4a");
    expect(a.paused).toBe(false);
    expect(s.v.state()).toEqual({ playing: "plaza_guide_1", asked: "plaza_guide_1" });
    expect(s.music.level).toBe(VOICE_DUCK_LEVEL);
    a.fire("ended");
    expect(s.v.state()).toEqual({ playing: null, asked: "plaza_guide_1" });
    expect(s.music.level).toBe(1);
    expect(s.music.calls).toEqual(["duck 0.3 250", "unduck 700"]);
  });

  it("one clip at a time: another question stops the first and plays the second on the same element", () => {
    const s = setup();
    s.v.press("plaza_guide_1");
    s.v.press("plaza_guide_2");
    expect(s.audios).toHaveLength(1);
    const a = s.audios[0]!;
    expect(a.plays).toEqual(["/village/voice/plaza_guide_1.m4a", "/village/voice/plaza_guide_2.m4a"]);
    expect(s.v.state().playing).toBe("plaza_guide_2");
    // the music stays ducked through the switch (no unduck in between)
    expect(s.music.calls).toEqual(["duck 0.3 250"]);
  });

  it("a second press of the playing question skips it, and the music comes back", () => {
    const s = setup();
    s.v.press("hall_desk_1");
    expect(s.v.press("hall_desk_1")).toBe("skip");
    expect(s.audios[0]!.paused).toBe(true);
    expect(s.v.state()).toEqual({ playing: null, asked: "hall_desk_1" });
    expect(s.music.level).toBe(1);
    // pressed again after the skip: it plays again from the start
    expect(s.v.press("hall_desk_1")).toBe("play");
    expect(s.audios[0]!.currentTime).toBe(0);
  });

  it("the sound toggle mutes it: muted, nothing plays and the music is not ducked; muting mid-clip stops it", () => {
    const s = setup({ muted: true });
    expect(s.v.press("plaza_guide_3")).toBe("muted");
    expect(s.audios).toHaveLength(0);
    expect(s.v.state()).toEqual({ playing: null, asked: "plaza_guide_3" }); // the answer text still shows
    expect(s.music.calls).toEqual([]);
    s.setMuted(false);
    s.v.press("plaza_guide_3");
    expect(s.audios[0]!.paused).toBe(false);
    s.setMuted(true);
    s.v.setMuted(true);
    expect(s.audios[0]!.paused).toBe(true);
    expect(s.v.state().playing).toBeNull();
    expect(s.music.level).toBe(1);
  });

  it("a hidden tab stops the clip and gives the music back; showing it again plays nothing by itself", () => {
    const s = setup();
    s.v.press("hall_desk_2");
    const a = s.audios[0]!;
    s.v.setVisible(false);
    expect(a.paused).toBe(true);
    expect(s.v.state()).toEqual({ playing: null, asked: "hall_desk_2" });
    expect(s.music.level).toBe(1);
    s.v.setVisible(true);
    expect(a.paused).toBe(true);
  });

  it("muted while play() is pending: the late resolve stops it", async () => {
    const s = setup();
    s.v.press("plaza_guide_1");
    const a = s.audios[0]!;
    s.v.skip();
    a.deferPlay = true;
    s.v.press("plaza_guide_2");
    s.setMuted(true);
    a.resolvePending!();
    await flush();
    expect(a.paused).toBe(true);
    expect(s.v.state().playing).toBeNull();
    expect(s.music.level).toBe(1);
  });

  it("a refused or failing clip never throws and gives the music back", async () => {
    const s = setup();
    s.v.press("plaza_guide_1");
    const a = s.audios[0]!;
    a.fire("error");
    expect(s.v.state().playing).toBeNull();
    expect(s.music.level).toBe(1);
    a.rejectPlay = true;
    expect(s.v.press("plaza_guide_2")).toBe("play");
    await flush();
    expect(s.v.state().playing).toBeNull();
    expect(s.music.level).toBe(1);
  });

  it("works without music (the hall before the music exists) and routes through a gain when there is one", () => {
    const s = setup({ noMusic: true, gain: true });
    s.v.press("hall_desk_2");
    expect(s.v.isRouted()).toBe(true);
    expect(s.audios[0]!.volume).toBe(1);
    expect(s.gains[0]!.level).toBe(1);
    expect(s.v.level()).toBe(1);
    s.audios[0]!.fire("ended");
  });

  it("reset (dialog closed) stops and forgets; dispose releases the element and its listeners", () => {
    const s = setup();
    s.v.press("hall_desk_3");
    s.v.reset();
    expect(s.v.state()).toEqual({ playing: null, asked: null });
    expect(s.music.level).toBe(1);
    s.v.press("hall_desk_3");
    s.v.dispose();
    const a = s.audios[0]!;
    expect(a.paused).toBe(true);
    expect(a.released).toBe(true);
    expect(a.listenerCount()).toBe(0);
    expect(s.music.level).toBe(1);
    expect(s.v.press("hall_desk_3")).toBe("none");
  });
});
