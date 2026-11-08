import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlocked, type AABB } from "../collision";
import { validateAppearance } from "../appearance";
import { PLAYER_RADIUS } from "../worldMap";
import { MEMORIAL_COLLIDERS } from "./generated/memorialColliders";
import { VILLAGE_COLLIDERS } from "./generated/villageColliders";
import {
  GUIDES,
  GUIDE_COLLIDER_HALF,
  GUIDE_REACH_M,
  guideById,
  guideColliders,
  guideVoiceUrl,
  nearestGuide,
} from "./guides";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";

// Run from shared/ (like characterManifest.test.ts).
const VOICE_DIR = resolve(process.cwd(), "../client/public/village/voice");
const L = VILLAGE_LAYOUT;
const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

describe("guides (Task 9A)", () => {
  it("has the two guides with unique ids, 3-4 questions each, unique voice ids", () => {
    expect(GUIDES.map((g) => g.id)).toEqual(["plaza_guide", "hall_desk"]);
    const voices = GUIDES.flatMap((g) => g.qas.map((q) => q.voice));
    expect(new Set(voices).size).toBe(voices.length);
    for (const g of GUIDES) {
      expect(g.qas.length).toBeGreaterThanOrEqual(3);
      expect(g.qas.length).toBeLessThanOrEqual(4);
      expect(g.tag).toBe("안내원");
      expect(validateAppearance(g.appearance)).toEqual(g.appearance);
      expect(guideById(g.id)).toBe(g);
    }
    expect(guideById("nobody")).toBeNull();
  });

  it("answers are short, gentle '~요' Korean with no '!'", () => {
    for (const g of GUIDES)
      for (const q of g.qas) {
        expect(q.answer).not.toContain("!");
        expect(q.question).not.toContain("!");
        const sentences = q.answer.split(/(?<=[.?])\s+/).filter(Boolean);
        expect(sentences.length).toBeGreaterThanOrEqual(1);
        expect(sentences.length).toBeLessThanOrEqual(3);
        expect(q.answer).toMatch(/요\.$/);
        expect(q.answer).not.toMatch(/\d+\s*원|만 원/); // no prices
      }
  });

  it("every answer's voice clip exists in client/public/village/voice as a small .m4a", () => {
    for (const g of GUIDES)
      for (const q of g.qas) {
        expect(guideVoiceUrl(q.voice)).toBe(`/village/voice/${q.voice}.m4a`);
        const file = resolve(VOICE_DIR, `${q.voice}.m4a`);
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size).toBeLessThanOrEqual(60 * 1024);
        expect(statSync(file).size).toBeGreaterThan(4 * 1024);
      }
  });

  it("plaza_guide stands at (5, 12) facing the spawn, clear of the spawn jitter and the plaza's colliders", () => {
    const g = guideById("plaza_guide")!;
    expect(g.pos).toEqual({ x: 5, z: 12 });
    expect(g.area).toBe("village");
    const { spawn } = L;
    const toSpawn = Math.atan2(spawn.x - g.pos.x, spawn.z - g.pos.z);
    expect(g.yaw).toBeCloseTo(toSpawn, 9);
    // a spawn anywhere in the jitter disc is still a free spot beside the guide's collider
    expect(Math.hypot(g.pos.x - spawn.x, g.pos.z - spawn.z)).toBeGreaterThan(spawn.jitter + GUIDE_COLLIDER_HALF * Math.SQRT2 + PLAYER_RADIUS);
    const box = guideColliders([g])[0]!;
    for (const c of VILLAGE_COLLIDERS) expect(overlaps(box, c), JSON.stringify(c)).toBe(false);
  });

  it("hall_desk stands at (302.8, 3.0) facing -x, clear of the hall's col__ boxes, the door pad and the inside spawn", () => {
    const g = guideById("hall_desk")!;
    expect(g.pos).toEqual({ x: 302.8, z: 3.0 });
    expect(g.area).toBe("hall");
    expect(g.yaw).toBeCloseTo(-Math.PI / 2, 9);
    const box = guideColliders([g])[0]!;
    for (const c of MEMORIAL_COLLIDERS) expect(overlaps(box, c), JSON.stringify(c)).toBe(false);
    const room = L.memorial.interior.room;
    expect(box.minX).toBeGreaterThan(room.minX);
    expect(box.maxX).toBeLessThan(room.maxX);
    expect(box.minZ).toBeGreaterThan(room.minZ);
    expect(box.maxZ).toBeLessThan(room.maxZ);
    const pad = L.memorial.interior.doorPad;
    const spawn = L.memorial.interior.spawn;
    const corner = GUIDE_COLLIDER_HALF * Math.SQRT2;
    expect(Math.hypot(g.pos.x - pad.centre.x, g.pos.z - pad.centre.z)).toBeGreaterThan(pad.radius + corner + PLAYER_RADIUS);
    expect(Math.hypot(g.pos.x - spawn.x, g.pos.z - spawn.z)).toBeGreaterThan(corner + PLAYER_RADIUS);
    // the spawn and the door pad stay walkable
    expect(isBlocked(spawn.x, spawn.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
    expect(isBlocked(pad.centre.x, pad.centre.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
    // "문의하기" is not offered right at the arrival point
    expect(Math.hypot(g.pos.x - spawn.x, g.pos.z - spawn.z)).toBeGreaterThan(GUIDE_REACH_M);
  });

  it("each guide has a collider in the walk geometry, so players do not walk through them", () => {
    for (const box of guideColliders()) expect(villageGeometry.obstacles).toContainEqual(box);
    for (const g of GUIDES) expect(isBlocked(g.pos.x, g.pos.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true);
  });

  it("nearestGuide offers a guide of the player's area within the reach only", () => {
    expect(nearestGuide("village", 5, 12 + 1.5)?.guide.id).toBe("plaza_guide");
    expect(nearestGuide("village", 5, 12 + GUIDE_REACH_M + 0.01)).toBeNull();
    expect(nearestGuide("hall", 5, 13)).toBeNull();
    expect(nearestGuide("hall", 301.5, 3.0)?.guide.id).toBe("hall_desk");
    expect(nearestGuide("village", 301.5, 3.0)).toBeNull();
    expect(nearestGuide("village", Number.NaN, 0)).toBeNull();
  });
});
