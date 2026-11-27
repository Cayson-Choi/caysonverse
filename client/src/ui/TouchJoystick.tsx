import { useEffect, useRef } from "react";
import {
  STICK_RADIUS_PX,
  createStickState,
  stickDownAt,
  stickMove,
  stickUp,
} from "../game/joystick";
import type { MoveInput } from "../game/input";
import { useViewStore } from "../stores/viewStore";
import { useUiStore } from "../stores/uiStore";
import "./touch.css";

interface TouchJoystickProps {
  /**
   * Shared movement input (the SAME object LocalPlayer reads and the keyboard's
   * intent is added to). Written on every stick move, zeroed on release/unmount.
   * `run` is true while the stick is pushed out to the rim (see stickGait).
   */
  moveInput: MoveInput;
  /**
   * Mirror the stick to the lower-RIGHT quarter. WorldScene passes the "왼손잡이 모드"
   * setting; CameraRig reads the same store field for its look half, so the two halves
   * always agree.
   */
  leftHanded?: boolean;
}

/** Half of the knob's CSS size (48px) — centres it on the thumb. */
const KNOB_HALF_PX = 24;

/**
 * Where the stick rests while no thumb is on it: always drawn there, faint, so a first-time
 * player sees at once that the lower-left corner moves the avatar (owner 11-26: "조이스틱이
 * 왼쪽 하단에 항상 표시"). Mirrored for left-handers. Inside the stick zone on any screen.
 */
export function stickRestPoint(vw: number, vh: number, leftHanded: boolean): { x: number; y: number } {
  const x = STICK_REST_SIDE_PX + STICK_RADIUS_PX;
  const y = vh - STICK_REST_BOTTOM_PX - STICK_RADIUS_PX;
  return { x: leftHanded ? vw - x : x, y: Math.max(y, vh / 2 + STICK_RADIUS_PX) };
}
/** Rest stick: base's distance from the side edge (clear of the OS back-gesture strip). */
const STICK_REST_SIDE_PX = 40;
/** Rest stick: base's distance from the bottom edge (clear of a phone's home bar). */
const STICK_REST_BOTTOM_PX = 44;

/** How far from the stick's centre a thumb may land and still take it (px): the base's rim plus a thumb's slack. */
export const STICK_HIT_PX = STICK_RADIUS_PX + 28;

/** Centre `el` (a fixed div at the viewport origin) on viewport point (cx, cy). */
function place(el: HTMLElement, cx: number, cy: number, halfPx: number): void {
  el.style.transform = `translate(${cx - halfPx}px, ${cy - halfPx}px)`;
}

/**
 * Fixed joystick (touch devices only): a faint stick always rests in the lower-left corner
 * (stickRestPoint). Only a thumb put ON it moves the avatar (owner 2026-11-27: "이동은 조이스틱있는데서만
 * 가능하도록"): push lightly to walk, to the rim to run; lift and the knob goes back to the centre. The zone is a
 * circle just around the stick and swallows its own pointers, so a stick drag never rotates the camera; a touch
 * anywhere else on the screen is the camera's (drag to turn, pinch) — and a tap there still walks to that spot (owner 11-27:
 * "특정 지점을 찍으면 이동하는건 동작해야해"; CameraRig).
 *
 * In the overview map the stick is off: the zone turns click-through (`is-ov`) so a
 * one-finger drag pans the map as before. Turning the map on mid-drag re-runs the
 * effect, whose cleanup releases the stick (art hidden, `moveInput` zeroed). The
 * same cleanup covers a `leftHanded` flip mid-drag and the Esc menu opening mid-drag.
 *
 * All the logic is the pure state machine in game/joystick.ts. This component
 * only wires pointer events to it and moves two divs: per-move work writes
 * `moveInput` and `style.transform` through refs — never React state (the
 * only React state read is the rare overview / menu flags, not per-frame data).
 */
export function TouchJoystick({ moveInput, leftHanded = false }: TouchJoystickProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const isOv = useViewStore((s) => s.isOv);
  const menuOpen = useUiStore((s) => s.menuOpen);

  useEffect(() => {
    const zone = zoneRef.current;
    const stick = stickRef.current;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!zone || !stick || !base || !knob) return;

    const state = createStickState();

    const clearInput = () => {
      moveInput.forward = 0;
      moveInput.right = 0;
      moveInput.run = false;
    };
    // No thumb down: the stick sits at its rest point, faint (is-rest).
    const rest = () => {
      const p = stickRestPoint(window.innerWidth, window.innerHeight, leftHanded);
      place(base, p.x, p.y, STICK_RADIUS_PX);
      place(knob, p.x, p.y, KNOB_HALF_PX);
      place(zone, p.x, p.y, STICK_HIT_PX);
    };
    const hide = () => {
      stick.classList.remove("is-active");
      knob.classList.remove("is-run");
      rest();
    };
    // Overview: the zone is click-through, so there is nothing to listen for. The menu
    // covers the zone while it is open, so no new stick can start; this also lets go
    // of one that was already down. No rest stick either (nothing to move).
    if (isOv || menuOpen) {
      stick.classList.remove("is-rest");
      return;
    }
    rest();
    stick.classList.add("is-rest");
    const onResize = () => {
      if (state.pointerId === null) rest();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = stickRestPoint(window.innerWidth, window.innerHeight, leftHanded);
      if (!stickDownAt(state, e.pointerId, e.clientX, e.clientY, p.x, p.y, STICK_HIT_PX)) {
        return; // a second finger, or the zone's corner outside the circle: swallowed, nothing happens
      }
      stick.classList.add("is-active");
      onMove(e); // a press beside the centre already pushes that way
    };

    const onMove = (e: PointerEvent) => {
      const input = stickMove(state, e.pointerId, e.clientX, e.clientY);
      if (!input) return;
      moveInput.forward = input.forward;
      moveInput.right = input.right;
      moveInput.run = input.run;
      // The knob follows the thumb but stays inside the base's rim.
      const dx = e.clientX - state.ox;
      const dy = e.clientY - state.oy;
      const dist = Math.hypot(dx, dy);
      const k = dist > STICK_RADIUS_PX ? STICK_RADIUS_PX / dist : 1;
      place(knob, state.ox + dx * k, state.oy + dy * k, KNOB_HALF_PX);
      knob.classList.toggle("is-run", input.run);
    };

    const onEnd = (e: PointerEvent) => {
      if (!stickUp(state, e.pointerId)) return;
      hide();
      clearInput();
    };

    // The window losing focus mid-drag can swallow the lift: never keep walking.
    const onBlur = () => {
      if (state.pointerId !== null && stickUp(state, state.pointerId)) {
        hide();
        clearInput();
      }
    };
    // A long press must not open the browser's context menu over the stick.
    const onContextMenu = (e: Event) => e.preventDefault();

    zone.addEventListener("pointerdown", onDown);
    zone.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      zone.removeEventListener("pointerdown", onDown);
      zone.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("blur", onBlur);
      // Never strand a stale intent or a drawn stick after unmount, a `leftHanded`
      // flip or the map turning on mid-drag — the avatar would keep walking.
      hide();
      clearInput();
      stick.classList.remove("is-rest");
    };
  }, [moveInput, leftHanded, isOv, menuOpen]);

  return (
    <>
      <div
        ref={zoneRef}
        className={"cv-stick-zone" + (isOv || menuOpen ? " is-ov" : "")}
        aria-hidden="true"
      />
      <div ref={stickRef} className="cv-stick" aria-hidden="true">
        <div ref={baseRef} className="cv-stick-base" />
        <div ref={knobRef} className="cv-stick-knob" />
      </div>
    </>
  );
}
