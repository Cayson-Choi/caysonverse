import { useEffect, useRef, useState } from "react";
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
import { CAMERA_LOOK_LIFT, ZOOM_BAND, pinchZoomDelta, stepKeyYaw, stepOrbitToward } from "./cameraControls";
import { DOUBLE_TAP_MS, canTapWalk, isDoubleTap, isLookHalf } from "./tapGesture";
import type { TapRecord } from "./tapGesture";
import {
  DRAG_SIGN,
  CLICK_MAX_PX,
  TAP_MAX_PX,
  isClick,
  pressTravel,
  setClickTarget,
  getClickTarget,
  clearClickTarget,
  setPendingClick,
  peekPendingClick,
  clearPendingClick,
} from "./clickMove";
import { asSurface, faceIsTall, pickSurface, ringView, surfaceHeightAt, warmPick, type ScenePick } from "./clickPick";
import {
  RING_SEEN_AT_CLICK,
  RING_SEEN_MOVED,
  WALKABLE_MAX_Y,
  WALKABLE_MIN_NY,
  clickIntent,
  planClickMove,
  requireSeen,
  walkStart,
  type ClickPlan,
  type RingView,
} from "./clickPlan";
import { ringLift, ringScreenScale } from "./clickRing";
import type { GroundDecal } from "./groundDecal";
import { overviewAllowed } from "./indoorCamera";
import { createFollowRig, createFollowSpot, noteAreaLimit, stepFollowRig } from "./followRig";
import { rememberOrbit, restoreOrbit } from "./cameraMemory";
import { cameraProbe } from "./cameraProbe";
import { activeBounds, activeSeats, getActiveMap } from "./activeMap";
import { localGlide } from "./seatMotion";
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
  /**
   * The scene's ground decals (PlayShell's; null: the defaults): the destination ring lies at their height above the
   * clicked surface (ClickMarker), so a click's ring is judged for being seen there (clickPlan.ts rule 4).
   */
  decal?: GroundDecal | null;
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

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Dev/E2E only (`window.__cvClickPick`): the last click — what it landed on, the plan made of it, how its ring would look (`view`; and `unseen`, the
 * plan rule 4 refused) and the ms the pick and the plan took together.
 */
let lastClickPick: { pick: ScenePick | null; plan: ClickPlan; view: RingView | null; unseen: ClickPlan | null; ms: number } | null = null;

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
 * budget (a finger gets TAP_MAX_PX) is a CLICK instead: the first visible surface
 * under it (clickPick.ts) is planned into a destination (clickPlan.ts — ground
 * only, clear of the colliders, where the walk really ends) and handed to clickMove
 * as the auto-move target (LocalPlayer steers; overview clicks are ignored); a
 * click on anything else does nothing. A touch tap on the LOOK half of the screen
 * waits DOUBLE_TAP_MS for a second tap, its ring already showing: one tap walks
 * there, two taps swing the camera back behind the body (requestRecenter). Mouse
 * clicks and taps on the stick half walk at once.
 *
 * The camera never moves by itself (owner 2026-11-10: "자동으로 바뀌니까 헷갈려"). The TP
 * orbit yaw changes only by a drag, the held Z / C keys, or `viewState.orbitGoal` (R,
 * double tap — the player asking for it), which any drag / wheel / pinch / Z / C cancels;
 * the pitch only by a drag; the zoom only by the wheel or a pinch. Walking, running,
 * stopping, turning, doors, sitting, standing, interactions, closing a card or a respawn
 * change none of them. The zoom and tilt the player chose are remembered for the visit
 * and across reloads (cameraMemory.ts): restored when the rig mounts — a new scene, a
 * reconnect, a reload, another experience — and written back after each wheel notch and
 * at the end of each drag or pinch. (A new scene's yaw starts as the scene sets it: a
 * direction on one map means nothing on another.)
 *
 * The TP pose is the follow rig's (followRig.ts): the camera rides rigidly with the body,
 * the follow DISTANCE glides to a new zoom and then holds it, and the place's ceiling
 * limit, the spring arm (a wall in the way pulls the camera in front of it while it is
 * in the way) and the floor stop shape one frame's spot without ever writing the orbit.
 * All of it shapes ONLY the TP pose term, so at full FP (blend 1, TP weight 0) it is
 * inert by construction — the FP eye ignores follow distance entirely.
 *
 * All per-frame state lives in the shared `orbit` object, the rig and the module
 * `viewState` (all mutated in place) — never React state.
 */
export function CameraRig({ pose, orbit, seat, fogRange = LEGACY_FOG, far: baseFar = CAMERA_FAR, decal = null }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // The follow rig (followRig.ts) and the spot it writes each frame — made once per mount, mutated in place. The
  // player's remembered zoom and tilt (cameraMemory.ts) go onto the fresh orbit first, before anything reads it, so a
  // new scene, a reconnect or a reload starts exactly where the player left the camera (no glide from a default).
  const [rig] = useState(() => {
    restoreOrbit(orbit);
    return createFollowRig(orbit);
  });
  const [tpSpot] = useState(createFollowSpot);
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

  // Dev/E2E only: expose the live camera (the maze cap is not reflected in
  // orbit.distance, and the FP look yaw lives outside orbit). Tree-shaken in prod.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCamera = () => ({ ...cameraProbe });
    // The live click-move target (design 29) — lets the E2E assert retarget /
    // stuck-release without inferring it from position traces alone.
    window.__cvClickTarget = () => getClickTarget();
    window.__cvClickPick = () => lastClickPick && { ...lastClickPick };
    return () => {
      delete window.__cvCamera;
      delete window.__cvClickTarget;
      delete window.__cvClickPick;
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
    // `travel`: the farthest it has gone from the down point (pressTravel) — a drag that came back is still a drag.
    let clickStart: { id: number; x: number; y: number; t: number; travel: number } | null = null;
    // Reused per mount for the click's scene raycast (never per event — no GC churn).
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
        clearPendingClick(); // its ring goes with it
      }
    };
    /** What a click at a screen point lands on: the first visible surface under it (clickPick.ts). Once per click. */
    const pickAt = (clientX: number, clientY: number): ScenePick | null => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      const cam = camera as PerspectiveCamera;
      raycaster.setFromCamera(ndc, cam);
      raycaster.near = cam.near; // nearer than the near plane is not drawn: nothing to click
      raycaster.far = cam.far;
      raycaster.layers.mask = cam.layers.mask;
      return pickSurface(raycaster, scene, { area: activeBounds() });
    };
    /**
     * Where a click on `pick` sends the avatar (clickPlan.ts) — or why it sends it nowhere — planned from where its
     * walk starts: where it stands, or, seated, the spot it gets up onto (the seat's dismount point), or, getting up,
     * where the stand-up glide lands. `t0`: when the click's pick began (the dev hook times pick + plan together).
     */
    const planFor = (pick: ScenePick | null, t0 = performance.now()): ClickPlan => {
      const s = seat.index >= 0 ? activeSeats()[seat.index] : undefined;
      const g = localGlide.current;
      const from = walkStart(pose.x, pose.z, s, g && { x: g.toX, z: g.toZ });
      const surface = asSurface(pick);
      // An upright face clicked low is a curb's side only if it ends there (not a step's riser): measured once.
      if (pick && surface && pick.ny < WALKABLE_MIN_NY && pick.y > 0 && pick.y <= WALKABLE_MAX_Y && pick.faceTall === undefined) {
        pick.faceTall = faceIsTall(raycaster, scene, pick);
      }
      let plan = planClickMove(from.x, from.z, surface, getActiveMap().geometry.obstacles, activeBounds(), !!s);
      // A destination moved off the click lies on the ground found there (a lane, a lawn, the forecourt).
      if (plan.ok && plan.adjusted !== "none") plan.y = surfaceHeightAt(raycaster, scene, plan.x, plan.z, plan.y);
      // Rule 4: only a ring the player will see takes a walk — as ClickMarker will draw it: its lift, its screen size.
      let view: RingView | null = null;
      let unseen: ClickPlan | null = null;
      if (plan.ok) {
        const cam = camera as PerspectiveCamera;
        cam.updateMatrixWorld();
        const y = plan.y + ringLift(decal);
        const dist = Math.hypot(cam.position.x - plan.x, cam.position.y - y, cam.position.z - plan.z);
        const scale = cam.isPerspectiveCamera ? ringScreenScale(dist, (cam.position.y - y) / Math.max(dist, 1e-4), cam.fov, el.clientHeight || 1) : 1;
        view = ringView(raycaster, scene, cam, plan.x, y, plan.z, scale, plan.adjusted === "none" ? RING_SEEN_AT_CLICK : RING_SEEN_MOVED);
        const seen = requireSeen(plan, view);
        if (!seen.ok) unseen = plan;
        plan = seen;
      }
      if (import.meta.env.DEV) lastClickPick = { pick, plan, view, unseen, ms: performance.now() - t0 };
      return plan;
    };

    // The look-drag gain: CAMERA.dragSpeed x the player's sensitivity setting, read
    // when the drag moves (not captured at mount), so changing it in the menu applies
    // to the very next drag.
    const dragSpeed = () => CAMERA.dragSpeed * useSettingsStore.getState().settings.lookSensitivity;

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clickStart =
        e.button === 0 && pointers.size === 1
          ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), travel: 0 }
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
      if (clickStart && clickStart.id === e.pointerId) {
        clickStart.travel = pressTravel(clickStart.travel, e.clientX - clickStart.x, e.clientY - clickStart.y);
      }
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
        cancelOrbitGoal(); // a drag takes the camera back from any recenter glide
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
      // (short + still + not cancelled) is planned from the surface under it
      // (planAt) and becomes the auto-move target. Skipped in overview (no overview click-move —
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
          isClick(
            pressTravel(start.travel, e.clientX - start.x, e.clientY - start.y),
            0,
            performance.now() - start.t,
            e.pointerType === "touch" ? TAP_MAX_PX : CLICK_MAX_PX,
          )
        ) {
          // Which half is the look half follows the left-handed setting — the SAME store
          // field TouchJoystick's prop comes from (WorldScene), so the stick half and
          // the look half can never overlap or leave a gap.
          const leftHanded = useSettingsStore.getState().settings.leftHanded;
          const lookTap = e.pointerType === "touch" && isLookHalf(e.clientX, window.innerWidth, leftHanded);
          // A look-half tap is timed by its lift (the event's own time), before any pick: a busy page must not
          // push a second tap past the double-tap window by the time the first one's pick took (round 3
          // merge test: a phone under load lost its double tap — a walk instead of a recenter).
          const tap: TapRecord | null = lookTap ? { t: e.timeStamp > 0 ? e.timeStamp : performance.now(), x: e.clientX, y: e.clientY } : null;
          if (tap && isDoubleTap(lastTap, tap)) {
            // The second tap of a double tap: the camera swings back behind the body — no pick, no walk.
            clearPendingWalk();
            lastTap = null;
            requestRecenter(pose.yaw);
          } else {
            const t0 = performance.now();
            const pick = pickAt(e.clientX, e.clientY);
            const plan = planFor(pick, t0);
            const intent = clickIntent(plan); // walk there / stop here (own feet) / nothing (a wall, a body, the sky...)
            if (tap) {
              // Look half: wait for a possible second tap. Two taps recenter the
              // camera; one tap walks after DOUBLE_TAP_MS (planned on what the
              // finger actually touched, not wherever the camera is by then), its
              // ring showing from the tap on. The world can change during that
              // wait, so the walk is re-checked when it fires (overview opened, chat
              // took the keyboard, the player sat down meanwhile — see canTapWalk).
              clearPendingWalk();
              lastTap = tap;
              if (intent !== "ignore") {
                const seatedAtTap = seat.index >= 0;
                // the ring at once (a menu open: no walk follows)
                const shown = plan.ok && !isUiCaptured() ? setPendingClick(plan.x, plan.z, plan.y) : null;
                pendingWalk = setTimeout(() => {
                  pendingWalk = null;
                  // its ring dropped meanwhile (a key, the stick, Esc, a sit): the player took over — no walk
                  const dropped = shown !== null && peekPendingClick() !== shown;
                  if (!canTapWalk(viewState.mode, isUiCaptured(), seatedAtTap, seat.index >= 0, dropped)) {
                    if (!dropped) clearPendingClick();
                    return;
                  }
                  // The same surface, planned again from where the avatar is now (a walk in progress moved it).
                  const now = planFor(pick);
                  if (now.ok) setClickTarget(now.x, now.z, now.y);
                  else if (clickIntent(now) === "stop") clearClickTarget(); // a tap at the own feet: stop
                  else clearPendingClick();
                }, DOUBLE_TAP_MS);
              }
            } else if (plan.ok) {
              setClickTarget(plan.x, plan.z, plan.y); // 벽·사람·하늘·갈 수 없는 곳은 무시 (clickPlan.ts)
            } else if (intent === "stop") {
              clearClickTarget(); // 내 발밑: 그 자리에 멈춤
            }
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
      // The end of a drag (tilt) or a pinch (zoom): keep what the player chose (stored only if it changed).
      rememberOrbit(orbit);
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
      rememberOrbit(orbit); // the zoom the player just set is the one kept (cameraMemory.ts)
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
      rememberOrbit(orbit); // a scene ending mid-drag still hands its camera to the next one
    };
  }, [gl, orbit, camera, scene, pose, seat, decal]);

  // The click pick's one-time preparation (clickPick.ts warmPick: the cells of the large meshes, the leaves' texels),
  // a few ms at a time while the page is idle, so no click pays for it — and again as the scene changes (a model that
  // loads late, the hall).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    let stopped = false;
    const step = () => {
      idle = undefined;
      if (stopped) return;
      const done = warmPick(scene, 6);
      timer = setTimeout(schedule, done ? 2000 : 30);
    };
    const schedule = () => {
      if (stopped) return;
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(step, { timeout: 1000 });
      else step();
    };
    timer = setTimeout(schedule, 500);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
    };
  }, [scene]);

  useFrame((state, delta) => {
    // ── A door into or out of a building (케이슨 마을, indoorCamera.ts) ── the player was just put somewhere else: the
    // rig's own easing starts fresh there (followRig.ts `noteAreaLimit`), behind the door's curtain. The view keeps the
    // player's yaw, pitch and zoom — it no longer swings behind the body or resets the tilt (owner 2026-11-10). A
    // recenter the player asked for just before the door is dropped: it was aimed for the other side.
    const areaLimit = getActiveMap().cameraLimit;
    if (noteAreaLimit(rig, orbit, areaLimit)) cancelOrbitGoal();
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
    // A pending goal the player asked for (R, double tap) glides the orbit; done → dropped.
    const goal = viewState.orbitGoal;
    if (goal && stepOrbitToward(orbit, goal, delta)) viewState.orbitGoal = null;

    // The TP camera follows the body itself (no trailing point), so its distance to the avatar is the zoom.
    const followX = pose.x;
    const followZ = pose.z;

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

    // ── Third-person pose ── the follow rig's (followRig.ts): the player's orbit, read and never written, shaped for
    // this frame only by the zoom glide, the portrait pull-back, the place's ceiling limit, the spring arm and the
    // floor stop. It acts ONLY on the TP term, so it never touches the FP eye. The walls are not cast against at full
    // FP weight, where the TP term is not drawn.
    stepFollowRig(rig, orbit, followX, followZ, aspect, delta, t < 1, tpSpot);
    const tpX = tpSpot.x;
    const tpY = tpSpot.y;
    const tpZ = tpSpot.z;
    const tpLookLift = tpSpot.lookLift;

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
    cameraProbe.distance = tpSpot.distance;
    cameraProbe.mode = viewState.mode;
    cameraProbe.blend = viewState.blend;
    cameraProbe.fpYaw = viewState.fpYaw;
    cameraProbe.ovBlend = viewState.ovBlend;
    cameraProbe.far = cam.far;
  });

  return null;
}
