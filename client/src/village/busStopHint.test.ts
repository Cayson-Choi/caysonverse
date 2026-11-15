import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { busStopHintAt } from "./busStopHint";

const every = TRANSIT.departureEveryMs;
const base = 1_800_000_000_000 - (1_800_000_000_000 % every); // a departure

describe("busStopHintAt — the stop's timetable line (review 2026-11-15)", () => {
  const s = VILLAGE_LAYOUT.busStop.shelter.centre;
  it("at the stop, between buses: when the next one leaves and that boarding opens 30 s before", () => {
    const h = busStopHintAt(s.x, s.z, base + every - 200_000, false)!;
    expect(h.tone).toBe("wait");
    expect(h.text).toBe("다음 버스 4분 뒤 출발 · 30초 전부터 탈 수 있어요");
  });
  it("in the boarding half minute: board now", () => {
    const h = busStopHintAt(s.x, s.z, base + every - 12_000, false)!;
    expect(h.tone).toBe("board");
    expect(h.text).toContain("지금 탈 수 있어요 · 12초 뒤 출발");
  });
  it("nothing away from the stop or while riding", () => {
    expect(busStopHintAt(0, 0, base + 1000, false)).toBeNull();
    expect(busStopHintAt(s.x, s.z, base + every - 12_000, true)).toBeNull();
  });
});
