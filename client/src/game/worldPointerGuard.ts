/**
 * One pointer sequence that the chat used to dismiss itself on the 3D canvas.
 *
 * ChatInput runs its document-capture pointerdown before CameraRig sees the
 * canvas event. Marking the pointer here lets the rig skip that sequence's
 * click-move without blocking the canvas or changing any later input.
 */
const suppressed = new Set<number>();

/** Mark a canvas pointerdown as UI-only (the chat is closing on this press). */
export function suppressWorldPointer(pointerId: number): void {
  suppressed.add(pointerId);
}

/** Consume the mark at CameraRig's pointerdown; later events are then ignored naturally. */
export function consumeSuppressedWorldPointer(pointerId: number): boolean {
  if (!suppressed.has(pointerId)) return false;
  suppressed.delete(pointerId);
  return true;
}

/** Test-only reset; a new scene normally has no pending pointerdown marks. */
export function resetWorldPointerGuard(): void {
  suppressed.clear();
}
