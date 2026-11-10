/**
 * Shared soft-keyboard inset tracking (touch). Publishes how much of the layout
 * viewport's bottom the on-screen keyboard covers into the `--cv-kbd-inset` CSS
 * var, so any bottom-anchored surface (the world chat bar, the NPC dialogue
 * sheet) can lift above the keyboard with `bottom: var(--cv-kbd-inset)`.
 *
 * `innerHeight - vv.height - vv.offsetTop` is the strip below the visual
 * viewport: exactly the keyboard overlap when up, 0 when down. Covers both the
 * iOS model (layout viewport unchanged, visual viewport shrinks) and Android
 * resizes-visual; on older Android resizes-content the layout viewport shrinks
 * on its own and this computes ~0, so nothing double-lifts.
 */

export const KBD_INSET_VAR = "--cv-kbd-inset";

/** The strip (px) of the layout viewport's bottom the on-screen keyboard covers right now (0 without a visual viewport). */
export function kbdInsetPx(): number {
  const vv = window.visualViewport;
  return vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
}

/** Recompute and publish the current keyboard inset (px). */
export function updateKbdInset(): void {
  document.documentElement.style.setProperty(KBD_INSET_VAR, `${Math.round(kbdInsetPx())}px`);
}

/**
 * Start tracking the keyboard inset until the returned cleanup runs (call it on
 * blur/unmount). Multiple concurrent trackers are harmless — they publish the
 * same value — and the cleanup resets the var to 0.
 */
export function trackKbdInset(): () => void {
  updateKbdInset();
  const vv = window.visualViewport;
  vv?.addEventListener("resize", updateKbdInset);
  vv?.addEventListener("scroll", updateKbdInset);
  return () => {
    vv?.removeEventListener("resize", updateKbdInset);
    vv?.removeEventListener("scroll", updateKbdInset);
    document.documentElement.style.setProperty(KBD_INSET_VAR, "0px");
  };
}
