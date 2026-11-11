import { describe, expect, it } from "vitest";
import { autoDoorPassable, CLOSED_AUTO_DOOR, stepAutoDoor, type AutoDoorConfig, type AutoDoorState } from "./autoDoor";

const C: AutoDoorConfig = { approachRadiusM: 2.5, openingMs: 100, closingMs: 200, closeDelayMs: 300 };
const near = { playerDistancesM: [2], doorwayOccupied: false };
const clear = { playerDistancesM: [5], doorwayOccupied: false };

function run(initial: AutoDoorState, events: Array<[number, typeof near]>): AutoDoorState {
  return events.reduce((s, [t, o]) => stepAutoDoor(s, t, o, C), initial);
}

describe("auto door state machine", () => {
  it("opens on approach, becomes passable after opening, then closes after a clear delay", () => {
    let s = stepAutoDoor(CLOSED_AUTO_DOOR, 10, near, C);
    expect(s.phase).toBe("opening");
    expect(autoDoorPassable(s)).toBe(true);
    s = stepAutoDoor(s, 109, near, C);
    expect(s.phase).toBe("opening");
    s = stepAutoDoor(s, 110, clear, C);
    expect(s.phase).toBe("open");
    s = stepAutoDoor(s, 409, clear, C);
    expect(s.phase).toBe("open");
    s = stepAutoDoor(s, 410, clear, C);
    expect(s.phase).toBe("closing");
    s = stepAutoDoor(s, 609, clear, C);
    expect(s.phase).toBe("closing");
    s = stepAutoDoor(s, 610, clear, C);
    expect(s.phase).toBe("closed");
    expect(autoDoorPassable(s)).toBe(false);
  });

  it("does not start its close delay while a player remains near", () => {
    let s = run(CLOSED_AUTO_DOOR, [[0, near], [100, near], [400, near], [1_000, clear]]);
    expect(s.phase).toBe("open");
    expect(s.clearSinceMs).toBe(1_000);
  });

  it("reopens during closing when a player approaches or occupies the threshold", () => {
    let s = run(CLOSED_AUTO_DOOR, [[0, near], [100, near], [500, clear], [900, clear]]);
    expect(s.phase).toBe("closing");
    s = stepAutoDoor(s, 650, { playerDistancesM: [9], doorwayOccupied: true }, C);
    expect(s.phase).toBe("opening");
  });

  it("clamps a backwards clock and rejects invalid times without mutating the state", () => {
    const s = stepAutoDoor({ phase: "open", phaseSinceMs: 100, clearSinceMs: null }, 50, clear, C);
    expect(s).toEqual({ phase: "open", phaseSinceMs: 100, clearSinceMs: 100 });
    expect(stepAutoDoor(s, Number.NaN, near, C)).toEqual(s);
  });
});

