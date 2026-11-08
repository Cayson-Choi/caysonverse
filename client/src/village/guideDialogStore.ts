import { useSyncExternalStore } from "react";
import { guideById, type GuideId } from "@caysonverse/shared/village/guides";
import { GUIDE_TARGET_PREFIX } from "./villageTargets";

/**
 * Which guide's questions are open (케이슨 마을 Task 9A; GuideDialog draws it). Plain module state like cubbyCard.ts:
 * "문의하기" (the context button or E within 2.2 m of a guide) opens it, 닫기 / Esc / leaving the area closes it.
 */

let open: GuideId | null = null;
const listeners = new Set<() => void>();

function set(next: GuideId | null): void {
  if (next === open) return;
  open = next;
  for (const l of [...listeners]) l();
}

/** Open the questions of a guide (an id `plaza_guide` or a target id `guide:plaza_guide`); unknown ids do nothing. */
export function openGuideDialog(idOrTarget: string): void {
  const id = idOrTarget.startsWith(GUIDE_TARGET_PREFIX) ? idOrTarget.slice(GUIDE_TARGET_PREFIX.length) : idOrTarget;
  const g = guideById(id);
  if (g) set(g.id);
}

export function closeGuideDialog(): void {
  set(null);
}

export function guideDialogOpen(): GuideId | null {
  return open;
}

export function subscribeGuideDialog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useGuideDialog(): GuideId | null {
  return useSyncExternalStore(subscribeGuideDialog, guideDialogOpen, guideDialogOpen);
}
