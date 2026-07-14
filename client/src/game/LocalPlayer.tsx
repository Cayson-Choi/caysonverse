import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF, useKeyboardControls } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Color, Group, Mesh, Material } from "three";
import { MOVE_SPEED, WORLD_BOUNDS, TINT_COLORS } from "@caysonverse/shared/constants";
import { OBSTACLES, PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { resolveCollision } from "@caysonverse/shared/collision";
import { readIntent, worldDirection } from "./input";
import type { Intent } from "./input";
import { guardMoveKeys, isUiCaptured } from "./uiCapture";
import { BlobShadow } from "./BlobShadow";
import { useSpeechBubble } from "./useSpeechBubble";
import { useEmoji } from "./useEmoji";
import { stepYaw } from "./yaw";
import { createMoveSender } from "./moveSender";
import { installDebugHook } from "./debug";
import { ANIM_FADE, CHARACTERS, CLIP, MODEL_FACING_OFFSET, TURN_SPEED } from "./constants";
import type { MoveControl } from "./constants";
import type { Orbit, Pose } from "./types";
import { sendMove } from "../net/connection";
import { isInputSuspended } from "../net/resilience";

interface LocalPlayerProps {
  /** Own session id — keys this player's speech bubble in the broadcast. */
  sessionId: string;
  character: number;
  tint: number;
  /** Shared mutable pose (mutated per frame — never React state). */
  pose: Pose;
  /** Shared mutable camera orbit (read for camera-relative movement). */
  orbit: Orbit;
  /**
   * Shared mutable joystick intent (touch). Written by the virtual joystick,
   * read here each frame and ADDED to the keyboard intent so both input paths
   * drive ONE camera-relative movement (no forked path). Zeroed when idle/in the
   * dead-zone; on desktop it stays {0,0} and this is a no-op.
   */
  moveInput: Intent;
  /** Draw a cheap blob shadow under this avatar (low-spec/touch profile). */
  blobShadow: boolean;
}

/** Clone a material so tinting never mutates the shared cached asset material. */
function tintMaterial(material: Material, color: Color): Material {
  const cloned = material.clone();
  // KayKit materials expose `.color`; multiply-tint darkens toward the hue.
  const withColor = cloned as Material & { color?: Color };
  if (withColor.color) withColor.color.copy(color);
  return cloned;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function LocalPlayer({
  sessionId,
  character,
  tint,
  pose,
  orbit,
  moveInput,
  blobShadow,
}: LocalPlayerProps) {
  const preset = CHARACTERS[character];
  const { scene, animations } = useGLTF(preset.model);
  const [, getKeys] = useKeyboardControls<MoveControl>();
  const groupRef = useRef<Group>(null);
  const movingRef = useRef(false);

  // Own speech bubble: driven by the server broadcast (not a local echo), so
  // self and remotes share one path. Attached above this avatar's group.
  useSpeechBubble(sessionId, groupRef);
  // Own emoji reaction: same broadcast-driven, self-included discipline.
  useEmoji(sessionId, groupRef);

  // Clone the skinned hierarchy (independent skeleton) and tint cloned materials
  // ONCE per character/tint — not per frame.
  const model = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene);
    const color = new Color(TINT_COLORS[tint]);
    cloned.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => tintMaterial(m, color))
        : tintMaterial(mesh.material, color);
    });
    return cloned;
  }, [scene, tint]);

  const { actions } = useAnimations(animations, model);

  // Start idle; expose the E2E pose hook for this player's lifetime.
  useEffect(() => {
    const idle = actions[CLIP.idle];
    idle?.reset().fadeIn(0).play();
    const removeHook = installDebugHook(() => pose, () => orbit);
    return () => {
      removeHook();
      actions[CLIP.idle]?.stop();
      actions[CLIP.walk]?.stop();
    };
    // actions identity changes when the (memoized) model does — safe to depend on.
  }, [actions, pose, orbit]);

  const sender = useRef(createMoveSender(sendMove)).current;

  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Focus guard: while the chat input owns keyboard input — OR while the
    // resilience driver is reconnecting (world frozen behind the overlay) —
    // movement keys are zeroed so nothing walks the avatar. We don't touch drei's
    // key listeners, so nothing can get stuck on blur (see uiCapture.ts).
    const suspended = isInputSuspended();
    const keys = guardMoveKeys(getKeys(), isUiCaptured() || suspended);
    const keyIntent = readIntent(keys);
    // Combine keyboard + joystick into ONE camera-relative intent. worldDirection
    // normalizes, so a blended push still moves at the constant MOVE_SPEED. While
    // suspended, the joystick contribution is dropped too (full input freeze).
    const intent: Intent = suspended
      ? { forward: 0, right: 0 }
      : {
          forward: keyIntent.forward + moveInput.forward,
          right: keyIntent.right + moveInput.right,
        };
    const moving = intent.forward !== 0 || intent.right !== 0;

    if (moving) {
      const dir = worldDirection(intent, orbit.yaw);
      // Slide the body (circle-vs-AABB) along walls/furniture from the SAME
      // OBSTACLES the server validates against, then keep the centre a radius
      // inside WORLD_BOUNDS as a backstop.
      const next = resolveCollision(
        pose.x,
        pose.z,
        dir.x * MOVE_SPEED * delta,
        dir.z * MOVE_SPEED * delta,
        PLAYER_RADIUS,
        OBSTACLES,
      );
      pose.x = clamp(next.x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS);
      pose.z = clamp(next.z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
      const targetYaw = Math.atan2(dir.x, dir.z);
      pose.yaw = stepYaw(pose.yaw, targetYaw, TURN_SPEED * delta);
    }

    group.position.set(pose.x, 0, pose.z);
    group.rotation.y = pose.yaw + MODEL_FACING_OFFSET;

    // Crossfade idle <-> walk on movement-state changes only.
    if (moving !== movingRef.current) {
      const from = movingRef.current ? actions[CLIP.walk] : actions[CLIP.idle];
      const to = moving ? actions[CLIP.walk] : actions[CLIP.idle];
      from?.fadeOut(ANIM_FADE);
      to?.reset().fadeIn(ANIM_FADE).play();
      movingRef.current = moving;
    }

    // Throttled network send (idle: nothing; moving: <=1 per PATCH_RATE_MS;
    // exactly one final message on stop).
    sender.update(performance.now(), moving, { x: pose.x, z: pose.z, yaw: pose.yaw });
  });

  return (
    <group ref={groupRef}>
      <primitive object={model} />
      {blobShadow && <BlobShadow />}
    </group>
  );
}
