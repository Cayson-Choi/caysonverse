import { describe, it, expect } from "vitest";
import { isBlocked } from "../collision";
import { ROOM_IDS } from "../escape/constants";
import { PLAYER_RADIUS } from "../worldMap";
import {
  EAST_CORRIDOR,
  EAST_GATE,
  HALL,
  HUB_BOUNDS,
  HUB_DOORS,
  HUB_GEOMETRY_GATED,
  HUB_GEOMETRY_OPEN,
  HUB_SPAWN,
  HUB_SPAWN_JITTER,
  HUB_WALLS,
  PROGRESS_BOARD,
  TEAM_ZONE,
  WEST_SEAL,
  doorAtPad,
  hubGeometry,
  hubZoneLabel,
  inTeamZone,
} from "./hubMap";
import { HUB_PROP_COLLIDERS } from "./generated/hubColliders";
import { centre, hasNear, inside, overlaps, reachable } from "./reachTestUtil";

const EPS = 1e-9;

describe("hub reachability", () => {
  it("gated: from the spawn nothing outside the hall is reachable", () => {
    const r = reachable(hubGeometry(false), HUB_SPAWN);
    expect(r.length).toBeGreaterThan(1000); // the hall really was walked
    expect(r.every((p) => inside(HALL, p))).toBe(true);
    expect(r.some((p) => inside(TEAM_ZONE, p))).toBe(true);
  });

  it("open: every door pad centre is reachable and nothing outside hall ∪ corridor", () => {
    const r = reachable(hubGeometry(true), HUB_SPAWN);
    for (const d of HUB_DOORS) expect(hasNear(r, centre(d.pad), 0.25), d.room).toBe(true);
    expect(r.every((p) => inside(HALL, p) || inside(EAST_CORRIDOR, p))).toBe(true);
    expect(r.some((p) => inside(EAST_CORRIDOR, p) && p.x > 40)).toBe(true); // all the way down the corridor
  });

  it("the west corridor of the next stage stays sealed in both geometries", () => {
    for (const gateOpen of [false, true]) {
      const r = reachable(hubGeometry(gateOpen), HUB_SPAWN);
      expect(r.some((p) => p.x < HALL.minX), `gateOpen=${gateOpen}`).toBe(false);
    }
  });

  it("the east gate is what separates hall and corridor before class starts", () => {
    expect(isBlocked(14, 0, PLAYER_RADIUS, hubGeometry(false).obstacles)).toBe(true);
    expect(isBlocked(14, 0, PLAYER_RADIUS, hubGeometry(true).obstacles)).toBe(false);
  });
});

describe("door pads", () => {
  it("pads sit inside the corridor (inset PLAYER_RADIUS), are disjoint, and doorAtPad maps their centres", () => {
    for (const d of HUB_DOORS) {
      expect(d.pad.minX, d.room).toBeGreaterThanOrEqual(EAST_CORRIDOR.minX + PLAYER_RADIUS - EPS);
      expect(d.pad.maxX, d.room).toBeLessThanOrEqual(EAST_CORRIDOR.maxX - PLAYER_RADIUS + EPS);
      expect(d.pad.minZ, d.room).toBeGreaterThanOrEqual(EAST_CORRIDOR.minZ + PLAYER_RADIUS - EPS);
      expect(d.pad.maxZ, d.room).toBeLessThanOrEqual(EAST_CORRIDOR.maxZ - PLAYER_RADIUS + EPS);
      expect(doorAtPad(centre(d.pad).x, centre(d.pad).z), d.room).toBe(d.room);
      expect(d.returnPoint).toEqual(centre(d.pad));
    }
    for (let i = 0; i < HUB_DOORS.length; i++) {
      for (let j = i + 1; j < HUB_DOORS.length; j++) {
        expect(overlaps(HUB_DOORS[i].pad, HUB_DOORS[j].pad), `${HUB_DOORS[i].room}/${HUB_DOORS[j].room}`).toBe(false);
      }
    }
  });

  it("doorAtPad on the corridor centre line is null", () => {
    for (let x = EAST_CORRIDOR.minX; x <= EAST_CORRIDOR.maxX; x += 0.5) expect(doorAtPad(x, 0), `x=${x}`).toBeNull();
    expect(doorAtPad(0, 6)).toBeNull(); // the hall spawn
  });

  it("has the four doors from the plan: counsel n 22, library s 22, broadcast n 38, career s 38", () => {
    expect(HUB_DOORS.map((d) => [d.room, d.side, d.x])).toEqual([
      ["counsel", "n", 22],
      ["library", "s", 22],
      ["broadcast", "n", 38],
      ["career", "s", 38],
    ]);
    for (const d of HUB_DOORS) expect(ROOM_IDS).toContain(d.room);
    expect(new Set(HUB_DOORS.map((d) => d.room)).size).toBe(HUB_DOORS.length);
  });

  it("each pad is 3 m wide on the door's own side of the corridor centre line", () => {
    for (const d of HUB_DOORS) {
      expect(d.pad.minX).toBeCloseTo(d.x - 1.5, 9);
      expect(d.pad.maxX).toBeCloseTo(d.x + 1.5, 9);
      if (d.side === "n") {
        expect(d.pad.minZ).toBeCloseTo(-2.6, 9);
        expect(d.pad.maxZ).toBeCloseTo(-0.8, 9);
      } else {
        expect(d.pad.minZ).toBeCloseTo(0.8, 9);
        expect(d.pad.maxZ).toBeCloseTo(2.6, 9);
      }
    }
  });

  it("doorAtPad answers null just outside a pad and for the wrong side of the corridor", () => {
    const counsel = HUB_DOORS.find((d) => d.room === "counsel")!;
    expect(doorAtPad(counsel.pad.maxX + 0.1, centre(counsel.pad).z)).toBeNull();
    expect(doorAtPad(counsel.x, counsel.pad.minZ - 0.1)).toBeNull();
    expect(doorAtPad(counsel.x, -centre(counsel.pad).z)).toBe("library"); // mirror image is the library pad
  });
});

describe("spawn and team zone", () => {
  it("spawn disk and TEAM_ZONE are clear in both geometries", () => {
    for (const geo of [HUB_GEOMETRY_OPEN, HUB_GEOMETRY_GATED]) {
      expect(isBlocked(HUB_SPAWN.x, HUB_SPAWN.z, HUB_SPAWN_JITTER + PLAYER_RADIUS, geo.obstacles, 0), geo.id).toBe(false);
      for (const o of geo.obstacles) expect(overlaps(o, TEAM_ZONE), `${geo.id} ${JSON.stringify(o)}`).toBe(false);
    }
  });

  it("the spawn and the team zone are inside the hall", () => {
    expect(inside(HALL, HUB_SPAWN)).toBe(true);
    expect(inside(HALL, { x: TEAM_ZONE.minX, z: TEAM_ZONE.minZ })).toBe(true);
    expect(inside(HALL, { x: TEAM_ZONE.maxX, z: TEAM_ZONE.maxZ })).toBe(true);
  });

  it("inTeamZone is true inside, widens by the margin (default 0.5) and is false beyond", () => {
    expect(inTeamZone(-8, 5)).toBe(true);
    expect(inTeamZone(TEAM_ZONE.maxX + 0.4, 5)).toBe(true);
    expect(inTeamZone(TEAM_ZONE.maxX + 0.6, 5)).toBe(false);
    expect(inTeamZone(-8, TEAM_ZONE.minZ - 0.4)).toBe(true);
    expect(inTeamZone(-8, TEAM_ZONE.minZ - 0.6)).toBe(false);
    expect(inTeamZone(0, 6)).toBe(false); // the spawn is not in the team zone
  });

  it("inTeamZone with margin 0 is the exact rectangle, and a larger margin widens it", () => {
    expect(inTeamZone(TEAM_ZONE.maxX, TEAM_ZONE.maxZ, 0)).toBe(true);
    expect(inTeamZone(TEAM_ZONE.maxX + 0.01, 5, 0)).toBe(false);
    expect(inTeamZone(TEAM_ZONE.maxX + 1.5, 5, 2)).toBe(true);
  });
});

describe("geometry objects", () => {
  it("hubGeometry returns the same object every call (no allocation)", () => {
    expect(hubGeometry(true)).toBe(hubGeometry(true));
    expect(hubGeometry(false)).toBe(hubGeometry(false));
    expect(hubGeometry(true)).toBe(HUB_GEOMETRY_OPEN);
    expect(hubGeometry(false)).toBe(HUB_GEOMETRY_GATED);
    expect(hubGeometry(true)).not.toBe(hubGeometry(false));
  });

  it("gated = open + the east gate, in both obstacles and camera boxes", () => {
    expect(HUB_GEOMETRY_OPEN.id).toBe("hub-open");
    expect(HUB_GEOMETRY_GATED.id).toBe("hub-gated");
    expect(HUB_GEOMETRY_OPEN.obstacles).not.toContainEqual(EAST_GATE);
    expect(HUB_GEOMETRY_GATED.obstacles).toContainEqual(EAST_GATE);
    expect(HUB_GEOMETRY_GATED.obstacles).toHaveLength(HUB_GEOMETRY_OPEN.obstacles.length + 1);
    expect(HUB_GEOMETRY_GATED.cameraBoxes).toContainEqual(EAST_GATE);
    expect(HUB_GEOMETRY_OPEN.cameraBoxes).not.toContainEqual(EAST_GATE);
  });

  it("both geometries hold the hub walls, the west seal and the progress board", () => {
    for (const geo of [HUB_GEOMETRY_OPEN, HUB_GEOMETRY_GATED]) {
      for (const w of HUB_WALLS) expect(geo.obstacles, geo.id).toContainEqual(w);
      expect(geo.obstacles, geo.id).toContainEqual(WEST_SEAL);
      expect(geo.obstacles, geo.id).toContainEqual(PROGRESS_BOARD);
      expect(geo.bounds, geo.id).toEqual(HUB_BOUNDS);
    }
  });

  it("the camera is blocked by walls and seals but not by the low progress board", () => {
    for (const geo of [HUB_GEOMETRY_OPEN, HUB_GEOMETRY_GATED]) {
      expect(geo.cameraBoxes, geo.id).toContainEqual(WEST_SEAL);
      expect(geo.cameraBoxes, geo.id).not.toContainEqual(PROGRESS_BOARD);
    }
  });

  it("hall and corridor are inside the hub bounds, which are exactly their union's bounding box", () => {
    expect(HUB_BOUNDS).toEqual({ minX: HALL.minX, maxX: EAST_CORRIDOR.maxX, minZ: HALL.minZ, maxZ: HALL.maxZ });
    expect(EAST_CORRIDOR.minX).toBe(HALL.maxX);
    expect(EAST_CORRIDOR.minZ).toBeGreaterThanOrEqual(HALL.minZ);
    expect(EAST_CORRIDOR.maxZ).toBeLessThanOrEqual(HALL.maxZ);
  });

  it("the progress board hangs on the hall's north wall, inside the hall", () => {
    expect(PROGRESS_BOARD.minZ).toBe(HALL.minZ);
    expect(PROGRESS_BOARD.minX).toBeGreaterThanOrEqual(HALL.minX);
    expect(PROGRESS_BOARD.maxX).toBeLessThanOrEqual(HALL.maxX);
  });

  it("every generated prop collider is both a collision obstacle and kept out of the camera boxes", () => {
    // Open = walls + west seal (camera boxes) and + progress board + generated props (obstacles).
    expect(HUB_GEOMETRY_OPEN.cameraBoxes).toHaveLength(HUB_WALLS.length + 1);
    expect(HUB_GEOMETRY_OPEN.obstacles).toHaveLength(HUB_WALLS.length + 1 + 1 + HUB_PROP_COLLIDERS.length);
    for (const geo of [HUB_GEOMETRY_OPEN, HUB_GEOMETRY_GATED]) {
      for (const c of HUB_PROP_COLLIDERS) {
        expect(geo.obstacles, geo.id).toContainEqual(c);
        expect(geo.cameraBoxes, geo.id).not.toContainEqual(c);
      }
    }
  });
});

describe("hubZoneLabel", () => {
  it("names the hall and the corridor, and nothing outside them", () => {
    expect(hubZoneLabel(0, 6)).toBe("중앙 홀");
    expect(hubZoneLabel(-8, 5)).toBe("중앙 홀");
    expect(hubZoneLabel(30, 0)).toBe("동쪽 복도");
    expect(hubZoneLabel(22, -1.7)).toBe("동쪽 복도");
    expect(hubZoneLabel(100, 100)).toBe("");
    expect(hubZoneLabel(30, 10)).toBe(""); // beside the corridor, in the void between the rooms
    expect(hubZoneLabel(-20, 0)).toBe("");
  });
});
