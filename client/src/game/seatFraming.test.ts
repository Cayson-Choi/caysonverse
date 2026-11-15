import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { CAMERA, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE } from "./constants";
import { HALL_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { INDOOR_SEAT_MIN_DIST, indoorSeatFrame, settledHeadDistance } from "./seatFraming";
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
  it("indoors the body is hidden only when the camera is really inside the head (< 0.6 m), never in normal play", () => {
    expect(INDOOR_SELF_HIDE_DISTANCE).toBeLessThanOrEqual(0.6);
    expect(indoorCloseHidden(false, true, 2.6, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(false);
    expect(indoorCloseHidden(false, true, 1.0, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(false);
    expect(indoorCloseHidden(false, true, 0.5, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(true);
    expect(indoorCloseHidden(true, true, 0.7, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(true);
    expect(indoorCloseHidden(true, true, 0.9, INDOOR_SELF_HIDE_DISTANCE, INDOOR_SELF_SHOW_DISTANCE)).toBe(false);
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
