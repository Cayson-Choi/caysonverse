/**
 * Controls that step out of the way while the touch HUD is in its chat layout (cv-chat-focus) and come back with it, whose
 * place only their own component knows — the open emoji fan's six buttons (EmojiFan, while the fan is open) and the
 * first-visit guide's card with its 건너뛰기 button (CoachMarks). ChatInput holds the chat layout through the tap that leaves
 * the chat only when that tap went down near one of these or near the HUD's fixed buttons (chatBar.ts pressNearAny): only
 * there can its click land on something that comes back. (The fan's places are registered only while it is open: on a
 * phone the closed fan's half circle spans most of the bottom of the screen, the joystick's corner included.)
 */

import type { Rect } from "../game/hud";

const targets = new Set<() => readonly Rect[]>();

/** Register where controls come back (an empty list while they have no place); returns the disposer. */
export function addChatLayoutTargets(rects: () => readonly Rect[]): () => void {
  const entry = () => rects();
  targets.add(entry);
  return () => {
    targets.delete(entry);
  };
}

/** Where every registered control comes back, right now. */
export function chatLayoutTargets(): Rect[] {
  const out: Rect[] = [];
  for (const f of targets) out.push(...f());
  return out;
}
