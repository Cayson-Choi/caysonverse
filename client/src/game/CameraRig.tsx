import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { Raycaster, Vector2 } from "three";
import type { Fog, PerspectiveCamera } from "three";
import { CAMERA, CAMERA_FAR, FOG_FAR, FOG_NEAR, FP_EYE_HEIGHT, HEAD_HEIGHT } from "./constants";
import type { MoveControl } from "./constants";
import { normalizeAngle } from "./yaw";
import { clampFpPitch, easeBlend } from "./viewMode";
import {
  viewState,
  applyZoom,
  stepViewBlend,
  stepOvBlend,
  toggleViewMode,
  toggleOverview,
  dropOverview,
  requestRecenter,
  cancelOrbitGoal,
} from "./viewState";
import {
  overviewFar,
  overviewFitHeight,
  clampOverviewHeight,
  clampOverviewCenter,
  overviewPanDelta,
} from "./overview";
import { onHotkey } from "./hotkeys";
import { isUiCaptured } from "./uiCapture";
import {
  CAMERA_LOOK_LIFT,
  ZOOM_BAND,
  pinchZoomDelta,
  recenterYaw,
  smoothToward,
  stepFollow,
  stepKeyYaw,
  stepOrbitToward,
} from "./cameraControls";
import { DOUBLE_TAP_MS, canTapWalk, isDoubleTap, isLookHalf } from "./tapGesture";
import type { TapRecord } from "./tapGesture";
import {
  DRAG_SIGN,
  isClick,
  groundPoint,
  setClickTarget,
  getClickTarget,
  clearClickTarget,
} from "./clickMove";
import { aspectDistanceScale } from "./aspectFraming";
import { MAZE_CAMERA_LIMIT, cameraLimitAt, stepMazeCapEngage } from "./mazeCamera";
import {
  indoorCameraClamp,
  limitedDistance,
  limitsDiffer,
  overviewAllowed,
  type CameraLimit,
  type Vec3,
} from "./indoorCamera";
import {
  ARM_FREE,
  SEAT_ARM,
  armHeightScale,
  armLookLift,
  springArmDistance,
  stepArmLimit,
} from "./cameraCollision";
import { cameraProbe } from "./cameraProbe";
import { activeBounds, getActiveMap } from "./activeMap";
import { getLocalLift } from "./jump";
import { useSettingsStore } from "../stores/settingsStore";
import type { Orbit, Pose, SeatState } from "./types";

interface CameraRigProps {
  pose: Pose;
  orbit: Orbit;
  /** The local player's server-confirmed seat (read, never written): a held-back tap-walk checks it. */
  seat: SeatState;
  /**
   * The scene's fog band [near, far] (m): where the overview's fog push-out starts from and
   * returns to. Defaults to the legacy world's FOG_NEAR / FOG_FAR.
   */
  fogRange?: readonly [number, number];
  /**
   * The scene's far plane (m) outside the overview (default CAMERA_FAR). 케이슨 마을 draws its sky dome and far
   * mountains out to 1.4 km and passes a far plane past them (VillageScene).
   */
  far?: number;
}

const LEGACY_FOG: readonly [number, number] = [FOG_NEAR, FOG_FAR];

/** Longest frame (s) a held Z / C may turn the view for — a stalled tab can't spin it. */
const MAX_KEY_TURN_DT = 0.1;

/**
 * Overview mode IS allowed to bypass the maze anti-peek cap (design 20 —
 * developer decision: easy escape wins over hiding the maze solution). The
 * top-down overview pose is a SEPARATE camera term that never runs through the
 * maze cap, so this switch is documentation + the single line a future "lock the
 * overview inside the maze" feature would flip to re-apply the cap there.
 */
export const OVERVIEW_ALLOWED_IN_MAZE = true;

/**
 * Scratch points for the camera limit (indoorCamera.ts), made once and rewritten every frame — the clamp
 * allocates nothing. `wantedSpot` is where the camera would sit with no limit, `headSpot` the player's head,
 * `limitedSpot` what the limit leaves of it.
 */
const wantedSpot: Vec3 = { x: 0, y: 0, z: 0 };
const headSpot: Vec3 = { x: 0, y: 0, z: 0 };
const limitedSpot: Vec3 = { x: 0, y: 0, z: 0 };

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pixel distance between the first two active pointers (0 if fewer than two). */
function spread(pointers: Map<number, { x: number; y: number }>): number {
  const values = pointers.values();
  const a = values.next().value;
  const b = values.next().value;
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The ONE follow rig, TWO modes, ONE blend (design 19).
 *
 * Third-person: orbits the player at (orbit.yaw, orbit.pitch, orbit.distance) —
 * one pointer drags to rotate, the wheel/pinch zoom. First-person: the camera
 * sits at the player's eye (FP_EYE_HEIGHT) and the SAME drag handlers rotate a
 * separate fp yaw/pitch (wider pitch clamp). A 0..1 `viewState.blend` eased over
 * ~0.25s interpolates the camera pose between the two on every toggle, so there is
 * no teleport-cut. Four toggle paths reach this rig: the `V` key (guarded by
 * uiCapture so chat typing never toggles), a wheel notch past minDistance, an
 * equivalent pinch, and the 👁 touch button (WorldScene → toggleViewMode).
 *
 * Pointer input (design 29): both look-drags (TP orbit, FP look) consume their
 * deltas through DRAG_SIGN — the single inversion switch — while the overview
 * pan and pinch zoom stay untouched. A press that ends within isClick's px/ms
 * budget is a floor CLICK instead: raycast to y=0 and handed to clickMove as
 * the auto-move target (LocalPlayer steers; overview clicks are ignored). A touch
 * tap on the LOOK half of the screen waits DOUBLE_TAP_MS for a second tap: one tap
 * walks there, two taps swing the camera back behind the body (requestRecenter).
 * Mouse clicks and taps on the stick half walk at once.
 *
 * The camera never turns by itself. The TP orbit yaw changes only by a drag, the
 * held Z / C keys, or `viewState.orbitGoal` (R, double tap, sitting down, standing
 * up) — which any drag / wheel / pinch / Z / C cancels. The view also eases: the TP
 * follow point trails the body (stepFollow) and the follow DISTANCE glides to the
 * zoom intent (smoothToward), so footsteps and wheel notches never jolt the picture.
 *
 * Spring arm: a wall between the head and the wanted TP camera spot pulls the camera
 * in front of it (cameraCollision) — at once on the way in, eased on the way out.
 * Like the portrait pull-back and the maze cap it shapes ONLY the TP pose term.
 *
 * All per-frame state lives in the shared `orbit` object and the module `viewState`
 * (both mutated in place) — never React state.
 *
 * On portrait viewports the TP follow distance is scaled up (aspectFraming); the
 * maze zone caps the TP height/distance (mazeCamera). BOTH act only on the TP pose
 * term below, so at full FP (blend 1, TP weight 0) they are inert by construction —
 * the FP eye ignores follow distance entirely and sits well under the maze walls.
 */
export function CameraRig({ pose, orbit, seat, fogRange = LEGACY_FOG, far: baseFar = CAMERA_FAR }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  // Camera-limit engagement (0 = off, 1 = fully limited): the maze's anti-peek cap, or a building's ceiling limit.
  // Lerped in useFrame so entering/leaving the maze eases the cap in/out with no snap; a building's limit is
  // engaged at once (the door's curtain hides the cut). A scene that mounts inside a building starts engaged.
  // Ref, not state.
  const capEngage = useRef(getActiveMap().cameraLimit ? 1 : 0);
  // The limit capEngage is blending: the building's, or the maze's. Kept after the player leaves the maze, so the
  // cap eases OUT with the same numbers it eased in with.
  const limitRef = useRef<CameraLimit>(getActiveMap().cameraLimit ?? MAZE_CAMERA_LIMIT);
  // The map's camera limit as of the last frame: a different one is a door into or out of a building.
  const lastAreaLimit = useRef(getActiveMap().cameraLimit);
  // Live whole-map fit height (aspect-dependent) — recomputed each frame, read by
  // the overview wheel/pinch handlers for the zoom ceiling. Ref, not state.
  const fitHeight = useRef(0);
  // Previous frame's mode, to detect the EDGE into overview and seed its camera
  // (distinct from viewState.prevMode, which is the mode overview will restore).
  const lastFrameMode = useRef(viewState.mode);
  // The rectangle the overview was last framed for: a different one (a door in 케이슨 마을) re-frames an open overview.
  const lastBounds = useRef(activeBounds());
  // Z / C are registered in the shared KeyboardControls map; read their live state.
  const [, getKeys] = useKeyboardControls<MoveControl>();
  // Smoothed TP follow point (trails the body) and smoothed follow distance (glides
  // to the zoom intent). Refs, mutated in place per frame — never React state.
  const follow = useRef({ x: pose.x, z: pose.z });
  const renderDist = useRef(orbit.distance);
  // Spring-arm limit (m): snaps in when a wall is in the way, eases back out at
  // SPRING.returnRate, and sits at ARM_FREE (no limit) in the open.
  const armLimit = useRef(ARM_FREE);
  // Eased 0..1 "seated" factor for the shortened-arm shaping below (0 standing, 1 seated).
  const seatBlend = useRef(0);

  // Dev/E2E only: expose the live camera (the maze cap is not reflected in
  // orbit.distance, and the FP look yaw lives outside orbit). Tree-shaken in prod.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCamera = () => ({ ...cameraProbe });
    // The live click-move target (design 29) — lets the E2E assert retarget /
    // stuck-release without inferring it from position traces alone.
    window.__cvClickTarget = () => getClickTarget();
    return () => {
      delete window.__cvCamera;
      delete window.__cvClickTarget;
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchPrev = 0; // previous two-finger spread (px); 0 while not pinching
    // Click-move candidate (design 29): the down point/time of a SINGLE primary-
    // button press on the canvas. A second pointer (pinch) or a non-primary
    // button voids it; on release, only a press that passes isClick (< ~6px,
    // < ~400ms) becomes a floor click — anything longer stays a pure look-drag.
    let clickStart: { id: number; x: number; y: number; t: number } | null = null;
    // Reused per mount for the floor raycast (never per event — no GC churn).
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    // Touch double-tap bookkeeping (look half only): the last finished tap, and the
    // single-tap walk that is being held back for DOUBLE_TAP_MS in case a second
    // tap turns it into a recenter. The timer is cleared on a double tap, a pinch
    // and unmount.
    let lastTap: TapRecord | null = null;
    let pendingWalk: ReturnType<typeof setTimeout> | null = null;
    const clearPendingWalk = () => {
      if (pendingWalk !== null) {
        clearTimeout(pendingWalk);
        pendingWalk = null;
      }
    };
    /** Raycast a screen point onto the y=0 floor (null for the sky). */
    const groundAt = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      return groundPoint(o.x, o.y, o.z, d.x, d.y, d.z);
    };

    // The look-drag gain: CAMERA.dragSpeed x the player's sensitivity setting, read
    // when the drag moves (not captured at mount), so changing it in the menu applies
    // to the very next drag.
    const dragSpeed = () => CAMERA.dragSpeed * useSettingsStore.getState().settings.lookSensitivity;

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clickStart =
        e.button === 0 && pointers.size === 1
          ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
          : null;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events may have no active pointer; capture is best-effort
      }
      if (pointers.size === 2) {
        pinchPrev = spread(pointers);
        // A second finger means a pinch, not a double tap: forget the held-back walk.
        clearPendingWalk();
        lastTap = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return; // a move with no prior down (e.g. hovering) — ignore
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size >= 2) {
        // Two fingers → pinch zoom only, never rotate. In overview a pinch zooms
        // the top-down HEIGHT (clamped); otherwise it routes through applyZoom so
        // a pinch past the extremes crosses into/out of FP just like the wheel.
        const curr = spread(pointers);
        if (pinchPrev > 0) {
          if (viewState.mode === "ov") {
            const delta = pinchPrev - curr; // fingers together → positive → zoom out
            viewState.ovHeight = clampOverviewHeight(
              viewState.ovHeight + delta * CAMERA.ovPinchSpeed,
              fitHeight.current,
            );
          } else {
            cancelOrbitGoal(); // the player took the camera back
            applyZoom(orbit, pinchZoomDelta(pinchPrev, curr), ZOOM_BAND);
          }
        }
        pinchPrev = curr;
        return;
      }
      // Single pointer → drive the ACTIVE view. Overview: PAN the centre (grab-
      // style, clamped to the world — design 29 keeps the pan UNinverted, it is
      // "grab the map and drag"). FP: rotate the separate fp yaw/pitch (wider
      // clamp). TP: rotate the orbit.
      // The FP/TP look drags consume their deltas through DRAG_SIGN — the single
      // inversion switch of design 29, both axes, applied nowhere else.
      if (viewState.mode === "ov") {
        const cam = camera as PerspectiveCamera;
        const fovRad = (cam.fov * Math.PI) / 180;
        const vpH = gl.domElement.clientHeight || 1;
        const pan = overviewPanDelta(dx, dy, viewState.ovHeight, fovRad, vpH);
        const c = clampOverviewCenter(
          viewState.ovCenterX + pan.dx,
          viewState.ovCenterZ + pan.dz,
          activeBounds(),
        );
        viewState.ovCenterX = c.x;
        viewState.ovCenterZ = c.z;
      } else if (viewState.mode === "fp") {
        cancelOrbitGoal();
        const gain = dragSpeed();
        viewState.fpYaw = normalizeAngle(viewState.fpYaw - DRAG_SIGN * dx * gain);
        viewState.fpPitch = clampFpPitch(viewState.fpPitch + DRAG_SIGN * dy * gain);
      } else {
        cancelOrbitGoal(); // a drag takes the camera back from any recenter / seat glide
        const gain = dragSpeed();
        orbit.yaw = normalizeAngle(orbit.yaw - DRAG_SIGN * dx * gain);
        orbit.pitch = clamp(
          orbit.pitch + DRAG_SIGN * dy * gain,
          CAMERA.minPitch,
          CAMERA.maxPitch,
        );
      }
    };
    const onUp = (e: PointerEvent) => {
      // Click-move (design 29): a released candidate that stayed a "click"
      // (short + still + not cancelled) raycasts onto the y=0 floor and becomes
      // the auto-move target. Skipped in overview (no overview click-move —
      // YAGNI, documented) and inert for clicks on DOM UI, which never reach
      // these canvas-only down handlers. Runs in TP and FP alike (in FP the walk
      // is camera-relative and never turns the look). The touch stick zone passes
      // its quick taps in as a replayed down + up on this canvas (TouchJoystick),
      // so they take exactly this path — on the stick half, hence at once.
      if (clickStart && clickStart.id === e.pointerId) {
        const start = clickStart;
        clickStart = null;
        if (
          e.type === "pointerup" && // a pointercancel is never a click
          viewState.mode !== "ov" &&
          isClick(e.clientX - start.x, e.clientY - start.y, performance.now() - start.t)
        ) {
          const point = groundAt(e.clientX, e.clientY);
          // Which half is the look half follows the left-handed setting — the SAME store
          // field TouchJoystick's prop comes from (WorldScene), so the stick half and
          // the look half can never overlap or leave a gap.
          const leftHanded = useSettingsStore.getState().settings.leftHanded;
          if (e.pointerType === "touch" && isLookHalf(e.clientX, window.innerWidth, leftHanded)) {
            // Look half: wait for a possible second tap. Two taps recenter the
            // camera; one tap walks after DOUBLE_TAP_MS (measured on the target
            // the finger actually touched, not wherever the camera is by then).
            // The world can change during that wait, so the walk is re-checked
            // when it fires (overview opened, chat took the keyboard, the player
            // sat down meanwhile — see canTapWalk).
            const tap: TapRecord = { t: performance.now(), x: e.clientX, y: e.clientY };
            clearPendingWalk();
            if (isDoubleTap(lastTap, tap)) {
              lastTap = null;
              requestRecenter(pose.yaw);
            } else {
              lastTap = tap;
              if (point) {
                const seatedAtTap = seat.index >= 0;
                pendingWalk = setTimeout(() => {
                  pendingWalk = null;
                  if (canTapWalk(viewState.mode, isUiCaptured(), seatedAtTap, seat.index >= 0)) {
                    setClickTarget(point.x, point.z);
                  }
                }, DOUBLE_TAP_MS);
              }
            }
          } else if (point) {
            setClickTarget(point.x, point.z); // 하늘 클릭은 무시
          }
        }
      }
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchPrev = 0;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may already be released; ignore
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Overview: the wheel zooms the top-down HEIGHT (clamped [15 m, fit×1.1]).
      if (viewState.mode === "ov") {
        viewState.ovHeight = clampOverviewHeight(
          viewState.ovHeight + e.deltaY * CAMERA.ovZoomSpeed,
          fitHeight.current,
        );
        return;
      }
      // deltaY < 0 = zoom in (toward min → one notch past min enters FP);
      // deltaY > 0 = zoom out (an outward notch in FP returns to TP).
      cancelOrbitGoal(); // the player took the camera back
      applyZoom(orbit, e.deltaY * CAMERA.zoomSpeed, ZOOM_BAND);
    };
    // V / M / R / Esc come from the shared hotkey table (hotkeys.ts), which already
    // drops auto-repeat, IME composition and keys typed into a focused chat field.
    const offHotkey = onHotkey((action) => {
      if (action.type === "toggleView") {
        if (viewState.mode === "ov") return; // V / zoom-through are ignored in overview
        toggleViewMode(orbit);
      } else if (action.type === "toggleMap") {
        toggleOverview(); // M toggles overview (and is the ONLY way out of it)
      } else if (action.type === "recenter") {
        requestRecenter(pose.yaw); // R: swing the TP camera back behind the body
      } else if (action.type === "menu") {
        clearClickTarget(); // Esc: stop a click-move in progress (the menu itself is MenuPanel's)
      }
    });

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      offHotkey();
      clearPendingWalk();
    };
  }, [gl, orbit, camera, pose, seat]);

  useFrame((state, delta) => {
    // ── A door into or out of a building (케이슨 마을, indoorCamera.ts) ── the player was just put somewhere else, so
    // the camera does not glide there (it would fly through walls, or over a roof): it is re-seated at once at its
    // limited spot behind the player. The follow point, the zoom glide and the spring arm start fresh, the limit is
    // fully engaged (or released), and the view turns to look the way the player faces. The door's curtain covers it.
    const areaLimit = getActiveMap().cameraLimit;
    if (limitsDiffer(lastAreaLimit.current, areaLimit)) {
      lastAreaLimit.current = areaLimit;
      follow.current.x = pose.x;
      follow.current.z = pose.z;
      renderDist.current = orbit.distance;
      armLimit.current = ARM_FREE;
      capEngage.current = areaLimit ? 1 : 0;
      orbit.yaw = recenterYaw(pose.yaw);
      viewState.fpYaw = orbit.yaw; // the same view in first person (as when a seat turns it)
      cancelOrbitGoal();
    }
    // No overview where the map says so (inside a building): an open one is dropped at once, not eased out.
    if (!overviewAllowed(areaLimit) && (viewState.mode === "ov" || viewState.ovBlend > 0)) dropOverview();

    // ── Who turns the view? Only the player (drag, Z / C) and an orbit goal. ──
    // Z / C turn the active view while held — the TP orbit, or the FP look yaw — but
    // never while a text field owns the keyboard (typing "zc" must not spin the
    // camera). A TP press also takes the camera back from any running goal.
    if (!isUiCaptured() && (viewState.mode === "tp" || viewState.mode === "fp")) {
      const keys = getKeys();
      if (keys.camLeft || keys.camRight) {
        const turnDt = Math.min(delta, MAX_KEY_TURN_DT);
        if (viewState.mode === "fp") {
          viewState.fpYaw = stepKeyYaw(viewState.fpYaw, keys.camLeft, keys.camRight, turnDt);
        } else {
          cancelOrbitGoal();
          orbit.yaw = stepKeyYaw(orbit.yaw, keys.camLeft, keys.camRight, turnDt);
        }
      }
    }
    // A pending goal (R, double tap, sitting down) glides the orbit; done → dropped.
    const goal = viewState.orbitGoal;
    if (goal && stepOrbitToward(orbit, goal, delta)) viewState.orbitGoal = null;

    // The follow point trails the body; the follow distance glides to the zoom
    // intent. FP ignores both (its eye sits on the pose), but they keep tracking so
    // leaving FP never jumps.
    stepFollow(follow.current, pose.x, pose.z, delta);
    renderDist.current = smoothToward(renderDist.current, orbit.distance, delta);
    const followX = follow.current.x;
    const followZ = follow.current.z;

    // Advance BOTH blend machines, then ease them. `t` = TP<->FP weight (the pose
    // UNDER the overview), `ovT` = overview weight on top.
    const t = easeBlend(stepViewBlend(delta));
    const ovT = easeBlend(stepOvBlend(delta));

    const cam = camera as PerspectiveCamera;
    const aspect = cam.aspect;
    // Whole-map fit height for the current aspect — seeds the overview and bounds
    // its zoom-out. Recomputed each frame so a viewport resize keeps the ceiling
    // honest (design 20 — nothing hardcoded).
    // The whole map is the ACTIVE map (activeMap.ts): its bounds (the area the player is in, in 케이슨 마을), read
    // as plain numbers.
    const mapBounds = activeBounds();
    fitHeight.current = overviewFitHeight(
      mapBounds.maxX - mapBounds.minX,
      mapBounds.maxZ - mapBounds.minZ,
      (cam.fov * Math.PI) / 180,
      aspect,
    );

    // On the EDGE into overview, frame the whole map: centre it and seed the fit
    // height. Re-entering re-centres (a fresh overview each time — YAGNI-simple).
    const prev = lastBounds.current;
    const mapChanged =
      prev.minX !== mapBounds.minX || prev.maxX !== mapBounds.maxX || prev.minZ !== mapBounds.minZ || prev.maxZ !== mapBounds.maxZ;
    lastBounds.current = mapBounds;
    if ((lastFrameMode.current !== "ov" || mapChanged) && viewState.mode === "ov") {
      viewState.ovCenterX = (mapBounds.minX + mapBounds.maxX) / 2;
      viewState.ovCenterZ = (mapBounds.minZ + mapBounds.maxZ) / 2;
      viewState.ovHeight = fitHeight.current;
    }
    lastFrameMode.current = viewState.mode;

    // ── Third-person pose ── `orbit.distance` stays the user's zoom intent; the
    // portrait pull-back and the camera limit apply ONLY here, so they never touch the
    // FP eye. The limit is a building's ceiling limit (the active map's) or, in the legacy
    // world, the maze's anti-peek cap: ease engagement toward 1 inside, then clamp both
    // the effective distance and the final height (indoorCameraClamp) so no pitch/aspect
    // lifts the camera over the walls or through the roof.
    const limitNow = cameraLimitAt(getActiveMap(), pose.x, pose.z);
    if (limitNow) limitRef.current = limitNow;
    const engage = stepMazeCapEngage(capEngage.current, limitNow !== undefined, delta);
    capEngage.current = engage;
    const wantedDistance = renderDist.current * aspectDistanceScale(aspect);
    const distance = limitedDistance(wantedDistance, limitRef.current, engage);
    const wantedHoriz = wantedDistance * Math.cos(orbit.pitch);
    let tpX = followX + wantedHoriz * Math.sin(orbit.yaw);
    let tpY = HEAD_HEIGHT + wantedDistance * Math.sin(orbit.pitch);
    let tpZ = followZ + wantedHoriz * Math.cos(orbit.yaw);
    if (engage > 0) {
      wantedSpot.x = tpX;
      wantedSpot.y = tpY;
      wantedSpot.z = tpZ;
      headSpot.x = followX;
      headSpot.y = HEAD_HEIGHT;
      headSpot.z = followZ;
      indoorCameraClamp(wantedSpot, headSpot, limitRef.current, engage, limitedSpot);
      tpX = limitedSpot.x;
      tpY = limitedSpot.y;
      tpZ = limitedSpot.z;
    }

    // Spring arm: cast head → wanted camera spot against the walls and, when one is
    // in the way, shorten the arm (scale the offset from the head) to just in front of
    // it. Seated, only the horizontal offset shrinks: the camera keeps its height and
    // the look target rises (armLookLift), so a seat close to a wall — the front row —
    // still shows the screen instead of the back of the head. Skipped at full FP
    // weight, where the TP term is not drawn; the limit is reset there so coming back
    // out of FP starts with a free arm.
    let tpLookLift = 0;
    seatBlend.current = smoothToward(
      seatBlend.current,
      seat.index >= 0 ? 1 : 0,
      delta,
      SEAT_ARM.blendRate,
    );
    if (t < 1) {
      const offX = tpX - followX;
      const offY = tpY - HEAD_HEIGHT;
      const offZ = tpZ - followZ;
      const reach = Math.sqrt(offX * offX + offY * offY + offZ * offZ);
      if (reach > 1e-6) {
        const clear = springArmDistance(followX, HEAD_HEIGHT, followZ, tpX, tpY, tpZ, reach);
        armLimit.current = stepArmLimit(armLimit.current, clear, reach, delta);
        if (armLimit.current < reach) {
          const k = armLimit.current / reach;
          tpX = followX + offX * k;
          tpY = HEAD_HEIGHT + offY * armHeightScale(k, seatBlend.current);
          tpZ = followZ + offZ * k;
          tpLookLift = armLookLift(k, seatBlend.current);
        }
      }
    } else {
      armLimit.current = ARM_FREE;
    }

    // ── First-person pose ── camera at the eye; look along the fp yaw/pitch. The
    // horizontal forward (-sin, -cos) matches worldDirection's convention, so
    // walking "forward" in FP tracks exactly where the view points.
    const cosP = Math.cos(viewState.fpPitch);
    const fwdX = -Math.sin(viewState.fpYaw) * cosP;
    const fwdY = -Math.sin(viewState.fpPitch);
    const fwdZ = -Math.cos(viewState.fpYaw) * cosP;

    // ── Underlying pose (tp<->fp, no teleport-cut) — the base the overview lifts
    // FROM and settles BACK TO. ──
    const uPosX = lerp(tpX, pose.x, t);
    // Own hop (jump.ts): the first-person eye and look target rise with the avatar's
    // display-only lift, weighted by the FP blend — the own body is hidden there, so
    // without this a Space press would show nothing. TP (t = 0) is untouched.
    const hop = getLocalLift();
    const uPosY = lerp(tpY, FP_EYE_HEIGHT + hop, t);
    const uPosZ = lerp(tpZ, pose.z, t);
    // TP looks at the (smoothed) follow point, a little above the head; FP at the
    // pose-anchored eye line.
    const uTgtX = lerp(followX, pose.x + fwdX, t);
    const uTgtY = lerp(HEAD_HEIGHT + CAMERA_LOOK_LIFT + tpLookLift, FP_EYE_HEIGHT + hop + fwdY, t);
    const uTgtZ = lerp(followZ, pose.z + fwdZ, t);

    // ── Overview pose ── straight up over the pan-centre, looking down. The maze
    // cap is bypassed here by construction (this is a separate pose term, never
    // routed through cappedCameraY — see OVERVIEW_ALLOWED_IN_MAZE). ──
    const ovPosX = viewState.ovCenterX;
    const ovPosY = viewState.ovHeight;
    const ovPosZ = viewState.ovCenterZ;

    // ── Compose: blend underlying ↔ overview by ovT. The up-vector also eases from
    // +Y to -Z so the top-down frame reads screen-up = north (-Z), right = east
    // (+X); only exactly overhead (ovT=1) is up perpendicular to the view, so the
    // lerped position is never gimbal-degenerate during the transition. ──
    camera.position.set(
      lerp(uPosX, ovPosX, ovT),
      lerp(uPosY, ovPosY, ovT),
      lerp(uPosZ, ovPosZ, ovT),
    );
    camera.up.set(0, 1 - ovT, -ovT);
    camera.lookAt(
      lerp(uTgtX, ovPosX, ovT),
      lerp(uTgtY, 0, ovT),
      lerp(uTgtZ, ovPosZ, ovT),
    );

    // Overview looks down from far above; push the fog band out (eased by ovT) so
    // the whole map reads crisply instead of hazing into the sky. Restored exactly
    // to FOG_NEAR/FOG_FAR at ovT = 0.
    const fog = state.scene.fog as Fog | null;
    if (fog && (fog as { isFog?: boolean }).isFog) {
      const h = viewState.ovHeight;
      const fogNear = fogRange[0]; // index reads, not destructuring: nothing allocated per frame
      const fogFar = fogRange[1];
      fog.near = lerp(fogNear, Math.max(fogNear, h * 0.6), ovT);
      fog.far = lerp(fogFar, Math.max(fogFar, h * 2.2), ovT);
    }

    // The far plane rides with the overview too: the whole-map fit height is width-limited
    // on a tall phone (209 m at 375×812), past CAMERA_FAR, and the map would be clipped
    // away entirely. Continuous in ovT, and restored exactly to the scene's far plane at 0.
    const far = overviewFar(baseFar, viewState.ovHeight, ovT);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }

    // Publish the live camera for the dev/E2E hook.
    cameraProbe.x = camera.position.x;
    cameraProbe.y = camera.position.y;
    cameraProbe.z = camera.position.z;
    cameraProbe.distance = distance;
    cameraProbe.mode = viewState.mode;
    cameraProbe.blend = viewState.blend;
    cameraProbe.fpYaw = viewState.fpYaw;
    cameraProbe.ovBlend = viewState.ovBlend;
    cameraProbe.far = cam.far;
  });

  return null;
}
