import { describe, it, expect, beforeEach } from "vitest";
import { ENTER_MIN_MS, holdRemainingMs, useEnterTransition } from "./enterTransition";

beforeEach(() => {
  useEnterTransition.getState().end();
});

describe("holdRemainingMs", () => {
  it("keeps the card up until ENTER_MIN_MS after it began, and not a moment longer", () => {
    expect(ENTER_MIN_MS).toBe(600);
    expect(holdRemainingMs(1000, 1000)).toBe(600);
    expect(holdRemainingMs(1000, 1200)).toBe(400);
    expect(holdRemainingMs(1000, 1600)).toBe(0);
    expect(holdRemainingMs(1000, 5000)).toBe(0);
  });

  it("a clock that went backwards still holds at most ENTER_MIN_MS", () => {
    expect(holdRemainingMs(1000, 500)).toBe(600);
  });
});

describe("useEnterTransition", () => {
  it("starts idle", () => {
    const s = useEnterTransition.getState();
    expect(s.phase).toBe("idle");
    expect(s.label).toBe("");
  });

  it("begin → ready → end walks joining, ready, idle", () => {
    const t = useEnterTransition.getState();
    t.begin("상담실로 들어가는 중…", 100);
    expect(useEnterTransition.getState()).toMatchObject({ phase: "joining", label: "상담실로 들어가는 중…", startedAt: 100 });
    useEnterTransition.getState().ready();
    expect(useEnterTransition.getState().phase).toBe("ready");
    useEnterTransition.getState().end();
    expect(useEnterTransition.getState().phase).toBe("idle");
  });

  it("a second ticket while one is running keeps the first start time (the card does not restart)", () => {
    useEnterTransition.getState().begin("상담실로 들어가는 중…", 100);
    useEnterTransition.getState().begin("교실로 들어가는 중…", 900);
    expect(useEnterTransition.getState()).toMatchObject({ phase: "joining", startedAt: 100 });
  });

  it("ready does nothing unless a join is running (a late ticket cannot raise a card from idle)", () => {
    useEnterTransition.getState().ready();
    expect(useEnterTransition.getState().phase).toBe("idle");
  });

  it("a card that already went ready starts over for a new ticket", () => {
    useEnterTransition.getState().begin("상담실로 들어가는 중…", 100);
    useEnterTransition.getState().ready();
    useEnterTransition.getState().begin("상담실로 들어가는 중…", 2000);
    expect(useEnterTransition.getState()).toMatchObject({ phase: "joining", startedAt: 2000 });
  });
});
