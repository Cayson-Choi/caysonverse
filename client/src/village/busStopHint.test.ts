import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { busStopHintAt } from "./busStopHint";

const every = TRANSIT.departureEveryMs;
const base = 1_800_000_000_000 - (1_800_000_000_000 % every); // a departure

describe("busStopHintAt — the stop's timetable line (review 2026-11-15)", () => {
  const s = VILLAGE_LAYOUT.busStop.shelter.centre;
  it("at the stop, between buses: when the next one leaves and how soon boarding opens (3 min before, owner 2026-11-15)", () => {
    expect(TRANSIT.boardingMs).toBe(3 * 60 * 1000);
    const h = busStopHintAt(s.x, s.z, base + every - 400_000, false)!;
    expect(h.tone).toBe("wait");
    expect(h.text).toBe("다음 버스 7분 뒤 출발 · 4분 뒤부터 탈 수 있어요");
    expect(busStopHintAt(s.x, s.z, base + every - 200_000, false)!.text).toBe("다음 버스 4분 뒤 출발 · 20초 뒤부터 탈 수 있어요");
  });
  it("in the 3 boarding minutes: board now, by the bus", () => {
    const h = busStopHintAt(s.x, s.z, base + every - 12_000, false)!;
    expect(h.tone).toBe("board");
    expect(h.text).toBe("지금 탈 수 있어요 · 12초 뒤 출발 (버스 앞에서 E / 🚌)");
    const open = busStopHintAt(s.x, s.z, base + every - TRANSIT.boardingMs, false)!;
    expect(open.tone).toBe("board");
    expect(open.text).toContain("지금 탈 수 있어요 · 3분 뒤 출발");
    expect(busStopHintAt(s.x, s.z, base + every - TRANSIT.boardingMs - 1, false)!.tone).toBe("wait");
  });
  it("nothing away from the stop or while riding", () => {
    expect(busStopHintAt(0, 0, base + 1000, false)).toBeNull();
    expect(busStopHintAt(s.x, s.z, base + every - 12_000, true)).toBeNull();
  });
});
