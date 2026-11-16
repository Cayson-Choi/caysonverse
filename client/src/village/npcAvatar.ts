// 마을 NPC 전용 모습(shared/village/npcLooks.ts)의 조립: character.glb의 머리·손·얼굴·머리카락·신발에 npc.glb의 전용 옷·모자·소품을
// 얹고(characterAvatar.ts addExtraParts), 두 파일의 클립을 함께 돌려준다. npc.glb는 NPC가 보이는 곳에서만(이 훅을 처음 부를 때) 받는다.

import { useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { LoadingManager, type AnimationClip } from "three";
import { GLTFLoader } from "three-stdlib";
import { NPC_GLB_HASH, NPC_GLB_PATH, NPC_LOOKS, type NpcId, type NpcLook } from "@caysonverse/shared/village/npcLooks";
import type { AvatarLook } from "../game/characterLook";
import type { BuiltAvatar } from "../game/characterAvatar";
import { useAvatar } from "../game/useAvatar";

/** npc.glb의 URL(?v= = 내용 해시: 새로 내보내면 URL이 바뀐다). */
export const NPC_MODEL_URL = `${NPC_GLB_PATH}?v=${NPC_GLB_HASH}`;

/**
 * npc.glb는 마을이 다 보인 뒤에 받는 장식이라 three의 기본 로딩 관리자를 쓰지 않는다: 기본 관리자의 진행이 화면 전체의 "불러오는 중…"
 * 막(PlayShell, drei useProgress)을 띄우므로, 그대로 두면 NPC 파일을 받는 동안 이미 그려진 마을 위에 막이 덮인다(마을버스와 같은 이유,
 * villageBusLoader.ts).
 */
const npcLoadingManager = new LoadingManager();

/** GLTFLoader on the NPCs' own loading manager (R3F memoizes one instance per class). */
export class NpcGLTFLoader extends GLTFLoader {
  constructor() {
    super(npcLoadingManager);
  }
}

/** NPC 모습 → 아바타 조립이 읽는 모습(부품 id·틴트 색). */
export function npcAvatarLook(look: NpcLook): AvatarLook {
  return { parts: { ...look.parts }, colors: { ...look.colors } };
}

/** NPC 하나를 조립한다(npc.glb를 기다리는 동안 Suspense로 멈춘다). clips = character.glb 클립 + NPC 클립. */
export function useNpcAvatar(id: NpcId, probeId?: string): { avatar: BuiltAvatar; clips: AnimationClip[]; look: NpcLook } {
  const npc = useLoader(NpcGLTFLoader, NPC_MODEL_URL);
  const look = NPC_LOOKS[id];
  const avatarLook = useMemo(() => npcAvatarLook(look), [look]);
  const { avatar, animations } = useAvatar(avatarLook, { probeId, extra: npc.scene });
  const clips = useMemo(() => [...animations, ...npc.animations], [animations, npc.animations]);
  return { avatar, clips, look };
}

/** 화면에서 빠진 뒤 다시 받게(LoadBoundary가 실패한 다운로드를 지울 때). */
export function clearNpcCache(): void {
  useLoader.clear(NpcGLTFLoader, NPC_MODEL_URL);
}
