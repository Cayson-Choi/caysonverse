import { describe, it, expect } from "vitest";
import { createMoveSender } from "./moveSender";
import type { MovePayload } from "@caysonverse/shared/messages";

/** Collect every payload the sender emits, in order. */
function makeSpy() {
  const sent: MovePayload[] = [];
  return { send: (p: MovePayload) => sent.push({ ...p }), sent };
}

const pose = (x: number, z: number, yaw = 0): MovePayload => ({ x, z, yaw });

describe("createMoveSender", () => {
  it("sends nothing while idle", () => {
    const { send, sent } = makeSpy();
    const s = createMoveSender(send, 100);
    s.update(0, false, pose(0, 0));
    s.update(50, false, pose(0, 0));
    s.update(1000, false, pose(0, 0));
    expect(sent).toHaveLength(0);
  });

  it("sends at most one message per interval while moving", () => {
    const { send, sent } = makeSpy();
    const s = createMoveSender(send, 100);
    // Frames every ~16ms for 250ms of continuous movement.
    for (let t = 0; t <= 250; t += 16) {
      s.update(t, true, pose(t * 0.001, 0));
    }
    // First frame sends immediately, then one per 100ms window: t=0, ~112, ~224.
    expect(sent.length).toBe(3);
    // No two sends closer than the interval — reconstruct emission times.
    // (First at t=0.) Assert monotonic spacing >= 100 by re-simulating timestamps.
    const { send: send2, sent: sent2 } = makeSpy();
    const times: number[] = [];
    const s2 = createMoveSender((p) => {
      send2(p);
      return p;
    }, 100);
    for (let t = 0; t <= 250; t += 16) {
      const before = sent2.length;
      s2.update(t, true, pose(0, 0));
      if (sent2.length > before) times.push(t);
    }
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(100);
    }
  });

  it("sends exactly one final message on stop, carrying the resting pose", () => {
    const { send, sent } = makeSpy();
    const s = createMoveSender(send, 100);
    s.update(0, true, pose(1, 1)); // initial move -> send #1
    s.update(50, true, pose(2, 1)); // throttled, no send
    s.update(60, false, pose(2, 1)); // stop -> exactly one final send
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(pose(2, 1)); // final send is the resting pose
    // Subsequent idle frames send nothing.
    s.update(500, false, pose(2, 1));
    s.update(9999, false, pose(2, 1));
    expect(sent).toHaveLength(2);
  });

  it("resumes sending after a stop", () => {
    const { send, sent } = makeSpy();
    const s = createMoveSender(send, 100);
    s.update(0, true, pose(0, 0)); // send #1
    s.update(30, false, pose(1, 0)); // final send #2
    expect(sent).toHaveLength(2);
    // Resume well after the interval -> immediate send.
    s.update(1000, true, pose(1, 0)); // send #3
    expect(sent).toHaveLength(3);
    expect(sent[2]).toEqual(pose(1, 0));
  });

  it("does not send a duplicate throttled message before the interval elapses", () => {
    const { send, sent } = makeSpy();
    const s = createMoveSender(send, 100);
    s.update(0, true, pose(0, 0)); // send
    s.update(99, true, pose(0.4, 0)); // still within interval -> no send
    expect(sent).toHaveLength(1);
    s.update(100, true, pose(0.4, 0)); // interval reached -> send
    expect(sent).toHaveLength(2);
  });
});
