import { describe, expect, it } from "vitest";
import { MUSIC_VOLUME, formatMusicVolume, normalizeMusicVolume, useMusicStore } from "./musicStore";

describe("musicStore", () => {
  it("keeps a volume in 0..1 in 5 % steps and falls back to the default for junk", () => {
    expect(normalizeMusicVolume(0.5)).toBeCloseTo(0.5);
    expect(normalizeMusicVolume("0.7")).toBeCloseTo(0.7);
    expect(normalizeMusicVolume(2)).toBe(1);
    expect(normalizeMusicVolume(-3)).toBe(0);
    expect(normalizeMusicVolume(0.52)).toBeCloseTo(0.5);
    for (const junk of [null, undefined, "", "abc", NaN, Infinity, {}]) {
      expect(normalizeMusicVolume(junk)).toBe(MUSIC_VOLUME.default);
    }
  });

  it("shows the volume as a percentage", () => {
    expect(formatMusicVolume(1)).toBe("100%");
    expect(formatMusicVolume(0)).toBe("0%");
    expect(formatMusicVolume(0.35)).toBe("35%");
  });

  it("is unavailable until a scene with music says so, and setVolume clamps", () => {
    const s = useMusicStore.getState();
    expect(s.available).toBe(false);
    s.setAvailable(true, false);
    expect(useMusicStore.getState().available).toBe(true);
    expect(useMusicStore.getState().on).toBe(false);
    useMusicStore.getState().setVolume(9);
    expect(useMusicStore.getState().volume).toBe(1);
    useMusicStore.getState().setVolume(0.2);
    expect(useMusicStore.getState().volume).toBeCloseTo(0.2);
    useMusicStore.getState().setAvailable(false);
    expect(useMusicStore.getState().available).toBe(false);
  });
});
