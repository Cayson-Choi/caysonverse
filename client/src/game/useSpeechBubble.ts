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
 */

import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { bubbleRegistry } from "./bubbleRegistry";
import { createBubbleSprite, type BubbleSprite } from "./bubbleSprite";

export function useSpeechBubble(sessionId: string, groupRef: RefObject<Group | null>): void {
  const stateRef = useRef<{ seq: number; bubble: BubbleSprite | null }>({ seq: -1, bubble: null });

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
  });

  useEffect(() => {
    return () => {
      detach();
      // Avatar left/unmounted: drop any lingering entry so a reused sid can't
      // inherit a stale bubble.
      bubbleRegistry.remove(sessionId);
    };
    // detach reads only refs; sessionId identifies the entry to clean up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
