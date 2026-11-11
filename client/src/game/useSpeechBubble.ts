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
 * Size: every frame the bubble is told how tall its text is on screen in device pixels (its view depth,
 * the camera's field of view, the canvas's height and the renderer's pixel ratio), and re-rasterizes
 * when that whole-pixel size changed enough (bubbleSprite.ts, fix/crisp-labels): it is drawn one texel
 * per screen pixel. A new bubble is rasterized at that size straight away.
 *
 * Returns a stable ref holding the TOP edge of the bubble that is up right now (m above the
 * group; null when none), rewritten every frame — the avatar's emoji reaction starts above
 * it (useEmoji) so the two never draw over each other. Call this hook BEFORE useEmoji: both
 * run in the same frame, in registration order.
 */

import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, PerspectiveCamera } from "three";
import { bubbleRegistry } from "./bubbleRegistry";
import { bubbleTextCssPx, createBubbleSprite, type BubbleSprite } from "./bubbleSprite";
import { BUBBLE_BASE_HEIGHT } from "./constants";
import { pixelsPerMetre, viewDepth } from "./nametagLayout";

/**
 * The bubble text's on-screen height in device px for a bubble whose bottom edge is `bottomY` above `group`, seen by
 * `camera` on a canvas `heightPx` CSS px tall at `dpr`. Measured at the bubble's bottom edge (a bubble is short: the
 * depth hardly changes over it). Allocation-free.
 */
function bubbleDevicePx(group: Group, bottomY: number, camera: PerspectiveCamera, heightPx: number, dpr: number): number {
  const g = group.matrixWorld.elements;
  const x = g[4] * bottomY + g[12];
  const y = g[5] * bottomY + g[13];
  const z = g[6] * bottomY + g[14];
  const depth = viewDepth(camera.matrixWorld.elements, x, y, z);
  const ppm = pixelsPerMetre(depth, (camera.fov * Math.PI) / 180, heightPx);
  return bubbleTextCssPx(ppm) * dpr;
}

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

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;

    const entry = bubbleRegistry.get(sessionId, performance.now());
    const s = stateRef.current;

    if (!entry) {
      if (s.bubble) detach();
      top.topY = null;
      return;
    }
    const bottomY = anchor?.y ?? BUBBLE_BASE_HEIGHT;
    const camera = state.camera as PerspectiveCamera;
    const px = camera.isPerspectiveCamera
      ? bubbleDevicePx(group, bottomY, camera, state.size.height, state.gl.getPixelRatio())
      : undefined;
    // (Re)build only when the active message actually changed.
    if (!s.bubble || s.seq !== entry.seq) {
      detach();
      const bubble = createBubbleSprite(entry.text, px);
      group.add(bubble.sprite);
      s.bubble = bubble;
      s.seq = entry.seq;
    } else if (px !== undefined) {
      s.bubble.setTextDevicePx(px);
    }
    // The bubble's origin is its bottom edge (bubbleSprite.ts).
    s.bubble.sprite.position.y = bottomY;
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
