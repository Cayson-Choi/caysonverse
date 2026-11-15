import { describe, expect, it } from "vitest";
import { CHARACTER_MANIFEST } from "@caysonverse/shared/characterManifest";
import { FLOOR_SIT_POSE, SIT_POSE, liftForSeatY } from "@caysonverse/shared/sitPose";
import type { Seat } from "@caysonverse/shared/worldMap";
import { CLIP, FLOOR_CLIP } from "./constants";
import { createSeatMotion } from "./remoteSeat";
import { isFloorSeat, seatClipBase } from "./seatClips";

const seat = (extra: Partial<Seat> = {}): Seat => ({ x: 1, z: 2, yaw: 0, standX: 1, standZ: 3, ...extra });

describe("which sit clips a seat plays", () => {
  it("a seat is a floor seat only when its pose says so; unknown seats and chairs keep the chair clips", () => {
    expect(isFloorSeat(seat({ pose: "floor" }))).toBe(true);
    expect(isFloorSeat(seat({ pose: "chair" }))).toBe(false);
    expect(isFloorSeat(seat())).toBe(false);
    expect(isFloorSeat(undefined)).toBe(false);
  });

  it("maps the three sit roles to the Sit_Floor_* clips on a floor seat, and leaves every other clip and every chair alone", () => {
    expect(seatClipBase(CLIP.sitDown, true)).toBe("Sit_Floor_Down");
    expect(seatClipBase(CLIP.sitIdle, true)).toBe("Sit_Floor_Idle");
    expect(seatClipBase(CLIP.sitStand, true)).toBe("Sit_Floor_StandUp");
    for (const base of [CLIP.sitDown, CLIP.sitIdle, CLIP.sitStand, CLIP.idle, CLIP.walk, CLIP.run, CLIP.jump]) {
      expect(seatClipBase(base, false)).toBe(base);
    }
    for (const base of [CLIP.idle, CLIP.walk, CLIP.run, CLIP.jump]) expect(seatClipBase(base, true)).toBe(base);
  });

  it("the floor clips are real manifest clips, and variants never rename them (a skirt sits the same)", () => {
    const clips: readonly string[] = CHARACTER_MANIFEST.clips;
    for (const c of Object.values(FLOOR_CLIP)) expect(clips).toContain(c);
    for (const variants of Object.values(CHARACTER_MANIFEST.clipVariants)) {
      for (const base of Object.keys(variants)) expect(Object.values(FLOOR_CLIP)).not.toContain(base);
    }
  });

  it("the floor pose lifts the sitter by the cushion's height; a chair's lift is unchanged", () => {
    expect(liftForSeatY(0.12, "floor")).toBeCloseTo(0.12 - FLOOR_SIT_POSE.contactY, 9);
    expect(liftForSeatY(0.12, "chair")).toBeCloseTo(0.12 - SIT_POSE.contactY, 9);
    expect(liftForSeatY(0.12)).toBe(liftForSeatY(0.12, "chair"));
    expect(liftForSeatY(undefined, "floor")).toBe(0);
  });

  it("a remote sitting on a floor cushion is lifted by the cushion's height (remoteSeat reads Seat.pose)", () => {
    const at = { x: 0, z: 0, yaw: 0 };
    const cushion = seat({ pose: "floor", seatY: 0.12 });
    const m = createSeatMotion(0, [cushion], at);
    expect(m.lift).toBeCloseTo(0.12, 9);
    const chairy = createSeatMotion(0, [seat({ seatY: 0.45 })], at);
    expect(chairy.lift).toBeCloseTo(0.45 - SIT_POSE.contactY, 9);
  });
});
