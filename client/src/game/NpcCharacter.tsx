/**
 * The AI 조교 NPC standing beside the lecture-hall screen (design 31). Pure
 * décor in the 3D scene: a mage-model clone with a fixed tint, looping Idle,
 * plus a nametag sprite. No collision, no network — the interaction layer
 * (NpcPrompt / NpcChatPanel) lives in the DOM overlay.
 */

import { useEffect, useMemo, useRef } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import type { Group } from "three";
import { CLIP } from "./constants";
import { cloneTinted } from "./avatar";
import { createNametag } from "./nametag";
import { NPC_NAME, NPC_POS, NPC_ROT_Y, NPC_TINT } from "./npc";

const NPC_MODEL = "/models/mage.glb";
useGLTF.preload(NPC_MODEL);

export function NpcCharacter() {
  const { scene, animations } = useGLTF(NPC_MODEL);
  const groupRef = useRef<Group>(null);

  // Same assembly path as the players: independent skeleton clone + own
  // material clones (disposed on unmount; shared geometry/textures stay).
  const avatar = useMemo(() => cloneTinted(scene, NPC_TINT), [scene]);
  useEffect(() => () => avatar.materials.forEach((m) => m.dispose()), [avatar]);

  const { actions } = useAnimations(animations, groupRef);
  useEffect(() => {
    actions[CLIP.idle]?.reset().play();
  }, [actions]);

  // Nametag above the head, released with the avatar.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const tag = createNametag(NPC_NAME);
    group.add(tag.sprite);
    return () => {
      group.remove(tag.sprite);
      tag.dispose();
    };
  }, []);

  return (
    <group ref={groupRef} position={[NPC_POS.x, 0, NPC_POS.z]} rotation-y={NPC_ROT_Y}>
      <primitive object={avatar.root} />
    </group>
  );
}
