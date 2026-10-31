/**
 * One AI 조교 NPC standing in its room (design 31 + 후속: three of them). The
 * "android docent" look (발주자: 기존 캐릭터에 없는 새 모습): mage body with
 * hat/weapons hidden, the whole robe palette-swapped to android white + one
 * accent hue, and a glowing visor + halo antenna (npcLook.ts). Looping Idle +
 * the shared "AI 조교" badge nametag (pinned in the NametagSystem — always shown
 * while the NPC is on screen and in range, an exception to the nearest-15 rule; sized
 * and faded with the same maths as the players' tags). Solidity comes from the shared map
 * obstacle (design 33), not from this component; the interaction layer
 * (ActionButton / NpcChatPanel) lives in the DOM overlay.
 */

import { useEffect, useMemo, useRef } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import type { Group, Material, Mesh, Texture } from "three";
import { CLIP, BUBBLE_BASE_HEIGHT } from "./constants";
import { cloneTinted } from "./avatar";
import { createNametag } from "./nametag";
import { registerLabel } from "./labelRegistry";
import { NPC_TAG_TEXT, type NpcConfig } from "./npc";
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

  // "AI 조교" nametag above the head (AI pill + "조교"), released with the avatar.
  // Registered as pinned: the NametagSystem sizes and fades it (it starts invisible and
  // fades in) but never drops it for the nearest-15 rule. NPCs never speak in the world,
  // so the bubble anchor is unused; the id is prefixed so it can't clash with a session id.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const tag = createNametag(NPC_TAG_TEXT, "ai");
    tag.setOpacity(0);
    group.add(tag.sprite);
    const unregister = registerLabel({
      id: `npc:${npc.id}`,
      anchor: group,
      tag,
      pinned: true,
      bubbleAnchor: { y: BUBBLE_BASE_HEIGHT },
    });
    return () => {
      unregister();
      group.remove(tag.sprite);
      tag.dispose();
    };
  }, [npc.id]);

  return (
    <group ref={groupRef} position={[npc.pos.x, 0, npc.pos.z]} rotation-y={npc.rotY}>
      <primitive object={avatar.root} />
    </group>
  );
}
