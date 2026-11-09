/**
 * First-person / third-person runtime state (module mutable — NEVER React state)
 * plus the discrete toggle mutations. Read every frame by CameraRig (camera pose)
 * and LocalPlayer (own-avatar hiding + camera-relative movement yaw); mutated only
 * by the four toggle paths (V key / wheel / pinch / 👁 button), the camera-goal
 * requests the player makes (R / double tap → `orbitGoal`) and the reconnect remount
 * reset. Sitting and standing no longer move the camera (owner 2026-11-10; see
 * `beginSeatCamera`). The pure math lives in viewMode.ts and
 * cameraControls.ts; the UI button flag lives in the zustand viewStore.
 *
 * Yaw continuity (design 19): on ENTER, the FP look yaw seeds from the current TP
 * orbit yaw; on EXIT, the TP orbit yaw seeds back from the FP look yaw — so the
 * world never spins across a toggle. FP look PITCH is a separate value and never
 * touches orbit.pitch; the TP orbit distance/pitch are preserved across the round
 * trip (FP simply ignores them).
 */

import { normalizeAngle } from "./yaw";
import { recenterYaw, type OrbitGoal } from "./cameraControls";
import { getActiveMap } from "./activeMap";
import { overviewAllowed } from "./indoorCamera";
import { stepBlend, stepZoomMode, OV_BLEND_SEC, type ViewMode, type ZoomBand } from "./viewMode";
import { useViewStore } from "../stores/viewStore";
import type { Orbit } from "./types";

export interface ViewState {
  /** Active view mode ('tp' | 'fp' | 'ov'). `blend`/`ovBlend` animate the visuals. */
  mode: ViewMode;
  /** 0 = fully third-person, 1 = fully first-person (eased in CameraRig). */
  blend: number;
  /** FP look azimuth (rad), SAME convention as orbit.yaw so seeding is a copy. */
  fpYaw: number;
  /** FP look pitch (rad), separate from orbit.pitch; clamped to the FP range. */
  fpPitch: number;
  /** 0 = the underlying tp/fp pose, 1 = fully the top-down overview pose. */
  ovBlend: number;
  /** Mode to restore when overview exits ('tp' | 'fp' — never 'ov'). */
  prevMode: ViewMode;
  /** Overview pan-centre X (world). Clamped to WORLD_BOUNDS while panning. */
  ovCenterX: number;
  /** Overview pan-centre Z (world). */
  ovCenterZ: number;
  /** Overview camera height (m) — the zoom level. 0 until CameraRig seeds a fit. */
  ovHeight: number;
  /**
   * Where the TP orbit should glide to because the player asked (R, double tap), or
   * null. CameraRig steps it every frame and drops it on arrival; a drag, wheel, pinch,
   * Z / C, entering first-person or a door cancels it.
   */
  orbitGoal: OrbitGoal | null;
}

/** The single shared view state — mutated in place, read per frame. */
export const viewState: ViewState = {
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
};

/** Mirror the active mode into the UI button flags (one React render, off-frame). */
function syncButton(): void {
  const store = useViewStore.getState();
  store.setFp(viewState.mode === "fp");
  store.setOv(viewState.mode === "ov");
}

/** The mode whose pose sits UNDER the overview (the one we'll restore on exit). */
function underlyingMode(): ViewMode {
  return viewState.mode === "ov" ? viewState.prevMode : viewState.mode;
}

/** Enter first-person, seeding the look yaw from the current TP orbit yaw. */
export function enterFp(orbitYaw: number): void {
  viewState.fpYaw = normalizeAngle(orbitYaw);
  viewState.mode = "fp";
  viewState.orbitGoal = null; // a TP glide must not keep turning the orbit behind the FP view
  syncButton();
}

/** Exit to third-person, seeding the orbit yaw back from the FP look yaw. */
export function exitFp(orbit: Orbit): void {
  orbit.yaw = normalizeAngle(viewState.fpYaw);
  viewState.mode = "tp";
  syncButton();
}

/** Toggle between modes (V key / 👁 button). Reads/writes orbit.yaw for seeding. */
export function toggleViewMode(orbit: Orbit): void {
  if (viewState.mode === "tp") enterFp(orbit.yaw);
  else exitFp(orbit);
}

/**
 * Apply one wheel/pinch zoom step (unified). `delta` is signed metres to add to
 * the follow distance (negative = in, positive = out); the wheel and pinch
 * handlers derive it from their own units. Crosses into / out of FP at the zoom
 * extremes per stepZoomMode, seeding yaw on any toggle.
 */
export function applyZoom(orbit: Orbit, delta: number, band: ZoomBand): void {
  const res = stepZoomMode(viewState.mode, orbit.distance, delta, band);
  orbit.distance = res.distance;
  if (!res.toggled) return;
  if (res.mode === "fp") enterFp(orbit.yaw);
  else exitFp(orbit);
}

/**
 * Enter the top-down overview (design 20), remembering the current mode so exit
 * restores it. A no-op if already in overview — so pressing the toggle rapidly
 * (M-spam) can never overwrite `prevMode` with 'ov' and strand the machine. The
 * overview pan-centre / height are seeded by CameraRig on the first overview
 * frame (it owns the camera fov/aspect the fit calculation needs).
 *
 * Refused where the active map's camera limit says no overview (inside a building, 케이슨 마을 Task 5): a
 * top-down view of a room would show it from above its roof. Every way in (the M key, the map button) lands here.
 */
export function enterOverview(): void {
  if (viewState.mode === "ov") return;
  if (!overviewAllowed(getActiveMap().cameraLimit)) return;
  viewState.prevMode = viewState.mode; // 'tp' or 'fp'
  viewState.mode = "ov";
  syncButton();
}

/** Exit the overview back to whatever mode it was opened from (design 20). */
export function exitOverview(): void {
  if (viewState.mode !== "ov") return;
  viewState.mode = viewState.prevMode;
  syncButton();
}

/**
 * Leave the overview AT ONCE, with no blend left to ease out: back to the mode it was opened from, `ovBlend` 0. For
 * a place that has no overview (walking into a building with the map open): an eased exit would fly the camera
 * from the map's height over the other area to the player. Does nothing when no overview is showing.
 */
export function dropOverview(): void {
  exitOverview();
  viewState.ovBlend = 0;
}

/**
 * Toggle the overview (M key / 🗺 button). Enter remembers the current mode; exit
 * restores it with the FP look / TP orbit exactly as they were (overview never
 * mutates fpYaw or the orbit, so a round-trip preserves both).
 */
export function toggleOverview(): void {
  if (viewState.mode === "ov") exitOverview();
  else enterOverview();
}

/**
 * Ask the third-person camera to swing back behind the body (R key, double tap on
 * the right half of the screen). The orbit yaw glides to `recenterYaw(bodyYaw)` —
 * CameraRig does the stepping. Only third-person has an orbit to turn: in
 * first-person the body already faces the view, and the overview map has no body
 * view, so the request is ignored there.
 */
export function requestRecenter(bodyYaw: number): void {
  if (viewState.mode !== "tp") return;
  viewState.orbitGoal = { yaw: recenterYaw(bodyYaw) };
}

/** Drop any pending orbit goal (the player took the camera back: drag, wheel, pinch, Z / C). */
export function cancelOrbitGoal(): void {
  viewState.orbitGoal = null;
}

/**
 * The seat is confirmed. The camera stays exactly as the player has it (owner
 * 2026-11-10: "자동으로 바뀌니까 헷갈려") — it used to swing behind the chair at a preset
 * tilt and distance (third person) or snap the look onto the screen (first person), and
 * glide back on standing up. Kept as the sit flow's camera hook (LocalPlayer calls it on
 * every confirmed sit), deliberately empty: neither the orbit nor the view state changes.
 */
export function beginSeatCamera(_orbit: Orbit, _seatYaw: number): void {
  // Nothing: sitting down does not move the camera.
}

/** The player stood up: the camera stays as it is, like on sitting down (see `beginSeatCamera`). */
export function endSeatCamera(_orbit?: Orbit): void {
  // Nothing: standing up does not move the camera.
}

/**
 * Advance the TP<->FP blend toward its target by `dt`. In overview the target is
 * the REMEMBERED mode's pose (1 = FP, 0 = TP) so the pose beneath the overview
 * stays put and a restore lands exactly where it left. Reversal-safe.
 */
export function stepViewBlend(dt: number): number {
  const target = underlyingMode() === "fp" ? 1 : 0;
  viewState.blend = stepBlend(viewState.blend, target, dt);
  return viewState.blend;
}

/**
 * Advance the overview blend toward its target (1 = overview, 0 = normal) by
 * `dt`. Separate machine from the TP<->FP blend so the two compose in CameraRig;
 * reversal-safe (a mid-blend re-toggle continues from the current value).
 */
export function stepOvBlend(dt: number): number {
  const target = viewState.mode === "ov" ? 1 : 0;
  viewState.ovBlend = stepBlend(viewState.ovBlend, target, dt, OV_BLEND_SEC);
  return viewState.ovBlend;
}

/**
 * Reset to a fresh third-person view (visible avatar, level look). Called on every
 * WorldScene mount — initial join AND each reconnect remount — so a world can
 * never come up stuck in FP with the own avatar hidden. View mode intentionally
 * does NOT persist across a reconnect (design 19 allows the reset).
 */
export function resetViewMode(): void {
  viewState.mode = "tp";
  viewState.blend = 0;
  viewState.fpYaw = 0;
  viewState.fpPitch = 0;
  viewState.ovBlend = 0;
  viewState.prevMode = "tp";
  viewState.ovCenterX = 0;
  viewState.ovCenterZ = 0;
  viewState.ovHeight = 0;
  viewState.orbitGoal = null;
  syncButton();
}
