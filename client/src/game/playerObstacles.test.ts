import { afterEach, describe, expect, it } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { houseInteriorGeometry, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_ACTIVE_MAP, getActiveMap, setActiveMap } from "./activeMap";
import { collectObstacles, remoteBlocks } from "./playerObstacles";

type RemoteTriple = [x: number, z: number, connected: boolean];

const OBSTACLES = villageGeometry.obstacles;

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

describe("collectObstacles — the active map", () => {
  afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

  it("collectObstacles uses the active map's obstacles after a switch and rebuilds only then", () => {
    // The village first: its static list, and the same array frame after frame.
    setActiveMap(VILLAGE_ACTIVE_MAP);
    const villageA = collectObstacles(0, 0, forEachOf([]));
    const villageB = collectObstacles(0, 0, forEachOf([[5, 5, true]]));
    expect(villageB).toBe(villageA); // no rebuild without a switch
    expect(villageB).toHaveLength(OBSTACLES.length + 1);

    // Switch to a house interior: its static prefix.
    setActiveMap({ geometry: houseInteriorGeometry, zoneLabel: () => "집 안" });
    const houseA = collectObstacles(0, 0, forEachOf([[3, 0, true]]));
    expect(houseA).not.toBe(villageA); // rebuilt once, for the new map
    expect(houseA).toHaveLength(houseInteriorGeometry.obstacles.length + 1);
    for (let i = 0; i < houseInteriorGeometry.obstacles.length; i++) {
      expect(houseA[i]).toBe(houseInteriorGeometry.obstacles[i]);
    }
    const houseB = collectObstacles(0, 0, forEachOf([]));
    expect(houseB).toBe(houseA); // …and not again while the map stays
    expect(houseB).toHaveLength(houseInteriorGeometry.obstacles.length);

    // Back in the village: rebuilt once more.
    setActiveMap(VILLAGE_ACTIVE_MAP);
    const back = collectObstacles(0, 0, forEachOf([]));
    expect(back).not.toBe(houseA);
    expect(back).toHaveLength(OBSTACLES.length);

    // Setting the SAME map object again is not a switch.
    setActiveMap(getActiveMap());
    expect(collectObstacles(0, 0, forEachOf([]))).toBe(back);
  });
});
