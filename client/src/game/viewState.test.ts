import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  viewState,
  enterFp,
  exitFp,
  toggleViewMode,
  toggleOverview,
  enterOverview,
  applyZoom,
  resetViewMode,
  stepViewBlend,
  stepOvBlend,
  requestRecenter,
  cancelOrbitGoal,
  beginSeatCamera,
  endSeatCamera,
  dropOverview,
  exitOverview,
} from "./viewState";
import { HALL_ACTIVE_MAP, LEGACY_ACTIVE_MAP, VILLAGE_ACTIVE_MAP, setActiveMap } from "./activeMap";
import { recenterYaw, stepOrbitToward } from "./cameraControls";
import { SEAT_CAM } from "./constants";
import { worldDirection } from "./input";
import { SEAT_YAW } from "@caysonverse/shared/worldMap";
import { normalizeAngle } from "./yaw";
import { useViewStore } from "../stores/viewStore";
import { BLEND_SEC, OV_BLEND_SEC } from "./viewMode";
import type { Orbit } from "./types";

const BAND = { min: 2.5, max: 18 };

function orbit(over: Partial<Orbit> = {}): Orbit {
  return { yaw: 0, pitch: 0.35, distance: 6, ...over };
}

beforeEach(() => resetViewMode());

describe("viewState — reset", () => {
  it("returns to TP, blend 0, level look, no overview, and clears the button flags", () => {
    viewState.mode = "ov";
    viewState.blend = 1;
    viewState.fpYaw = 2;
    viewState.fpPitch = 0.5;
    viewState.ovBlend = 1;
    viewState.prevMode = "fp";
    viewState.ovCenterX = -18;
    viewState.ovCenterZ = 4;
    viewState.ovHeight = 60;
    viewState.orbitGoal = { yaw: 1, pitch: 0.4 };
    viewState.savedOrbit = { yaw: 0.2, pitch: 0.3, distance: 8 };
    useViewStore.getState().setFp(true);
    useViewStore.getState().setOv(true);

    resetViewMode();

    expect(viewState).toEqual({
      mode: "tp",
      blend: 0,
      fpYaw: 0,
      fpPitch: 0,
      ovBlend: 0,
      prevMode: "tp",
      ovCenterX: 0,
      ovCenterZ: 0,
      ovHeight: 0,
      orbitGoal: null,
      savedOrbit: null,
    });
    expect(useViewStore.getState().isFp).toBe(false);
    expect(useViewStore.getState().isOv).toBe(false);
  });
});

describe("viewState — yaw seeding continuity (wrap-safe, both directions)", () => {
  it("enter seeds FP yaw FROM the TP orbit yaw (world does not spin)", () => {
    const o = orbit({ yaw: 1.2 });
    enterFp(o.yaw);
    expect(viewState.mode).toBe("fp");
    expect(viewState.fpYaw).toBeCloseTo(1.2, 6);
  });

  it("exit seeds TP orbit yaw FROM the FP look yaw, normalized past the +/-PI seam", () => {
    const o = orbit({ yaw: 1.2 });
    enterFp(o.yaw);
    // Drag the FP look well past +PI so the raw value would be out of [-PI, PI].
    viewState.fpYaw = normalizeAngle(3.0 + 0.6); // 3.6 → wraps to ~-2.683
    exitFp(o);
    expect(viewState.mode).toBe("tp");
    expect(o.yaw).toBeCloseTo(normalizeAngle(3.6), 6);
    // Continuity: the resumed camera azimuth EQUALS the last FP look azimuth.
    expect(o.yaw).toBeCloseTo(viewState.fpYaw, 6);
  });

  it("does NOT clobber TP distance or pitch across a round-trip (FP look pitch is separate)", () => {
    const o = orbit({ yaw: 0.5, pitch: 0.8, distance: 11 });
    toggleViewMode(o); // → FP
    viewState.fpPitch = 0.9; // FP look tilt must not leak into orbit.pitch
    toggleViewMode(o); // → TP
    expect(o.pitch).toBe(0.8);
    expect(o.distance).toBe(11);
    expect(o.yaw).toBeCloseTo(0.5, 6); // seeded back from the (unchanged) fpYaw
  });
});

describe("viewState — toggle drives the button store", () => {
  it("flips isFp on each toggle", () => {
    const o = orbit();
    expect(useViewStore.getState().isFp).toBe(false);
    toggleViewMode(o);
    expect(viewState.mode).toBe("fp");
    expect(useViewStore.getState().isFp).toBe(true);
    toggleViewMode(o);
    expect(viewState.mode).toBe("tp");
    expect(useViewStore.getState().isFp).toBe(false);
  });
});

describe("viewState — applyZoom (wheel/pinch threshold wiring)", () => {
  it("TP at min + inward → FP; seeds fpYaw from the orbit yaw", () => {
    const o = orbit({ yaw: 0.9, distance: BAND.min });
    applyZoom(o, -0.5, BAND); // inward
    expect(viewState.mode).toBe("fp");
    expect(viewState.fpYaw).toBeCloseTo(0.9, 6);
    expect(o.distance).toBe(BAND.min);
  });

  it("TP above min + inward just zooms the distance in (no toggle)", () => {
    const o = orbit({ distance: 6 });
    applyZoom(o, -1, BAND);
    expect(viewState.mode).toBe("tp");
    expect(o.distance).toBeCloseTo(5, 6);
  });

  it("FP + outward → TP with the pre-FP distance preserved, orbit yaw seeded", () => {
    const o = orbit({ yaw: 0.3, distance: 9 });
    toggleViewMode(o); // enter FP via V at distance 9 (untouched)
    viewState.fpYaw = 1.1; // looked around in FP
    applyZoom(o, +1, BAND); // outward notch exits FP
    expect(viewState.mode).toBe("tp");
    expect(o.distance).toBe(9); // previous distance restored
    expect(o.yaw).toBeCloseTo(1.1, 6);
  });

  it("FP + inward is inert (no mode change, distance untouched)", () => {
    const o = orbit({ distance: 7 });
    toggleViewMode(o);
    applyZoom(o, -2, BAND);
    expect(viewState.mode).toBe("fp");
    expect(o.distance).toBe(7);
  });
});

describe("viewState — stepViewBlend", () => {
  it("advances toward 1 in FP and back toward 0 in TP, reversal-safe", () => {
    const o = orbit();
    toggleViewMode(o); // FP → target 1
    stepViewBlend(BLEND_SEC / 2);
    expect(viewState.blend).toBeCloseTo(0.5, 6);
    // Reverse before completing: back to TP → continues DOWN from 0.5.
    toggleViewMode(o); // TP → target 0
    stepViewBlend(BLEND_SEC / 2 / 2); // dt = BLEND_SEC/4 → step 0.25
    expect(viewState.blend).toBeCloseTo(0.25, 6);
    stepViewBlend(BLEND_SEC); // overshoot guard
    expect(viewState.blend).toBe(0);
  });
});

describe("viewState — overview mode machine (design 20)", () => {
  it("tp → ov → tp round-trip restores TP and preserves orbit yaw/pitch/distance", () => {
    const o = orbit({ yaw: 0.7, pitch: 0.9, distance: 12 });
    toggleOverview(); // enter overview from TP
    expect(viewState.mode).toBe("ov");
    expect(viewState.prevMode).toBe("tp");
    toggleOverview(); // exit → restore TP
    expect(viewState.mode).toBe("tp");
    expect(o).toEqual({ yaw: 0.7, pitch: 0.9, distance: 12 }); // orbit untouched
  });

  it("fp → ov → fp round-trip restores FP and preserves the FP look yaw", () => {
    const o = orbit({ yaw: 0.2 });
    toggleViewMode(o); // → FP
    viewState.fpYaw = 1.35; // looked around in FP
    viewState.fpPitch = 0.4;
    toggleOverview(); // enter overview from FP
    expect(viewState.mode).toBe("ov");
    expect(viewState.prevMode).toBe("fp");
    toggleOverview(); // exit → restore FP
    expect(viewState.mode).toBe("fp");
    expect(viewState.fpYaw).toBeCloseTo(1.35, 6); // FP look preserved across overview
    expect(viewState.fpPitch).toBeCloseTo(0.4, 6);
  });

  it("drives BOTH button flags: isOv while in overview, restored on exit", () => {
    const o = orbit();
    expect(useViewStore.getState().isOv).toBe(false);
    toggleOverview();
    expect(useViewStore.getState().isOv).toBe(true);
    expect(useViewStore.getState().isFp).toBe(false);
    toggleOverview();
    expect(useViewStore.getState().isOv).toBe(false);
    // From FP, isFp must be restored (not stuck) after an overview round-trip.
    toggleViewMode(o); // → FP
    expect(useViewStore.getState().isFp).toBe(true);
    toggleOverview();
    expect(useViewStore.getState().isFp).toBe(false); // overview owns the button
    expect(useViewStore.getState().isOv).toBe(true);
    toggleOverview();
    expect(useViewStore.getState().isFp).toBe(true); // FP button back
    expect(useViewStore.getState().isOv).toBe(false);
  });

  it("is M-spam safe: a redundant enterOverview never clobbers the remembered mode", () => {
    const o = orbit({ yaw: 0.5 });
    toggleViewMode(o); // → FP
    enterOverview(); // remembers FP
    expect(viewState.prevMode).toBe("fp");
    enterOverview(); // stray second enter (already in overview) — must NOT set prevMode = ov
    enterOverview();
    expect(viewState.prevMode).toBe("fp"); // still FP
    toggleOverview(); // exit → FP (not stuck in overview)
    expect(viewState.mode).toBe("fp");
  });

  it("stepOvBlend eases to 1 in overview and back to 0 outside, reversal-safe", () => {
    toggleOverview(); // → ov, target 1
    stepOvBlend(OV_BLEND_SEC / 2);
    expect(viewState.ovBlend).toBeCloseTo(0.5, 6);
    toggleOverview(); // exit → target 0, continues DOWN from 0.5
    stepOvBlend(OV_BLEND_SEC / 4);
    expect(viewState.ovBlend).toBeCloseTo(0.25, 6);
    stepOvBlend(OV_BLEND_SEC); // overshoot guard
    expect(viewState.ovBlend).toBe(0);
  });

  it("keeps the underlying TP<->FP blend aimed at the REMEMBERED mode while in overview", () => {
    const o = orbit();
    toggleViewMode(o); // → FP, blend heads to 1
    stepViewBlend(BLEND_SEC); // fully FP (blend 1)
    expect(viewState.blend).toBe(1);
    toggleOverview(); // overview over FP — underlying target stays 1 (FP)
    stepViewBlend(BLEND_SEC);
    expect(viewState.blend).toBe(1); // underlying pose remains FP beneath the overview
    toggleOverview(); // back to FP
    expect(viewState.mode).toBe("fp");
    expect(viewState.blend).toBe(1);
  });
});

describe("viewState — camera goals (R recenter, double-tap, seat camera)", () => {
  it("requestRecenter sets a yaw goal in TP and is a no-op in FP and overview", () => {
    const o = orbit();
    // TP: the goal is the camera-behind-the-body yaw, nothing else.
    requestRecenter(0.7);
    expect(viewState.orbitGoal).toEqual({ yaw: recenterYaw(0.7) });
    expect(viewState.orbitGoal).not.toHaveProperty("pitch");
    expect(viewState.orbitGoal).not.toHaveProperty("distance");

    // A later request replaces the goal (latest wins).
    requestRecenter(-2);
    expect(viewState.orbitGoal).toEqual({ yaw: recenterYaw(-2) });

    // FP: no TP orbit to turn — the request is ignored.
    cancelOrbitGoal();
    toggleViewMode(o); // → FP
    requestRecenter(1.2);
    expect(viewState.orbitGoal).toBeNull();

    // Overview (from FP, then from TP): also ignored.
    toggleOverview();
    requestRecenter(1.2);
    expect(viewState.orbitGoal).toBeNull();
    toggleOverview(); // back to FP
    toggleViewMode(o); // → TP
    toggleOverview(); // overview over TP
    expect(viewState.mode).toBe("ov");
    requestRecenter(1.2);
    expect(viewState.orbitGoal).toBeNull();
  });

  it("cancelOrbitGoal clears it; resetViewMode clears orbitGoal and savedOrbit", () => {
    requestRecenter(1);
    expect(viewState.orbitGoal).not.toBeNull();
    cancelOrbitGoal();
    expect(viewState.orbitGoal).toBeNull();
    cancelOrbitGoal(); // idempotent
    expect(viewState.orbitGoal).toBeNull();

    viewState.orbitGoal = { yaw: 2, distance: 4 };
    viewState.savedOrbit = { yaw: 0.1, pitch: 0.2, distance: 7 };
    resetViewMode();
    expect(viewState.orbitGoal).toBeNull();
    expect(viewState.savedOrbit).toBeNull();
  });

  it("entering first-person drops a pending TP goal (it must not turn the orbit behind FP)", () => {
    const o = orbit({ yaw: 0.4 });
    requestRecenter(2);
    expect(viewState.orbitGoal).not.toBeNull();
    toggleViewMode(o); // V → FP
    expect(viewState.mode).toBe("fp");
    expect(viewState.orbitGoal).toBeNull();
    // Same through the zoom threshold.
    resetViewMode();
    const z = orbit({ distance: BAND.min });
    requestRecenter(2);
    applyZoom(z, -0.5, BAND); // one notch past min → FP
    expect(viewState.mode).toBe("fp");
    expect(viewState.orbitGoal).toBeNull();
  });
});

describe("viewState — seat camera (sit → behind the seat facing the screen, stand → back)", () => {
  it("SEAT_CAM keeps the tuned values (pitch 0.32 rad, 4.2 m behind — see constants.ts)", () => {
    expect(SEAT_CAM).toEqual({ pitch: 0.32, distance: 4.2 });
  });

  it("beginSeatCamera saves the orbit once and aims the TP goal behind the seat at SEAT_CAM", () => {
    const o = orbit({ yaw: 0.9, pitch: 0.5, distance: 8 });
    beginSeatCamera(o, SEAT_YAW);

    expect(viewState.savedOrbit).toEqual({ yaw: 0.9, pitch: 0.5, distance: 8 });
    expect(viewState.savedOrbit).not.toBe(o); // a copy, not the live orbit
    expect(viewState.orbitGoal).toEqual({
      yaw: recenterYaw(SEAT_YAW),
      pitch: SEAT_CAM.pitch,
      distance: SEAT_CAM.distance,
    });
    expect(o).toEqual({ yaw: 0.9, pitch: 0.5, distance: 8 }); // the glide is CameraRig's job

    // Sitting down again (a second call before standing) keeps the FIRST saved orbit.
    o.yaw = -1;
    o.pitch = SEAT_CAM.pitch;
    o.distance = SEAT_CAM.distance;
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.savedOrbit).toEqual({ yaw: 0.9, pitch: 0.5, distance: 8 });
  });

  it("beginSeatCamera replaces a goal that was already running (R pressed just before sitting)", () => {
    const o = orbit();
    requestRecenter(2);
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.orbitGoal).toEqual({
      yaw: recenterYaw(SEAT_YAW),
      pitch: SEAT_CAM.pitch,
      distance: SEAT_CAM.distance,
    });
  });

  it("the TP goal glides the orbit until the camera sits behind the seat looking at the screen (+X)", () => {
    const o = orbit({ yaw: 2.4, pitch: 0.6, distance: 9 });
    beginSeatCamera(o, SEAT_YAW);
    let frames = 0;
    while (viewState.orbitGoal && !stepOrbitToward(o, viewState.orbitGoal, 1 / 60) && frames < 600) frames++;
    expect(frames).toBeLessThan(600);
    expect(o.pitch).toBeCloseTo(SEAT_CAM.pitch, 6);
    expect(o.distance).toBeCloseTo(SEAT_CAM.distance, 6);
    // "Forward" on the screen is where the camera looks: from behind the seat that is the screen side (+X).
    const look = worldDirection({ forward: 1, right: 0 }, o.yaw);
    expect(look.x).toBeCloseTo(1, 6);
    expect(look.z).toBeCloseTo(0, 6);
  });

  it("endSeatCamera makes the saved orbit the goal and clears it", () => {
    const o = orbit({ yaw: 0.9, pitch: 0.5, distance: 8 });
    beginSeatCamera(o, SEAT_YAW);
    o.yaw = recenterYaw(SEAT_YAW); // pretend the seat glide finished
    o.pitch = SEAT_CAM.pitch;
    o.distance = SEAT_CAM.distance;
    viewState.orbitGoal = null;

    endSeatCamera();
    expect(viewState.orbitGoal).toEqual({ yaw: 0.9, pitch: 0.5, distance: 8 });
    expect(viewState.savedOrbit).toBeNull();

    // The goal really brings the orbit home.
    let frames = 0;
    while (viewState.orbitGoal && !stepOrbitToward(o, viewState.orbitGoal, 1 / 60) && frames < 600) frames++;
    expect(o.yaw).toBeCloseTo(0.9, 6);
    expect(o.pitch).toBeCloseTo(0.5, 6);
    expect(o.distance).toBeCloseTo(8, 6);

    // And the goal is its own copy: nothing links it to the live orbit.
    expect(viewState.savedOrbit).toBeNull();
  });

  it("endSeatCamera with nothing saved changes nothing (a stand that never had a seat camera)", () => {
    requestRecenter(1); // an unrelated goal must survive
    const goal = viewState.orbitGoal;
    endSeatCamera();
    expect(viewState.orbitGoal).toEqual(goal);
    expect(viewState.savedOrbit).toBeNull();
  });

  it("in FP, sitting snaps the look to the screen (+X)", () => {
    const o = orbit({ yaw: 0.4 });
    enterFp(0);
    beginSeatCamera(o, SEAT_YAW);
    const look = worldDirection({ forward: 1, right: 0 }, viewState.fpYaw);
    expect(look.x).toBeCloseTo(1, 6);
    expect(look.z).toBeCloseTo(0, 6);
    expect(viewState.fpYaw).toBeCloseTo(recenterYaw(SEAT_YAW), 6);
    // FP has no TP orbit to glide: no goal, and the orbit is left alone.
    expect(viewState.orbitGoal).toBeNull();
    expect(o).toEqual({ yaw: 0.4, pitch: 0.35, distance: 6 });
    expect(viewState.mode).toBe("fp");
    // The orbit is still saved, so standing up can put its zoom back.
    expect(viewState.savedOrbit).toEqual({ yaw: 0.4, pitch: 0.35, distance: 6 });
  });

  it("standing up in FP clears the saved orbit without a goal, and puts the TP zoom back", () => {
    const o = orbit({ yaw: 0.4, pitch: 0.5, distance: 7 });
    beginSeatCamera(o, SEAT_YAW); // sat in TP: goal toward the seat view
    o.pitch = SEAT_CAM.pitch; // ...which finished
    o.distance = SEAT_CAM.distance;
    viewState.orbitGoal = null;
    toggleViewMode(o); // V → FP while seated (look seeded from the seat view)
    expect(viewState.orbitGoal).toBeNull();

    endSeatCamera(o);
    expect(viewState.orbitGoal).toBeNull(); // no TP glide behind the FP view
    expect(viewState.savedOrbit).toBeNull();
    expect(o.pitch).toBe(0.5); // the zoom the player had before sitting
    expect(o.distance).toBe(7);

    // Back in TP later: same zoom as before sitting, looking where FP looked.
    toggleViewMode(o);
    expect(viewState.mode).toBe("tp");
    expect(o.distance).toBe(7);
  });

  it("over the overview the seat camera follows the mode underneath", () => {
    // Overview opened from TP: the orbit goal still glides behind the map.
    const o = orbit({ yaw: 1 });
    toggleOverview();
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.orbitGoal).toEqual({
      yaw: recenterYaw(SEAT_YAW),
      pitch: SEAT_CAM.pitch,
      distance: SEAT_CAM.distance,
    });
    endSeatCamera();
    expect(viewState.orbitGoal).toEqual({ yaw: 1, pitch: 0.35, distance: 6 });

    // Overview opened from FP: the FP look snaps, no TP goal.
    resetViewMode();
    const p = orbit({ yaw: 1 });
    toggleViewMode(p); // FP
    toggleOverview(); // overview over FP
    beginSeatCamera(p, SEAT_YAW);
    expect(viewState.orbitGoal).toBeNull();
    expect(viewState.fpYaw).toBeCloseTo(recenterYaw(SEAT_YAW), 6);
    endSeatCamera(p);
    expect(viewState.orbitGoal).toBeNull();
    expect(viewState.savedOrbit).toBeNull();
  });

  it("sitting again while the stand-up restore glide is still running keeps the ORIGINAL orbit", () => {
    const o = orbit({ yaw: 0.9, pitch: 0.5, distance: 8 });
    const home = { yaw: 0.9, pitch: 0.5, distance: 8 };
    beginSeatCamera(o, SEAT_YAW);
    // The seat glide finishes…
    while (viewState.orbitGoal && !stepOrbitToward(o, viewState.orbitGoal, 1 / 60)) {
      /* glide */
    }
    viewState.orbitGoal = null;
    // …the player stands, and the restore glide gets only part of the way home…
    endSeatCamera();
    const restore = viewState.orbitGoal;
    expect(restore).not.toBeNull();
    for (let i = 0; i < 4; i++) stepOrbitToward(o, restore ?? {}, 1 / 60);
    expect(viewState.orbitGoal).toBe(restore); // still running (nothing has dropped it)
    expect(o).not.toEqual(home); // mid-glide
    // …and they sit down again at once: the saved orbit is the one being restored, not the mid-glide one.
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.savedOrbit).toEqual(home);
    expect(viewState.orbitGoal).toEqual({
      yaw: recenterYaw(SEAT_YAW),
      pitch: SEAT_CAM.pitch,
      distance: SEAT_CAM.distance,
    });
    // Standing up once more still goes all the way home.
    endSeatCamera();
    expect(viewState.orbitGoal).toEqual(home);
  });

  it("a finished, cancelled or replaced restore glide is not mistaken for a running one", () => {
    const home = { yaw: 0.9, pitch: 0.5, distance: 8 };
    // Finished (CameraRig drops the goal on arrival): the orbit IS home, so the current orbit is saved.
    let o = orbit({ ...home });
    beginSeatCamera(o, SEAT_YAW);
    endSeatCamera();
    viewState.orbitGoal = null; // arrived
    o.yaw = 0.2; // (the player has since turned the camera)
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.savedOrbit).toEqual({ yaw: 0.2, pitch: 0.5, distance: 8 });

    // Cancelled by a drag: the player took the camera, so what they left is what gets saved.
    resetViewMode();
    o = orbit({ ...home });
    beginSeatCamera(o, SEAT_YAW);
    endSeatCamera();
    cancelOrbitGoal();
    o.yaw = -0.4;
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.savedOrbit).toEqual({ yaw: -0.4, pitch: 0.5, distance: 8 });

    // Replaced by R: a different goal, so the current orbit is saved.
    resetViewMode();
    o = orbit({ ...home });
    beginSeatCamera(o, SEAT_YAW);
    endSeatCamera();
    requestRecenter(1);
    o.yaw = 0.1;
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.savedOrbit).toEqual({ yaw: 0.1, pitch: 0.5, distance: 8 });

    // A reset forgets the restore goal too.
    resetViewMode();
    o = orbit({ ...home });
    beginSeatCamera(o, SEAT_YAW);
    endSeatCamera();
    const staleGoal = viewState.orbitGoal;
    resetViewMode();
    viewState.orbitGoal = staleGoal; // even if that very goal object turns up again, it is not a running restore
    o.yaw = 1.5;
    beginSeatCamera(o, SEAT_YAW);
    expect(viewState.savedOrbit).toEqual({ yaw: 1.5, pitch: 0.5, distance: 8 });
  });

  it("the order matters: FP entry clears a goal, so the seat goal is set after it", () => {
    const o = orbit();
    toggleViewMode(o); // → FP
    toggleViewMode(o); // → TP again
    beginSeatCamera(o, SEAT_YAW); // goal set after the toggles → survives
    expect(viewState.orbitGoal).not.toBeNull();
    toggleViewMode(o); // entering FP afterwards drops it, by design
    expect(viewState.orbitGoal).toBeNull();
  });
});

describe("viewState — no overview inside a building (케이슨 마을 Task 5)", () => {
  afterEach(() => setActiveMap(LEGACY_ACTIVE_MAP));

  it("the toggle (M key and the map button) is refused in the memorial hall: nothing changes", () => {
    setActiveMap(HALL_ACTIVE_MAP);
    toggleOverview();
    expect(viewState.mode).toBe("tp");
    expect(useViewStore.getState().isOv).toBe(false);
    enterOverview();
    expect(viewState.mode).toBe("tp");
    expect(viewState.ovBlend).toBe(0);
    stepOvBlend(OV_BLEND_SEC);
    expect(viewState.ovBlend).toBe(0);
  });

  it("a refused enter from first-person leaves first-person alone, with nothing remembered", () => {
    setActiveMap(HALL_ACTIVE_MAP);
    toggleViewMode(orbit()); // → FP
    toggleOverview();
    expect(viewState.mode).toBe("fp");
    expect(useViewStore.getState().isFp).toBe(true);
    expect(useViewStore.getState().isOv).toBe(false);
  });

  it("the village (no camera limit), the legacy world and the maze keep their overview", () => {
    for (const map of [VILLAGE_ACTIVE_MAP, LEGACY_ACTIVE_MAP]) {
      setActiveMap(map);
      toggleOverview();
      expect(viewState.mode).toBe("ov");
      toggleOverview();
      expect(viewState.mode).toBe("tp");
    }
  });

  it("walking in through the door while the map is open: dropOverview leaves it AT ONCE (no blend left to swoop)", () => {
    setActiveMap(VILLAGE_ACTIVE_MAP);
    toggleViewMode(orbit()); // → FP
    toggleOverview(); // open the map from FP
    stepOvBlend(OV_BLEND_SEC / 2);
    expect(viewState.ovBlend).toBeGreaterThan(0);
    setActiveMap(HALL_ACTIVE_MAP); // the door
    dropOverview();
    expect(viewState.mode).toBe("fp"); // back to what the map was opened from
    expect(viewState.ovBlend).toBe(0);
    expect(useViewStore.getState().isOv).toBe(false);
    expect(useViewStore.getState().isFp).toBe(true);
  });

  it("dropOverview also clears a blend that is still easing out after a normal exit", () => {
    toggleOverview();
    stepOvBlend(OV_BLEND_SEC);
    exitOverview();
    stepOvBlend(OV_BLEND_SEC / 4);
    expect(viewState.ovBlend).toBeGreaterThan(0);
    dropOverview();
    expect(viewState.ovBlend).toBe(0);
  });

  it("dropOverview with no overview open does nothing", () => {
    dropOverview();
    expect(viewState.mode).toBe("tp");
    expect(viewState.ovBlend).toBe(0);
  });
});
