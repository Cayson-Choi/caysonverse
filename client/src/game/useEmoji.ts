/**
 * Attach / animate / tear down one avatar's emoji-reaction sprite, driven by
 * the module emoji registry (populated by the emoji broadcast). Used by BOTH
 * the local player and every remote avatar, so self and remote reactions share
 * one code path and both come from the server broadcast — never a local echo
 * (mirrors useSpeechBubble.ts).
 *
 * The sprite is added as a CHILD of the avatar's group, so it follows the
 * avatar for free and is removed when the avatar unmounts. The glyph canvas is
 * rasterized only once per active reaction (on registry seq change); the
 * rise/fade is driven every frame straight through refs via `emojiFloatProgress`
 * — never React state.
 *
 * Where it starts: above the avatar's speech bubble when one is up, else above its name tag
 * (emojiBaseHeight), so it never draws over a lifted or tall bubble. The base eases toward
 * that height instead of jumping when a bubble appears or expires mid-reaction.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { EMOJIS } from "@caysonverse/shared/constants";
import { emojiRegistry } from "./emojiRegistry";
import { createEmojiSprite, type EmojiSpriteHandle } from "./emojiSprite";
import { emojiBaseHeight, emojiFloatProgress } from "./emojiFloat";
import { smoothToward } from "./cameraControls";
import { BUBBLE_BASE_HEIGHT } from "./constants";
import type { BubbleTop } from "./useSpeechBubble";

/** How fast the start height chases a moved bubble / tag, per second (settles in ~0.2 s). */
const BASE_EASE_RATE = 14;

export function useEmoji(
  sessionId: string,
  groupRef: RefObject<Group | null>,
  anchor?: { y: number },
  bubbleTop?: BubbleTop,
): void {
  const stateRef = useRef<{ seq: number; handle: EmojiSpriteHandle | null; baseY: number }>({
    seq: -1,
    handle: null,
    baseY: 0,
  });

  function detach(): void {
    const s = stateRef.current;
    if (s.handle) {
      s.handle.sprite.parent?.remove(s.handle.sprite);
      s.handle.dispose();
      s.handle = null;
    }
    s.seq = -1;
  }

  useFrame((_, dt) => {
    const group = groupRef.current;
    if (!group) return;

    const now = performance.now();
    const entry = emojiRegistry.get(sessionId, now);
    const s = stateRef.current;

    if (!entry) {
      if (s.handle) detach();
      return;
    }
    // (Re)build only when the active reaction actually changed.
    if (!s.handle || s.seq !== entry.seq) {
      detach();
      const handle = createEmojiSprite(EMOJIS[entry.index]);
      group.add(handle.sprite);
      s.handle = handle;
      s.seq = entry.seq;
      s.baseY = NaN; // a fresh reaction starts at its target height, no glide
    }
    const target = emojiBaseHeight(anchor?.y ?? BUBBLE_BASE_HEIGHT, bubbleTop?.topY ?? null);
    s.baseY = Number.isNaN(s.baseY) ? target : smoothToward(s.baseY, target, dt, BASE_EASE_RATE);
    const { offsetY, opacity } = emojiFloatProgress(now - entry.startedAt);
    s.handle.setProgress(offsetY, opacity, s.baseY);
  });

  useEffect(() => {
    return () => {
      detach();
      // Avatar left/unmounted: drop any lingering entry so a reused sid can't
      // inherit a stale reaction.
      emojiRegistry.remove(sessionId);
    };
    // detach reads only refs; sessionId identifies the entry to clean up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
