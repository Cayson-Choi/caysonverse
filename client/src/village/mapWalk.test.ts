import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setActiveMap, VILLAGE_ACTIVE_MAP } from "../game/activeMap";
import { clearClickTarget, peekClickTarget, setClickTarget } from "../game/clickMove";
import { useClickHint } from "../stores/clickHintStore";
import { cancelMapWalk, MAP_WALK_COPY, mapWalkTarget, startMapWalk } from "./mapWalk";
import { PLAZA_HUB } from "./villagePlaces";

const pose = { ...PLAZA_HUB, yaw: 0 };
const standing = { index: -1 };

beforeEach(() => {
  vi.useFakeTimers();
  setActiveMap(VILLAGE_ACTIVE_MAP);
});
afterEach(() => {
  cancelMapWalk();
  clearClickTarget();
  useClickHint.getState().clear();
  vi.useRealTimers();
});

it("stops the previous leg and confirms arrival when the next destination is the current spot", () => {
  expect(startMapWalk("lake", pose, standing)).toBe(true);
  expect(peekClickTarget()).not.toBeNull();
  startMapWalk("plaza", pose, standing);
  vi.advanceTimersByTime(150);
  expect(mapWalkTarget()).toBeNull();
  expect(peekClickTarget()).toBeNull();
  expect(useClickHint.getState().text).toBe(MAP_WALK_COPY.arrived("광장"));
});

it("cancels the active leg with the map, preserving a newer manual destination", () => {
  startMapWalk("lake", pose, standing);
  cancelMapWalk();
  expect(peekClickTarget()).toBeNull();
  startMapWalk("lake", pose, standing);
  setClickTarget(2, 18, 0);
  cancelMapWalk();
  expect(peekClickTarget()).toMatchObject({ x: 2, z: 18 });
});
