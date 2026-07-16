/**
 * First-person / third-person runtime state (module mutable — NEVER React state)
 * plus the discrete toggle mutations. Read every frame by CameraRig (camera pose)
 * and LocalPlayer (own-avatar hiding + camera-relative movement yaw); mutated only
 * by the four toggle paths (V key / wheel / pinch / 👁 button) and the reconnect
 * remount reset. The pure math lives in viewMode.ts; the UI button flag lives in
 * the zustand viewStore.
 *
 * Yaw continuity (design 19): on ENTER, the FP look yaw seeds from the current TP
 * orbit yaw; on EXIT, the TP orbit yaw seeds back from the FP look yaw — so the
 * world never spins across a toggle. FP look PITCH is a separate value and never
 * touches orbit.pitch; the TP orbit distance/pitch are preserved across the round
 * trip (FP simply ignores them).
 */

import { normalizeAngle } from "./yaw";
import { stepBlend, stepZoomMode, type ViewMode, type ZoomBand } from "./viewMode";
import { useViewStore } from "../stores/viewStore";
import type { Orbit } from "./types";

export interface ViewState {
  /** Active view mode. `blend` animates the visual transition toward it. */
  mode: ViewMode;
  /** 0 = fully third-person, 1 = fully first-person (eased in CameraRig). */
  blend: number;
  /** FP look azimuth (rad), SAME convention as orbit.yaw so seeding is a copy. */
  fpYaw: number;
  /** FP look pitch (rad), separate from orbit.pitch; clamped to the FP range. */
  fpPitch: number;
}

/** The single shared view state — mutated in place, read per frame. */
export const viewState: ViewState = { mode: "tp", blend: 0, fpYaw: 0, fpPitch: 0 };

/** Mirror the mode into the UI button flag (drives one React render, off-frame). */
function syncButton(): void {
  useViewStore.getState().setFp(viewState.mode === "fp");
}

/** Enter first-person, seeding the look yaw from the current TP orbit yaw. */
export function enterFp(orbitYaw: number): void {
  viewState.fpYaw = normalizeAngle(orbitYaw);
  viewState.mode = "fp";
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
 * Advance the blend factor toward the active mode's target (1 = FP, 0 = TP) by
 * `dt`. Called once per frame by CameraRig; returns the new factor. Reversal-safe
 * (a mid-blend toggle just flips the target and the factor continues).
 */
export function stepViewBlend(dt: number): number {
  const target = viewState.mode === "fp" ? 1 : 0;
  viewState.blend = stepBlend(viewState.blend, target, dt);
  return viewState.blend;
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
  syncButton();
}
