import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { MoveControl } from "./constants";
import { isTouchDevice } from "../device";
import { isUiCaptured } from "./uiCapture";
import { viewState } from "./viewState";
import {
  createFpCursorTracker,
  fpCursorHidden,
  heldKeyMask,
  noteHeldKeys,
  noteMouseMove,
  noteMousePress,
} from "./fpCursor";

/**
 * Hides the mouse cursor over the 3D view in first person while it is not in use (fpCursor.ts has the rule).
 * Called by CameraRig with the canvas and drei's key state. Only the canvas's own `cursor` is touched, so the HUD,
 * the panels, the chat and the menus — DOM laid over the canvas, not inside it — always keep their cursor. Mouse
 * activity is heard on the window (capture phase, so no overlay that stops a pointer event can hide it from us) and
 * shows the cursor at once; the held keys and the idle clock are read once a frame. A touch device is left alone.
 */
export function useFpCursor(el: HTMLElement, getKeys: () => Readonly<Record<MoveControl, boolean>>): void {
  const [tracker] = useState(createFpCursorTracker);
  // Whether the canvas cursor is hidden right now: the style is written only when this flips.
  const hidden = useRef(false);

  useEffect(() => {
    if (isTouchDevice) return;
    const show = () => {
      if (!hidden.current) return;
      hidden.current = false;
      el.style.cursor = "";
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (noteMouseMove(tracker, e.clientX, e.clientY, performance.now())) show();
    };
    const onPress = (e: PointerEvent | WheelEvent) => {
      if ("pointerType" in e && e.pointerType === "touch") return;
      noteMousePress(tracker, performance.now());
      show();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerdown", onPress, opts);
    window.addEventListener("wheel", onPress, opts);
    return () => {
      window.removeEventListener("pointermove", onMove, opts);
      window.removeEventListener("pointerdown", onPress, opts);
      window.removeEventListener("wheel", onPress, opts);
      hidden.current = false;
      el.style.cursor = "";
    };
  }, [el, tracker]);

  useFrame(() => {
    if (isTouchDevice) return;
    const now = performance.now();
    const captured = isUiCaptured();
    // Keys typed into a chat field are no walking (uiCapture): they neither hide the cursor nor count as a press.
    noteHeldKeys(tracker, captured ? 0 : heldKeyMask(getKeys()), now);
    const hide = fpCursorHidden(tracker, { mode: viewState.mode, touch: false, captured }, now);
    if (hide === hidden.current) return;
    hidden.current = hide;
    el.style.cursor = hide ? "none" : "";
  });
}
