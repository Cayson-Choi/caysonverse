import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Vector2, Vector4, type Material, type Object3D, type WebGLRenderer } from "three";
import {
  APPEARANCE_PRESETS,
  CLOTHES_PALETTE,
  DEFAULT_APPEARANCE,
  SKIN_PALETTE,
  SLOT_OPTIONS,
  withPart,
} from "@caysonverse/shared/appearance";
import { CHARACTER_SLOTS } from "@caysonverse/shared/characterManifest";
import {
  THUMBS_PER_FRAME,
  THUMB_PX,
  ThumbCache,
  ThumbScheduler,
  ThumbStudio,
  drawThumbFrame,
  chipThumbHex,
  chipThumbKey,
  nextThumbJobs,
  presetThumbKey,
  thumbJobs,
  type ThumbJob,
  type ThumbShooter,
} from "./builderThumbs";

const hex = (label: string) => CLOTHES_PALETTE.find((c) => c.label === label)!.hex;
const index = (slot: keyof typeof SLOT_OPTIONS, id: string | null) => SLOT_OPTIONS[slot].indexOf(id);

describe("builderThumbs — cache keys", () => {
  it("keys a part card by (part, colour) — case-insensitive hex — and a portrait by preset id", () => {
    expect(chipThumbKey("hat", "wizard", "#8b5cf6")).toBe(chipThumbKey("hat", "wizard", "#8B5CF6"));
    expect(chipThumbKey("hat", "wizard", "#8B5CF6")).not.toBe(chipThumbKey("hat", "wizard", "#E53E3E"));
    expect(chipThumbKey("hat", "wizard", "#8B5CF6")).not.toBe(chipThumbKey("hat", "cap", "#8B5CF6"));
    expect(chipThumbKey("top", "tee", "#8B5CF6")).not.toBe(chipThumbKey("bottom", "tee", "#8B5CF6"));
    expect(presetThumbKey("knight")).toBe(presetThumbKey("knight"));
    expect(presetThumbKey("knight")).not.toBe(presetThumbKey("pirate"));
    expect(presetThumbKey("knight")).not.toBe(chipThumbKey("hat", "knight", "#000000"));
    expect(THUMB_PX).toEqual({ chip: 128, preset: 160 });
  });
});

describe("builderThumbs — the colour a card is painted with", () => {
  it("paints a card in the colour the slot would have after pressing it", () => {
    // The default look wears no hat and its hat colour is 노랑.
    expect(chipThumbHex(DEFAULT_APPEARANCE, "hat", index("hat", "cap"))).toBe(hex("노랑"));
    // 왕관 and 티아라 switch the hat to 금색 when pressed (manifest defaultColors), so their cards are gold.
    expect(chipThumbHex(DEFAULT_APPEARANCE, "hat", index("hat", "crown"))).toBe(hex("금색"));
    expect(chipThumbHex(DEFAULT_APPEARANCE, "hat", index("hat", "tiara"))).toBe(hex("금색"));
    // The worn card shows the colour actually worn, even a crown recoloured red.
    const redCrown = { ...withPart(DEFAULT_APPEARANCE, "hat", index("hat", "crown")), hatColor: 0 };
    expect(chipThumbHex(redCrown, "hat", index("hat", "crown"))).toBe(hex("빨강"));
    // Face cards carry the skin colour; 없음 has no card picture at all.
    expect(chipThumbHex(DEFAULT_APPEARANCE, "face", 3)).toBe(SKIN_PALETTE[DEFAULT_APPEARANCE.skin].hex);
    expect(chipThumbHex(DEFAULT_APPEARANCE, "hat", 0)).toBeNull();
    expect(chipThumbHex(DEFAULT_APPEARANCE, "item", 0)).toBeNull();
  });
});

describe("builderThumbs — what to draw, current tab first", () => {
  it("orders the open tab's cards, then the 8 portraits, then the other tabs — each picture once", () => {
    const jobs = thumbJobs(DEFAULT_APPEARANCE, "top");
    const tops = SLOT_OPTIONS.top.length;
    expect(jobs.slice(0, tops).map((j) => (j.kind === "chip" ? `${j.slot}:${j.part}` : j.key))).toEqual(
      SLOT_OPTIONS.top.map((id) => `top:${id}`),
    );
    expect(jobs.slice(0, tops).every((j) => j.kind === "chip" && j.hex === hex("파랑"))).toBe(true);
    expect(jobs.slice(tops, tops + 8).map((j) => (j.kind === "preset" ? j.presetId : j.key))).toEqual(
      APPEARANCE_PRESETS.map((p) => p.id),
    );
    const rest = jobs.slice(tops + 8).map((j) => (j.kind === "chip" ? j.slot : "preset"));
    expect([...new Set(rest)]).toEqual(CHARACTER_SLOTS.filter((s) => s !== "top"));
    // Every non-empty part once, no 없음 cards, no duplicate keys.
    const parts = CHARACTER_SLOTS.reduce((n, s) => n + SLOT_OPTIONS[s].filter((id) => id !== null).length, 0);
    expect(jobs).toHaveLength(parts + APPEARANCE_PRESETS.length);
    expect(new Set(jobs.map((j) => j.key)).size).toBe(jobs.length);
  });

  it("moves a newly opened tab to the front", () => {
    const first = thumbJobs(DEFAULT_APPEARANCE, "hat")[0];
    expect(first).toMatchObject({ kind: "chip", slot: "hat", part: "cap" });
    expect(thumbJobs(DEFAULT_APPEARANCE, "item")[0]).toMatchObject({ kind: "chip", slot: "item", part: "book" });
  });
});

describe("builderThumbs — at most two pictures a frame", () => {
  const take = (jobs: readonly ThumbJob[], cache: ThumbCache) => nextThumbJobs(jobs, cache).map((j) => j.key);

  it("hands out two jobs per frame, never one already drawn or failed, in order", () => {
    expect(THUMBS_PER_FRAME).toBe(2);
    const jobs = thumbJobs(DEFAULT_APPEARANCE, "hat");
    const cache = new ThumbCache();
    const frame1 = take(jobs, cache);
    expect(frame1).toEqual([jobs[0].key, jobs[1].key]);
    cache.set(frame1[0], "data:image/webp;base64,AAA");
    cache.set(frame1[1], null); // failed: shown as a name-only card, not retried
    expect(take(jobs, cache)).toEqual([jobs[2].key, jobs[3].key]);
    let frames = 1;
    for (let next = take(jobs, cache); next.length > 0; next = take(jobs, cache)) {
      expect(next.length).toBeLessThanOrEqual(2);
      for (const key of next) cache.set(key, "x");
      frames += 1;
    }
    expect(frames).toBe(Math.ceil(jobs.length / 2));
    expect(cache.get(frame1[1])).toBeNull();
    expect(cache.get("never")).toBeUndefined();
  });

  it("draws a recoloured card again (new key) but not the cards whose colour stayed", () => {
    const cache = new ThumbCache();
    for (const job of thumbJobs(DEFAULT_APPEARANCE, "top")) cache.set(job.key, "x");
    const green = { ...DEFAULT_APPEARANCE, topColor: CLOTHES_PALETTE.findIndex((c) => c.label === "초록") };
    const next = nextThumbJobs(thumbJobs(green, "top"), cache, 100);
    expect(next.every((j) => j.kind === "chip" && j.slot === "top" && j.hex === hex("초록"))).toBe(true);
    expect(next).toHaveLength(SLOT_OPTIONS.top.length);
  });

  it("does not hand out a picture again while it is still being encoded", () => {
    const jobs = thumbJobs(DEFAULT_APPEARANCE, "hat");
    const cache = new ThumbCache();
    cache.begin(jobs[0].key);
    cache.begin(jobs[1].key);
    expect(nextThumbJobs(jobs, cache).map((j) => j.key)).toEqual([jobs[2].key, jobs[3].key]);
    expect(cache.get(jobs[0].key)).toBeUndefined(); // no picture yet: the card shows its name only
    cache.set(jobs[0].key, "blob:x");
    expect(cache.get(jobs[0].key)).toBe("blob:x");
    expect(cache.has(jobs[1].key)).toBe(true);
  });

  it("forgets the oldest pictures past the cap — never the ones still wanted — and frees their URLs", () => {
    const revoked: string[] = [];
    const cache = new ThumbCache(3, (url) => revoked.push(url));
    cache.set("a", "blob:1");
    cache.set("b", "blob:2");
    cache.set("c", "blob:3");
    cache.set("d", "blob:4", new Set(["a"]));
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBe("blob:1"); // wanted, kept
    expect(cache.get("b")).toBeUndefined(); // oldest unwanted, dropped
    expect(cache.get("d")).toBe("blob:4");
    expect(revoked).toEqual(["blob:2"]);
  });

  it("tells subscribers when pictures arrive", () => {
    const cache = new ThumbCache();
    const listener = vi.fn();
    const stop = cache.subscribe(listener);
    cache.notify();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    cache.notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("builderThumbs — the per-frame scheduler", () => {
  it("fills one reused array instead of allocating a new one every frame", () => {
    const jobs = thumbJobs(DEFAULT_APPEARANCE, "hat");
    const cache = new ThumbCache();
    const out: ThumbJob[] = [];
    expect(nextThumbJobs(jobs, cache, 2, out)).toBe(out);
    expect(out).toHaveLength(2);
    for (const j of jobs) cache.set(j.key, "x");
    expect(nextThumbJobs(jobs, cache, 2, out)).toBe(out);
    expect(out).toHaveLength(0);
    const scheduler = new ThumbScheduler(new ThumbCache());
    scheduler.want(jobs);
    expect(scheduler.next()).toBe(scheduler.next());
  });

  it("does not rescan the job list once everything is drawn, until a job or a picture changes", () => {
    const cache = new ThumbCache();
    const scheduler = new ThumbScheduler(cache);
    const jobs = thumbJobs(DEFAULT_APPEARANCE, "top");
    scheduler.want(jobs);
    for (const j of jobs) cache.set(j.key, "x");
    const has = vi.spyOn(cache, "has");
    expect(scheduler.next()).toHaveLength(0); // one scan finds nothing to do…
    const afterFirst = has.mock.calls.length;
    expect(afterFirst).toBe(jobs.length);
    for (let frame = 0; frame < 100; frame++) expect(scheduler.next()).toHaveLength(0);
    expect(has.mock.calls.length).toBe(afterFirst); // …and the next 100 frames do not look again
    cache.set("chip:hat:cap:#000000", "y"); // a picture arrived (any change)
    scheduler.next();
    expect(has.mock.calls.length).toBe(afterFirst + jobs.length);
    const green = { ...DEFAULT_APPEARANCE, topColor: 4 };
    scheduler.want(thumbJobs(green, "top")); // a new colour: new jobs
    expect(scheduler.next().map((j) => j.key)).toEqual(thumbJobs(green, "top").slice(0, 2).map((j) => j.key));
  });

  it("retries failed pictures after a size change, never the drawn ones", () => {
    const cache = new ThumbCache();
    const scheduler = new ThumbScheduler(cache);
    const jobs = thumbJobs(DEFAULT_APPEARANCE, "hat");
    scheduler.want(jobs);
    cache.set(jobs[0].key, null); // e.g. the canvas was too small
    for (const j of jobs.slice(1)) cache.set(j.key, "x");
    expect(scheduler.next()).toHaveLength(0);
    scheduler.retryFailed();
    expect(scheduler.next().map((j) => j.key)).toEqual([jobs[0].key]);
    expect(cache.get(jobs[0].key)).toBeUndefined();
  });
});

describe("builderThumbs — drawing a frame", () => {
  const gl = {};
  function setup(shooter: Partial<ThumbShooter<object>>) {
    const cache = new ThumbCache();
    const scheduler = new ThumbScheduler(cache);
    scheduler.want(thumbJobs(DEFAULT_APPEARANCE, "hat"));
    const studio: ThumbShooter<object> = {
      prepare: vi.fn(() => true),
      shoot: vi.fn(() => Promise.resolve("blob:x")),
      release: vi.fn(),
      ...shooter,
    };
    return { cache, scheduler, studio };
  }

  it("turns the pictures off for the session (name-only cards) when the studio cannot start", () => {
    const { scheduler, studio } = setup({ prepare: vi.fn(() => { throw new Error("no WebGL2 context"); }) });
    expect(() => drawThumbFrame(scheduler, studio, gl)).not.toThrow();
    expect(scheduler.disabled).toBe(true);
    expect(studio.release).toHaveBeenCalled();
    expect(scheduler.next()).toHaveLength(0);
    drawThumbFrame(scheduler, studio, gl);
    expect(studio.prepare).toHaveBeenCalledTimes(1);
    expect(studio.shoot).not.toHaveBeenCalled();
  });

  it("draws two pictures a frame when they are quick, one when the first is slow", () => {
    let now = 0;
    const clock = () => now;
    const quick = setup({});
    drawThumbFrame(quick.scheduler, quick.studio, gl, clock);
    expect(quick.studio.shoot).toHaveBeenCalledTimes(2);
    const slow = setup({ shoot: vi.fn(() => { now += 12; return Promise.resolve("blob:y"); }) });
    drawThumbFrame(slow.scheduler, slow.studio, gl, clock);
    expect(slow.studio.shoot).toHaveBeenCalledTimes(1);
  });

  it("starts no new picture while two are still being drawn (read back from the GPU, encoded)", async () => {
    const reads: Array<(url: string | null) => void> = [];
    const { cache, scheduler, studio } = setup({ shoot: vi.fn(() => new Promise<string | null>((done) => reads.push(done))) });
    drawThumbFrame(scheduler, studio, gl);
    expect(studio.shoot).toHaveBeenCalledTimes(2);
    // A slow GPU has not caught up: the next preview frames get no picture work at all.
    for (let frame = 0; frame < 5; frame++) drawThumbFrame(scheduler, studio, gl);
    expect(studio.shoot).toHaveBeenCalledTimes(2);
    expect(cache.drawing).toBe(2);
    reads[0]("blob:a");
    await Promise.resolve();
    expect(cache.drawing).toBe(1);
    drawThumbFrame(scheduler, studio, gl);
    expect(studio.shoot).toHaveBeenCalledTimes(3);
    reads[1](null); // a failed read frees its place too
    await Promise.resolve();
    expect(cache.drawing).toBe(1);
  });

  it("marks a picture as being drawn, stores it when encoded, and stores a failure as null", async () => {
    const { cache, scheduler, studio } = setup({ shoot: vi.fn((_gl: object, job: ThumbJob) => (job.kind === "chip" && job.part === "cap" ? null : Promise.resolve(`blob:${job.key}`))) });
    const [a, b] = scheduler.next().map((j) => j.key);
    drawThumbFrame(scheduler, studio, gl);
    expect(cache.get(a)).toBeNull(); // cap could not be drawn
    expect(cache.has(b) && cache.get(b) === undefined).toBe(true); // encoding
    await Promise.resolve();
    expect(cache.get(b)).toBe(`blob:${b}`);
  });

  it("keeps the studio's rig while there is nothing to draw (no rebuild on the next colour change)", () => {
    const { cache, scheduler, studio } = setup({});
    for (const j of thumbJobs(DEFAULT_APPEARANCE, "hat")) cache.set(j.key, "x");
    for (let frame = 0; frame < 300; frame++) drawThumbFrame(scheduler, studio, gl);
    expect(studio.release).not.toHaveBeenCalled();
    expect(studio.prepare).not.toHaveBeenCalled();
  });

  it("waits while the studio compiles its shaders, without marking anything", () => {
    const { cache, scheduler, studio } = setup({ prepare: vi.fn(() => false) });
    drawThumbFrame(scheduler, studio, gl);
    expect(studio.shoot).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
    expect(scheduler.next()).toHaveLength(2);
  });
});

describe("builderThumbs — the studio never draws on the screen", () => {
  /** A recording stand-in for the preview's WebGLRenderer (no GPU in the unit tests). */
  function fakeRenderer() {
    const log: string[] = [];
    let target: unknown = null;
    let autoClear = true;
    const shaders = { ready: true };
    const program = { isReady: () => shaders.ready };
    const materialsOf = (root: Object3D) => {
      const found = new Set<Material>();
      root.traverse((o) => {
        if ((o as Mesh).isMesh) found.add((o as Mesh).material as Material);
      });
      return found;
    };
    const gl = {
      compile: (root: Object3D) => {
        log.push(`compile on ${target === null ? "SCREEN" : "target"}`);
        return materialsOf(root);
      },
      // three's own compileAsync: polls the programs with timers until they are ready
      compileAsync(root: Object3D) {
        const waiting = gl.compile(root);
        return new Promise<void>((resolve) => {
          const check = () => {
            for (const m of waiting) if (program.isReady()) waiting.delete(m);
            if (waiting.size === 0) resolve();
            else setTimeout(check, 10);
          };
          check();
        });
      },
      properties: { get: () => ({ currentProgram: program }) },
      extensions: { has: () => true },
      toneMapping: 4, // ACESFilmicToneMapping
      toneMappingExposure: 1,
      outputColorSpace: "srgb",
      get autoClear() {
        return autoClear;
      },
      set autoClear(v: boolean) {
        autoClear = v;
      },
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t;
      },
      getClearColor: (c: Color) => c.set(0x123456),
      getClearAlpha: () => 0.25,
      setClearColor: (_c: unknown, a: number) => log.push(`setClearColor ${a}`),
      clear: () => log.push(`clear on ${target === null ? "SCREEN" : "target"}`),
      render: () => log.push(`render on ${target === null ? "SCREEN" : "target"}`),
      readRenderTargetPixelsAsync: () => {
        log.push("read target");
        return Promise.resolve();
      },
      getPixelRatio: () => 1,
      getDrawingBufferSize: (v: Vector2) => v.set(1000, 1000),
      getViewport: (v: Vector4) => v.set(0, 0, 1000, 1000),
      getScissor: (v: Vector4) => v.set(0, 0, 1000, 1000),
      getScissorTest: () => false,
      setViewport: () => log.push("setViewport"),
      setScissor: () => log.push("setScissor"),
      setScissorTest: () => log.push("setScissorTest"),
      getContext: () => ({ readPixels: () => log.push("readPixels SCREEN") }),
      domElement: {},
    };
    return { gl: gl as unknown as WebGLRenderer, log, shaders, target: () => target, autoClear: () => autoClear };
  }

  function capScene() {
    const scene = new Group();
    const cap = new Mesh(new BoxGeometry(0.4, 0.2, 0.4), new MeshStandardMaterial({ name: "mat_tint_hat" }));
    cap.name = "hat__cap";
    cap.position.y = 2.2;
    scene.add(cap);
    return scene;
  }

  it("waits for its shaders without timers, so closing the builder mid-compile leaves nothing running", () => {
    vi.useFakeTimers();
    try {
      const studio = new ThumbStudio({ scene: capScene(), animations: [] });
      const { gl, log, shaders } = fakeRenderer();
      shaders.ready = false;
      expect(studio.prepare(gl)).toBe(false);
      expect(log.filter((l) => l.startsWith("compile"))).toEqual(["compile on target", "compile on target"]); // the render-target variants
      expect(vi.getTimerCount()).toBe(0);
      expect(studio.prepare(gl)).toBe(false); // still compiling: asked again on the next frame with work
      shaders.ready = true;
      expect(studio.prepare(gl)).toBe(true);
      // Closed while compiling: release, and no callback is left to touch the disposed materials.
      const closing = new ThumbStudio({ scene: capScene(), animations: [] });
      shaders.ready = false;
      expect(closing.prepare(gl)).toBe(false);
      closing.release();
      expect(vi.getTimerCount()).toBe(0);
      studio.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws card pictures only into its own render targets and gives the renderer back as it was", async () => {
    const studio = new ThumbStudio({ scene: capScene(), animations: [] });
    const { gl, log, target, autoClear } = fakeRenderer();
    // A minimal 2D canvas so the encoding step can run without a DOM.
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {}, putImageData() {}, createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }),
        toBlob: (done: (b: null) => void) => done(null),
      }),
    });
    expect(studio.prepare(gl)).toBe(false); // compiling
    await Promise.resolve();
    expect(studio.prepare(gl)).toBe(true);
    const job = thumbJobs(DEFAULT_APPEARANCE, "hat").find((j) => j.kind === "chip" && j.part === "cap")!;
    const shot = studio.shoot(gl, job);
    expect(shot).not.toBeNull();
    await shot; // the stub canvas encodes nothing: null, no throw
    expect(log.filter((l) => /SCREEN|setViewport|setScissor/.test(l))).toEqual([]);
    expect(log.filter((l) => l.startsWith("render on"))).toEqual(["render on target", "render on target"]); // scene, output pass
    expect(log).toContain("read target");
    expect(target()).toBeNull(); // the previous (screen) target is bound again
    expect(autoClear()).toBe(true);
    expect(log.filter((l) => l.startsWith("setClearColor")).pop()).toBe("setClearColor 0.25");
    studio.release();
    vi.unstubAllGlobals();
  });
});
