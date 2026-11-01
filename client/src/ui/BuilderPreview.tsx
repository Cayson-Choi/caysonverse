// 조립실 3D 미리보기(설계 5.3): 지금 외형의 토이 피규어가 Idle로 서 있고, 가로로 끌면 돈다.
// 인형은 게임과 같은 조립 경로(useAvatar)로 만들고, 클립 이름은 어디서나처럼 clipFor를 거친다.
// 외형이 바뀌면 PreviewFigure의 key(lookKey)가 바뀌어 새 믹서로 다시 마운트되므로 클립도 새 look으로 다시 정해진다.
// 회전 각도는 ref에만 있다(React state 금지). 입장하면 EntryScreen과 함께 이 Canvas도 언마운트되어 루프가 멈춘다.

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useAnimations } from "@react-three/drei";
import type { Appearance } from "@caysonverse/shared/appearance";
import { clipFor, lookFromAppearance, lookKey, type AvatarLook } from "../game/characterLook";
import { avatarProbe, reportAvatarClip, useAvatar } from "../game/useAvatar";
import { BlobShadow } from "../game/BlobShadow";
import { CLIP } from "../game/constants";
import { BUILDER_COPY, PREVIEW_CAMERA, PREVIEW_DRAG_SPEED, PREVIEW_START_YAW } from "./builderOptions";

/** `__cvAvatars()`에서 미리보기 인형의 키. */
export const PREVIEW_PROBE_ID = "preview";

/** DEV 클립 손잡이가 받는 기본 클립 이름(CLIP 값). 실제 재생 이름은 clipFor로 정한다. */
const KNOB_CLIPS: readonly string[] = Object.values(CLIP);

// Canvas 설정은 모듈 상수다: 렌더마다 새 객체·배열을 넘기지 않아 R3F가 카메라를 다시 설정할 일이 없다.
const PREVIEW_DPR: [number, number] = [1, 2];
const PREVIEW_CAMERA_OPTIONS = {
  fov: PREVIEW_CAMERA.fov,
  near: 0.1,
  far: 40,
  position: [0, PREVIEW_CAMERA.eyeY, PREVIEW_CAMERA.distance] as [number, number, number],
};
/** 1단계 승인 뷰어의 조명. */
const HEMI_LIGHT: [number, number, number] = [0xfff6ea, 0x9a7a5a, 1.6];
const SUN_POSITION: [number, number, number] = [3, 7, 5];

/** `window.__cvPreview()`가 돌려주는 값(DEV 전용). */
export interface PreviewProbe {
  /** 지금 회전 각도(rad). 끌면 dx × PREVIEW_DRAG_SPEED만큼 바뀐다(2π로 감싸지 않는다). */
  yaw: number;
  /** 손잡이로 고른 기본 클립(기본 Idle). */
  base: string;
  /** 지금 재생 중인 클립 = clipFor(base, look). 인형이 아직 없으면 null. */
  clip: string | null;
  /** 미리보기 인형의 부품 메시 이름(정렬). 아직 없으면 []. */
  parts: string[];
  /** 지금 외형의 lookKey. */
  lookKey: string | null;
  /** 인형이 한 번이라도 그려졌는가(로딩 문구 → 끌기 안내). */
  shown: boolean;
}

/** DEV 손잡이: 미리보기 상태 읽기 + 기본 클립 바꾸기(Task 10이 외형마다 서기·걷기·앉기 시트를 찍는다). */
export type PreviewKnob = (() => PreviewProbe) & {
  /** `base`(CLIP 값)를 clipFor(base, look)으로 재생한다. 돌려주는 값은 지금 외형에서 재생될 이름이다. */
  setClip: (base: string) => string;
  /** 회전 각도를 바로 정한다(시트를 같은 각도로 찍을 때). 다음 프레임에 카메라가 옮겨진다. */
  setYaw: (yaw: number) => void;
};

declare global {
  interface Window {
    /** DEV 전용 E2E 손잡이(조립실 미리보기). 운영 번들에는 없다. */
    __cvPreview?: PreviewKnob;
  }
}

/** 마운트된 미리보기가 DEV 손잡이에 걸어 두는 연결. 운영에서는 쓰지 않는다. */
interface PreviewLink {
  yaw: () => number;
  setYaw: (yaw: number) => void;
  look: () => AvatarLook;
  base: () => string;
  setBase: (base: string) => void;
  shown: () => boolean;
}
let previewLink: PreviewLink | null = null;
/** 지금 재생 중인 클립(PreviewFigure가 바뀔 때만 적는다. 매 프레임 아님). */
let previewClip: string | null = null;

if (import.meta.env.DEV && typeof window !== "undefined") {
  const knob = (() => {
    const link = previewLink;
    const look = link?.look();
    return {
      yaw: link ? link.yaw() : Number.NaN,
      base: link ? link.base() : CLIP.idle,
      clip: link ? previewClip : null,
      parts: [...(avatarProbe.get(PREVIEW_PROBE_ID)?.parts ?? [])],
      lookKey: look ? lookKey(look) : null,
      shown: link ? link.shown() : false,
    };
  }) as PreviewKnob;
  knob.setClip = (base: string) => {
    if (!KNOB_CLIPS.includes(base)) throw new Error(`__cvPreview.setClip: unknown clip "${base}" (${KNOB_CLIPS.join(", ")})`);
    if (!previewLink) throw new Error("__cvPreview.setClip: the builder preview is not mounted");
    previewLink.setBase(base);
    return clipFor(base, previewLink.look());
  };
  knob.setYaw = (yaw: number) => {
    if (!Number.isFinite(yaw)) throw new Error(`__cvPreview.setYaw: not a finite angle (${yaw})`);
    if (!previewLink) throw new Error("__cvPreview.setYaw: the builder preview is not mounted");
    previewLink.setYaw(yaw);
  };
  window.__cvPreview = knob;
}

/** 카메라를 yaw 궤도 위에 두고 인형 가운데 높이를 본다. yaw가 바뀐 프레임에만 옮긴다. */
function PreviewCamera({ yawRef }: { yawRef: { current: number } }) {
  const camera = useThree((s) => s.camera);
  const lastYaw = useRef(Number.NaN);
  useFrame(() => {
    const yaw = yawRef.current;
    if (yaw === lastYaw.current) return;
    lastYaw.current = yaw;
    const { distance, eyeY, targetY } = PREVIEW_CAMERA;
    camera.position.set(Math.sin(yaw) * distance, eyeY, Math.cos(yaw) * distance);
    camera.lookAt(0, targetY, 0);
  });
  return null;
}

interface FigureProps {
  look: AvatarLook;
  /** 기본 클립 이름(CLIP 값). 사용자 화면에서는 항상 Idle이다. */
  base: string;
  /** 인형이 처음 그려지는 프레임에 한 번 부른다. */
  onShown: () => void;
}

/** 외형 하나의 인형. 부모가 key={lookKey(look)}로 마운트하므로 외형이 바뀌면 새 믹서로 다시 만들어진다. */
function PreviewFigure({ look, base, onShown }: FigureProps) {
  const { avatar, animations } = useAvatar(look, { probeId: PREVIEW_PROBE_ID });
  const { actions } = useAnimations(animations, avatar.root);
  // 이 look에서 재생할 이름. 클립 이름은 언제나 clipFor를 거친다(Idle은 변형이 없어 그대로 Idle).
  const clipName = clipFor(base, look);

  // useAvatar 뒤에 선언: 같은 컴포넌트의 effect는 선언 순서로 돌므로 프로브 항목이 생긴 뒤 클립을 적는다.
  useEffect(() => {
    const action = actions[clipName];
    if (!action) return;
    action.reset().fadeIn(0).play();
    if (import.meta.env.DEV) {
      previewClip = clipName;
      reportAvatarClip(PREVIEW_PROBE_ID, clipName);
    }
    return () => {
      action.stop();
    };
  }, [actions, clipName]);

  const shownRef = useRef(false);
  useFrame(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    onShown();
  });

  return (
    <group>
      <primitive object={avatar.root} />
      <BlobShadow />
    </group>
  );
}

/** WebGL이 없거나 모델을 못 받아도 입장 화면 전체가 무너지지 않게, 미리보기만 대체 문구로 바꾼다. */
class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const PREVIEW_FAILED = "미리보기를 불러오지 못했어요. 그래도 입장할 수 있어요.";

/** 조립실 미리보기. 컨테이너는 가로 끌기만 가로채고(touch-action: pan-y) 세로 끌기는 페이지 스크롤로 둔다. */
export function BuilderPreview({ appearance }: { appearance: Appearance }) {
  const look = useMemo(() => lookFromAppearance(appearance), [appearance]);
  const key = lookKey(look);
  const yawRef = useRef(PREVIEW_START_YAW);
  const dragRef = useRef<{ id: number; x: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // 미리보기가 화면 밖으로 완전히 스크롤되면 렌더 루프를 멈춘다(휴대폰에서 칩·목소리를 고르는 동안).
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries[entries.length - 1].isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // DEV 손잡이가 고르는 기본 클립. 사용자 화면에서는 바뀌지 않는다(Idle).
  const [base, setBase] = useState<string>(CLIP.idle);

  // DEV: 손잡이 연결. 읽는 함수들이 ref를 통해 지금 값을 본다.
  const lookRef = useRef(look);
  lookRef.current = look;
  const baseRef = useRef(base);
  baseRef.current = base;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const link: PreviewLink = {
      yaw: () => yawRef.current,
      setYaw: (yaw) => {
        yawRef.current = yaw;
      },
      look: () => lookRef.current,
      base: () => baseRef.current,
      setBase,
      shown: () => shownRef.current,
    };
    previewLink = link;
    return () => {
      if (previewLink === link) {
        previewLink = null;
        previewClip = null;
      }
    };
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { id: e.pointerId, x: e.clientX };
    // 마우스는 상자 밖으로 끌려 나가도 계속 돌게 잡아 둔다(터치는 브라우저가 이미 잡아 준다).
    if (e.pointerType === "mouse") e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    yawRef.current += (e.clientX - drag.x) * PREVIEW_DRAG_SPEED;
    drag.x = e.clientX;
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
  }

  const onShown = useCallback(() => setShown(true), []);

  return (
    <div
      ref={boxRef}
      className="cv-builder-preview"
      role="group"
      aria-label="캐릭터 미리보기"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <PreviewBoundary fallback={<p className="cv-builder-hint is-failed">{PREVIEW_FAILED}</p>}>
        <div className="cv-builder-stage">
          <Canvas dpr={PREVIEW_DPR} frameloop={onScreen ? "always" : "never"} camera={PREVIEW_CAMERA_OPTIONS}>
            <hemisphereLight args={HEMI_LIGHT} />
            <directionalLight color={0xffffff} intensity={2.4} position={SUN_POSITION} />
            <PreviewCamera yawRef={yawRef} />
            <Suspense fallback={null}>
              <PreviewFigure key={key} look={look} base={base} onShown={onShown} />
            </Suspense>
          </Canvas>
        </div>
        {/* 무대 위가 아니라 아래 띠에 둔다: 인형의 발을 가리지 않는다. */}
        <p className={"cv-builder-hint" + (shown ? "" : " is-loading")} aria-live="polite">
          {shown ? BUILDER_COPY.dragHint : BUILDER_COPY.loading}
        </p>
      </PreviewBoundary>
    </div>
  );
}
