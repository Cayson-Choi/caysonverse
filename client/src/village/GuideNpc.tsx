import { useEffect, useMemo, useRef } from "react";
import { useAnimations } from "@react-three/drei";
import type { Group } from "three";
import { GUIDES, type Guide } from "@caysonverse/shared/village/guides";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { CLIP } from "../game/constants";
import { clipFor, lookFromAppearance } from "../game/characterLook";
import { createNametag } from "../game/nametag";
import { registerLabel } from "../game/labelRegistry";
import { bubbleRestHeight, nametagRestHeight } from "../game/nametagLayout";
import { reportAvatarClip, useAvatar } from "../game/useAvatar";

/**
 * One village guide (케이슨 마을 Task 9A): the players' toy figure in a fixed look (shared/village/guides.ts), standing
 * still in its Idle loop with an "안내원" name tag (pinned in the NametagSystem, like the AI 조교's). Solidity comes
 * from the guide's collider in the walk geometry (`guideColliders`), not from this component; "문의하기" and the
 * questions are the context button and GuideDialog.
 */
function GuideFigure({ guide }: { guide: Guide }) {
  const groupRef = useRef<Group>(null);
  const look = useMemo(() => lookFromAppearance(guide.appearance), [guide]);
  const probeId = `guide:${guide.id}`;
  const { avatar, animations } = useAvatar(look, { probeId });
  const tagHeight = nametagRestHeight(avatar.topY);
  const bubbleRest = bubbleRestHeight(avatar.topY);

  const { actions } = useAnimations(animations, groupRef);
  useEffect(() => {
    const idle = actions[clipFor(CLIP.idle, look)];
    idle?.reset().play();
    if (import.meta.env.DEV && idle) reportAvatarClip(probeId, idle.getClip().name);
  }, [actions, look, probeId]);

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
    <group ref={groupRef} position={[guide.pos.x, 0, guide.pos.z]} rotation-y={guide.yaw}>
      <primitive object={avatar.root} />
    </group>
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
