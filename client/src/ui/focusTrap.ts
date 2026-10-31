/**
 * Keep Tab inside a modal dialog (the Esc menu). Pure: the component gathers the
 * dialog's focusable controls and the index of the focused one; this says whether Tab /
 * Shift+Tab must be redirected to stay inside.
 */

/** The controls Tab can land on inside a dialog (disabled ones cannot take focus). */
export const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The index of the control Tab / Shift+Tab must focus to stay inside a dialog with
 * `count` focusable controls, or null when the browser's own focus move already stays
 * inside. `index` is the focused control's position, or -1 when focus is on the dialog
 * itself or has somehow ended up outside it. Tab past the last control wraps to the
 * first, Shift+Tab before the first wraps to the last, and from the dialog itself /
 * outside it enters at the matching end.
 */
export function tabWrapTarget(count: number, index: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (index < 0 || index >= count) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}
