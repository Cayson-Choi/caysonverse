/**
 * Attach / refresh / tear down one avatar's speech bubble, driven by the module
 * bubble registry (populated by the chat broadcast). Used by BOTH the local
 * player and every remote avatar, so self and remote bubbles share one code path
 * and both come from the server broadcast — never a local echo.
 *
 * The bubble is added as a CHILD of the avatar's group, so it follows the avatar
 * for free and is removed when the avatar unmounts. The registry is read every
 * frame (a cheap Map lookup), but a canvas is (re)rasterized ONLY when the
 * registry seq for this sid changes — never per frame.
 *
 * Height: the bubble's bottom edge sits at `anchor.y` (metres above the avatar's
 * group), re-read every frame — the NametagSystem keeps it just above the avatar's
 * nametag, however tall or lifted that is (Task 14). Every caller passes an anchor
 * that starts at bubbleRestHeight(avatar.topY) (just above where this avatar's tag
 * would end), which is also where the local player's bubble stays while its own tag
 * is off. BUBBLE_BASE_HEIGHT is only the fallback for a call without an anchor.
 *
 * Returns a stable ref holding the TOP edge of the bubble that is up right now (m above the
 * group; null when none), rewritten every frame — the avatar's emoji reaction starts above
 * it (useEmoji) so the two never draw over each other. Call this hook BEFORE useEmoji: both
 * run in the same frame, in registration order.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { bubbleRegistry } from "./bubbleRegistry";
import { createBubbleSprite, type BubbleSprite } from "./bubbleSprite";
import { BUBBLE_BASE_HEIGHT } from "./constants";

/** Where the bubble currently up ends (see useSpeechBubble). */
export interface BubbleTop {
  topY: number | null;
}

export function useSpeechBubble(
  sessionId: string,
  groupRef: RefObject<Group | null>,
  anchor?: { y: number },
): BubbleTop {
  const stateRef = useRef<{ seq: number; bubble: BubbleSprite | null }>({ seq: -1, bubble: null });
  const top = useRef<BubbleTop>({ topY: null }).current;

  function detach(): void {
    const s = stateRef.current;
    if (s.bubble) {
      s.bubble.sprite.parent?.remove(s.bubble.sprite);
      s.bubble.dispose();
      s.bubble = null;
    }
    s.seq = -1;
  }

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    const entry = bubbleRegistry.get(sessionId, performance.now());
    const s = stateRef.current;

    if (!entry) {
      if (s.bubble) detach();
      top.topY = null;
      return;
    }
    // (Re)build only when the active message actually changed.
    if (!s.bubble || s.seq !== entry.seq) {
      detach();
      const bubble = createBubbleSprite(entry.text);
      group.add(bubble.sprite);
      s.bubble = bubble;
      s.seq = entry.seq;
    }
    // Sprites are centre-origin: the bottom edge at anchor.y puts the centre half a bubble higher.
    const bottomY = anchor?.y ?? BUBBLE_BASE_HEIGHT;
    s.bubble.sprite.position.y = bottomY + s.bubble.heightM / 2;
    top.topY = bottomY + s.bubble.heightM;
  });

  useEffect(() => {
    return () => {
      detach();
      top.topY = null;
      // Avatar left/unmounted: drop any lingering entry so a reused sid can't
      // inherit a stale bubble.
      bubbleRegistry.remove(sessionId);
    };
    // detach reads only refs; sessionId identifies the entry to clean up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return top;
}
