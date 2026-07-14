import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF, useKeyboardControls } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import { Color, Group, Mesh, Material } from "three";
import { MOVE_SPEED, WORLD_BOUNDS, TINT_COLORS } from "@caysonverse/shared/constants";
import { readIntent, worldDirection } from "./input";
import { stepYaw } from "./yaw";
import { createMoveSender } from "./moveSender";
import { installDebugHook } from "./debug";
import { ANIM_FADE, CHARACTERS, CLIP, MODEL_FACING_OFFSET, TURN_SPEED } from "./constants";
import type { MoveControl } from "./constants";
import type { Orbit, Pose } from "./types";
import { sendMove } from "../net/connection";

interface LocalPlayerProps {
  character: number;
  tint: number;
  /** Shared mutable pose (mutated per frame — never React state). */
  pose: Pose;
  /** Shared mutable camera orbit (read for camera-relative movement). */
  orbit: Orbit;
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

export function LocalPlayer({ character, tint, pose, orbit }: LocalPlayerProps) {
  const preset = CHARACTERS[character];
  const { scene, animations } = useGLTF(preset.model);
  const [, getKeys] = useKeyboardControls<MoveControl>();
  const groupRef = useRef<Group>(null);
  const movingRef = useRef(false);

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
    const removeHook = installDebugHook(() => pose);
    return () => {
      removeHook();
      actions[CLIP.idle]?.stop();
      actions[CLIP.walk]?.stop();
    };
    // actions identity changes when the (memoized) model does — safe to depend on.
  }, [actions, pose]);

  const sender = useRef(createMoveSender(sendMove)).current;

  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const keys = getKeys();
    const intent = readIntent({
      forward: keys.forward,
      backward: keys.backward,
      left: keys.left,
      right: keys.right,
    });
    const moving = intent.forward !== 0 || intent.right !== 0;

    if (moving) {
      const dir = worldDirection(intent, orbit.yaw);
      pose.x = clamp(pose.x + dir.x * MOVE_SPEED * delta, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
      pose.z = clamp(pose.z + dir.z * MOVE_SPEED * delta, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
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
    </group>
  );
}
