import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../game/settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: vi.fn((k: string) => (k in data ? data[k] : null)),
    setItem: vi.fn((k: string, v: string) => {
      data[k] = v;
    }),
  };
}

/** A fresh copy of both stores, built against whatever `localStorage` is stubbed right now (a page load). */
async function pageLoad() {
  vi.resetModules();
  const { useCoachStore } = await import("./coachStore");
  const { useSettingsStore } = await import("./settingsStore");
  return { coach: useCoachStore, settings: useSettingsStore };
}

const saved = (storage: ReturnType<typeof memoryStorage>) =>
  JSON.parse(storage.data["cv-settings-v1"] ?? "null") as { coachDone?: boolean } | null;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("coachStore — first visit", () => {
  it("starts at ① when the guide has not been seen", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { coach } = await pageLoad();
    expect(coach.getState().step).toBe("move");
  });

  it("starts finished (no cards) when coachDone was saved — the reload case", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "cv-settings-v1": JSON.stringify({ ...DEFAULT_SETTINGS, coachDone: true }) }));
    const { coach } = await pageLoad();
    expect(coach.getState().step).toBe("done");
  });

  it("walks ① → ② → ③ → done on the matching actions and saves coachDone at the end only", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { coach, settings } = await pageLoad();
    coach.getState().report("moved");
    expect(coach.getState().step).toBe("look");
    coach.getState().report("looked");
    expect(coach.getState().step).toBe("talk");
    expect(settings.getState().settings.coachDone).toBe(false);
    expect(saved(storage)).toBeNull(); // nothing written before the guide is over
    coach.getState().report("talked");
    expect(coach.getState().step).toBe("done");
    expect(settings.getState().settings.coachDone).toBe(true);
    expect(saved(storage)?.coachDone).toBe(true);
  });

  it("talking during ① does not skip ahead, nor does looking, nor does a finished step repeat", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { coach, settings } = await pageLoad();
    coach.getState().report("talked");
    coach.getState().report("looked");
    expect(coach.getState().step).toBe("move");
    coach.getState().report("moved");
    coach.getState().report("moved"); // ② is waiting for a look, not for another walk
    expect(coach.getState().step).toBe("look");
    coach.getState().report("talked");
    expect(coach.getState().step).toBe("look");
    expect(settings.getState().settings.coachDone).toBe(false);
  });
});

describe("coachStore — skip and restart", () => {
  it("skip ends the guide from any step and saves coachDone", async () => {
    for (const upTo of [0, 1, 2]) {
      const storage = memoryStorage();
      vi.stubGlobal("localStorage", storage);
      const { coach, settings } = await pageLoad();
      const path = ["moved", "looked"] as const;
      for (let i = 0; i < upTo; i++) coach.getState().report(path[i]);
      expect(coach.getState().step).toBe(["move", "look", "talk"][upTo]);
      coach.getState().report("skip");
      expect(coach.getState().step).toBe("done");
      expect(settings.getState().settings.coachDone).toBe(true);
      expect(saved(storage)?.coachDone).toBe(true);
    }
  });

  it("after skipping, nothing brings the cards back until a restart (a reload shows none)", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const first = await pageLoad();
    first.coach.getState().report("skip");
    first.coach.getState().report("moved");
    first.coach.getState().report("talked");
    expect(first.coach.getState().step).toBe("done");
    const second = await pageLoad(); // a reload against the same storage
    expect(second.coach.getState().step).toBe("done");
  });

  it("restart from the menu shows ① again and leaves coachDone as it was", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { coach, settings } = await pageLoad();
    coach.getState().report("skip");
    expect(settings.getState().settings.coachDone).toBe(true);
    coach.getState().report("restart");
    expect(coach.getState().step).toBe("move");
    expect(settings.getState().settings.coachDone).toBe(true); // a reload mid-replay stays quiet
    // …and the replay runs through to the end again.
    coach.getState().report("moved");
    coach.getState().report("looked");
    coach.getState().report("talked");
    expect(coach.getState().step).toBe("done");
  });

  it("restart counts a new round even when ① is already up, so the measuring starts over", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { coach } = await pageLoad();
    const r0 = coach.getState().round;
    coach.getState().report("restart");
    expect(coach.getState().step).toBe("move");
    expect(coach.getState().round).toBe(r0 + 1);
    coach.getState().report("moved");
    coach.getState().report("restart");
    expect(coach.getState().step).toBe("move");
    expect(coach.getState().round).toBe(r0 + 2);
  });

  it("works with blocked storage (private mode): the guide still ends for this visit", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { coach, settings } = await pageLoad();
    expect(coach.getState().step).toBe("move");
    coach.getState().report("skip");
    expect(coach.getState().step).toBe("done");
    expect(settings.getState().settings.coachDone).toBe(true);
  });
});
