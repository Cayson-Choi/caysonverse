import { Suspense, useEffect, useMemo, useRef } from "react";
import { useAnimations } from "@react-three/drei";
import { LoopOnce, type AnimationAction, type AnimationClip, type Group } from "three";
import { GUIDES, type Guide } from "@caysonverse/shared/village/guides";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { CLIP } from "../game/constants";
import { clipFor, lookFromAppearance } from "../game/characterLook";
import type { BuiltAvatar } from "../game/characterAvatar";
import { createNametag } from "../game/nametag";
import { PICK_AS_BODY } from "../game/clickPick";
import { registerLabel } from "../game/labelRegistry";
import { bubbleRestHeight, nametagRestHeight } from "../game/nametagLayout";
import { reportAvatarClip, useAvatar } from "../game/useAvatar";
import { LoadBoundary } from "./LoadBoundary";
import { clearNpcCache, useNpcAvatar } from "./npcAvatar";
import { subscribeGuideDialog, guideDialogOpen } from "./guideDialogStore";

/**
 * One village guide (케이슨 마을 Task 9A), standing still with an "안내원" name tag (pinned in the NametagSystem, like the AI
 * 조교's). Solidity comes from the guide's collider in the walk geometry (`guideColliders`), not from this component;
 * "문의하기" and the questions are the context button and GuideDialog.
 *
 * Since owner 2026-11-16 ("마을 안내원도 안내원만의 캐릭터 … 추모공간에 맞는 캐릭터") each guide wears its own NPC look from npc.glb
 * (npcLooks.ts: the plaza guide's red info vest, hat, badge and clipboard; the hall desk's black suit and mourning ribbon), with its
 * own idle and a greeting played once when its questions open. While npc.glb downloads nothing is drawn; if it fails, the old
 * fixed look on the players' figure stands in (and the download is tried again).
 */
function GuideBody({ guide, avatar, clips, idle, greet, probeId }: {
  guide: Guide;
  avatar: BuiltAvatar;
  clips: AnimationClip[];
  idle: string;
  greet: string | null;
  probeId: string;
}) {
  const groupRef = useRef<Group>(null);
  const tagHeight = nametagRestHeight(avatar.topY);
  const bubbleRest = bubbleRestHeight(avatar.topY);

  const { actions, mixer } = useAnimations(clips, groupRef);
  useEffect(() => {
    const base = actions[idle];
    base?.reset().play();
    if (import.meta.env.DEV && base) queueMicrotask(() => reportAvatarClip(probeId, base.getClip().name));
    const hello: AnimationAction | null = greet ? (actions[greet] ?? null) : null;
    if (!base || !hello) return;
    hello.setLoop(LoopOnce, 1);
    hello.clampWhenFinished = false;
    const onFinished = (e: { action: AnimationAction }) => {
      if (e.action !== hello) return;
      base.reset().fadeIn(0.35).play();
      hello.fadeOut(0.35);
      if (import.meta.env.DEV) reportAvatarClip(probeId, base.getClip().name);
    };
    mixer.addEventListener("finished", onFinished as never);
    // 문의하기를 열면 한 번 인사한다(안내원은 손을 흔들고, 추모관 안내는 공수한 채 고개 숙여 절한다)
    let wasOpen = guideDialogOpen() === guide.id;
    const unsubscribe = subscribeGuideDialog(() => {
      const open = guideDialogOpen() === guide.id;
      if (open && !wasOpen) {
        hello.reset().fadeIn(0.3).play();
        base.fadeOut(0.3);
        if (import.meta.env.DEV) reportAvatarClip(probeId, hello.getClip().name);
      }
      wasOpen = open;
    });
    return () => {
      unsubscribe();
      mixer.removeEventListener("finished", onFinished as never);
    };
  }, [actions, mixer, idle, greet, guide.id, probeId]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const tag = createNametag(guide.tag, "none", tagHeight);
    tag.setOpacity(0);
    group.add(tag.sprite);
    const unregister = registerLabel({
      id: probeId,
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
  }, [guide.tag, probeId, tagHeight, bubbleRest]);

  return (
    <group ref={groupRef} position={[guide.pos.x, 0, guide.pos.z]} rotation-y={guide.yaw} userData={PICK_AS_BODY}>
      <primitive object={avatar.root} />
    </group>
  );
}

/** The guide in its own NPC look (suspends on npc.glb). */
function NpcGuideFigure({ guide }: { guide: Guide }) {
  const probeId = `guide:${guide.id}`;
  const { avatar, clips, look } = useNpcAvatar(guide.npc, probeId);
  return <GuideBody guide={guide} avatar={avatar} clips={clips} idle={look.idle} greet={look.greet} probeId={probeId} />;
}

/** The old fixed look on the players' figure: only while npc.glb cannot be had. */
function FallbackGuideFigure({ guide }: { guide: Guide }) {
  const probeId = `guide:${guide.id}`;
  const look = useMemo(() => lookFromAppearance(guide.appearance), [guide]);
  const { avatar, animations } = useAvatar(look, { probeId });
  return <GuideBody guide={guide} avatar={avatar} clips={animations} idle={clipFor(CLIP.idle, look)} greet={null} probeId={probeId} />;
}

function GuideFigure({ guide }: { guide: Guide }) {
  return (
    <LoadBoundary fallback={<FallbackGuideFigure guide={guide} />} onReset={clearNpcCache} notice="안내원 모습을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
      <Suspense fallback={null}>
        <NpcGuideFigure guide={guide} />
      </Suspense>
    </LoadBoundary>
  );
}

/** The guides of the local player's area. */
export function GuideNpcs({ area }: { area: AreaId }) {
  return (
    <>
      {GUIDES.filter((g) => g.area === area).map((g) => (
        <GuideFigure key={g.id} guide={g} />
      ))}
    </>
  );
}
