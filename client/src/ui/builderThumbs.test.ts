import { describe, expect, it, vi } from "vitest";
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
  chipThumbHex,
  chipThumbKey,
  nextThumbJobs,
  presetThumbKey,
  thumbJobs,
  type ThumbJob,
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
