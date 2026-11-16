import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS } from "./tapGesture";
import { SIT_ON_ARRIVAL_ARM_MS, SIT_ON_ARRIVAL_DIST, stepSeatOnArrival, yawToward, type SeatArrivalInput, type SeatIntent } from "./seatOnArrival";

const intent = (over: Partial<SeatIntent> = {}): SeatIntent => ({ index: 7, x: 10, z: 5, armed: false, at: 1000, ...over });
const input = (over: Partial<SeatArrivalInput> = {}): SeatArrivalInput => ({
  target: null,
  seated: false,
  pose: { x: 0, z: 0 },
  now: 1000,
  ...over,
});

describe("a clicked seat on arrival: walk there, turn to face it, never sit (owner 2026-11-17: 의자를 찍으면 자동 앉기는 빼줘)", () => {
  it("the walk to the seat's approach arms it, and its end there turns the avatar toward that very seat — no sit", () => {
    let soa: SeatIntent | null = intent();
    // walking: the target is the approach
    let step = stepSeatOnArrival(soa, input({ target: { x: 10, z: 5 }, pose: { x: 6, z: 5 }, now: 1100 }));
    expect(step).toEqual({ next: { ...soa, armed: true }, face: null });
    soa = step.next;
    step = stepSeatOnArrival(soa, input({ target: { x: 10, z: 5 }, pose: { x: 9, z: 5 }, now: 3000 })); // still walking, long after
    expect(step.next?.armed).toBe(true);
    // arrived: the walk's target cleared, the avatar at the approach
    step = stepSeatOnArrival(step.next, input({ pose: { x: 10.1, z: 5 }, now: 3200 }));
    expect(step).toEqual({ next: null, face: 7 });
    expect(Object.keys(step)).not.toContain("sit");
  });

  it("a stop short of the approach turns to nothing", () => {
    const armed = intent({ armed: true });
    expect(stepSeatOnArrival(armed, input({ pose: { x: 10 + SIT_ON_ARRIVAL_DIST + 0.05, z: 5 } }))).toEqual({ next: null, face: null });
    expect(stepSeatOnArrival(armed, input({ pose: { x: 10 + SIT_ON_ARRIVAL_DIST - 0.05, z: 5 } })).face).toBe(7);
  });

  it("another walk, sitting meanwhile, or a walk that never starts forgets it", () => {
    expect(stepSeatOnArrival(intent({ armed: true }), input({ target: { x: 3, z: 3 } })).next).toBeNull(); // a new click elsewhere
    expect(stepSeatOnArrival(intent(), input({ seated: true }))).toEqual({ next: null, face: null });
    const waiting = stepSeatOnArrival(intent(), input({ pose: { x: 0, z: 0 }, now: 1000 + SIT_ON_ARRIVAL_ARM_MS - 1 }));
    expect(waiting.next).not.toBeNull(); // a tap's walk waits out its double-tap time first
    expect(stepSeatOnArrival(intent(), input({ pose: { x: 0, z: 0 }, now: 1000 + SIT_ON_ARRIVAL_ARM_MS + 1 }))).toEqual({ next: null, face: null });
  });

  it("a walk so short it began and ended between two frames turns once the double-tap wait is over", () => {
    const soa = intent(); // never saw its target: the approach a step away
    expect(stepSeatOnArrival(soa, input({ pose: { x: 10.2, z: 5 }, now: 1000 + DOUBLE_TAP_MS })).next).not.toBeNull();
    expect(stepSeatOnArrival(soa, input({ pose: { x: 10.2, z: 5 }, now: 1000 + DOUBLE_TAP_MS + 101 }))).toEqual({ next: null, face: 7 });
  });

  it("nothing to do without an intent", () => {
    expect(stepSeatOnArrival(null, input())).toEqual({ next: null, face: null });
  });

  it("the facing: the player yaw convention atan2(dx, dz), none when standing on the seat point", () => {
    expect(yawToward(0, 0, 0, 1)).toBeCloseTo(0, 9); // +z
    expect(yawToward(0, 0, 1, 0)).toBeCloseTo(Math.PI / 2, 9); // +x
    expect(yawToward(0, 0, 0, -1)).toBeCloseTo(Math.PI, 9);
    expect(yawToward(2, 3, 2, 3)).toBeNull();
  });
});
