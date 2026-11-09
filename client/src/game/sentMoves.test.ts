import { describe, it, expect, beforeEach } from "vitest";
import { RUN_SPEED } from "@caysonverse/shared/constants";
import { SNAP_DISTANCE } from "./constants";
import { clearSentMoves, recordSentMove, selfDiverged, sentPoseAt } from "./sentMoves";

describe("sent-move history", () => {
  beforeEach(() => clearSentMoves());

  it("finds a sent pose by its stamp, and keeps only stamped moves", () => {
    recordSentMove({ x: 1, z: 2, yaw: 0, t: 500 });
    recordSentMove({ x: 9, z: 9, yaw: 0 }); // no stamp: the server will echo 0 for it
    recordSentMove({ x: 1.4, z: 2, yaw: 0, t: 600 });
    expect(sentPoseAt(500)).toMatchObject({ x: 1, z: 2 });
    expect(sentPoseAt(600)).toMatchObject({ x: 1.4, z: 2 });
    expect(sentPoseAt(550)).toBeUndefined();
  });

  it("forgets the oldest beyond ~6 s of moves", () => {
    for (let k = 1; k <= 100; k++) recordSentMove({ x: k, z: 0, yaw: 0, t: k * 100 });
    expect(sentPoseAt(100)).toBeUndefined();
    expect(sentPoseAt(10000)).toMatchObject({ x: 100 });
  });
});

describe("selfDiverged — the self-correction no longer mistakes a late echo for a correction", () => {
  beforeEach(() => clearSentMoves());

  it("a runner's echo 0.9 s late (a phone's hiccup) is where the runner was then: no snap (the old check: 5.8 m → snap)", () => {
    // Running north at RUN_SPEED, a move every 100 ms.
    for (let k = 0; k <= 20; k++) recordSentMove({ x: 0, z: -RUN_SPEED * 0.1 * k, yaw: 0, t: 1000 + 100 * k });
    const now = { x: 0, z: -RUN_SPEED * 2.0 }; // where I am at t = 3000
    const echo = { x: 0, z: -RUN_SPEED * 1.1 }; // the server accepted my t = 2100 move; its patch reaches me now
    expect(Math.abs(now.z - echo.z)).toBeGreaterThan(SNAP_DISTANCE); // what the old check compared
    expect(selfDiverged(now, echo, 2100)).toBe(false);
  });

  it("a pose the server placed (a door) keeps the old stamp and is far from it: snap", () => {
    recordSentMove({ x: 0, z: -50, yaw: 0, t: 4000 });
    expect(selfDiverged({ x: 0, z: -50.2 }, { x: 300, z: 3.6 }, 4000)).toBe(true);
  });

  it("no usable stamp (an older server, nothing sent yet, a stamp I no longer hold): the plain 3 m check from where I stand", () => {
    recordSentMove({ x: 0, z: 0, yaw: 0, t: 4000 });
    expect(selfDiverged({ x: 0, z: -5 }, { x: 0, z: 0 }, 0)).toBe(true);
    expect(selfDiverged({ x: 0, z: -2 }, { x: 0, z: 0 }, 0)).toBe(false);
    expect(selfDiverged({ x: 0, z: -5 }, { x: 0, z: 0 }, 123)).toBe(true);
  });

  it("a refused Move (the server echoed my stamps, now 0): resync once I am past what it can still catch up with", () => {
    // After a long freeze the server took what its budget allowed and refused the rest; I ran on.
    expect(selfDiverged({ x: 0, z: -2.25 }, { x: 0, z: 0 }, 0, true)).toBe(true); // it would never catch up
    expect(selfDiverged({ x: 0, z: -2.25 }, { x: 0, z: 0 }, 0, false)).toBe(false); // (the old 3 m rule: stuck)
    expect(selfDiverged({ x: 0, z: -0.8 }, { x: 0, z: 0 }, 0, true)).toBe(false); // close: it catches up by itself
  });

  it("a small server clamp (the map edge) is no snap either way", () => {
    recordSentMove({ x: 29.9, z: 0, yaw: 0, t: 7000 });
    expect(selfDiverged({ x: 31, z: 0 }, { x: 29.7, z: 0 }, 7000)).toBe(false);
  });
});
