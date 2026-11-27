import { describe, it, expect, beforeEach } from "vitest";
import { RUN_SPEED } from "@caysonverse/shared/constants";
import { REFUSAL_HEAL_MS, SNAP_DISTANCE } from "./constants";
import {
  clearSentMoves,
  createEchoWatch,
  healDeadline,
  noteEcho,
  noteRefusal,
  onServerRefusal,
  recordSentMove,
  requestPoseResend,
  resolveRefusal,
  selfDiverged,
  sentPoseAt,
  serverRefused,
  takePoseResend,
} from "./sentMoves";

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

describe("the server's refusal notice and its resolution (fix/net-sync)", () => {
  it("a refusal that changes no synced field (the echo was 0 already) still starts a heal window, then is judged", () => {
    const w = createEchoWatch();
    noteRefusal(w, 0, 1000); // the first Move after the join was refused: no patch at all, only the notice
    expect(noteEcho(w, 0, 1000)).toBe("healing");
    expect(healDeadline(w)).toBe(1000 + REFUSAL_HEAL_MS);
    expect(noteEcho(w, 0, 1000 + REFUSAL_HEAL_MS)).toBe("refused");
    // 60 m apart (the report: the server at the spawn, the client at the park gate): put back where the server has me
    expect(resolveRefusal(w, { x: -24, z: 88 }, { x: -0.58, z: 11.9 }, 1700)).toBe("snap");
    expect(Number.isNaN(w.refusedAt)).toBe(true);
  });

  it("a stale echo (the stamp current when the refusal began) is no healing; a newer one is", () => {
    const w = createEchoWatch();
    expect(noteEcho(w, 4000, 0)).toBe("ok");
    noteRefusal(w, 4000, 100);
    expect(noteEcho(w, 4000, 200)).toBe("healing"); // the patch that still says 4000 says nothing new
    expect(noteEcho(w, 4100, 300)).toBe("ok"); // the server took a later Move
    expect(Number.isNaN(w.refusedAt)).toBe(true);
  });

  it("a small gap is healed by sending my pose once more; if that is refused too, I am put back", () => {
    const w = createEchoWatch();
    noteRefusal(w, 0, 0);
    expect(resolveRefusal(w, { x: 1.0, z: 0 }, { x: 0, z: 0 }, 700)).toBe("resend");
    expect(w.refusedAt).toBe(700); // a fresh window for the resent pose
    expect(noteEcho(w, 0, 900)).toBe("healing");
    expect(resolveRefusal(w, { x: 1.0, z: 0 }, { x: 0, z: 0 }, 1400)).toBe("snap");
  });

  it("no real gap: nothing to do, the refusal is over", () => {
    const w = createEchoWatch();
    noteRefusal(w, 0, 0);
    expect(resolveRefusal(w, { x: 0.1, z: 0.1 }, { x: 0, z: 0 }, 700)).toBe("none");
    expect(Number.isNaN(w.refusedAt)).toBe(true);
  });

  it("the notice reaches the self-correction's listener; a resend request is taken once", () => {
    let heard = 0;
    const off = onServerRefusal(() => heard++);
    serverRefused();
    expect(heard).toBe(1);
    off();
    serverRefused();
    expect(heard).toBe(1);
    expect(takePoseResend()).toBe(false);
    requestPoseResend();
    expect(takePoseResend()).toBe(true);
    expect(takePoseResend()).toBe(false);
  });
});
