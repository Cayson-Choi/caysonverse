// character.glb 로딩 + 아바타 조립·해제 훅(설계 5.3). 조립실 미리보기·내 아바타·원격 아바타·NPC가 모두 이 훅
// 하나로 같은 조립 경로를 쓴다. 조립·소유 규칙은 characterAvatar.ts 머리말에 있다.
//
// StrictMode(개발, E2E 전부)에서도 운영에서도 몫이 정확히 짝을 이룬다:
// - 렌더(useMemo)는 assembleAvatar만 한다 — 아무것도 잡지 않으므로 StrictMode가 팩토리를 두 번 불러 버리는 결과나
//   커밋되지 않은 렌더가 새지 않는다.
// - layout effect setup에서 retainAvatar(+1). layout effect는 커밋 안에서 동기로 돌므로, R3F 프레임 루프가 이 아바타를
//   처음 그리기 전에 몫을 잡고 공유 지오메트리로 갈아탄다.
// - cleanup에서 releaseAvatarSoon(마이크로태스크 뒤 −1). StrictMode는 같은 태스크 안에서 cleanup → setup을 다시
//   돌리므로 그 setup의 retainAvatar가 예약을 취소한다(중간 dispose 없음). 진짜 언마운트·외형 변경에서는 예약이
//   그대로 실행되어 한 번만 놓는다. Activity·Suspense로 숨겼다가 다시 보이면 retainAvatar가 다시 잡는다.

import { useEffect, useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { AnimationClip } from "three";
import { assembleAvatar, releaseAvatarSoon, retainAvatar, type BuiltAvatar } from "./characterAvatar";
import { lookKey, type AvatarLook } from "./characterLook";
import { CHARACTER_GLB_HASH } from "@caysonverse/shared/characterManifest";

/**
 * 캐릭터 모델 URL. ?v=는 GLB 내용의 해시(sync-character-assets.mjs가 쓴다)라, 새 GLB를 배포하면 URL이 바뀌어
 * 브라우저·CDN 캐시에 남은 옛 GLB를 새 manifest와 섞어 쓰지 않는다. 미리 받기·조립실 인형·카드 그림·월드가 모두
 * 이 URL 하나를 쓴다(로더 캐시 키도 이 문자열이다).
 */
export const CHARACTER_MODEL_URL = `/models/character.glb?v=${CHARACTER_GLB_HASH}`;

export interface AvatarProbeEntry {
  parts: string[];
  drawMeshes: number;
  triangles: number;
  /** 쉬는 자세에서 가장 높은 곳(m): 머리카락·모자·NPC 헤일로까지. 이름표·말풍선 높이의 근거(BuiltAvatar.topY). */
  topY: number;
  /** 지금 재생 중인 클립 이름. 보고 전이거나 보고하지 않는 아바타는 null. */
  clip: string | null;
}

declare global {
  interface Window {
    /** DEV 전용 E2E 프로브: probeId → 그 아바타의 부품·메시 수·삼각형·꼭대기 높이·클립. 운영 번들에는 없다. */
    __cvAvatars?: () => Record<string, AvatarProbeEntry>;
  }
}

/** DEV 전용: probeId를 준 아바타마다 항목 하나. 운영에서는 항상 비어 있다(DEV 가드가 코드째 빠진다). */
export const avatarProbe = new Map<string, AvatarProbeEntry>();

if (import.meta.env.DEV && typeof window !== "undefined") {
  // 부를 때마다 복사본(프레임 경로가 아니다) — 호출한 쪽이 살아 있는 항목을 바꿀 수 없게.
  window.__cvAvatars = () =>
    Object.fromEntries([...avatarProbe].map(([id, entry]) => [id, { ...entry, parts: [...entry.parts] }]));
}

/**
 * DEV 전용. 이 아바타가 재생하기 시작한 클립 이름을 프로브에 적는다(항목이 있을 때만). 클립이 바뀔 때 한 번
 * 부른다(매 프레임 아님). 외형이 바뀌어 다시 조립하면 항목의 clip은 null로 돌아가므로, 호출한 쪽은 새 look으로
 * 클립을 다시 정해(clipFor) 또 부른다.
 */
export function reportAvatarClip(probeId: string | undefined, clip: string): void {
  if (!import.meta.env.DEV || probeId === undefined) return;
  const entry = avatarProbe.get(probeId);
  if (entry) entry.clip = clip;
}

/**
 * 외형 → 조립한 아바타와 GLB의 클립 전부(기본 7 + 하의 변형). 무엇을 재생할지는 호출한 쪽이 clipFor로 정한다.
 * 같은 외형(lookKey)이면 다시 조립하지 않는다. look·decorate는 외형이 바뀌어 다시 조립할 때의 값을 쓴다.
 *
 * 호출한 쪽의 애니메이션 effect는 이 훅 호출보다 뒤에 선언한다: 같은 컴포넌트의 effect는 선언 순서대로 돌므로
 * 프로브 항목이 생긴 뒤에 reportAvatarClip이 불린다. 이 훅의 layout effect(몫 잡기)는 그보다도 먼저 돈다.
 */
export function useAvatar(
  look: AvatarLook,
  opts: { probeId?: string; decorate?: (a: BuiltAvatar) => void } = {},
): { avatar: BuiltAvatar; animations: AnimationClip[] } {
  const { scene, animations } = useGLTF(CHARACTER_MODEL_URL);
  const { probeId, decorate } = opts;
  const key = lookKey(look);

  // 렌더 단계: 조립만 하고 잡지 않는다(머리말).
  const avatar = useMemo(
    () => assembleAvatar({ scene }, look, decorate),
    // look은 key(lookKey)가 대신한다 — 호출한 쪽이 렌더마다 새 look 객체를 만들어도 같은 외형이면 다시 조립하지
    // 않는다. decorate는 다시 조립할 때의 값을 쓴다(매 렌더 새 함수여도 무시).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, key],
  );

  useLayoutEffect(() => {
    retainAvatar(avatar);
    return () => releaseAvatarSoon(avatar);
  }, [avatar]);

  useEffect(() => {
    if (!import.meta.env.DEV || probeId === undefined) return;
    const entry: AvatarProbeEntry = {
      parts: avatar.parts,
      drawMeshes: avatar.drawMeshes,
      triangles: avatar.triangles,
      topY: avatar.topY,
      clip: null,
    };
    avatarProbe.set(probeId, entry);
    return () => {
      // 같은 probeId로 새로 마운트한 아바타의 항목은 지우지 않는다.
      if (avatarProbe.get(probeId) === entry) avatarProbe.delete(probeId);
    };
  }, [avatar, probeId]);

  return { avatar, animations };
}

/** character.glb를 미리 받아 둔다(입장 화면에서 조립실·월드보다 먼저). */
export function preloadCharacterAssets(): void {
  useGLTF.preload(CHARACTER_MODEL_URL);
}
