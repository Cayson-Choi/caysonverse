/**
 * One AI 조교 NPC standing in its room (design 31 + 후속: three of them). The
 * "android docent" look (발주자: 기존 캐릭터에 없는 새 모습): mage body with
 * hat/weapons hidden, the whole robe palette-swapped to android white + one
 * accent hue, and a glowing visor + halo antenna (npcLook.ts). Looping Idle +
 * the shared "AI 조교" badge nametag. Solidity comes from the shared map
 * obstacle (design 33), not from this component; the interaction layer
 * (NpcPrompt / NpcChatPanel) lives in the DOM overlay.
 */

import { useEffect, useMemo, useRef } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import type { Group, Material, Mesh, Texture } from "three";
import { CLIP } from "./constants";
import { cloneTinted } from "./avatar";
import { createNametag } from "./nametag";
import { NPC_LABEL, type NpcConfig } from "./npc";
import { NPC_ACCENTS, NPC_HIDE_NODES, attachNpcAccessories, getNpcTexture } from "./npcLook";

const NPC_MODEL = "/models/mage.glb";
useGLTF.preload(NPC_MODEL);

export function NpcCharacter({ npc }: { npc: NpcConfig }) {
  const { scene, animations } = useGLTF(NPC_MODEL);
  const groupRef = useRef<Group>(null);

  // Same assembly path as the players (independent skeleton, own material
  // clones — disposed on unmount, shared geometry/textures stay), then the
  // android dressing: tint 0 is the identity multiply, the cloned materials'
  // atlas map is swapped for the cached accent palette, and the procedural
  // visor/halo attach to the head bone.
  const avatar = useMemo(() => {
    const accent = NPC_ACCENTS[npc.id];
    const built = cloneTinted(scene, 0, { hideNodes: NPC_HIDE_NODES });
    built.root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const withMap = m as Material & { map?: Texture | null };
        if (withMap.map) withMap.map = getNpcTexture(accent, withMap.map);
      }
    });
    attachNpcAccessories(built.root, accent, built.materials);
    return built;
  }, [scene, npc]);
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
