import { describe, expect, it } from "vitest";
import { HOUSE_KEYPAD_POLICY, checkHouseKeypad, initialKeypadRate } from "./villageKeypad";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";

describe("server house keypad", () => {
  const pad = keypadEntries()[0]!;
  const base = { buildingId: pad.buildingId, playerId: "p1", area: "village", x: pad.pad.x, z: pad.pad.z, nowMs: 0 };

  it("accepts the configured house code only at an authoritative house pad and never exposes the expected code", () => {
    const result = checkHouseKeypad({ ...base, code: "1004", rate: initialKeypadRate() });
    expect(result.decision).toEqual({ ok: true, buildingId: pad.buildingId });
    expect(result.entry.placeholderArea).toBe("hall");
    expect(JSON.stringify(HOUSE_KEYPAD_POLICY)).not.toContain("1004");
    expect(JSON.stringify(result.decision)).not.toContain("1004");
  });

  it("rejects a wrong code, locks after repeated failures, and rejects a claimed house at another position", () => {
    let rate = initialKeypadRate();
    for (let i = 0; i < 5; i += 1) rate = checkHouseKeypad({ ...base, code: "0000", nowMs: i * 100, rate }).state;
    const locked = checkHouseKeypad({ ...base, code: "1004", nowMs: 500, rate });
    expect(locked.decision).toMatchObject({ ok: false, reason: "locked_out" });
    const elsewhere = checkHouseKeypad({ ...base, x: pad.pad.x + 20, code: "1004", nowMs: 40_000, rate: initialKeypadRate() });
    expect(elsewhere.decision).toEqual({ ok: false, reason: "too_far" });
  });
});
