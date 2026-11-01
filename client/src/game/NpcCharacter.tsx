/**
 * One AI 조교 NPC standing in its room (design 31 + 후속: four of them). The
 * "android docent" look (발주자: 기존 캐릭터에 없는 새 모습): the players' toy body in
 * the NPC-only `android` outfit with one accent stripe and its own hair, plus a
 * glowing halo antenna (npcLook.ts). It is assembled by the same `useAvatar` path as
 * the players — the hook owns the cloned skeleton, the merged solid geometry and the
 * materials, and releases them on unmount, so this component never disposes them.
 * Looping Idle + the shared "AI 조교" badge nametag (pinned in the NametagSystem —
 * always shown while the NPC is on screen and in range, an exception to the nearest-15
 * rule; sized and faded with the same maths as the players' tags). Solidity comes from
 * the shared map obstacle (design 33), not from this component; the interaction layer
 * (ActionButton / NpcChatPanel) lives in the DOM overlay.
 */

import { useEffect, useMemo, useRef } from "react";
import { useAnimations } from "@react-three/drei";
import type { Group } from "three";
import { CLIP } from "./constants";
import { clipFor } from "./characterLook";
import { createNametag } from "./nametag";
import { registerLabel } from "./labelRegistry";
import { bubbleRestHeight, nametagRestHeight } from "./nametagLayout";
import { NPC_TAG_TEXT, type NpcConfig } from "./npc";
import { NPC_ACCENTS, attachNpcAccessories, npcLook } from "./npcLook";
import { reportAvatarClip, useAvatar } from "./useAvatar";

export function NpcCharacter({ npc }: { npc: NpcConfig }) {
  const groupRef = useRef<Group>(null);

  // Assemble the assistant ONCE from its fixed look. `decorate` runs only when the avatar is
  // assembled (never again under StrictMode) and pushes the halo's materials into
  // `a.materials`, so the hook disposes them with the avatar.
  const look = useMemo(() => npcLook(npc.id), [npc.id]);
  const probeId = `npc:${npc.id}`;
  const { avatar, animations } = useAvatar(look, {
    probeId,
    decorate: (a) => attachNpcAccessories(a.root, NPC_ACCENTS[npc.id], a.materials),
  });

  // The tag floats above THIS avatar's top — which includes the halo (BuiltAvatar.topY) — so the ring
  // never pokes through it; the bubble rests just above the tag.
  const tagHeight = nametagRestHeight(avatar.topY);
  const bubbleRest = bubbleRestHeight(avatar.topY);

  // Declared after useAvatar so the avatar probe entry exists when the clip is reported.
  // The clip name goes through clipFor like every avatar's (an `android` bottom has no
  // variant, so this is plain Idle).
  const { actions } = useAnimations(animations, groupRef);
  useEffect(() => {
    const idle = actions[clipFor(CLIP.idle, look)];
    idle?.reset().play();
    if (import.meta.env.DEV && idle) reportAvatarClip(probeId, idle.getClip().name);
  }, [actions, look, probeId]);

  // "AI 조교" nametag above the head (AI pill + "조교"), released with the avatar.
  // Registered as pinned: the NametagSystem sizes and fades it (it starts invisible and
  // fades in) but never drops it for the nearest-15 rule. NPCs never speak in the world,
  // so the bubble anchor is unused; the id is prefixed so it can't clash with a session id.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const tag = createNametag(NPC_TAG_TEXT, "ai", tagHeight);
    tag.setOpacity(0);
    group.add(tag.sprite);
    const unregister = registerLabel({
      id: `npc:${npc.id}`,
      anchor: group,
      tag,
      pinned: true,
      bubbleAnchor: { y: bubbleRest },
      heightM: tagHeight,
    });
    return () => {
      unregister();
      group.remove(tag.sprite);
      tag.dispose();
    };
  }, [npc.id, tagHeight, bubbleRest]);

  return (
    <group ref={groupRef} position={[npc.pos.x, 0, npc.pos.z]} rotation-y={npc.rotY}>
      <primitive object={avatar.root} />
    </group>
  );
}
