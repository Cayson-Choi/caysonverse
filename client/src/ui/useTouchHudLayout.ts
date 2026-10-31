import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { touchHudLayout, type Rect, type SafeInsets, type TouchHudLayout } from "../game/hud";
import { useSettingsStore } from "../stores/settingsStore";

/** The screen the touch HUD is laid out for: the layout viewport plus the notch / home-bar insets. */
interface Viewport {
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
// useSyncExternalStore never re-renders for a resize that did not move anything.
let snapshot: Viewport | null = null;
const listeners = new Set<() => void>();

function refresh(): void {
  const next = measure();
  if (snapshot && same(snapshot, next)) return;
  snapshot = next;
  for (const l of listeners) l();
}

function getSnapshot(): Viewport {
  if (!snapshot) snapshot = measure();
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    refresh(); // the screen may have turned while nobody listened
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
    }
  };
}

/**
 * The touch HUD's rectangles for the current screen, 버튼 크기 and 왼손잡이 mode — the
 * numbers from game/hud.ts `touchHudLayout`, which hud.test.ts checks. Only touch
 * components apply them; on a PC the layout is plain CSS (hud.css) and this is unused.
 */
export function useTouchHudLayout(): TouchHudLayout {
  const vp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
