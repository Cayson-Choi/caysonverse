import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Fog, PerspectiveCamera } from "three";
import { WORLD_BOUNDS } from "@caysonverse/shared/constants";
import { CAMERA, FOG_FAR, FOG_NEAR, FP_EYE_HEIGHT, HEAD_HEIGHT } from "./constants";
import { normalizeAngle } from "./yaw";
import { clampFpPitch, easeBlend } from "./viewMode";
import {
  viewState,
  applyZoom,
  stepViewBlend,
  stepOvBlend,
  toggleViewMode,
  toggleOverview,
} from "./viewState";
import {
  overviewFitHeight,
  clampOverviewHeight,
  clampOverviewCenter,
  overviewPanDelta,
} from "./overview";
import { isUiCaptured } from "./uiCapture";
import { aspectDistanceScale } from "./aspectFraming";
import {
  isInMaze,
  stepMazeCapEngage,
  cappedFollowDistance,
  cappedCameraY,
} from "./mazeCamera";
import { cameraProbe } from "./cameraProbe";
import type { Orbit, Pose } from "./types";

interface CameraRigProps {
  pose: Pose;
  orbit: Orbit;
}

/** Follow-distance clamp band shared by the wheel and pinch zoom paths. */
const ZOOM_BAND = { min: CAMERA.minDistance, max: CAMERA.maxDistance } as const;

/**
 * Overview mode IS allowed to bypass the maze anti-peek cap (design 20 —
 * developer decision: easy escape wins over hiding the maze solution). The
 * top-down overview pose is a SEPARATE camera term that never runs through the
 * maze cap, so this switch is documentation + the single line a future "lock the
 * overview inside the maze" feature would flip to re-apply the cap there.
 */
export const OVERVIEW_ALLOWED_IN_MAZE = true;

/** Whole-map framing constants, derived once from WORLD_BOUNDS (no hardcode). */
const MAP_W = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
const MAP_D = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
const MAP_CX = (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2;
const MAP_CZ = (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2;

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
 * All per-frame state lives in the shared `orbit` object and the module `viewState`
 * (both mutated in place) — never React state.
 *
 * On portrait viewports the TP follow distance is scaled up (aspectFraming); the
 * maze zone caps the TP height/distance (mazeCamera). BOTH act only on the TP pose
 * term below, so at full FP (blend 1, TP weight 0) they are inert by construction —
 * the FP eye ignores follow distance entirely and sits well under the maze walls.
 */
export function CameraRig({ pose, orbit }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  // Maze anti-peek cap engagement (0 = off, 1 = fully capped). Lerped in useFrame
  // so entering/leaving the maze eases the cap in/out with no snap. Ref, not state.
  const capEngage = useRef(0);
  // Live whole-map fit height (aspect-dependent) — recomputed each frame, read by
  // the overview wheel/pinch handlers for the zoom ceiling. Ref, not state.
  const fitHeight = useRef(0);
  // Previous frame's mode, to detect the EDGE into overview and seed its camera
  // (distinct from viewState.prevMode, which is the mode overview will restore).
  const lastFrameMode = useRef(viewState.mode);

  // Dev/E2E only: expose the live camera (the maze cap is not reflected in
  // orbit.distance, and the FP look yaw lives outside orbit). Tree-shaken in prod.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCamera = () => ({ ...cameraProbe });
    return () => {
      delete window.__cvCamera;
    };
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchPrev = 0; // previous two-finger spread (px); 0 while not pinching

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events may have no active pointer; capture is best-effort
      }
      if (pointers.size === 2) pinchPrev = spread(pointers);
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
          const delta = pinchPrev - curr; // fingers together → positive → zoom out
          if (viewState.mode === "ov") {
            viewState.ovHeight = clampOverviewHeight(
              viewState.ovHeight + delta * CAMERA.ovPinchSpeed,
              fitHeight.current,
            );
          } else {
            applyZoom(orbit, delta * CAMERA.pinchSpeed, ZOOM_BAND);
          }
        }
        pinchPrev = curr;
        return;
      }
      // Single pointer → drive the ACTIVE view. Overview: PAN the centre (grab-
      // style, clamped to the world). FP: rotate the separate fp yaw/pitch (wider
      // clamp) AND flag the drag so the look-follow pauses. TP: rotate the orbit.
      if (viewState.mode === "ov") {
        const cam = camera as PerspectiveCamera;
        const fovRad = (cam.fov * Math.PI) / 180;
        const vpH = gl.domElement.clientHeight || 1;
        const pan = overviewPanDelta(dx, dy, viewState.ovHeight, fovRad, vpH);
        const c = clampOverviewCenter(
          viewState.ovCenterX + pan.dx,
          viewState.ovCenterZ + pan.dz,
          WORLD_BOUNDS,
        );
        viewState.ovCenterX = c.x;
        viewState.ovCenterZ = c.z;
      } else if (viewState.mode === "fp") {
        viewState.fpYaw = normalizeAngle(viewState.fpYaw - dx * CAMERA.dragSpeed);
        viewState.fpPitch = clampFpPitch(viewState.fpPitch + dy * CAMERA.dragSpeed);
        viewState.dragging = true; // drag look-control → pause the auto-follow
      } else {
        orbit.yaw = normalizeAngle(orbit.yaw - dx * CAMERA.dragSpeed);
        orbit.pitch = clamp(orbit.pitch + dy * CAMERA.dragSpeed, CAMERA.minPitch, CAMERA.maxPitch);
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchPrev = 0;
      // Last pointer released → the FP look-follow may resume.
      if (pointers.size === 0) viewState.dragging = false;
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
      applyZoom(orbit, e.deltaY * CAMERA.zoomSpeed, ZOOM_BAND);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isUiCaptured()) return; // typing in chat must never toggle the view
      if (e.repeat) return; // one toggle per physical press (no auto-repeat)
      if (e.code === "KeyV") {
        if (viewState.mode === "ov") return; // V / zoom-through are ignored in overview
        toggleViewMode(orbit);
      } else if (e.code === "KeyM") {
        toggleOverview(); // M toggles overview (and is the ONLY way out of it)
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gl, orbit, camera]);

  useFrame((state, delta) => {
    // Advance BOTH blend machines, then ease them. `t` = TP<->FP weight (the pose
    // UNDER the overview), `ovT` = overview weight on top.
    const t = easeBlend(stepViewBlend(delta));
    const ovT = easeBlend(stepOvBlend(delta));

    const cam = camera as PerspectiveCamera;
    const aspect = cam.aspect;
    // Whole-map fit height for the current aspect — seeds the overview and bounds
    // its zoom-out. Recomputed each frame so a viewport resize keeps the ceiling
    // honest (design 20 — nothing hardcoded).
    fitHeight.current = overviewFitHeight(MAP_W, MAP_D, (cam.fov * Math.PI) / 180, aspect);

    // On the EDGE into overview, frame the whole map: centre it and seed the fit
    // height. Re-entering re-centres (a fresh overview each time — YAGNI-simple).
    if (lastFrameMode.current !== "ov" && viewState.mode === "ov") {
      viewState.ovCenterX = MAP_CX;
      viewState.ovCenterZ = MAP_CZ;
      viewState.ovHeight = fitHeight.current;
    }
    lastFrameMode.current = viewState.mode;

    // ── Third-person pose ── `orbit.distance` stays the user's zoom intent; the
    // portrait pull-back and the maze cap apply ONLY here, so they never touch the
    // FP eye. Maze cap: ease engagement toward 1 inside the zone, then clamp both
    // the effective distance and the final height so no pitch/aspect lifts the
    // camera over the walls.
    const engage = stepMazeCapEngage(capEngage.current, isInMaze(pose.x, pose.z), delta);
    capEngage.current = engage;
    const distance = cappedFollowDistance(orbit.distance * aspectDistanceScale(aspect), engage);
    const horiz = distance * Math.cos(orbit.pitch);
    const height = distance * Math.sin(orbit.pitch);
    const tpX = pose.x + horiz * Math.sin(orbit.yaw);
    const tpY = cappedCameraY(HEAD_HEIGHT + height, engage);
    const tpZ = pose.z + horiz * Math.cos(orbit.yaw);

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
    const uPosY = lerp(tpY, FP_EYE_HEIGHT, t);
    const uPosZ = lerp(tpZ, pose.z, t);
    const uTgtX = lerp(pose.x, pose.x + fwdX, t);
    const uTgtY = lerp(HEAD_HEIGHT, FP_EYE_HEIGHT + fwdY, t);
    const uTgtZ = lerp(pose.z, pose.z + fwdZ, t);

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
      fog.near = lerp(FOG_NEAR, Math.max(FOG_NEAR, h * 0.6), ovT);
      fog.far = lerp(FOG_FAR, Math.max(FOG_FAR, h * 2.2), ovT);
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
  });

  return null;
}
