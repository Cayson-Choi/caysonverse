import { describe, expect, it } from "vitest";
import { OBSTACLES, PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { collectObstacles, remoteBlocks } from "./playerObstacles";

type RemoteTriple = [x: number, z: number, connected: boolean];

const forEachOf =
  (remotes: RemoteTriple[]) => (fn: (x: number, z: number, connected: boolean) => void) => {
    for (const [x, z, c] of remotes) fn(x, z, c);
  };

describe("remoteBlocks (escape rule)", () => {
  it("blocks a remote you are NOT overlapping", () => {
    expect(remoteBlocks(0, 0, 2, 0)).toBe(true);
    expect(remoteBlocks(0, 0, 0, 2 * PLAYER_RADIUS + 0.01)).toBe(true);
  });

  it("does NOT block a remote you are already inside (can walk out)", () => {
    expect(remoteBlocks(0, 0, 0, 0)).toBe(false); // spawn stack
    expect(remoteBlocks(0, 0, 0.3, 0.3)).toBe(false); // deep diagonal overlap
  });
});

describe("collectObstacles (design 33 — solid remote players)", () => {
  it("returns exactly the static obstacles when no remotes exist", () => {
    const list = collectObstacles(0, 0, forEachOf([]));
    expect(list).toHaveLength(OBSTACLES.length);
    expect(list[0]).toEqual(OBSTACLES[0]);
  });

  it("appends a player-sized box per connected remote", () => {
    const list = collectObstacles(0, 0, forEachOf([[5, 5, true]]));
    expect(list).toHaveLength(OBSTACLES.length + 1);
    const box = list[list.length - 1];
    expect(box).toEqual({
      minX: 5 - PLAYER_RADIUS,
      maxX: 5 + PLAYER_RADIUS,
      minZ: 5 - PLAYER_RADIUS,
      maxZ: 5 + PLAYER_RADIUS,
    });
  });

  it("skips ghosts (disconnected) and overlapped remotes", () => {
    const list = collectObstacles(
      0,
      0,
      forEachOf([
        [5, 5, false], // ghost → walk through
        [0.2, 0, true], // overlapping → escape rule
        [3, 0, true], // solid
      ]),
    );
    expect(list).toHaveLength(OBSTACLES.length + 1);
  });

  it("reuses the array across frames without corrupting the static prefix", () => {
    const first = collectObstacles(0, 0, forEachOf([[5, 5, true], [7, 7, true]]));
    expect(first).toHaveLength(OBSTACLES.length + 2);
    const second = collectObstacles(0, 0, forEachOf([]));
    expect(second).toHaveLength(OBSTACLES.length);
    for (let i = 0; i < OBSTACLES.length; i++) expect(second[i]).toEqual(OBSTACLES[i]);
  });
});
