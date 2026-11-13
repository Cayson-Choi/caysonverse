import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, solidBox } from "./villageLayout";
import { EMPTY_KEYPAD_RATE, HOUSE_KEYPAD_IDS, keypadEntries, nearestKeypadEntry, recordKeypadAttempt, validateKeypadAttempt, type KeypadPolicy } from "./buildingAccess";

const policy: KeypadPolicy = {
  keypadBuildingIds: new Set(["house_1"]),
  reachM: 2,
  minCodeLength: 4,
  maxCodeLength: 8,
  failureWindowMs: 10_000,
  maxFailures: 3,
  lockoutMs: 30_000,
};
const base = { buildingId: "house_1", playerId: "p1", area: "village", distanceM: 1, code: "1004", nowMs: 0 };

describe("keypad access boundary", () => {
  it("derives one keypad pad for each B-scale house and never includes public buildings", () => {
    const entries = keypadEntries();
    expect(entries).toHaveLength(10);
    expect(entries.map((e) => e.buildingId)).toEqual([...HOUSE_KEYPAD_IDS]);
    expect(entries.every((e) => e.placeholderArea === "hall")).toBe(true);
    const near = nearestKeypadEntry(entries[0]!.pad.x, entries[0]!.pad.z);
    expect(near?.entry.buildingId).toBe(entries[0]!.buildingId);
    expect(near?.distanceM).toBe(0);
  });

  it("accepts only a finite, nearby keypad request and never returns the expected code", () => {
    expect(validateKeypadAttempt(base, policy)).toEqual({ ok: true, buildingId: "house_1" });
    expect(JSON.stringify(validateKeypadAttempt(base, policy))).not.toContain("1004");
  });

  it("rejects wrong building, distance, malformed code and non-finite coordinates before verification", () => {
    expect(validateKeypadAttempt({ ...base, buildingId: "cafe" }, policy)).toEqual({ ok: false, reason: "invalid_request" });
    expect(validateKeypadAttempt({ ...base, distanceM: 2.01 }, policy)).toEqual({ ok: false, reason: "too_far" });
    expect(validateKeypadAttempt({ ...base, code: "1004a" }, policy)).toEqual({ ok: false, reason: "invalid_code" });
    expect(validateKeypadAttempt({ ...base, nowMs: Number.NaN }, policy)).toEqual({ ok: false, reason: "invalid_request" });
  });

  it("locks out after repeated failed verifier results and expires only after the lockout", () => {
    let s = EMPTY_KEYPAD_RATE;
    let r = recordKeypadAttempt(s, 0, false, policy); s = r.state; expect(r.decision).toEqual({ ok: false, reason: "rate_limited" });
    r = recordKeypadAttempt(s, 100, false, policy); s = r.state; expect(r.decision).toEqual({ ok: false, reason: "rate_limited" });
    r = recordKeypadAttempt(s, 200, false, policy); s = r.state; expect(r.decision).toEqual({ ok: false, reason: "locked_out", retryAfterMs: 30_000 });
    expect(recordKeypadAttempt(s, 1_000, true, policy).decision).toEqual({ ok: false, reason: "locked_out", retryAfterMs: 29_200 });
    expect(recordKeypadAttempt(s, 30_200, true, policy, "house_1").decision).toEqual({ ok: true, buildingId: "house_1" });
  });

  it("every keypad pad stands on its house's door axis, on the walkable porch, 0.65 m in front of the model's door (milestone 1 review)", () => {
    // the model's door is on the footprint's centre line, in the body's front wall, 2.25 m in from the footprint edge (the porch depth)
    const PORCH = 2.25;
    for (const e of keypadEntries()) {
      const h = VILLAGE_LAYOUT.sceneryHouses.find((x) => x.id === e.buildingId)!;
      expect(h.terrace, e.buildingId).toBe(PORCH);
      const door = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[h.doorSide];
      const halfDepth = (h.doorSide === "n" || h.doorSide === "s" ? h.size.z : h.size.x) / 2;
      const doorPos = { x: h.centre.x + door[0]! * (halfDepth - PORCH), z: h.centre.z + door[1]! * (halfDepth - PORCH) };
      const along = h.doorSide === "n" || h.doorSide === "s" ? Math.abs(e.pad.x - doorPos.x) : Math.abs(e.pad.z - doorPos.z);
      expect(along, e.buildingId).toBeLessThan(0.01);
      expect(Math.hypot(e.pad.x - doorPos.x, e.pad.z - doorPos.z), e.buildingId).toBeCloseTo(0.65, 2);
      // the pad is outside the solid box (the porch is walkable) and inside the footprint
      const sb = solidBox(h);
      expect(e.pad.x < sb.minX || e.pad.x > sb.maxX || e.pad.z < sb.minZ || e.pad.z > sb.maxZ, e.buildingId).toBe(true);
    }
  });
});
