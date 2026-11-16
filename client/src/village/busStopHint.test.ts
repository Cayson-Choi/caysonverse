import { describe, expect, it } from "vitest";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { busStopHintAt, createHintGate } from "./busStopHint";

const every = TRANSIT.departureEveryMs;
const base = 1_800_000_000_000 - (1_800_000_000_000 % every); // a departure

describe("busStopHintAt — the stop's timetable line (review 2026-11-15)", () => {
  const s = VILLAGE_LAYOUT.busStop.shelter.centre;
  it("at the stop, between buses: when the next one leaves and how soon boarding opens (3 min before, owner 2026-11-15)", () => {
    expect(TRANSIT.boardingMs).toBe(3 * 60 * 1000);
    const h = busStopHintAt(s.x, s.z, base + every - 400_000, false)!;
    expect(h.tone).toBe("wait");
    expect(h.text).toBe("다음 버스 7분 뒤 출발 · 출발 3분 전부터 탈 수 있어요");
    // one countdown (review 2026-11-15: "4분 뒤 출발 · 20초 뒤부터" disagreed with itself)
    expect(busStopHintAt(s.x, s.z, base + every - 200_000, false)!.text).toBe("다음 버스 4분 뒤 출발 · 출발 3분 전부터 탈 수 있어요");
  });
  it("while the bus is out on its lap the chip says it is running and when the next one leaves, with no key (2026-11-15 check)", () => {
    // 20 s after a departure the bus is on the road (inTransit)
    const h = busStopHintAt(s.x, s.z, base + 20_000, false)!;
    expect(h).not.toBeNull();
    expect(h.tone).toBe("wait");
    expect(h.text).toMatch(/^버스 운행 중 · .+ 뒤 출발/);
    expect(h.text).not.toMatch(/E/);
  });
  it("40 s after a departure the next one is about 9 minutes away, not rounded up to a whole cycle (review r1: it said 10분)", () => {
    const h = busStopHintAt(s.x, s.z, base + 40_000, false)!;
    expect(h.text).toMatch(/^버스 운행 중 · 약 9분 뒤 출발/);
  });
  it("in the 3 boarding minutes: board now, by the bus", () => {
    const h = busStopHintAt(s.x, s.z, base + every - 12_000, false)!;
    expect(h.tone).toBe("board");
    expect(h.text).toBe("지금 탈 수 있어요 · 12초 뒤 출발 (버스 앞에서 E)");
    const open = busStopHintAt(s.x, s.z, base + every - TRANSIT.boardingMs, false)!;
    expect(open.tone).toBe("board");
    expect(open.text).toContain("지금 탈 수 있어요 · 3분 뒤 출발");
    // inside the window minutes and seconds: never a rounded-up "3분" that reads as if boarding just opened
    expect(busStopHintAt(s.x, s.z, base + every - 121_000, false)!.text).toBe("지금 탈 수 있어요 · 2분 1초 뒤 출발 (버스 앞에서 E)");
    expect(busStopHintAt(s.x, s.z, base + every - TRANSIT.boardingMs - 1, false)!.tone).toBe("wait");
  });
  it("a phone has no E key: its line names the 🚌 button only (review 2026-11-15)", () => {
    const phone = busStopHintAt(s.x, s.z, base + every - 12_000, false, undefined, true)!;
    expect(phone.text).toBe("지금 탈 수 있어요 · 12초 뒤 출발 (버스 앞에서 🚌 버튼)");
    expect(phone.text).not.toMatch(/E/);
    expect(busStopHintAt(s.x, s.z, base + every - 400_000, false, undefined, true)!.text).not.toMatch(/E/);
  });
  it("the pill clears its line once you board (review 2026-11-15: the gate's first null was swallowed)", () => {
    const changed = createHintGate();
    const board = busStopHintAt(s.x, s.z, base + every - 12_000, false)!;
    expect(changed(board)).toBe(true);
    expect(changed(board)).toBe(false);
    // boarding restarts the pill's sampling with a fresh gate: its first sample, null, is published
    const afterBoarding = createHintGate();
    expect(changed(null)).toBe(true);
    expect(afterBoarding(busStopHintAt(s.x, s.z, base + every - 11_000, true))).toBe(true);
  });
  it("nothing away from the stop or while riding", () => {
    expect(busStopHintAt(0, 0, base + 1000, false)).toBeNull();
    expect(busStopHintAt(s.x, s.z, base + every - 12_000, true)).toBeNull();
  });
});
