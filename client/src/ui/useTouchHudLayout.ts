import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { touchHudLayout, type Rect, type SafeInsets, type TouchHudLayout } from "../game/hud";
import { isTouchDevice } from "../device";
import { useSettingsStore } from "../stores/settingsStore";

/** The screen the touch HUD is laid out for: the layout viewport plus the notch / home-bar insets. */
export interface Viewport {
  w: number;
  h: number;
  safe: SafeInsets;
}

/** Read `env(safe-area-inset-*)` through a throw-away probe (CSS is the only place that knows them). */
function readSafeInsets(): SafeInsets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) " +
    "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safe = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return safe;
}

function measure(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight, safe: readSafeInsets() };
}

function same(a: Viewport, b: Viewport): boolean {
  return (
    a.w === b.w &&
    a.h === b.h &&
    a.safe.top === b.safe.top &&
    a.safe.right === b.safe.right &&
    a.safe.bottom === b.safe.bottom &&
    a.safe.left === b.safe.left
  );
}

// One shared snapshot and one resize listener for every HUD component (jump, action,
// emoji, chat, top rows). The snapshot object is replaced only when a number changed, so
// useSyncExternalStore never re-renders for a resize that did not move anything. Resize
// events (a dragged window, the keyboard animating) are coalesced to one measure per frame.
let snapshot: Viewport | null = null;
const listeners = new Set<() => void>();
let frame = 0;

/** What a PC reports: the touch layout is not drawn there, so nothing is measured or listened to. */
const DESKTOP_VIEWPORT: Viewport = { w: 1280, h: 800, safe: { top: 0, right: 0, bottom: 0, left: 0 } };

function refresh(): void {
  const next = measure();
  if (snapshot && same(snapshot, next)) return;
  snapshot = next;
  for (const l of listeners) l();
}

function onResize(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    refresh();
  });
}

function getSnapshot(): Viewport {
  if (!isTouchDevice) return DESKTOP_VIEWPORT;
  if (!snapshot) snapshot = measure();
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  if (!isTouchDevice) return () => {};
  if (listeners.size === 0) {
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    refresh(); // the screen may have turned while nobody listened
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/**
 * The screen the touch HUD is laid out for (CSS px + safe-area insets), from the one shared
 * snapshot `useTouchHudLayout` is built on — for the few things that need the screen itself
 * next to the layout (the first-visit guide's card placement). A PC gets a constant.
 */
export function useTouchViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The touch HUD's rectangles for the current screen, 버튼 크기 and 왼손잡이 mode — the
 * numbers from game/hud.ts `touchHudLayout`, which hud.test.ts checks. Only touch
 * components apply them; on a PC the layout is plain CSS (hud.css), so this does no work
 * there (no probe, no resize listener) and the returned layout is not used.
 */
export function useTouchHudLayout(): TouchHudLayout {
  const vp = useTouchViewport();
  const size = useSettingsStore((s) => s.settings.buttonSize);
  const leftHanded = useSettingsStore((s) => s.settings.leftHanded);
  return useMemo(
    () => touchHudLayout({ vw: vp.w, vh: vp.h, safe: vp.safe, size, leftHanded }),
    [vp, size, leftHanded],
  );
}

/** Inline style that pins a fixed-position element to `r`. */
export function rectStyle(r: Rect): CSSProperties {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}
