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
 */

import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { EMOJIS } from "@caysonverse/shared/constants";
import { emojiRegistry } from "./emojiRegistry";
import { createEmojiSprite, type EmojiSpriteHandle } from "./emojiSprite";
import { emojiFloatProgress } from "./emojiFloat";

export function useEmoji(sessionId: string, groupRef: RefObject<Group | null>): void {
  const stateRef = useRef<{ seq: number; handle: EmojiSpriteHandle | null }>({
    seq: -1,
    handle: null,
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

  useFrame(() => {
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
    }
    const { offsetY, opacity } = emojiFloatProgress(now - entry.startedAt);
    s.handle.setProgress(offsetY, opacity);
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
