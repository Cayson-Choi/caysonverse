/**
 * One AI 조교 NPC standing in its room (design 31 + 후속: three of them). Pure
 * décor in the 3D scene: a mage-model clone with a per-assistant tint, looping
 * Idle, plus the shared "AI 조교" badge nametag. Solidity comes from the
 * shared map obstacle (design 33), not from this component; the interaction
 * layer (NpcPrompt / NpcChatPanel) lives in the DOM overlay.
 */

import { useEffect, useMemo, useRef } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import type { Group } from "three";
import { CLIP } from "./constants";
import { cloneTinted } from "./avatar";
import { createNametag } from "./nametag";
import { NPC_LABEL, type NpcConfig } from "./npc";

const NPC_MODEL = "/models/mage.glb";
useGLTF.preload(NPC_MODEL);

export function NpcCharacter({ npc }: { npc: NpcConfig }) {
  const { scene, animations } = useGLTF(NPC_MODEL);
  const groupRef = useRef<Group>(null);

  // Same assembly path as the players: independent skeleton clone + own
  // material clones (disposed on unmount; shared geometry/textures stay).
  const avatar = useMemo(() => cloneTinted(scene, npc.tint), [scene, npc]);
  useEffect(() => () => avatar.materials.forEach((m) => m.dispose()), [avatar]);

  const { actions } = useAnimations(animations, groupRef);
  useEffect(() => {
    actions[CLIP.idle]?.reset().play();
  }, [actions]);

  // Badge nametag above the head, released with the avatar.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const tag = createNametag(NPC_LABEL);
    group.add(tag.sprite);
    return () => {
      group.remove(tag.sprite);
      tag.dispose();
    };
  }, []);

  return (
    <group ref={groupRef} position={[npc.pos.x, 0, npc.pos.z]} rotation-y={npc.rotY}>
      <primitive object={avatar.root} />
    </group>
  );
}
