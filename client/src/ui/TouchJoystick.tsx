import { useEffect, useRef } from "react";
import {
  STICK_RADIUS_PX,
  createStickState,
  isStickTap,
  stickDown,
  stickMove,
  stickUp,
} from "../game/joystick";
import type { MoveInput } from "../game/input";
import { pressTravel } from "../game/clickMove";
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

/** Centre `el` (a fixed div at the viewport origin) on viewport point (cx, cy). */
function place(el: HTMLElement, cx: number, cy: number, halfPx: number): void {
  el.style.transform = `translate(${cx - halfPx}px, ${cy - halfPx}px)`;
}

/**
 * Hand a quick tap to the 3D canvas as a normal press-and-release, so a tap in
 * the stick zone still becomes a click-move (CameraRig turns a short, still press
 * on the canvas into the ground target). The zone sits above the canvas, so the
 * real tap never reached it; the replay carries the real pointer's position.
 */
function passTapToGround(e: PointerEvent): void {
  const canvas = document.querySelector(".cv-canvas canvas");
  if (!canvas) return;
  const init: PointerEventInit = {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    isPrimary: true,
    button: 0,
    clientX: e.clientX,
    clientY: e.clientY,
    bubbles: true,
    cancelable: true,
  };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", init));
}

/**
 * Dynamic joystick (touch devices only): put a thumb anywhere in the lower-left
 * quarter of the screen and a stick appears right there; push lightly to walk, to
 * the rim to run; lift to hide it. The zone element swallows its own pointers, so
 * a stick drag never reaches the canvas and never rotates the camera — except a
 * quick tap, which is passed on as a click-move tap (see passTapToGround).
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
    let downX = 0;
    let downY = 0;
    let downAt = 0;
    // The farthest the press has gone from where it went down (px): a push that came back to its start is still a
    // stick push, not a tap (round 4 review — it walked on the stick and then to the ground under the thumb as well).
    let travel = 0;
    // The event's own time (ms, performance.now()'s clock): a busy page handles a lift late, not a long press.
    const eventTime = (e: PointerEvent) => (e.timeStamp > 0 ? e.timeStamp : performance.now());

    const clearInput = () => {
      moveInput.forward = 0;
      moveInput.right = 0;
      moveInput.run = false;
    };
    const hide = () => {
      stick.classList.remove("is-active");
      knob.classList.remove("is-run");
    };
    // Overview: the zone is click-through, so there is nothing to listen for. The menu
    // covers the zone while it is open, so no new stick can start; this also lets go
    // of one that was already down.
    if (isOv || menuOpen) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { innerWidth: vw, innerHeight: vh } = window;
      if (!stickDown(state, e.pointerId, e.clientX, e.clientY, vw, vh, leftHanded)) {
        return; // second finger, or the edge strip: swallowed, nothing happens
      }
      downX = e.clientX;
      downY = e.clientY;
      downAt = eventTime(e);
      travel = 0;
      place(base, state.ox, state.oy, STICK_RADIUS_PX);
      place(knob, state.ox, state.oy, KNOB_HALF_PX);
      stick.classList.add("is-active");
    };

    const onMove = (e: PointerEvent) => {
      const input = stickMove(state, e.pointerId, e.clientX, e.clientY);
      if (!input) return;
      travel = pressTravel(travel, e.clientX - downX, e.clientY - downY);
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
      if (
        e.type === "pointerup" &&
        isStickTap(pressTravel(travel, e.clientX - downX, e.clientY - downY), 0, eventTime(e) - downAt)
      ) {
        passTapToGround(e);
      }
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
    return () => {
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
    };
  }, [moveInput, leftHanded, isOv, menuOpen]);

  return (
    <>
      <div
        ref={zoneRef}
        className={"cv-stick-zone" + (leftHanded ? " is-left-handed" : "") + (isOv ? " is-ov" : "")}
        aria-hidden="true"
      />
      <div ref={stickRef} className="cv-stick" aria-hidden="true">
        <div ref={baseRef} className="cv-stick-base" />
        <div ref={knobRef} className="cv-stick-knob" />
      </div>
    </>
  );
}
