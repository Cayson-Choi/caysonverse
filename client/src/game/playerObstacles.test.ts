import { afterEach, describe, expect, it } from "vitest";
import { OBSTACLES, PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { EAST_GATE, HUB_GEOMETRY_GATED, HUB_GEOMETRY_OPEN, hubZoneLabel } from "@caysonverse/shared/school/hubMap";
import { LEGACY_ACTIVE_MAP, getActiveMap, setActiveMap } from "./activeMap";
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

describe("collectObstacles — the active map (Task 15)", () => {
  afterEach(() => setActiveMap(LEGACY_ACTIVE_MAP));

  it("collectObstacles uses the active map's obstacles after a switch and rebuilds only then", () => {
    // Legacy first: the world's static list, and the same array frame after frame.
    const legacyA = collectObstacles(0, 0, forEachOf([]));
    const legacyB = collectObstacles(0, 0, forEachOf([[5, 5, true]]));
    expect(legacyB).toBe(legacyA); // no rebuild without a switch
    expect(legacyB).toHaveLength(OBSTACLES.length + 1);

    // Switch to the gated hub: the hub's static prefix (walls, seal, gate, board, props).
    setActiveMap({ geometry: HUB_GEOMETRY_GATED, zoneLabel: hubZoneLabel });
    const hubA = collectObstacles(0, 0, forEachOf([[3, 0, true]]));
    expect(hubA).not.toBe(legacyA); // rebuilt once, for the new map
    expect(hubA).toHaveLength(HUB_GEOMETRY_GATED.obstacles.length + 1);
    for (let i = 0; i < HUB_GEOMETRY_GATED.obstacles.length; i++) {
      expect(hubA[i]).toBe(HUB_GEOMETRY_GATED.obstacles[i]);
    }
    expect(hubA).toContain(EAST_GATE);
    const hubB = collectObstacles(0, 0, forEachOf([]));
    expect(hubB).toBe(hubA); // …and not again while the map stays
    expect(hubB).toHaveLength(HUB_GEOMETRY_GATED.obstacles.length);

    // The gate opens: the open geometry has no gate box.
    setActiveMap({ geometry: HUB_GEOMETRY_OPEN, zoneLabel: hubZoneLabel });
    const open = collectObstacles(0, 0, forEachOf([]));
    expect(open).not.toBe(hubA);
    expect(open).toHaveLength(HUB_GEOMETRY_OPEN.obstacles.length);
    expect(open).not.toContain(EAST_GATE);

    // Setting the SAME map object again is not a switch.
    setActiveMap(getActiveMap());
    expect(collectObstacles(0, 0, forEachOf([]))).toBe(open);
  });
});
