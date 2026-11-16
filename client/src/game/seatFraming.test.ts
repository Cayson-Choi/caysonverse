import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { CAMERA, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE } from "./constants";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { INDOOR_SEAT_MIN_DIST, indoorSeatFrame, seatSpotClear, setSeatSightBlocker, setSeatSpotBlocker, settledHeadDistance } from "./seatFraming";
import { createFollowRig, createFollowSpot, stepFollowRig } from "./followRig";
import { beginSeatCamera, resetViewMode, viewState } from "./viewState";
import { indoorCloseHidden } from "./selfBody";
import type { Orbit } from "./types";

const PC = 1280 / 720;
const PHONE = 390 / 844;
const PHONE_LAND = 844 / 390;
const HALL_SEATS = VILLAGE_SEATS.filter((s) => s.area === "hall");

beforeEach(() => {
  resetViewMode();
  setActiveMap(HALL_ACTIVE_MAP);
});
afterEach(() => setActiveMap(VILLAGE_ACTIVE_MAP));

describe("own avatar in view in the memorial hall (review 2026-11-15 round 5: it vanished on arrival and on most seats)", () => {
  it("indoors the body is hidden only when the camera is right at the head (< 1 m), never in normal play (3.2 m+)", () => {
    // round 9 visual review (2026-11-16): a camera held 0.55–0.85 m off by the lounge armchair behind left a half-faded head
    // filling the screen: that whole band is now hidden, and the normal-play distances (minDistance 3.2 m) stay drawn
    expect(INDOOR_SELF_HIDE_DISTANCE).toBeGreaterThanOrEqual(0.9);
    expect(INDOOR_SELF_HIDE_DISTANCE).toBeLessThan(CAMERA.minDistance);
    expect(INDOOR_SELF_SHOW_DISTANCE).toBeLessThan(CAMERA.minDistance);
    expect(indoorCloseHidden(false, true, 2.6, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(false);
    expect(indoorCloseHidden(false, true, 1.3, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(false);
    for (const d of [0.5, 0.55, 0.71, 0.85, 0.95]) expect(indoorCloseHidden(false, true, d, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE), `${d} m`).toBe(true);
    expect(indoorCloseHidden(true, true, 1.1, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(true);
    expect(indoorCloseHidden(true, true, 1.3, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(false);
  });

  it("on arrival (the hall's spawn, facing in, the camera behind toward the door wall) the camera settles 3.2 m+ from the head on PC and phone", () => {
    const sp = VILLAGE_LAYOUT.memorial.interior.spawn;
    for (const aspect of [PC, PHONE, PHONE_LAND]) {
      for (const pitch of [0.25, CAMERA.pitch, 0.5, 0.8]) {
        for (const distance of [CAMERA.distance, 4.5, 10]) {
          // the camera behind a player facing north (yaw 0 puts it on +z, at the door wall)
          const d = settledHeadDistance(sp.x, sp.z, 0, pitch, distance, aspect);
          expect(d, `aspect ${aspect.toFixed(2)} pitch ${pitch} zoom ${distance}`).toBeGreaterThanOrEqual(CAMERA.minDistance);
        }
      }
    }
  });

  it("every seat in the hall (sofas, armchairs, consult chairs, letter chairs, benches) is first framed with the camera 3.2 m+ from the head", () => {
    const kinds = new Set(HALL_SEATS.map((s) => s.id.replace(/_.*$/, "")));
    expect(HALL_SEATS.length).toBeGreaterThanOrEqual(21);
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["armchair", "bench", "consult", "letter", "sofa"]));
    for (const s of HALL_SEATS) {
      for (const aspect of [PC, PHONE, PHONE_LAND]) {
        for (const distance of [CAMERA.distance, 4, 12]) {
          const f = indoorSeatFrame(s.x, s.z, s.yaw, distance, aspect);
          expect(f.dist, `${s.id} aspect ${aspect.toFixed(2)} zoom ${distance}`).toBeGreaterThanOrEqual(INDOOR_SEAT_MIN_DIST);
          expect(settledHeadDistance(s.x, s.z, f.yaw, f.pitch, distance, aspect)).toBeCloseTo(f.dist, 9);
        }
      }
    }
  });

  it("a seat with room behind it keeps the old framing: behind, looking the way it faces, level", () => {
    const bench = HALL_SEATS.find((s) => s.id.startsWith("bench_w1"))!;
    const f = indoorSeatFrame(bench.x, bench.z, bench.yaw, CAMERA.distance, PC);
    expect(f.pitch).toBeCloseTo(0.12, 9);
  });

  it("beginSeatCamera indoors with the seat's spot sets that framing as the one glide goal", () => {
    const sofa = HALL_SEATS.find((s) => s.id.startsWith("sofa_a0"))!;
    const orbit = Object.freeze({ yaw: 0, pitch: 0.35, distance: 6 }) as Orbit;
    viewState.orbitGoal = null;
    beginSeatCamera(orbit, sofa.yaw, true, { x: sofa.x, z: sofa.z, aspect: PC });
    const f = indoorSeatFrame(sofa.x, sofa.z, sofa.yaw, 6, PC);
    expect(viewState.orbitGoal).toEqual({ yaw: f.yaw, pitch: f.pitch });
  });
});

describe("a sofa's first framing is from the room, with the body in sight (round 6 review: sofa a0/a1 behind the tea counter)", () => {
  const sofas = HALL_SEATS.filter((s) => s.id === "sofa_a0" || s.id === "sofa_a1");
  it("sofa a0 and a1 are framed from the room side (north of the sofa), not along the wall past the tea counter", () => {
    expect(sofas).toHaveLength(2);
    for (const s of sofas) {
      for (const aspect of [PC, PHONE, PHONE_LAND]) {
        const f = indoorSeatFrame(s.x, s.z, s.yaw, 6, aspect);
        // the camera sits at (sin yaw, cos yaw) from the seat: the room is to the north (−z)
        expect(Math.cos(f.yaw), `${s.id} aspect ${aspect.toFixed(2)}`).toBeLessThan(-0.3);
        expect(f.dist).toBeGreaterThanOrEqual(INDOOR_SEAT_MIN_DIST - 1e-9);
      }
    }
  });

  it("a framing whose line to the seated body is blocked (the hall's model, registered by the hall) is passed over", () => {
    const s = sofas[1]!;
    const free = indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
    // block every line from a camera on the free framing's side of the seat
    const side = Math.sign(Math.sin(free.yaw)) || 1;
    const off = setSeatSightBlocker((fx) => Math.sign(fx - s.x) === side);
    try {
      const f = indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
      expect(Math.sign(Math.sin(f.yaw))).not.toBe(side);
    } finally {
      off();
    }
  });
});

describe("a seat's first framing never puts the camera inside or above solid things (round 7 review: letter_s0 in the louvres)", () => {
  /** Where the camera settles for a frame (the same two-step settle the search uses). */
  const settled = (x: number, z: number, f: { yaw: number; pitch: number }, aspect: number) => {
    const orbit = { yaw: f.yaw, pitch: f.pitch, distance: 6 };
    const rig = createFollowRig(orbit);
    const spot = createFollowSpot();
    stepFollowRig(rig, orbit, x, z, aspect, 1 / 60, true, spot);
    stepFollowRig(rig, orbit, x, z, aspect, 1 / 60, true, spot);
    return spot;
  };
  // the lounge's oak louvres as the hall model has them (build_memorial.py slats(): x 292.95..296.92, z 1.2..5.55, underside
  // 3.88 m), grown as MemorialHall grows hung things (0.2 m round, 0.25 m under)
  const LOUVRES = { minX: 292.75, maxX: 297.12, minZ: 1.0, maxZ: 5.75, minY: 3.88 - 0.25 };
  const inLouvres = (x: number, y: number, z: number) => x >= LOUVRES.minX && x <= LOUVRES.maxX && z >= LOUVRES.minZ && z <= LOUVRES.maxZ && y > LOUVRES.minY;

  it("letter_s0 on PC (the reviewer's case) and every hall seat on PC and phone: the settled camera is clear of the louvres", () => {
    const off = setSeatSpotBlocker(inLouvres);
    try {
      for (const s of HALL_SEATS) {
        for (const aspect of [PC, PHONE, PHONE_LAND]) {
          const f = indoorSeatFrame(s.x, s.z, s.yaw, 6, aspect);
          const spot = settled(s.x, s.z, f, aspect);
          expect(inLouvres(spot.x, spot.y, spot.z), `${s.id} aspect ${aspect.toFixed(2)} ${JSON.stringify(spot)}`).toBe(false);
          expect(seatSpotClear(spot)).toBe(true);
        }
      }
    } finally {
      off();
    }
  });

  it("letter_s0 as the reviewer met it (the low framings from the lounge side see the body blocked): without the spot test the camera ends up in the louvres, with it never", () => {
    const s = HALL_SEATS.find((x) => x.id === "letter_s0")!;
    expect(s).toBeTruthy();
    // in the hall the chairs and the sofa block the low lines from the lounge side; the high one slips through the slats
    const offSight = setSeatSightBlocker((_fx, fy, fz) => fz > s.z + 1 && fy < 3.5);
    try {
      const f = indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
      const spot = settled(s.x, s.z, f, PC);
      expect(inLouvres(spot.x, spot.y, spot.z), JSON.stringify(spot)).toBe(true);
      const offSpot = setSeatSpotBlocker(inLouvres);
      try {
        const g = indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
        const at = settled(s.x, s.z, g, PC);
        expect(inLouvres(at.x, at.y, at.z), JSON.stringify(at)).toBe(false);
        expect(g.dist).toBeGreaterThanOrEqual(INDOOR_SEAT_MIN_DIST - 1e-9);
      } finally {
        offSpot();
      }
    } finally {
      offSight();
    }
  });

  it("the search is done once per seat, zoom and screen: a second ask is answered from the cache (no rays)", () => {
    let rays = 0;
    const off = setSeatSightBlocker(() => {
      rays++;
      return false;
    });
    try {
      const s = HALL_SEATS.find((x) => x.id === "letter_s1")!;
      const a = indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
      const first = rays;
      expect(first).toBeGreaterThan(0);
      const b = indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
      expect(rays).toBe(first);
      expect(b).toEqual(a);
      // a new registration (a new hall model) starts afresh
      const off2 = setSeatSightBlocker(() => {
        rays++;
        return false;
      });
      indoorSeatFrame(s.x, s.z, s.yaw, 6, PC);
      expect(rays).toBeGreaterThan(first);
      off2();
    } finally {
      off();
    }
  });
});
