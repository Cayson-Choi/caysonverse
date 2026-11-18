import { describe, expect, it } from "vitest";
import { CAROUSEL_PAD, COASTER_QUEUE_PAD, PARK_EXIT_PAD, parkGateDoor } from "@caysonverse/shared/village/parkArea";
import { CAROUSEL_BOARD_TARGET_ID, COASTER_BOARD_TARGET_ID, PARK_DOOR_ID, villageTargets } from "./villageTargets";

describe("park targets", () => {
  it("offers the way out under the arch and nothing in the open", () => {
    expect(villageTargets("park", PARK_EXIT_PAD.x, PARK_EXIT_PAD.z).map((t) => t.id)).toEqual([PARK_DOOR_ID]);
    expect(villageTargets("park", 40, -140)).toEqual([]);
  });
  it("offers the coaster from the queue, not from the plaza", () => {
    expect(villageTargets("park", COASTER_QUEUE_PAD.x, COASTER_QUEUE_PAD.z).map((t) => t.id)).toEqual([COASTER_BOARD_TARGET_ID]);
    expect(villageTargets("park", 40, -112)).toEqual([]);
  });
  it("offers the carousel from 40 m, not from the plaza", () => {
    expect(villageTargets("park", CAROUSEL_PAD.x, CAROUSEL_PAD.z).map((t) => t.id)).toEqual([CAROUSEL_BOARD_TARGET_ID]);
    expect(villageTargets("park", CAROUSEL_PAD.x - 40, CAROUSEL_PAD.z).map((t) => t.id)).toEqual([CAROUSEL_BOARD_TARGET_ID]);
    expect(villageTargets("park", 40, -112)).toEqual([]);
  });
  it("offers the park gate at the village gate lot's pad", () => {
    const g = parkGateDoor().pad;
    const t = villageTargets("village", g.x, g.z);
    expect(t.map((x) => x.id)).toEqual([PARK_DOOR_ID]);
    expect(t[0]!.kind).toBe("door");
    expect(villageTargets("village", 0, 0).some((x) => x.id === PARK_DOOR_ID)).toBe(false);
  });
});
