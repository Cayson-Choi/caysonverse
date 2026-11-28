import { describe, expect, it } from "vitest";
import { LOADER_FADE_MS, REVEAL_FAIL_SAFE_MS, createVillageLoad, currentStep, entryCovering, loadActivity, loadPercent, loadSteps, villageLoad } from "./villageLoad";

function fakeTimers() {
  const due: Array<{ fn: () => void; ms: number }> = [];
  return {
    t: { set: (fn: () => void, ms: number) => (due.push({ fn, ms }), due.length - 1), clear: (h: unknown) => (due[h as number] = { fn: () => {}, ms: 0 }) },
    run: () => due.splice(0).forEach((d) => d.fn()),
    due,
  };
}

describe("the entry's loading screen (villageLoad)", () => {
  it("opens on the press, shows 마을 → 풍경 → 캐릭터 → 접속 in that order, and closes (after a fade) once all four are done", () => {
    const ft = fakeTimers();
    const l = createVillageLoad(ft.t);
    l.begin(0, { charReady: false, modelIn: false, dressed: false });
    expect(l.get().open).toBe(true);
    expect(loadSteps(l.get()).map((s) => s.label)).toEqual(["마을", "풍경", "캐릭터", "접속"]);
    expect(currentStep(l.get())).toBe("connect");
    l.joined();
    l.bytes(1_000_000, 5_000_000);
    expect(currentStep(l.get())).toBe("village");
    expect(loadActivity(l.get())).toContain("1.0 / 4.8 MB");
    l.charReady();
    l.modelIn();
    l.build(0.5);
    expect(loadActivity(l.get())).toBe("나무와 꽃을 심고 있어요…");
    expect(l.get().closing).toBe(false);
    l.dressed();
    // dressed is not the end any more (fix/entry-full-load): the rest of the plaza's files, then the warm-up
    expect(l.get().closing).toBe(false);
    expect(currentStep(l.get())).toBe("scenery");
    expect(loadPercent(l.get())).toBeLessThan(100);
    l.scenery(0.5, 7);
    expect(loadActivity(l.get())).toBe("집과 건물, 호수를 불러오고 있어요… 7개 남음");
    l.sceneryIn();
    expect(loadActivity(l.get())).toBe("광장을 그릴 준비를 하고 있어요…");
    expect(l.get().closing).toBe(false);
    l.warm(0.6);
    l.warmed();
    expect(l.get().closing).toBe(true);
    expect(loadPercent(l.get())).toBe(100);
    expect(ft.due.at(-1)!.ms).toBe(LOADER_FADE_MS);
    ft.due.at(-1)!.fn();
    expect(l.get().open).toBe(false);
  });

  it("lifts by itself if the scenery stage never reports (REVEAL_FAIL_SAFE_MS after the dressing)", () => {
    const ft = fakeTimers();
    const l = createVillageLoad(ft.t);
    l.begin(0, { charReady: true, modelIn: true, dressed: false });
    l.joined();
    l.dressed();
    const safe = ft.due.find((d) => d.ms === REVEAL_FAIL_SAFE_MS);
    expect(safe).toBeTruthy();
    safe!.fn();
    expect(l.get().closing).toBe(true);
  });

  it("entryCovering: true while the screen is up and not yet lifting", () => {
    expect(entryCovering()).toBe(false);
    villageLoad.begin(0, { charReady: true, modelIn: true, dressed: false });
    expect(entryCovering()).toBe(true);
    villageLoad.fail();
    expect(entryCovering()).toBe(false);
  });

  it("its percentage only goes up and stays under 100 until everything is in", () => {
    const l = createVillageLoad(fakeTimers().t);
    l.begin(0, { charReady: true, modelIn: false, dressed: false });
    const seen: number[] = [loadPercent(l.get())];
    l.joined();
    seen.push(loadPercent(l.get()));
    for (let b = 0; b <= 5; b++) {
      l.bytes(b * 1_000_000, 5_000_000);
      seen.push(loadPercent(l.get()));
    }
    l.modelIn();
    seen.push(loadPercent(l.get()));
    for (const f of [0.1, 0.05, 0.6, 0.95]) {
      l.build(f); // a lower report never takes it back
      seen.push(loadPercent(l.get()));
    }
    l.dressed();
    seen.push(loadPercent(l.get()));
    for (const f of [0.2, 0.1, 0.7]) {
      l.scenery(f, 3); // a lower share (a new file started) never takes it back
      seen.push(loadPercent(l.get()));
    }
    l.sceneryIn();
    seen.push(loadPercent(l.get()));
    for (const f of [0.3, 0.2, 0.9]) {
      l.warm(f);
      seen.push(loadPercent(l.get()));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(Math.max(...seen)).toBeLessThan(100);
  });

  it("a failed join closes it at once; reports while it is closed change nothing", () => {
    const l = createVillageLoad(fakeTimers().t);
    l.begin(0, { charReady: true, modelIn: true, dressed: false });
    l.fail();
    expect(l.get().open).toBe(false);
    l.joined();
    l.dressed();
    expect(l.get().open).toBe(false);
    expect(l.get().joined).toBe(false);
  });

  it("files already in (preloaded on the entry screen) count as done from the start", () => {
    const l = createVillageLoad(fakeTimers().t);
    l.begin(0, { charReady: true, modelIn: true, dressed: false });
    l.joined();
    expect(loadPercent(l.get())).toBeGreaterThanOrEqual(50);
  });
});
