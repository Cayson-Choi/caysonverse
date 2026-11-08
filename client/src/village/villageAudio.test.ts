import { afterEach, describe, expect, it, vi } from "vitest";

/** A stand-in AudioContext: its state is set by the test, resume() counts calls and flips to "running" on demand. */
class FakeCtx {
  static last: FakeCtx | null = null;
  state: string = "suspended";
  resumes = 0;
  resumeWorks = false;
  listeners = new Set<() => void>();
  constructor() {
    FakeCtx.last = this;
  }
  resume() {
    this.resumes++;
    if (this.resumeWorks) this.setState("running");
    return Promise.resolve();
  }
  setState(s: string) {
    this.state = s;
    for (const l of [...this.listeners]) l();
  }
  addEventListener(type: string, fn: () => void) {
    if (type === "statechange") this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === "statechange") this.listeners.delete(fn);
  }
}

async function load() {
  vi.resetModules();
  vi.stubGlobal("window", { AudioContext: FakeCtx });
  const mod = await import("./villageAudio");
  mod.villageAudioContext();
  return { mod, ctx: FakeCtx.last! };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("villageAudio resume", () => {
  it("resumes a suspended context", async () => {
    const { mod, ctx } = await load();
    expect(mod.villageAudioState()).toBe("suspended");
    mod.resumeVillageAudio();
    expect(ctx.resumes).toBe(1);
  });

  it("resumes an iOS 'interrupted' context too (after a call or a screen lock)", async () => {
    const { mod, ctx } = await load();
    ctx.state = "interrupted";
    mod.resumeVillageAudio();
    expect(ctx.resumes).toBe(1);
  });

  it("leaves a running or closed context alone", async () => {
    const { mod, ctx } = await load();
    ctx.state = "running";
    mod.resumeVillageAudio();
    ctx.state = "closed";
    mod.resumeVillageAudio();
    expect(ctx.resumes).toBe(0);
  });

  it("reports state changes until unsubscribed", async () => {
    const { mod, ctx } = await load();
    const seen: string[] = [];
    const off = mod.onVillageAudioState(() => seen.push(mod.villageAudioState()));
    ctx.setState("running");
    ctx.setState("interrupted");
    off();
    ctx.setState("running");
    expect(seen).toEqual(["running", "interrupted"]);
  });

  it("is a no-op without Web Audio", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    const mod = await import("./villageAudio");
    expect(mod.villageAudioContext()).toBeNull();
    expect(() => mod.resumeVillageAudio()).not.toThrow();
    expect(mod.villageAudioState()).toBe("none");
    expect(() => mod.onVillageAudioState(() => {})()).not.toThrow();
  });
});
