import { describe, it, expect } from "vitest";
import { isBlocked } from "../collision";
import { INSPECT_REACH, PHASE1_OPEN_ROOMS, ROOM_LABELS } from "../escape/constants";
import { PLAYER_RADIUS } from "../worldMap";
import {
  COUNSEL_ANCHORS,
  COUNSEL_GEOMETRY,
  COUNSEL_ROOM,
  COUNSEL_SPAWN,
  COUNSEL_SPAWN_JITTER,
  COUNSEL_VISUALS,
  anchorById,
} from "./counselMap";
import { COUNSEL_PROP_COLLIDERS } from "./generated/counselColliders";
import { inside, reachable } from "./reachTestUtil";
import { ROOM_MAPS } from "./roomMaps";

/** Margin between where a player may stand and the reach limit: lag and the 0.25 m grid. */
const STAND_SLACK = 0.3;

describe("counselling room: shell", () => {
  it("room is sealed: everything reachable from the spawn is inside COUNSEL_ROOM", () => {
    const r = reachable(COUNSEL_GEOMETRY, COUNSEL_SPAWN);
    expect(r.length).toBeGreaterThan(500); // the room really was walked
    expect(r.every((p) => inside(COUNSEL_ROOM, p))).toBe(true);
  });

  it("spawn disk is clear; every visual node starts with 'obj__'", () => {
    expect(
      isBlocked(COUNSEL_SPAWN.x, COUNSEL_SPAWN.z, COUNSEL_SPAWN_JITTER + PLAYER_RADIUS, COUNSEL_GEOMETRY.obstacles, 0),
    ).toBe(false);
    expect(inside(COUNSEL_ROOM, COUNSEL_SPAWN)).toBe(true);
    expect(COUNSEL_VISUALS.length).toBeGreaterThan(0);
    for (const v of COUNSEL_VISUALS) expect(v.node.startsWith("obj__"), v.node).toBe(true);
  });

  it("is a 12 x 10 m room whose geometry id and bounds are 'counsel' and the room box", () => {
    expect(COUNSEL_ROOM).toEqual({ minX: -6, maxX: 6, minZ: -5, maxZ: 5 });
    expect(COUNSEL_GEOMETRY.id).toBe("counsel");
    expect(COUNSEL_GEOMETRY.bounds).toEqual(COUNSEL_ROOM);
  });

  it("walls surround the room and every generated prop collider is an obstacle but not a camera box", () => {
    expect(COUNSEL_GEOMETRY.cameraBoxes.length).toBeGreaterThanOrEqual(4);
    expect(COUNSEL_GEOMETRY.obstacles).toHaveLength(COUNSEL_GEOMETRY.cameraBoxes.length + COUNSEL_PROP_COLLIDERS.length);
    for (const c of COUNSEL_PROP_COLLIDERS) {
      expect(COUNSEL_GEOMETRY.obstacles).toContainEqual(c);
      expect(COUNSEL_GEOMETRY.cameraBoxes).not.toContainEqual(c);
    }
  });
});

describe("counselling room: anchors", () => {
  it("anchors: unique ids, ≥ 1.0 m apart, inside COUNSEL_ROOM inset 0.6, each with a free standing point in reach", () => {
    const ids = COUNSEL_ANCHORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (let i = 0; i < COUNSEL_ANCHORS.length; i++) {
      for (let j = i + 1; j < COUNSEL_ANCHORS.length; j++) {
        const a = COUNSEL_ANCHORS[i];
        const b = COUNSEL_ANCHORS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(1.0);
      }
    }

    // Ruling E12: the anchors ARE solid props (they get colliders), so "anchor not blocked" is
    // the wrong invariant. What the server needs is a place to STAND: a free, spawn-reachable
    // grid point within (reach − 0.3) m of the anchor, so the distance check can pass.
    const standable = reachable(COUNSEL_GEOMETRY, COUNSEL_SPAWN);
    for (const a of COUNSEL_ANCHORS) {
      expect(a.x, a.id).toBeGreaterThanOrEqual(COUNSEL_ROOM.minX + 0.6);
      expect(a.x, a.id).toBeLessThanOrEqual(COUNSEL_ROOM.maxX - 0.6);
      expect(a.z, a.id).toBeGreaterThanOrEqual(COUNSEL_ROOM.minZ + 0.6);
      expect(a.z, a.id).toBeLessThanOrEqual(COUNSEL_ROOM.maxZ - 0.6);
      const maxDist = (a.reach ?? INSPECT_REACH) - STAND_SLACK;
      const near = standable.filter((p) => Math.hypot(p.x - a.x, p.z - a.z) <= maxDist);
      expect(near.length, `${a.id}: a free standing point within ${maxDist} m`).toBeGreaterThan(0);
    }
  });

  it("lists the 11 named props and the 8 scattered notes, notes at 0.5 m height", () => {
    expect(COUNSEL_ANCHORS).toHaveLength(19);
    for (const id of [
      "counsel_screen",
      "note_box",
      "flashlight",
      "cabinet",
      "drawer_left",
      "drawer_right",
      "sort_board",
      "safe",
      "safe_key_left",
      "safe_key_right",
      "exit_door",
    ]) {
      expect(anchorById(id), id).toBeDefined();
    }
    for (let n = 1; n <= 8; n++) expect(anchorById(`note_${n}`)?.y, `note_${n}`).toBe(0.5);
  });

  it("anchorById finds an anchor by id and returns undefined for an unknown id", () => {
    expect(anchorById("exit_door")).toEqual({ id: "exit_door", x: 0, z: 4.0, y: 1.2 });
    expect(anchorById("safe")).toEqual({ id: "safe", x: 3.0, z: -3.8, y: 0.8 });
    expect(anchorById("no_such_thing")).toBeUndefined();
    expect(anchorById("")).toBeUndefined();
  });

  it("the two safe keys are on opposite walls, so two players must be apart to press them together", () => {
    const left = anchorById("safe_key_left")!;
    const right = anchorById("safe_key_right")!;
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(Math.abs(right.x - left.x)).toBeGreaterThan(2 * INSPECT_REACH);
  });
});

describe("counselling room: visuals", () => {
  it("binds the nine scene nodes to their puzzle flags", () => {
    expect(COUNSEL_VISUALS).toEqual([
      { node: "obj__flashlight", flag: "picked:flashlight", effect: "hide" },
      { node: "obj__uv_film", flag: "picked:uv_film", effect: "hide" },
      { node: "obj__cabinet_door", flag: "solved:cabinet_lock", effect: "open", angle: -1.75 },
      { node: "obj__sort_cards", flag: "picked:sort_cards", effect: "hide" },
      { node: "obj__board_cover", flag: "solved:cover_lock", effect: "open", angle: 1.6 },
      { node: "obj__board_cards", flag: "solved:board_lock", effect: "glow" },
      { node: "obj__safe_door", flag: "safe_open", effect: "open", angle: -1.9 },
      { node: "obj__screen_ari", flag: "finale_ready", effect: "glow" },
      { node: "obj__exit_door", flag: "escaped", effect: "open", angle: 1.6 },
    ]);
  });

  it("each node is bound once, and only 'open' bindings carry an angle", () => {
    expect(new Set(COUNSEL_VISUALS.map((v) => v.node)).size).toBe(COUNSEL_VISUALS.length);
    for (const v of COUNSEL_VISUALS) {
      expect(v.angle !== undefined, v.node).toBe(v.effect === "open");
    }
  });
});

describe("room maps", () => {
  it("ROOM_MAPS.counsel points at the counsel geometry, anchors and visuals", () => {
    const m = ROOM_MAPS.counsel;
    expect(m).toBeDefined();
    expect(m!.geometry).toBe(COUNSEL_GEOMETRY);
    expect(m!.anchors).toBe(COUNSEL_ANCHORS);
    expect(m!.visuals).toBe(COUNSEL_VISUALS);
    expect(m!.spawn).toBe(COUNSEL_SPAWN);
    expect(m!.spawnJitter).toBe(COUNSEL_SPAWN_JITTER);
    expect(m!.label).toBe(ROOM_LABELS.counsel);
    expect(m!.glb).toBe("/models/school/counsel.glb");
  });

  it("phase 1 builds a map for exactly the rooms it opens", () => {
    expect(Object.keys(ROOM_MAPS).sort()).toEqual([...PHASE1_OPEN_ROOMS].sort());
  });
});
