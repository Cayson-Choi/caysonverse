import { altitudeFogFar, altitudeFogNear, parkAltitude } from "../land/parkAltitude";
import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import type { Fog } from "three";
import { CAMERA, CAMERA_FAR, FP_EYE_HEIGHT, HEAD_HEIGHT } from "./constants";
import type { MoveControl } from "./constants";
import { normalizeAngle, stepYaw } from "./yaw";
import { RIDE_PITCH_MAX, clampFpPitch, clampRideYaw, easeBlend } from "./viewMode";
import {
  viewState,
  applyZoom,
  stepViewBlend,
  stepOvBlend,
  toggleViewMode,
  enterFp,
  exitFp,
  toggleOverview,
  dropOverview,
  requestRecenter,
  cancelOrbitGoal,
  zoomSkyBy,
} from "./viewState";
import {
  overviewFar,
  overviewFitHeight,
  clampOverviewHeight,
  clampOverviewCenter,
  overviewPanDelta,
  OV_FOCUS_HEIGHT,
} from "./overview";
import { onHotkey } from "./hotkeys";
import { isUiCaptured } from "./uiCapture";
import { consumeSuppressedWorldPointer } from "./worldPointerGuard";
import { CAMERA_LOOK_LIFT, ZOOM_BAND, pinchZoomDelta, stepKeyYaw, stepOrbitToward } from "./cameraControls";
import { DOUBLE_TAP_MS, HeldWork, LookTapGate, canTapWalk, isLookHalf } from "./tapGesture";
import {
  DRAG_SIGN,
  CLICK_MAX_PX,
  TAP_MAX_PX,
  isClick,
  pressTravel,
  setClickTarget,
  setSeatWalk,
  getClickTarget,
  clearClickTarget,
  setPendingClick,
  peekPendingClick,
  clearPendingClick,
  clickGeneration,
  peekClickTarget,
  type ClickTarget,
} from "./clickMove";
import { asSurface, faceIsTall, pickSurface, ringView, surfaceHeightAt, warmPick, type ScenePick } from "./clickPick";
import {
  WALKABLE_MAX_Y,
  WALKABLE_MIN_NY,
  clickIntent,
  finishClickPlanSteps,
  requireSeen,
  startClickPlan,
  surfaceKind,
  walkStart,
  type ClickPlan,
  type SurfacePoint,
  type RingView,
} from "./clickPlan";
import { ringLift, ringScreenScale } from "./clickRing";
import type { GroundDecal } from "./groundDecal";
import { overviewAllowed } from "./indoorCamera";
import { createFollowRig, createFollowSpot, noteAreaLimit, stepFollowRig } from "./followRig";
import { rememberOrbit, restoreOrbit } from "./cameraMemory";
import { cameraProbe } from "./cameraProbe";
import { activeBounds, activePickBounds, activeSeats, getActiveMap, mapBounds, type ActiveMap } from "./activeMap";
import { localGlide } from "./seatMotion";
import { seatApproachGoal, seatUnderTap, warmSeatApproachGoals } from "./seatTap";
import { isLotSeat } from "@caysonverse/shared/village/benchSeats";
import { seatedEyeOffset, stepSeatedWeight } from "./seatedEye";
import { setPreferredSeat } from "./seatPreference";
import { getLocalLift } from "./jump";
import { getLocalStepLift } from "../village/houses/houseLift";
import { useFpCursor } from "./useFpCursor";
import { CAROUSEL_SIDE, FP_NEAR, STEADY_MOVING, fpBodyOff, fpEye } from "./fpBody";
import { RIDE } from "@caysonverse/shared/land/rides";
import { useSettingsStore } from "../stores/settingsStore";
import { getTransitRenderPose } from "../net/transitSync";
import { busRiderCamera, busSelfHidden, busShoulderScale, busShoulderSide, clampBusPitch, riderFov, type TransitCameraPose } from "../village/transitCamera";
import { resetRideCamera, selfRide, stepRideCamera } from "../land/coasterRide";
import { stepRideAudio, stopRideAudio } from "../land/coasterAudio";
import { resetCarouselCamera, stepCarouselCamera } from "../land/carouselRide";
import { resetWheelCamera, stepWheelCamera } from "../land/wheelRide";
import { resetMoonBoatCamera, stepMoonBoatCamera } from "../land/moonBoatRide";
import { resetDropCamera, stepDropCamera } from "../land/dropTowerRide";
import { busCamGoal, busCamState, busSeatGoal, busSeatPreferred, busWalkGoal, riderBusPoint, selfBusRide } from "./busRide";
import { BUS_SEATS, busPlaceOf, cabinFloorAt, seatBodyPoint } from "@caysonverse/shared/village/busCabin";
import { busFloorUnderRay, busSeatUnderRay } from "../village/busSeatPick";
import { VILLAGE_LAYOUT, cubbyAtPoint, isHouseArea, isLotArea } from "@caysonverse/shared/village/villageLayout";
import { localArea } from "../village/villageArea";
import { armHouseUse, houseTapTarget, setPadWalk, tapUsesOnArrival } from "../village/houseTap";
import { DOOR_TAP_USE_RANGE_M, lotDoorTapTarget } from "../village/lotDoorTap";
import { armRide, rideForTap, rideTapSpot } from "../land/rideBoard";
import { openCubbyAt } from "../village/cubbyCard";
import { cubbyFocusAnchor, stepCubbyFocus, type FocusPose } from "../village/cubbyFocus";
import type { Orbit, Pose, SeatState } from "./types";
import { BASE_FOV } from "./cameraShoulder";
import { furnitureClick, seatThroughFloor } from "./furnitureClick";
import { FACE_SEAT_TURN, stepSeatOnArrival, yawToward, type SeatIntent } from "./seatOnArrival";
import { UNREACHABLE_HINT, useClickHint } from "../stores/clickHintStore";

/** A click on floor the avatar cannot get to: a short line instead of silence (round 9 review). */
function showUnreachableHint(): void {
  useClickHint.getState().show(UNREACHABLE_HINT);
  if (import.meta.env.DEV) window.__cvClickHints = (window.__cvClickHints ?? 0) + 1;
}
import { getRemoteSeatIndices } from "./remoteStore";

interface CameraRigProps {
  map: ActiveMap;
  pose: Pose;
  orbit: Orbit;
  /** The local player's server-confirmed seat (read, never written): a held-back tap-walk checks it. */
  seat: SeatState;
  /**
   * The scene's fog band [near, far] (m): where the overview's fog push-out starts from and
   * returns to.
   */
  fogRange: readonly [number, number];
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

/** Longest frame (s) a held Z / C may turn the view for — a stalled tab can't spin it. */
const MAX_KEY_TURN_DT = 0.1;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Dev/E2E only (`window.__cvClickPick`): the last click — what it landed on, the plan made of it, how its ring would look (`view`; and `unseen`, the
 * plan rule 4 refused) and the ms the pick and the plan took together. `pending`: its way round is still being looked
 * for (`plan` null until then).
 */
let lastClickPick: {
  pick: ScenePick | null;
  plan: ClickPlan | null;
  view: RingView | null;
  unseen: ClickPlan | null;
  pending: boolean;
  ms: number;
  /** The seat a click on furniture picked (furnitureClick.ts), sat on when the walk ends at its approach. */
  sitOn?: number | null;
} | null = null;


/** How long (ms) one slice of a click's way-round search runs before the page gets the thread back (CameraRig planClick). */
const PLAN_SLICE_MS = 4;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** When an input event happened (ms, performance.now()'s clock): its own time stamp, else now. */
function eventTime(e: Event): number {
  return e.timeStamp > 0 ? e.timeStamp : performance.now();
}

/** A look-half tap held back for a possible second tap (CameraRig lookTapWalk). */
interface LookTap {
  /** Where the finger lifted (client px). */
  at: { x: number; y: number };
  /** A copy of the camera as it was then: the tap is picked, and its ring judged, on what the finger saw. */
  snap: PerspectiveCamera;
  /** When it was handled (performance.now()): its walk waits DOUBLE_TAP_MS from here. */
  tappedAt: number;
  /** Seated at the tap: its walk still means "get up and go there" (canTapWalk). */
  seatedAtTap: boolean;
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
export function CameraRig({ map, pose, orbit, seat, fogRange, far: baseFar = CAMERA_FAR, decal = null }: CameraRigProps) {
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
  // the memorial cubby close-up's pose this frame (cubbyFocus.ts), reused (no allocation per frame)
  const [focusPose] = useState<FocusPose>(() => ({ ex: 0, ey: 0, ez: 0, tx: 0, ty: 0, tz: 0 }));
  // Live whole-map fit height (aspect-dependent) — recomputed each frame, read by
  // the overview wheel/pinch handlers for the zoom ceiling. Ref, not state.
  const fitHeight = useRef(0);
  /** The camera's own vertical field of view (PlayShell's): the over-the-shoulder view on a phone widens it for a while. */
  const baseFov = useRef(0);
  // Previous frame's mode, to detect the EDGE into overview and seed its camera
  // (distinct from viewState.prevMode, which is the mode overview will restore).
  const lastFrameMode = useRef(viewState.mode);
  const busModeBeforeRef = useRef<string | null>(null); // the view mode before boarding the bus (null: not riding)
  /** The same for the 별똥별 급행 (land/coasterRide.ts), with the lens and the near plane to give back. */
  const rideBeforeRef = useRef<{ mode: string; fov: number; near: number } | null>(null);
  // The rectangle the overview was last framed for: a different one (a door in 케이슨 마을) re-frames an open overview.
  const lastBounds = useRef(activeBounds());
  /** The seated FP eye's weight (0 standing .. 1 seated) and the seat it eases toward or away from (seatedEye.ts). */
  const seatedEyeW = useRef(0);
  const steadyPrev = useRef({ x: 0, z: 0, v: 0 });
  const seatedEyeSeat = useRef<{ yaw: number; seatY?: number } | null>(null);
  /**
   * A seat clicked (furnitureClick.ts): once the walk to its approach (x, z) has started (`armed`: its ring is the walk's target)
   * and ends there, the avatar turns to face it — and stays standing: the visitor sits with "앉기" (owner 2026-11-17, no sitting
   * on a tap). Another click, a key or the stick (the walk's target replaced or dropped short of the spot) forgets it.
   */
  const seatOnArrival = useRef<SeatIntent | null>(null);
  /** The seat the standing avatar is turning to face after its walk (seatOnArrival), and where it stood when it began. */
  const faceSeat = useRef<{ index: number; x: number; z: number } | null>(null);
  // Z / C are registered in the shared KeyboardControls map; read their live state.
  const [, getKeys] = useKeyboardControls<MoveControl>();
  // A boarded village bus owns the camera pose until the server confirms a leave.
  // Keeping this as a tiny external-store hook avoids per-frame React renders.
  /** The lens's field of view before the bus ride widened it (null while not riding). */
  const fovBeforeRideRef = useRef<number | null>(null);
  const nearBeforeRideRef = useRef(0.2);
  /** The scene's own near plane (read on the first frame; first person draws nearer, FP_NEAR, for the own shoulders and hands). */
  const baseNear = useRef(0);
  const busRideCam = useRef<TransitCameraPose>({ x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, arm: 0, gap: 0, firstPerson: false }).current;
  /** In the bus: the shoulder the third person stands over (+1 right, -1 left) and the side drawn, eased toward it. */
  const busShoulder = useRef<{ side: 1 | -1; ease: number }>({ side: 1, ease: 1 }).current;
  /** In the bus: the own body hidden because the third-person lens is too near the head (selfGap.ts), with its hysteresis. */
  const busHidden = useRef(false);
  /** In the bus: the view mode of the last frame (null off the bus) — a first <-> third person toggle carries the aim's pitch across. */
  const busLastMode = useRef<string | null>(null);
  // First person hides the resting mouse cursor over the 3D view (fpCursor.ts) — the owner saw it as a stray icon.
  useFpCursor(gl.domElement, getKeys);

  // Dev/E2E only: expose the live camera (a camera limit is not reflected in
  // orbit.distance, and the FP look yaw lives outside orbit). Tree-shaken in prod.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvCamera = () => ({ ...cameraProbe });
    // The live click-move target (design 29) — lets the E2E assert retarget /
    // stuck-release without inferring it from position traces alone.
    window.__cvClickTarget = () => getClickTarget();
    window.__cvClickPick = () => lastClickPick && { ...lastClickPick };
    // the seat a click on furniture walks to (and turns toward when its walk ends: furnitureClick.ts), or null
    (window as unknown as { __cvSeatOnArrival?: () => unknown }).__cvSeatOnArrival = () => seatOnArrival.current && { ...seatOnArrival.current };
    // bus v3: where a bus seat's cushion is on the screen now (client px), for the e2e's tap on it
    (window as unknown as { __cvBusSeatScreen?: (i: number) => unknown }).__cvBusSeatScreen = (i: number) => {
      const s = BUS_SEATS[i];
      if (!s) return null;
      const bus = getTransitRenderPose();
      const fx = Math.sin(bus.yaw);
      const fz = Math.cos(bus.yaw);
      const a = s.ahead + 0.06;
      const p = new Vector3(bus.x + fx * a - fz * s.right, s.floor + 0.47, bus.z + fz * a + fx * s.right);
      const cam = camera as PerspectiveCamera;
      cam.updateMatrixWorld();
      p.project(cam);
      const rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, onScreen: p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
    };
    return () => {
      delete (window as unknown as { __cvBusSeatScreen?: unknown }).__cvBusSeatScreen;
      delete (window as unknown as { __cvSeatOnArrival?: () => unknown }).__cvSeatOnArrival;
      delete window.__cvCamera;
      delete window.__cvClickTarget;
      delete window.__cvClickPick;
    };
  }, []);

  // Prewarm the chairs within this area's bounds. The village and its interiors share one seat list.
  useEffect(() => {
    if (map.seats) return warmSeatApproachGoals(map.seats, map.geometry.obstacles, mapBounds(map));
  }, [map]);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchPrev = 0; // previous two-finger spread (px); 0 while not pinching
    // Click-move candidate (design 29): the down point/time of a SINGLE primary-
    // button press on the canvas. A second pointer (pinch) or a non-primary
    // button voids it; on release, only a press that passes isClick (< ~6px,
    // < ~400ms) becomes a floor click — anything longer stays a pure look-drag.
    // `travel`: the farthest it has gone from the down point (pressTravel) — a drag that came back is still a drag.
    // `second`: the second touch of a double tap (LookTapGate, decided at its touch-down).
    let clickStart: { id: number; x: number; y: number; t: number; travel: number; second: boolean } | null = null;
    // Reused per mount for the click's scene raycast (never per event — no GC churn).
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    // Touch double-tap bookkeeping (look half only — tapGesture.ts LookTapGate): the last tap, what it holds back for
    // DOUBLE_TAP_MS (its pick, its walk, its plan's slices) in case a second tap turns it into a recenter, and that
    // second touch, decided the moment it goes down. Dropped on a double tap, a pinch and unmount.
    const taps = new LookTapGate();
    // The click-move generation (clickGeneration) when a double tap's second touch went down, after it dropped the first
    // tap: should that touch turn into a drag, the first tap walks after all — unless the player took over meanwhile.
    let secondTouchGeneration = -1;
    // A mouse click's (or a stick-half tap's) plan still looking for its way round (planClick): a newer click drops it.
    const clickWork = new HeldWork();
    /** The ray of the last click that picked nothing (pickAt), for a tap on a glass door a click passes through (houseTap.ts, lotDoorTap.ts). */
    let missRay: NonNullable<ScenePick["ray"]> | null = null;
    /** What a click at a screen point lands on: the first visible surface under it (clickPick.ts). Once per click. */
    const pickAt = (clientX: number, clientY: number, cam = camera as PerspectiveCamera): ScenePick | null => {
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, cam);
      raycaster.near = cam.near; // nearer than the near plane is not drawn: nothing to click
      raycaster.far = cam.far;
      raycaster.layers.mask = cam.layers.mask;
      const pick = pickSurface(raycaster, scene, { area: activePickBounds() });
      const { origin: o, direction: d } = raycaster.ray;
      const ray = { o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z } };
      if (pick) pick.ray = ray;
      // nothing picked (the sky, or through a glass door and out of the area): the ray is kept for the door's own test (planClick)
      missRay = pick ? null : ray;
      return pick;
    };
    /**
     * Bus v3 (owner 2026-11-16): riding, a click or a tap on one of the bus's seats walks the rider down the aisle to it
     * (busRide.ts busSeatGoal; LocalPlayer walks, the rider sits with E / 앉기). A click or a tap on the cabin's floor walks there
     * (busWalkGoal, owner 2026-11-18). True when the rider is aboard: the click is the bus's.
     */
    const busSeatTap = (clientX: number, clientY: number, cam = camera as PerspectiveCamera): boolean => {
      if (selfBusRide.slot < 0) return false;
      const rect = el.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
      raycaster.setFromCamera(ndc, cam);
      const { origin: o, direction: d } = raycaster.ray;
      const busPose = getTransitRenderPose();
      const index = busSeatUnderRay(busPose, o, d);
      if (index >= 0) {
        busSeatGoal.index = index;
        busSeatPreferred.index = -1;
        busSeatGoal.at = performance.now();
        busWalkGoal.active = false;
        return true;
      }
      // owner 2026-11-18 ("버스안에서 이동이 잘 안되고"): a click or a tap on the cabin's floor walks there, as on the village's ground
      const spot = busFloorUnderRay(busPose, o, d);
      if (spot) {
        busWalkGoal.ahead = spot.ahead;
        busWalkGoal.right = spot.right;
        busWalkGoal.at = performance.now();
        busWalkGoal.active = true;
        busSeatGoal.index = -1;
        busSeatPreferred.index = -1;
      }
      return true;
    };
    /**
     * In the memorial hall a click or a tap on a cubby — any row, the top one too (owner 2026-11-13) — opens its close-up (the
     * card, and the camera glides to the front of that cubby: cubbyFocus.ts) instead of walking. While a close-up is open a
     * click elsewhere does nothing (the card's own buttons and Esc end it). True when the click was taken here.
     */
    const hallCubbyClick = (clientX: number, clientY: number): boolean => {
      if (localArea() !== "hall") return false;
      const hit = pickAt(clientX, clientY);
      const cubby = hit && !hit.blocker ? cubbyAtPoint(VILLAGE_LAYOUT, hit.x, hit.y, hit.z) : null;
      if (cubby) {
        taps.reset();
        clickWork.drop();
        clearClickTarget();
        openCubbyAt(cubby);
        return true;
      }
      return cubbyFocusAnchor() !== null;
    };
    /**
     * Rule 4: how a ring at (x, z) on a surface at `surfaceY` would look from `cam` — as ClickMarker will draw it: its
     * lift, its screen size. Only whether it is on the screen is asked (ringView's `need` 0: no rays — what covers part
     * of it, the ring is drawn through; round 5 review: the share in plain view was measured on every click for nothing).
     */
    const viewOfRing = (x: number, surfaceY: number, z: number, cam: PerspectiveCamera): RingView => {
      const y = surfaceY + ringLift(decal);
      const dist = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
      const scale = cam.isPerspectiveCamera ? ringScreenScale(dist, (cam.position.y - y) / Math.max(dist, 1e-4), cam.fov, el.clientHeight || 1) : 1;
      return ringView(raycaster, scene, cam, x, y, z, scale, 0);
    };
    /**
     * Where a click on `pick` sends the avatar (clickPlan.ts) — or why it sends it nowhere — planned from where its
     * walk starts: where it stands, or, seated, the spot it gets up onto (the seat's dismount point), or, getting up,
     * where the stand-up glide lands. Handed to `done` at once when the walk there is straight (most clicks), else once
     * its way round has been looked for, PLAN_SLICE_MS at a time on `work`'s timers (finishClickPlanSteps): the click's
     * handler never waits for a grid search (round 5 review: 15 ms in a pointerup handler for a click across the
     * fountain, 40-60 ms on a slower CPU). Meanwhile, with `provisional`, the ring already shows where that way round
     * leads (the pending ring, clickMove.ts), so the click is answered at once; `done` gets that ring (or null) to take
     * down if the plan comes to nothing. Dropping `work` drops the plan and its ring. `onDefer` runs when the plan is
     * left for later, before that ring shows (a walk in progress stops there: the plan starts where the avatar stands).
     * `snap`: the camera as it was at the tap (a copy) for a pick run after its event; the live camera otherwise. `t0`:
     * when the click's pick began (the dev hook times pick + plan together).
     */
    const planClick = (
      pick: ScenePick | null,
      done: (plan: ClickPlan, provisional: Readonly<ClickTarget> | null) => void,
      work: HeldWork,
      opts: { t0?: number; snap?: PerspectiveCamera | null; provisional?: boolean; onDefer?: () => void } = {},
    ): void => {
      const t0 = opts.t0 ?? performance.now();
      const snap = opts.snap ?? null;
      const s = seat.index >= 0 ? activeSeats()[seat.index] : undefined;
      const g = localGlide.current;
      const from = walkStart(pose.x, pose.z, s, g && { x: g.toX, z: g.toZ });
      let surface: SurfacePoint | null = asSurface(pick);
      const map = getActiveMap();
      // A tap on a marked chair or porch bench (the art's village seats: the café terrace, the porches) walks to THAT seat's own
      // approach spot (seatTap.ts), never the ground nearest it, and sits on arrival like any other seat clicked (below).
      const seatTapped = surface ? seatUnderTap(activeSeats(), surface.x, surface.y, surface.z) : -1;
      const seatGoal = seatTapped >= 0 && seatTapped !== seat.index ? seatApproachGoal(activeSeats(), seatTapped, map.geometry.obstacles, activeBounds()) : null;
      if (seatGoal) surface = { x: seatGoal.x, y: surfaceHeightAt(raycaster, scene, seatGoal.x, seatGoal.z, 0.01), z: seatGoal.z, ny: 1 };
      // An upright face clicked low is a curb's side only if it ends there (not a step's riser): measured once.
      if (pick && surface && pick.ny < WALKABLE_MIN_NY && pick.y > 0 && pick.y <= WALKABLE_MAX_Y && pick.faceTall === undefined) {
        pick.faceTall = faceIsTall(raycaster, scene, pick);
      }
      // In the hall every collider in the room is furniture (round 9: the floor seen under the letter table's edge, between its
      // chairs, had no free spot within MAX_PUSH and the tap was "unreachable"): floor inside one moves out as for a bench's box.
      // (a house floor is a room like the hall: every collider in it is furniture or the stair)
      const inRoom = localArea() === "hall" || isHouseArea(localArea()) || isLotArea(localArea());
      let furniture = inRoom ? map.geometry.obstacles : map.furniture;
      // A tap on a house's stair or front door walks to its pad (houseTap.ts): the pad is the destination; a door's use is armed, a stair's never.
      // (a lot building's door, the village side or a room's way out, the same way: lotDoorTap.ts). Only the door / stair ITSELF: a tap on
      // the ground or floor by it is a plain walk (owner 2026-11-21), and a tap made from far off walks to the door without using it.
      // (nothing picked: a glass leaf lets the click through and out of the area; then its ray alone says whether it crossed the door)
      const tapRay = pick ? pick.ray : missRay;
      const houseTap = pick?.blocker
        ? null
        : isHouseArea(localArea())
          ? houseTapTarget(localArea(), pick?.x ?? NaN, pick?.y ?? NaN, pick?.z ?? NaN, pick?.ny, tapRay, pick?.distance ?? 0)
          : lotDoorTapTarget(localArea(), pick?.x ?? NaN, pick?.y ?? NaN, pick?.z ?? NaN, tapRay, pick?.distance ?? 0, pick?.ny);
      if (houseTap) surface = { x: houseTap.x, y: 0, z: houseTap.z, ny: 1 };
      // ...and that walk is followed to the pad's middle (houseTap.ts setPadWalk): ended short, it is planned again from there
      setPadWalk(houseTap);
      // (a stair is only walked to: its 올라가기 / 내려가기 button climbs, never the tap — owner 2026-11-27, tapUsesOnArrival)
      armHouseUse(houseTap && tapUsesOnArrival(houseTap.id) && Math.hypot(from.x - houseTap.x, from.z - houseTap.z) <= DOOR_TAP_USE_RANGE_M ? houseTap.id : null);
      // A tap on a ride's own body (its frame, cars, seats, a raised platform) walks to its boarding pad, where its 타기 button is; it never
      // boards (owner 2026-11-21: "타기 버튼을 눌러야만 타도록"). A tap on the ground is a walk to that spot. Any tap drops a board armed by an
      // earlier press of 타기 from afar (rideBoardWalk.ts): the player chose to go somewhere else.
      const rideTapKey = pick && !pick.blocker && localArea() === "park" ? rideForTap(pick.x, pick.z, pick.ray, pick.distance, pick.y, pick.ny) : null;
      if (rideTapKey) {
        const spot = rideTapSpot(rideTapKey);
        surface = { x: spot.x, y: 0, z: spot.z, ny: 1 };
      }
      armRide(null);
      // A click on a seat or (in the hall) on other furniture is no ground, yet means something (round 8 review: a tap on the
      // sofa did nothing): the seat's approach, to sit on arrival, or the floor next to the piece (furnitureClick.ts).
      let sitOn: number | null = seatGoal ? seatTapped : null;
      // A house's floor is flat: anything facing up above it (a sofa's cushion at 0.46 m, a low table) is furniture, never a raised floor to
      // walk onto, and a tap whose ray enters a seat (a floor cushion a few cm up, a 보료) is that seat — a tap on a cushion clear of its
      // collider's box walked onto the cushion and did not sit (G round 3). Elsewhere a ground click may have gone between a bench's
      // slats or through its backrest band to the floor beyond (seatThroughFloor, plaza bench hotfix): that seat; else it stays ground.
      const inHouse = isHouseArea(localArea()) || isLotArea(localArea()); // (a lot building's room: a flat floor too)
      const kindNone = !!surface && surfaceKind(surface, map.geometry.obstacles, activeBounds()) === "none";
      if (!seatGoal && !houseTap && !rideTapKey && surface) {
        const remote = new Set(getRemoteSeatIndices());
        const taken = (i: number) => remote.has(i);
        const onFurniture = kindNone || inHouse;
        const fc = onFurniture
          ? furnitureClick(pick, pick?.ray ?? null, map.seats ?? activeSeats(), map.seatArea, taken, from, 0, inRoom, { obstacles: map.geometry.obstacles, bounds: activeBounds() })
          : seatThroughFloor(pick, pick?.ray ?? null, map.seats ?? activeSeats(), map.seatArea, taken, from, map.furniture ?? []);
        const counts = !onFurniture || kindNone || (fc !== null && (fc.seatIndex !== null || surface.y > WALKABLE_MAX_Y));
        // (a click on the seat the player is sitting on stays nothing)
        if (fc && counts && !(fc.seatIndex !== null && fc.seatIndex === seat.index)) {
          // the floor there (a column that meets a cushion or a seat first is not the floor: the room's floor level then)
          const fy = surfaceHeightAt(raycaster, scene, fc.surface.x, fc.surface.z, 0);
          surface = { ...fc.surface, y: fy <= WALKABLE_MAX_Y ? fy : 0 };
          sitOn = fc.seatIndex;
          // the floor under a click on furniture lies inside its box: moved out as far as for a bench's
          furniture = map.geometry.obstacles;
        }
      }
      // the walk that ends beside the clicked seat offers THAT one, though another may be a hair nearer (seatPreference.ts)
      setPreferredSeat(sitOn ?? -1);
      const start = startClickPlan(from.x, from.z, surface, map.geometry.obstacles, activeBounds(), !!s, { furniture, farFirst: seatGoal !== null, shore: map.shore });
      const toShore = !!(surface && map.shore && map.shore(surface.x, surface.z));
      const cameraNow = (): PerspectiveCamera => {
        if (snap) return snap;
        const cam = camera as PerspectiveCamera;
        cam.updateMatrixWorld();
        return cam;
      };
      // A destination moved off the click lies on the ground found there (a lane, a lawn, the forecourt).
      const groundAt = (x: number, z: number, y: number, moved: boolean) => (moved ? surfaceHeightAt(raycaster, scene, x, z, y) : y);
      const settle = (raw: ClickPlan): ClickPlan => {
        let plan = raw;
        if (plan.ok && plan.adjusted !== "none") plan = { ...plan, y: groundAt(plan.x, plan.z, plan.y, true) };
        // Rule 4: only a ring on the screen takes a walk — but a click on the falls' pool walks to its nearest shore
        // spot wherever that is (W6: on the phone's narrow portrait view the shore spot of a click on the pool's north
        // or south part lies off the screen, and a tap on the water that does nothing is what B10 complained of)
        let view: RingView | null = null;
        let unseen: ClickPlan | null = null;
        if (plan.ok) {
          view = viewOfRing(plan.x, plan.y, plan.z, cameraNow());
          // a seat clicked was itself in view: its approach (beside or under the camera) need not be; a click on the falls' pool
          // walks to its nearest shore spot wherever that is (W6: on the phone's portrait view it may lie off the screen)
          const seen = sitOn === null && !houseTap && !rideTapKey && !toShore ? requireSeen(plan, view) : plan;
          if (!seen.ok) unseen = plan;
          plan = seen;
        }
        if (import.meta.env.DEV) lastClickPick = { pick, plan, view, unseen, pending: false, ms: performance.now() - t0, sitOn };
        // a seat clicked: sat on once the walk to its approach ends there (the frame loop's seat-on-arrival)
        // (already standing at it, the click is "here": sat on at once)
        const now = performance.now();
        // a lot building's seat (L5, owner 2026-11-17 "의자를 찍으면 자동 앉기는 빼줘"): the tap walks there and offers it; the 앉기 button sits
        if (sitOn === null || isLotSeat(activeSeats()[sitOn])) seatOnArrival.current = null;
        else if (plan.ok) seatOnArrival.current = { index: sitOn, x: plan.x, z: plan.z, armed: false, at: now };
        else seatOnArrival.current = plan.reason === "here" ? { index: sitOn, x: from.x, z: from.z, armed: true, at: now } : null;
        return plan;
      };
      if (start.plan) {
        done(settle(start.plan), null);
        return;
      }
      const detour = start.detour;
      opts.onDefer?.();
      let shown: Readonly<ClickTarget> | null = null;
      if (opts.provisional) {
        const spot = detour.spots[0];
        const y = groundAt(spot.x, spot.z, detour.surface.y, spot.x !== detour.surface.x || spot.z !== detour.surface.z);
        if (viewOfRing(spot.x, y, spot.z, cameraNow()).onScreen) shown = setPendingClick(spot.x, spot.z, y);
      }
      const dropRing = () => {
        if (shown && peekPendingClick() === shown) clearPendingClick();
      };
      if (import.meta.env.DEV) lastClickPick = { pick, plan: null, view: null, unseen: null, pending: true, ms: performance.now() - t0 };
      const steps = finishClickPlanSteps(detour);
      const slice = () => {
        const began = performance.now();
        for (;;) {
          const r = steps.next();
          if (r.done) {
            done(settle(r.value), shown);
            return;
          }
          if (performance.now() - began >= PLAN_SLICE_MS) break;
        }
        work.hold(slice, 0, dropRing);
      };
      work.hold(slice, 0, dropRing);
    };

    // The look-drag gain: CAMERA.dragSpeed x the player's sensitivity setting, read
    // when the drag moves (not captured at mount), so changing it in the menu applies
    // to the very next drag.
    const dragSpeed = () => CAMERA.dragSpeed * useSettingsStore.getState().settings.lookSensitivity;
    /** A walk in progress stops where it is (a new click is being planned from there: planClick `onDefer`). */
    const stopWalk = () => {
      if (peekClickTarget()) clearClickTarget();
    };
    /** Where a walk starts now (planClick's own rule, walkStart): where the avatar stands, gets up onto, or lands. */
    const walkFrom = () => {
      const s = seat.index >= 0 ? activeSeats()[seat.index] : undefined;
      const g = localGlide.current;
      return walkStart(pose.x, pose.z, s, g && { x: g.toX, z: g.toZ });
    };
    /**
     * A look-half tap (onUp): its pick just after the event, on the camera as it was at the tap (`snap`); its plan, its
     * ring shown at once; its walk once DOUBLE_TAP_MS have passed since the tap (`wait`: a second tap may still turn it
     * into a recenter) — or at once (the second touch turned into a drag: LookTapGate.dragged). Every step on
     * `taps.work`, dropped together by a new tap, a double tap or a pinch. Whenever the player takes over meanwhile — a
     * key, the stick, Esc, a sit or another click (clickGeneration) — nothing of it shows or walks any more (round 6
     * review: a ring brought back by a way round found after the player had moved on, a walk started by a re-plan
     * finished after it).
     */
    const lookTapWalk = (tap: LookTap, wait: boolean) => {
      if (busSeatTap(tap.at.x, tap.at.y, tap.snap)) return; // riding: a tap on a seat sits there, nothing else walks
      const generation = clickGeneration();
      taps.work.hold(() => {
        const t0 = performance.now();
        const pick = pickAt(tap.at.x, tap.at.y, tap.snap);
        const plannedFrom = walkFrom();
        planClick(
          pick,
          (plan, provisional) => {
            if (clickGeneration() !== generation) {
              // the player took over while its way round was looked for: its ring does not come back
              if (provisional && peekPendingClick() === provisional) clearPendingClick();
              return;
            }
            const intent = clickIntent(plan); // walk there / stop here (own feet) / nothing (a wall, a body, the sky...)
            // the ring at the plan's spot (a menu open: no walk follows, no ring)
            const shown = plan.ok && !isUiCaptured() ? setPendingClick(plan.x, plan.z, plan.y) : null;
            if (!shown && provisional && peekPendingClick() === provisional) clearPendingClick();
            if (intent === "ignore") {
              // a floor no body gets to: said so once the tap stands (not the first of a double tap)
              if (!plan.ok && plan.reason === "unreachable") {
                taps.work.hold(
                  () => {
                    if (clickGeneration() === generation) showUnreachableHint();
                  },
                  wait ? Math.max(0, DOUBLE_TAP_MS - (performance.now() - tap.tappedAt)) : 0,
                );
              }
              return;
            }
            /** Its ring (`shown`, or a re-plan's `ring`) taken down if it still shows — never another click's. */
            const dropOwnRing = (ring: Readonly<ClickTarget> | null = null) => {
              const now = peekPendingClick();
              if (now !== null && (now === shown || now === ring)) clearPendingClick();
            };
            taps.work.hold(
              () => {
                // a key, the stick, Esc, a sit or another click meanwhile: the player took over — no walk
                const dropped = clickGeneration() !== generation || (shown !== null && peekPendingClick() !== shown);
                if (!canTapWalk(viewState.mode, isUiCaptured(), tap.seatedAtTap, seat.index >= 0, dropped)) {
                  if (!dropped) clearPendingClick();
                  else dropOwnRing();
                  if (import.meta.env.DEV) window.__cvTapWalk?.();
                  return;
                }
                // A tap at the own feet means stop, whatever the walk in progress did meanwhile (round 4 review:
                // planned again 300 ms later, 0.6 m on, it walked back to the tap instead).
                if (intent === "stop") {
                  clearClickTarget();
                  if (import.meta.env.DEV) window.__cvTapWalk?.();
                  return;
                }
                const walkTo = (now: ClickPlan, ring: Readonly<ClickTarget> | null) => {
                  if (now.ok) {
                    setClickTarget(now.x, now.z, now.y, now.via);
                    if (seatOnArrival.current && seatOnArrival.current.x === now.x && seatOnArrival.current.z === now.z) setSeatWalk();
                    // should a second touch that came in time be handled only now, this walk is taken back
                    const set = clickGeneration();
                    taps.walked(() => {
                      if (clickGeneration() === set) clearClickTarget();
                    });
                  } else if (clickIntent(now) === "stop") clearClickTarget(); // it is at the avatar's feet now: stop
                  else {
                    if (now.reason === "unreachable") showUnreachableHint();
                    dropOwnRing(ring);
                  }
                  if (import.meta.env.DEV) window.__cvTapWalk?.(); // the E2E holds the avatar here, before a frame walks it
                };
                // Where the avatar was when the tap was planned: that plan holds. A walk in progress moved it: the
                // same surface, planned again from where it is now — its ring judged on the screen as the finger saw it
                // (`snap`; round 6 review: judged 300 ms later on the live camera, a tap at the bottom of the screen
                // behind a walk away from it had left the screen and was refused, its ring gone).
                const from = walkFrom();
                if (Math.hypot(from.x - plannedFrom.x, from.z - plannedFrom.z) < 1e-3) {
                  walkTo(plan, null);
                  return;
                }
                let replanned = clickGeneration();
                planClick(
                  pick,
                  (now, ring) => {
                    // its way round was looked for over a few moments: the player may have taken over meanwhile
                    const tookOver = clickGeneration() !== replanned;
                    if (tookOver || !canTapWalk(viewState.mode, isUiCaptured(), tap.seatedAtTap, seat.index >= 0)) {
                      dropOwnRing(ring);
                      if (import.meta.env.DEV) window.__cvTapWalk?.();
                      return;
                    }
                    walkTo(now, ring);
                  },
                  taps.work,
                  {
                    snap: tap.snap,
                    provisional: true,
                    onDefer: () => {
                      stopWalk();
                      replanned = clickGeneration();
                    },
                  },
                );
              },
              wait ? Math.max(0, DOUBLE_TAP_MS - (performance.now() - tap.tappedAt)) : 0,
              () => clearPendingClick(), // its ring goes with it
            );
          },
          taps.work,
          { t0, snap: tap.snap, provisional: !isUiCaptured() },
        );
      }, 0);
    };

    const onDown = (e: PointerEvent) => {
      // ChatInput closes on a document-capture pointerdown over the canvas.
      // Consume that mark before recording the pointer so its dismissal press
      // cannot become a click-move on pointerup.
      if (consumeSuppressedWorldPointer(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clickStart =
        e.button === 0 && pointers.size === 1
          ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: eventTime(e), travel: 0, second: false }
          : null;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events may have no active pointer; capture is best-effort
      }
      // A touch on the look half within DOUBLE_TAP_MS of a tap's lift, near it: a double tap, decided now — the first
      // tap's walk is dropped before this touch is lifted, however long it is held (LookTapGate).
      const doubleTap =
        clickStart &&
        e.pointerType === "touch" &&
        viewState.mode !== "ov" &&
        isLookHalf(e.clientX, window.innerWidth, useSettingsStore.getState().settings.leftHanded) &&
        taps.down(e.pointerId, clickStart.t, e.clientX, e.clientY);
      if (doubleTap && clickStart) {
        clickStart.second = true;
        // A busy page can let the first tap's walk start before this touch-down is handled. LookTapGate normally
        // undoes that walk through its callback; clear the live target as well so a delayed callback can never leave
        // the avatar walking while the camera recentres.
        clickWork.drop();
        clearClickTarget();
        secondTouchGeneration = clickGeneration();
      }
      if (pointers.size === 2) {
        pinchPrev = spread(pointers);
        // A second finger means a pinch, not a double tap: forget the held-back walk.
        taps.reset();
      }
    };
    /**
     * A mouse hovering a cubby in the hall shows the hand cursor, so the player can tell a cubby is clicked to look at it
     * (review 2026-11-15: nothing said so). At most ~8 picks a second, and only with no button down.
     */
    let lastHoverPick = 0;
    let hoverCursor = false;
    const hoverCubby = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      const now = performance.now();
      if (now - lastHoverPick < 120) return;
      lastHoverPick = now;
      let over = false;
      if (localArea() === "hall" && cubbyFocusAnchor() === null) {
        const hit = pickAt(e.clientX, e.clientY);
        over = !!hit && !hit.blocker && cubbyAtPoint(VILLAGE_LAYOUT, hit.x, hit.y, hit.z) !== null;
      }
      if (over !== hoverCursor) {
        hoverCursor = over;
        el.style.cursor = over ? "pointer" : "";
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        hoverCubby(e);
        return; // a move with no prior down (e.g. hovering): nothing else
      }
      if (clickStart && clickStart.id === e.pointerId) {
        clickStart.travel = pressTravel(clickStart.travel, e.clientX - clickStart.x, e.clientY - clickStart.y);
        // a double tap's second touch turned into a look-drag: no double tap — the first tap walks after all (round 6
        // review: tapped, then dragged at once from the same spot, the tap did nothing)
        if (clickStart.second && clickStart.travel >= TAP_MAX_PX) taps.dragged(e.pointerId);
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
          } else if (viewState.skyLook && viewState.mode === "fp") {
            zoomSkyBy(Math.exp((pinchPrev - curr) * 0.006)); // fingers apart (curr > prev) = lens in
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
        const gain = dragSpeed() * viewState.skyZoom; // zoomed in, a drag turns the view less
        const yaw = normalizeAngle(viewState.fpYaw - DRAG_SIGN * dx * gain);
        // on a ride the look stops where the ride's camera stops (no dead travel, no wrap to the other side)
        viewState.fpYaw = selfRide.slot >= 0 ? clampRideYaw(viewState.fpYaw - DRAG_SIGN * dx * gain) : yaw;
        const pitch = clampFpPitch(viewState.fpPitch + DRAG_SIGN * dy * gain, viewState.skyLook);
        // on a ride (coaster, carousel, wheel) the ride's own camera stops at RIDE_PITCH_MAX: the drag stops there too (no dead travel)
        viewState.fpPitch = selfRide.slot >= 0 ? Math.min(pitch, RIDE_PITCH_MAX) : pitch;
      } else {
        cancelOrbitGoal(); // a drag takes the camera back from any recenter glide
        const gain = dragSpeed();
        orbit.yaw = normalizeAngle(orbit.yaw - DRAG_SIGN * dx * gain);
        // in the bus the third person aims (over the shoulder): its tilt reaches the floor and the ceiling (transitCamera.ts BUS_TP)
        orbit.pitch =
          selfBusRide.slot >= 0
            ? clampBusPitch(orbit.pitch + DRAG_SIGN * dy * gain)
            : clamp(orbit.pitch + DRAG_SIGN * dy * gain, CAMERA.minPitch, CAMERA.maxPitch);
      }
    };
    const onUp = (e: PointerEvent) => {
      // Click-move (design 29): a released candidate that stayed a "click"
      // (short + still + not cancelled) is planned from the surface under it
      // (planClick) and becomes the auto-move target. Skipped in overview (no overview click-move —
      // YAGNI, documented) and inert for clicks on DOM UI, which never reach
      // these canvas-only down handlers. Runs in TP and FP alike (in FP the walk
      // is camera-relative and never turns the look). The touch stick zone passes
      // its quick taps in as a replayed down + up on this canvas (TouchJoystick),
      // so they take exactly this path — on the stick half, hence at once.
      if (clickStart && clickStart.id === e.pointerId) {
        const start = clickStart;
        clickStart = null;
        // Timed by the events' own times, not by when this handler got to run: on a busy page a 60 ms tap's lift
        // was handled 459 ms after its press and dropped as a long press (round 4 review).
        const upAt = eventTime(e);
        const travel = pressTravel(start.travel, e.clientX - start.x, e.clientY - start.y);
        if (start.second) {
          // The second touch of a double tap (decided at its touch-down, onDown): the camera swings back behind the
          // body — unless the touch became a drag (that turned the view) or was cancelled: then it was no double tap,
          // and the first tap walks after all (LookTapGate.dragged, once). No pick, no walk of its own.
          const tapped = e.type === "pointerup" && viewState.mode !== "ov" && travel < TAP_MAX_PX;
          if (!tapped) taps.dragged(e.pointerId);
          taps.up(e.pointerId);
          if (tapped) requestRecenter(pose.yaw);
        } else if (
          e.type === "pointerup" && // a pointercancel is never a click
          viewState.mode !== "ov" &&
          isClick(travel, 0, upAt - start.t, e.pointerType === "touch" ? TAP_MAX_PX : CLICK_MAX_PX) &&
          !hallCubbyClick(e.clientX, e.clientY)
        ) {
          // Which half is the look half follows the left-handed setting — the SAME store
          // field TouchJoystick's prop comes from (WorldScene), so the stick half and
          // the look half can never overlap or leave a gap.
          const leftHanded = useSettingsStore.getState().settings.leftHanded;
          const lookTap = e.pointerType === "touch" && isLookHalf(e.clientX, window.innerWidth, leftHanded);
          if (lookTap) {
            // Look half: wait for a possible second tap. Two taps recenter the camera; one tap walks after
            // DOUBLE_TAP_MS (planned on what the finger actually touched, not wherever the camera is by then), its
            // ring showing from the tap on. The world can change during that wait, so the walk is re-checked when
            // it fires (overview opened, chat took the keyboard, the player sat down or took over meanwhile — see
            // canTapWalk).
            // The pick runs just after this event, on a copy of the camera as it is now: the page answers the finger
            // first, so a second tap is not held up behind the first one's pick (round 3 merge test, round 4 review:
            // a phone under load lost its double tap — a walk instead of a recenter).
            // A look-half tap takes over a mouse/stick plan that is still searching for a route. The two HeldWork
            // lanes must not be allowed to finish out of order and replace this tap's target later.
            clickWork.drop();
            const cam = camera as PerspectiveCamera;
            cam.updateMatrixWorld();
            const tap: LookTap = {
              at: { x: e.clientX, y: e.clientY },
              snap: new PerspectiveCamera().copy(cam, false),
              tappedAt: performance.now(),
              seatedAtTap: seat.index >= 0,
            };
            taps.tap(upAt, e.clientX, e.clientY, () => {
              // a second touch that dropped it turned into a drag: walked after all, at once — unless the player took
              // over since that touch went down
              if (clickGeneration() === secondTouchGeneration) lookTapWalk(tap, false);
            });
            lookTapWalk(tap, true);
          } else {
            // A mouse click, or a tap on the stick half: planned now, walked the moment its plan is made (a way round
            // is looked for over the next moments, its ring showing meanwhile).
            const t0 = performance.now();
            // This input lane takes over any held look-half tap (including its pending ring and route slices).
            taps.reset();
            clickWork.drop(); // a click still being planned gives way to this one
            // riding: a click on a seat sits there (busSeatTap), nothing else walks
            if (!busSeatTap(e.clientX, e.clientY)) {
            let generation = clickGeneration();
            // The pick (a raycast against the whole scene) and the plan run just AFTER this event, on the camera as it is now (the
            // look-half tap's rule: lookTapWalk): INP "event handlers blocked UI updates" (Vercel Toolbar, 207 ms on a phone) counts the
            // handler, and the page answers the press first. A key, the stick or another click meanwhile is a take-over (clickGeneration).
            const cam = camera as PerspectiveCamera;
            cam.updateMatrixWorld();
            const snap = new PerspectiveCamera().copy(cam, false);
            const cx = e.clientX;
            const cy = e.clientY;
            clickWork.hold(() => {
            planClick(
              pickAt(cx, cy, snap),
              (plan, provisional) => {
                // a key, the stick, Esc or a sit while its way round was looked for: the player took over
                if (clickGeneration() !== generation) return;
                if (plan.ok) {
                  setClickTarget(plan.x, plan.z, plan.y, plan.via); // 벽·사람·하늘·갈 수 없는 곳은 무시 (clickPlan.ts)
                  // a seat clicked: the walk ends right at its approach (a step short of it the seat may not be the one offered)
                  if (seatOnArrival.current && seatOnArrival.current.x === plan.x && seatOnArrival.current.z === plan.z) setSeatWalk();
                } else if (clickIntent(plan) === "stop") {
                  clearClickTarget(); // 내 발밑: 그 자리에 멈춤
                } else {
                  if (plan.reason === "unreachable") showUnreachableHint(); // 갈 수 없는 바닥: 짧은 안내 (침묵 대신)
                  if (provisional && peekPendingClick() === provisional) clearPendingClick();
                }
              },
              clickWork,
              {
                t0,
                provisional: true,
                onDefer: () => {
                  stopWalk();
                  generation = clickGeneration();
                },
                snap,
              },
            );
            }, 0);
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
      // The star finder's sky view: the wheel narrows / widens the lens (never leaves first person).
      if (viewState.skyLook && viewState.mode === "fp") {
        zoomSkyBy(Math.exp(Math.max(-300, Math.min(300, e.deltaY)) * 0.0022));
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
      if (hoverCursor) el.style.cursor = "";
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      offHotkey();
      taps.reset();
      clickWork.drop();
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
    // ── A clicked seat on arrival (round 8 review; owner 2026-11-17: no sitting on a tap) ── the walk ends at its approach, the
    // avatar turns to face it, and "앉기" offers that very seat (seatPreference.ts): the visitor sits with the button / E.
    if (seatOnArrival.current) {
      const step = stepSeatOnArrival(seatOnArrival.current, { target: peekClickTarget(), seated: seat.index >= 0, pose, now: performance.now() });
      seatOnArrival.current = step.next;
      if (step.face !== null) faceSeat.current = { index: step.face, x: pose.x, z: pose.z };
    }
    if (faceSeat.current) {
      const f = faceSeat.current;
      const target = (getActiveMap().seats ?? activeSeats())[f.index];
      // a step, a new walk or sitting ends the turn (the body turns with its own walk then)
      const want = target && seat.index < 0 && peekClickTarget() === null && Math.hypot(pose.x - f.x, pose.z - f.z) < 0.02 ? yawToward(pose.x, pose.z, target.x, target.z) : null;
      if (want === null) faceSeat.current = null;
      else {
        pose.yaw = stepYaw(pose.yaw, want, FACE_SEAT_TURN * delta);
        if (Math.abs(normalizeAngle(want - pose.yaw)) < 0.01) faceSeat.current = null;
      }
    }

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
          const yaw = stepKeyYaw(viewState.fpYaw, keys.camLeft, keys.camRight, turnDt);
          viewState.fpYaw = selfRide.slot >= 0 ? clampRideYaw(yaw) : yaw;
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
    if (baseFov.current === 0) baseFov.current = cam.isPerspectiveCamera ? cam.fov : BASE_FOV;
    // Whole-map fit height for the current aspect — seeds the overview and bounds
    // its zoom-out. Recomputed each frame so a viewport resize keeps the ceiling
    // honest (design 20 — nothing hardcoded).
    // The whole map is the ACTIVE map (activeMap.ts): its bounds (the area the player is in, in 케이슨 마을), read
    // as plain numbers.
    const mapBounds = activeBounds();
    fitHeight.current = overviewFitHeight(
      mapBounds.maxX - mapBounds.minX,
      mapBounds.maxZ - mapBounds.minZ,
      (baseFov.current * Math.PI) / 180,
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
    // A place to show (the guide's "지도에서 보기", viewState.showOnMap): centre on it, zoomed in to a part of the map. Read on
    // any overview frame, so an open map is re-framed too; dropped once applied (MapPlaces opens the card of `ovPick`).
    if (viewState.mode === "ov" && viewState.ovFocus) {
      const c = clampOverviewCenter(viewState.ovFocus.x, viewState.ovFocus.z, mapBounds);
      viewState.ovCenterX = c.x;
      viewState.ovCenterZ = c.z;
      viewState.ovHeight = clampOverviewHeight(fitHeight.current * OV_FOCUS_HEIGHT, fitHeight.current);
      viewState.ovFocus = null;
    }
    lastFrameMode.current = viewState.mode;

    // ── Third-person pose ── the follow rig's (followRig.ts): the player's orbit, read and never written, shaped for
    // this frame only by the zoom glide, the portrait pull-back, the place's ceiling limit, the spring arm and the
    // floor stop. It acts ONLY on the TP term, so it never touches the FP eye. The walls are not cast against at full
    // FP weight, where the TP term is not drawn.
    // the body's porch lift (집 외관 A8): the follow camera hangs from the raised head
    const stepLift = getLocalStepLift();
    stepFollowRig(rig, orbit, followX, followZ, aspect, delta, t < 1, tpSpot, stepLift);
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
    // Seated, the FP eye is at the seated head (behind the seat point, a little higher; seatedEye.ts), eased with the clip.
    const seatNow = seat.index >= 0 ? activeSeats()[seat.index] : undefined;
    seatedEyeW.current = stepSeatedWeight(seatedEyeW.current, seatNow !== undefined, delta);
    if (seatNow) seatedEyeSeat.current = seatNow;
    const eyeSeat = seatedEyeSeat.current;
    const eye = eyeSeat ? seatedEyeOffset(eyeSeat.yaw, eyeSeat.seatY, seatedEyeW.current) : { dx: 0, dy: 0, dz: 0 };
    // the first-person eye as estimated from the pose (the render hook moves it onto the head's real eye: fpBody.ts)
    const uFpX = pose.x + eye.dx;
    const uFpZ = pose.z + eye.dz;
    const uPosX = lerp(tpX, uFpX, t);
    // Own hop (jump.ts): the first-person eye and look target rise with the avatar's
    // display-only lift, weighted by the FP blend — the own body is hidden there, so
    // without this a Space press would show nothing. TP (t = 0) is untouched.
    // The porch's lift (A8) too, but not while seated: the seated eye already stands on the seat's own height.
    const hop = getLocalLift() + stepLift * (1 - seatedEyeW.current);
    const uFpY = FP_EYE_HEIGHT + hop + eye.dy;
    const uPosY = lerp(tpY, uFpY, t);
    const uPosZ = lerp(tpZ, pose.z + eye.dz, t);
    // TP looks at the (smoothed) follow point, a little above the head; FP at the
    // pose-anchored eye line.
    const uTgtX = lerp(followX + tpSpot.lookX, pose.x + eye.dx + fwdX, t);
    const uTgtY = lerp(HEAD_HEIGHT + stepLift + CAMERA_LOOK_LIFT + tpLookLift, FP_EYE_HEIGHT + hop + eye.dy + fwdY, t);
    const uTgtZ = lerp(followZ + tpSpot.lookZ, pose.z + eye.dz + fwdZ, t);

    // ── Overview pose ── straight up over the pan-centre, looking down. A camera limit (a building's ceiling) is
    // bypassed here by construction (this is a separate pose term, never routed through the limit). ──
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

    // A memorial cubby's close-up (cubbyFocus.ts): the camera glides from the player's view to the front of that cubby, at its
    // height, and back when the card closes. The player's own orbit is never written: closing it puts the view back as it was.
    const fw = stepCubbyFocus(delta, aspect, baseFov.current, focusPose);
    if (fw > 0) {
      const p = camera.position;
      const lx = lerp(uTgtX, ovPosX, ovT);
      const ly = lerp(uTgtY, 0, ovT);
      const lz = lerp(uTgtZ, ovPosZ, ovT);
      p.set(lerp(p.x, focusPose.ex, fw), lerp(p.y, focusPose.ey, fw), lerp(p.z, focusPose.ez, fw));
      camera.up.set(0, 1, 0);
      camera.lookAt(lerp(lx, focusPose.tx, fw), lerp(ly, focusPose.ty, fw), lerp(lz, focusPose.tz, fw));
    }

    // While riding, the camera is the village's own orbit tied to the BUS's frame (transitCamera.ts, owner 2026-11-15: look
    // out of every window): drag / pinch / wheel turn and zoom it round the rider as in the village (orbit.yaw is
    // relative to the bus's heading, so it turns with the bus), the panel's quick views ease it, and all the way in it is
    // the rider's own eye. The world camera resumes on the very next frame after the authoritative leave state.
    if (selfBusRide.slot >= 0) {
      const persp = camera as PerspectiveCamera;
      if (busModeBeforeRef.current === null) {
        // boarding: first person is the default way to look out of the windows (owner 2026-11-16); V / the eye button / a zoom-out still give the third person
        busModeBeforeRef.current = viewState.mode;
        if (viewState.mode === "tp") {
          enterFp(orbit.yaw);
          viewState.fpPitch = 0;
        }
      }
      // first <-> third person keep the same aim (docs/designs/bus-controls.md): the yaw is carried by enterFp / exitFp, the pitch here
      if (viewState.mode !== "ov") {
        const last = busLastMode.current;
        if (last !== null && last !== viewState.mode) {
          if (viewState.mode === "tp") orbit.pitch = clampBusPitch(viewState.fpPitch);
          else viewState.fpPitch = clampFpPitch(orbit.pitch);
        }
        busLastMode.current = viewState.mode;
      }
      const fp = viewState.mode === "fp";
      if (busCamGoal.yaw !== null) {
        // the quick view's glide: the look yaw (first person) or the orbit yaw (third), relative to the bus
        const cur = fp ? viewState.fpYaw : orbit.yaw;
        const d = normalizeAngle(busCamGoal.yaw - cur);
        const next = normalizeAngle(cur + d * Math.min(1, delta * 7));
        if (fp) viewState.fpYaw = next;
        else orbit.yaw = next;
        if (Math.abs(d) < 0.01) busCamGoal.yaw = null;
      }
      const place = busPlaceOf(selfBusRide.slot);
      const bus = getTransitRenderPose();
      const spot = place.kind === "seat" ? seatBodyPoint(BUS_SEATS[place.index]!) : undefined;
      const local = riderBusPoint(selfBusRide, place.kind, spot);
      // the third person's shoulder: the one with room beside the head, eased across when it changes
      // (a portrait phone prefers the left shoulder, the rider on the right of the screen: the ride panel covers the left)
      busShoulder.side = busShoulderSide(local.right, orbit.yaw, busShoulder.side, persp.aspect < 1 ? -1 : 1);
      busShoulder.ease += (busShoulder.side - busShoulder.ease) * Math.min(1, delta * 5);
      const ride = busRiderCamera(
        {
          bus,
          ahead: local.ahead,
          right: local.right,
          floor: cabinFloorAt(local.ahead, local.right),
          seated: place.kind === "seat",
          yaw: fp ? viewState.fpYaw : orbit.yaw,
          elevation: fp ? viewState.fpPitch : clampBusPitch(orbit.pitch),
          dist: fp ? 0 : orbit.distance, // the player's own zoom; only the cabin's walls and ceiling shorten it (owner 2026-11-16)
          shoulder: busShoulder.ease * busShoulderScale(persp.aspect),
          portrait: persp.aspect < 1,
        },
        busRideCam,
      );
      busHidden.current = busSelfHidden(busHidden.current, ride, persp.aspect < 1);
      camera.position.set(ride.x, ride.y, ride.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(ride.targetX, ride.targetY, ride.targetZ);
      const wantNear = 0.05;
      if (persp.near !== wantNear) {
        nearBeforeRideRef.current = persp.near;
        persp.near = wantNear;
        persp.updateProjectionMatrix();
      }
      busCamState.active = true;
      busCamState.firstPerson = ride.firstPerson;
      busCamState.selfHidden = busHidden.current;
      busCamState.arm = ride.arm;
      const fxx = Math.sin(bus.yaw);
      const fzz = Math.cos(bus.yaw);
      const dx = ride.x - bus.x;
      const dz = ride.z - bus.z;
      busCamState.eye[0] = dx * fxx + dz * fzz;
      busCamState.eye[1] = -dx * fzz + dz * fxx;
      busCamState.eye[2] = ride.y;
      const headFloor = cabinFloorAt(local.ahead, local.right);
      busCamState.head[0] = local.ahead;
      busCamState.head[1] = local.right;
      busCamState.head[2] = headFloor + (place.kind === "seat" ? 1.62 : 1.95);
      busCamState.chest[0] = local.ahead;
      busCamState.chest[1] = local.right;
      busCamState.chest[2] = headFloor + (place.kind === "seat" ? 1.0 : 1.3);
      cameraProbe.distance = ride.arm;
      // The cabin is small (review r3: the rider filled the frame): a wider lens in the bus, as a phone's camera held up
      // in one, put back exactly as it was on getting off.
      const want = riderFov(persp.aspect);
      if (persp.isPerspectiveCamera && persp.fov !== want) {
        if (fovBeforeRideRef.current === null) fovBeforeRideRef.current = persp.fov;
        persp.fov = want;
        persp.updateProjectionMatrix();
      }
    } else if (fovBeforeRideRef.current !== null || busModeBeforeRef.current !== null) {
      if (busModeBeforeRef.current === "tp" && viewState.mode === "fp") exitFp(orbit); // got off: the view the player had before boarding
      busModeBeforeRef.current = null;
      busLastMode.current = null;
      busHidden.current = false;
      if (fovBeforeRideRef.current !== null) {
        const persp = camera as PerspectiveCamera;
        persp.fov = fovBeforeRideRef.current;
        persp.near = nearBeforeRideRef.current;
        persp.updateProjectionMatrix();
      }
      fovBeforeRideRef.current = null;
      busCamState.active = false;
      busCamState.firstPerson = false;
      busCamState.selfHidden = false;
    }

    // The 별똥별 급행 (케이슨랜드): the camera is the rider's eye in the car's frame (land/coasterRide.ts). Looking round is the first-person
    // drag (fpYaw to the left, fpPitch down, relative to the car). The village's own camera resumes on the frame the seat is freed.
    if (selfRide.slot >= 0) {
      const persp = camera as PerspectiveCamera;
      if (rideBeforeRef.current === null) {
        rideBeforeRef.current = { mode: viewState.mode, fov: persp.fov, near: persp.near };
        if (viewState.mode !== "fp") enterFp(orbit.yaw);
        viewState.fpYaw = 0;
        viewState.fpPitch = selfRide.ride === 2 ? -0.04 : selfRide.ride === 3 ? 0.12 : selfRide.ride === 4 ? -0.12 : selfRide.ride === 5 ? 0.08 : 0.1; // a rider settles looking a little down at the bar (on the carousel: level, over the horse's ears)
        resetRideCamera();
        resetCarouselCamera();
        resetWheelCamera();
        resetMoonBoatCamera();
        resetDropCamera();
        persp.near = 0.05;
        persp.updateProjectionMatrix();
      }
      if (selfRide.ride === 5) stepDropCamera(persp, Math.min(delta, 0.1), viewState.fpYaw, viewState.fpPitch, baseFov.current || rideBeforeRef.current.fov);
      else if (selfRide.ride === 4) stepMoonBoatCamera(persp, Math.min(delta, 0.1), viewState.fpYaw, viewState.fpPitch, baseFov.current || rideBeforeRef.current.fov);
      else if (selfRide.ride === 3) stepWheelCamera(persp, Math.min(delta, 0.1), viewState.fpYaw, viewState.fpPitch, baseFov.current || rideBeforeRef.current.fov);
      else if (selfRide.ride === 2) stepCarouselCamera(persp, Math.min(delta, 0.1), viewState.fpYaw, viewState.fpPitch, baseFov.current || rideBeforeRef.current.fov);
      else {
        stepRideCamera(persp, Math.min(delta, 0.1), viewState.fpYaw, viewState.fpPitch, baseFov.current || rideBeforeRef.current.fov);
        stepRideAudio(performance.now());
      }
      cameraProbe.distance = 0;
    } else if (rideBeforeRef.current !== null) {
      const was = rideBeforeRef.current;
      rideBeforeRef.current = null;
      if (was.mode === "tp" && viewState.mode === "fp") exitFp(orbit);
      const persp = camera as PerspectiveCamera;
      persp.fov = was.fov;
      persp.near = was.near;
      persp.updateProjectionMatrix();
      resetRideCamera();
      resetCarouselCamera();
      stopRideAudio();
      resetWheelCamera();
      resetMoonBoatCamera();
      resetDropCamera();
    }

    // Overview looks down from far above; push the fog band out (eased by ovT) so
    // the whole map reads crisply instead of hazing into the sky. Restored exactly
    // to the scene's fog band at ovT = 0.
    const fog = state.scene.fog as Fog | null;
    if (fog && (fog as { isFog?: boolean }).isFog) {
      const h = viewState.ovHeight;
      const fogNear = fogRange[0]; // index reads, not destructuring: nothing allocated per frame
      const fogFar = fogRange[1];
      fog.near = lerp(fogNear, Math.max(fogNear, h * 0.6), ovT);
      fog.far = lerp(fogFar, Math.max(fogFar, h * 2.2), ovT);
      // the park's aerial perspective with height (land/parkAltitude.ts): the far ground hazes sooner, so the haze line falls below the eye
      if (parkAltitude.a > 0) {
        fog.near = altitudeFogNear(fog.near, parkAltitude.a);
        fog.far = altitudeFogFar(fog.far, parkAltitude.a);
      }
    }

    // The far plane rides with the overview too: the whole-map fit height is width-limited
    // on a tall phone (209 m at 375×812), past CAMERA_FAR, and the map would be clipped
    // away entirely. Continuous in ovT, and restored exactly to the scene's far plane at 0.
    // The over-the-shoulder view against an indoor wall widens a portrait phone's view (cameraShoulder.ts), third person only.
    // In the bus the rider's own lens (riderFov, set above) stays as it is.
    // The star finder's zoom (a narrower lens while looking up at the sky; eased, back to 1 when it is closed).
    viewState.skyFovBase = baseFov.current;
    const zoomOn = viewState.skyLook && viewState.mode === "fp";
    if (!zoomOn) viewState.skyZoomGoal = 1;
    if (viewState.skyZoom !== viewState.skyZoomGoal) {
      const dz = viewState.skyZoomGoal - viewState.skyZoom;
      viewState.skyZoom = Math.abs(dz) < 0.002 ? viewState.skyZoomGoal : viewState.skyZoom + dz * (1 - Math.exp(-9 * Math.min(delta, 0.1)));
    }
    const fov = (baseFov.current + tpSpot.fovAdd * (1 - t) * (1 - ovT) * (1 - fw)) * viewState.skyZoom;
    if (selfBusRide.slot < 0 && selfRide.slot < 0 && cam.isPerspectiveCamera && Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const far = overviewFar(baseFar, viewState.ovHeight, ovT);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }

    // DEV/E2E only: a fixed photo camera (window.__cvShot = { x, y, z, tx, ty, tz, fov? }) over the rig's pose, for the
    // evidence sheets' street views (e2e/village-exteriors.mjs). Tree-shaken in production.
    if (import.meta.env.DEV) {
      const shot = (window as unknown as { __cvShot?: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov?: number } | null }).__cvShot;
      if (shot) {
        camera.position.set(shot.x, shot.y, shot.z);
        camera.up.set(0, 1, 0);
        camera.lookAt(shot.tx, shot.ty, shot.tz);
        if (cam.isPerspectiveCamera && shot.fov && Math.abs(cam.fov - shot.fov) > 1e-3) {
          cam.fov = shot.fov;
          cam.updateProjectionMatrix();
        }
      }
    }

    // True first person (fpBody.ts): the eye estimated here from the pose is moved onto the own head's eye point by the scene's
    // render hook, once the body's pose for this frame is final, by the first person's weight. In the bus's first person and on
    // a 케이슨랜드 ride the eye is the seated rider's head as well: the ride's own camera keeps its look (the car's frame, the head's
    // lag and lean), only its point moves onto the head that is drawn in the seat (the rides' eyes sat 0.4 m lower, in the
    // chest of the body now drawn there). The DEV photo camera is left where it was put.
    const devShot = import.meta.env.DEV && !!(window as unknown as { __cvShot?: unknown }).__cvShot;
    if (devShot || fpBodyOff()) fpEye.w = 0;
    else if (selfBusRide.slot >= 0 || selfRide.slot >= 0) {
      fpEye.w = selfRide.slot >= 0 || busCamState.firstPerson ? 1 : 0;
      fpEye.x = camera.position.x;
      fpEye.y = camera.position.y;
      fpEye.z = camera.position.z;
    } else {
      fpEye.w = t * (1 - ovT) * (1 - fw);
      fpEye.x = uFpX;
      fpEye.y = uFpY;
      fpEye.z = uFpZ;
      // the near plane: the scene's own in third person and the overview, FP_NEAR once the camera is in at the eye
      if (baseNear.current === 0) baseNear.current = cam.near;
      const wantNear = fpEye.w > 0.5 ? FP_NEAR : baseNear.current;
      if (cam.near !== wantNear) {
        cam.near = wantNear;
        cam.updateProjectionMatrix();
      }
    }
    {
      // on foot (the head's walking bob is held out of the eye: fpBody.ts steadyHead) and walking
      const sdt = Math.max(1e-3, Math.min(0.1, delta));
      const sp = Math.hypot(pose.x - steadyPrev.current.x, pose.z - steadyPrev.current.z) / sdt;
      steadyPrev.current.x = pose.x;
      steadyPrev.current.z = pose.z;
      steadyPrev.current.v += (sp - steadyPrev.current.v) * Math.min(1, sdt * 12);
      fpEye.onFoot = selfRide.slot < 0 && selfBusRide.slot < 0 && seat.index < 0 && seatedEyeW.current < 0.01;
      fpEye.moving = steadyPrev.current.v > STEADY_MOVING;
    }
    fpEye.side = selfRide.slot >= 0 && selfRide.ride === RIDE.carousel ? CAROUSEL_SIDE : 0;
    fpEye.camera = camera;
    fpEye.armed = fpEye.w > 0;

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
