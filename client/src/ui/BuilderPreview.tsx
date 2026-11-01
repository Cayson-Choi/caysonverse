// 조립실 3D 미리보기(설계 5.3, Task 7b 무대): 지금 외형의 토이 피규어가 배경 그림의 받침대 위에 Idle로 서 있고,
// 가로로 끌거나 ⟲ ⟳를 누르면 돈다. 캔버스는 투명하고(배경은 EntryScreen의 그림), 발이 받침대 윗면에 오도록
// stageLayout이 캔버스 상자를 놓는다(카메라는 PREVIEW_CAMERA 그대로).
// 인형은 게임과 같은 조립 경로(useAvatar)로 만들고, 클립 이름은 어디서나처럼 clipFor를 거친다.
// 외형이 바뀌면 PreviewFigure의 key(lookKey)가 바뀌어 새 믹서로 다시 마운트되므로 클립도 새 look으로 다시 정해진다.
// 회전 각도는 ref에만 있다(React state 금지). 입장하면 EntryScreen과 함께 이 Canvas도 언마운트되어 루프가 멈춘다.
// 같은 Canvas의 렌더러로 부품·프리셋 카드 그림도 그린다(PreviewThumbs, builderThumbs.ts).

import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import { Vector3, type Camera } from "three";
import type { Appearance } from "@caysonverse/shared/appearance";
import { clipFor, lookFromAppearance, lookKey, type AvatarLook } from "../game/characterLook";
import { CHARACTER_MODEL_URL, avatarProbe, reportAvatarClip, useAvatar } from "../game/useAvatar";
import { BlobShadow } from "../game/BlobShadow";
import { CLIP } from "../game/constants";
import {
  BUILDER_COPY,
  PREVIEW_CAMERA,
  PREVIEW_DRAG_SPEED,
  PREVIEW_LIGHTS,
  PREVIEW_ROTATE_MS,
  PREVIEW_ROTATE_STEP,
  PREVIEW_SPIN_MS,
  PREVIEW_START_YAW,
  tweenYaw,
} from "./builderOptions";
import { ThumbStudio, drawThumbFrame, thumbStore } from "./builderThumbs";
import { FIGURE_TOP } from "./stageLayout";
import { BuilderIcon } from "./BuilderIcons";

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
/** 밝은 하늘 정원 무대의 조명(PREVIEW_LIGHTS, 카드 그림과 같은 것). */
const { hemi: HEMI, sun: SUN, fill: FILL, rim: RIM } = PREVIEW_LIGHTS;
const HEMI_LIGHT: [number, number, number] = [HEMI.sky, HEMI.ground, HEMI.intensity];

/** 터치로 끌 때 이만큼 움직이면 가로(돌리기)·세로(시트 스크롤) 중 하나로 정한다. */
const AXIS_LOCK_PX = 8;

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
  /** Task 7b: 실제 카메라로 투영한 인형 발(원점)과 마법사 모자 끝 높이(FIGURE_TOP)의 화면 좌표(CSS px). 없으면 null. */
  feet: { x: number; y: number } | null;
  top: { x: number; y: number } | null;
}

/** DEV 손잡이: 미리보기 상태 읽기 + 기본 클립 바꾸기(Task 10이 외형마다 서기·걷기·앉기 시트를 찍는다). */
export type PreviewKnob = (() => PreviewProbe) & {
  /** `base`(CLIP 값)를 clipFor(base, look)으로 재생한다. 돌려주는 값은 지금 외형에서 재생될 이름이다. */
  setClip: (base: string) => string;
  /** 회전 각도를 바로 정한다(시트를 같은 각도로 찍을 때). 도는 중이면 멈춘다. 다음 프레임에 카메라가 옮겨진다. */
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
  project: (heightM: number) => { x: number; y: number } | null;
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
      feet: link ? link.project(0) : null,
      top: link ? link.project(FIGURE_TOP.height) : null,
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

/** 진행 중인 회전(⟲ ⟳·프리셋 한 바퀴). 끌기·setYaw가 시작되면 멈춘다. */
interface YawTween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

/** 카메라를 yaw 궤도 위에 두고 인형 가운데 높이를 본다. 회전 중이면 각도를 진행시키고, yaw가 바뀐 프레임에만 옮긴다. */
function PreviewCamera({
  yawRef,
  tweenRef,
  cameraRef,
}: {
  yawRef: { current: number };
  tweenRef: { current: YawTween | null };
  cameraRef: { current: Camera | null };
}) {
  const camera = useThree((s) => s.camera);
  const lastYaw = useRef(Number.NaN);
  useFrame(() => {
    cameraRef.current = camera;
    const tween = tweenRef.current;
    if (tween) {
      const progress = (performance.now() - tween.start) / tween.duration;
      yawRef.current = tweenYaw(tween.from, tween.to, progress);
      if (progress >= 1) tweenRef.current = null;
    }
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

/**
 * 부품·프리셋 카드 그림을 이 Canvas의 렌더러로 그린다(drawThumbFrame: 프레임마다 2장까지, 지금 탭 먼저, 할 일이
 * 없으면 할당 없이 바로 돌아간다). 그림은 렌더 타깃에만 찍으므로 화면(미리보기)에는 닿지 않는다. 캔버스 크기가
 * 바뀌면 실패한 그림을 다시 해 본다.
 */
function PreviewThumbs() {
  const gl = useThree((s) => s.gl);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const { scene, animations } = useGLTF(CHARACTER_MODEL_URL);
  // 만들 때는 GPU 자원을 잡지 않는다(촬영용 인형은 첫 일감에서 만든다): StrictMode가 두 번 만들어도 샐 것이 없다.
  // 촬영용 인형은 조립실이 떠 있는 동안 두고(색을 바꿀 때 다시 만들지 않게) 언마운트할 때 놓는다.
  const studio = useMemo(() => new ThumbStudio({ scene, animations }), [scene, animations]);
  useEffect(() => () => studio.release(), [studio]);
  useEffect(() => thumbStore.retryFailed(), [width, height]);
  useFrame(() => drawThumbFrame(thumbStore, studio, gl));
  return null;
}

/**
 * WebGL이 없거나 모델을 못 받아도 입장 화면 전체가 무너지지 않게, 미리보기만 대체 문구로 바꾼다.
 * 외형(resetKey)이 바뀌면 다시 해 본다. 모델을 못 받은 실패였으면 캐시된 오류를 지우고 다시 받는다.
 */
class PreviewBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; resetKey: string },
  { failed: boolean; loadError: boolean }
> {
  state = { failed: false, loadError: false };
  static getDerivedStateFromError(error: unknown): { failed: boolean; loadError: boolean } {
    return { failed: true, loadError: String(error).includes(CHARACTER_MODEL_URL) };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (!this.state.failed || prev.resetKey === this.props.resetKey) return;
    if (this.state.loadError) useGLTF.clear(CHARACTER_MODEL_URL);
    this.setState({ failed: false, loadError: false });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 조립실 미리보기(무대). 끌기는 직접 처리한다(touch-action: none): 마우스는 가로만 돌리기, 터치는 처음 움직인
 * 방향으로 정해 가로면 돌리기, 세로면 시트(scrollerRef)를 스크롤한다(Ruling S22: 세로로 끌면 돌지 않고 스크롤).
 * spin이 바뀌면(프리셋·🎲) 한 바퀴 돈다. 움직임 줄이기 설정이면 돌지 않고 회전 버튼은 바로 그 각도로 간다.
 */
export function BuilderPreview({
  appearance,
  spin = 0,
  scrollerRef,
}: {
  appearance: Appearance;
  spin?: number;
  scrollerRef?: RefObject<HTMLElement | null>;
}) {
  const look = useMemo(() => lookFromAppearance(appearance), [appearance]);
  const key = lookKey(look);
  const yawRef = useRef(PREVIEW_START_YAW);
  const tweenRef = useRef<YawTween | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; startX: number; startY: number; axis: "x" | "y" | null } | null>(
    null,
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // 미리보기가 화면 밖으로 완전히 나가면 렌더 루프를 멈춘다.
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

  /** 지금(또는 진행 중인 회전의 끝) 각도에서 delta만큼 duration 동안 돈다. */
  const turn = useCallback((delta: number, duration: number) => {
    const target = (tweenRef.current ? tweenRef.current.to : yawRef.current) + delta;
    if (prefersReducedMotion()) {
      tweenRef.current = null;
      yawRef.current = target;
      return;
    }
    tweenRef.current = { from: yawRef.current, to: target, start: performance.now(), duration };
  }, []);

  // 프리셋·🎲: 한 바퀴(움직임 줄이기면 돌지 않는다 — 각도도 그대로).
  useEffect(() => {
    if (spin === 0 || prefersReducedMotion()) return;
    turn(2 * Math.PI, PREVIEW_SPIN_MS);
  }, [spin, turn]);

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
        tweenRef.current = null;
        yawRef.current = yaw;
      },
      look: () => lookRef.current,
      base: () => baseRef.current,
      setBase,
      shown: () => shownRef.current,
      project: (heightM) => {
        const camera = cameraRef.current;
        const canvas = boxRef.current?.querySelector("canvas");
        if (!camera || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        camera.updateMatrixWorld();
        const p = new Vector3(0, heightM, 0).project(camera);
        return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
      },
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
    if ((e.target as Element).closest("button")) return; // ⟲ ⟳는 끌기가 아니다
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const axis = e.pointerType === "mouse" ? "x" : null;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, axis };
    tweenRef.current = null; // 도는 중이면 그 자리에서 멈추고 손가락을 따른다
    // 마우스는 상자 밖으로 끌려 나가도 계속 돌게 잡아 둔다(터치는 브라우저가 이미 잡아 준다).
    if (e.pointerType === "mouse") e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    // 버튼을 뗀 뒤 들어온 마우스 이동(pointerup을 놓친 경우)은 끌기가 아니다.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      dragRef.current = null;
      return;
    }
    if (drag.axis === null) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
      drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      // 정하기 전에 움직인 만큼도 넣는다(가로 200 px 끌기 = 2.0 rad).
      drag.x = drag.startX;
      drag.y = drag.startY;
    }
    if (drag.axis === "x") yawRef.current += (e.clientX - drag.x) * PREVIEW_DRAG_SPEED;
    else if (scrollerRef?.current) scrollerRef.current.scrollTop -= e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
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
      <PreviewBoundary resetKey={key} fallback={<p className="cv-builder-hint is-failed">{BUILDER_COPY.failed}</p>}>
        <div className="cv-builder-stage">
          <Canvas dpr={PREVIEW_DPR} frameloop={onScreen ? "always" : "never"} camera={PREVIEW_CAMERA_OPTIONS}>
            <hemisphereLight args={HEMI_LIGHT} />
            {[SUN, FILL, RIM].map((light, i) => (
              <directionalLight key={i} color={light.color} intensity={light.intensity} position={light.position} />
            ))}
            <PreviewCamera yawRef={yawRef} tweenRef={tweenRef} cameraRef={cameraRef} />
            <Suspense fallback={null}>
              <PreviewFigure key={key} look={look} base={base} onShown={onShown} />
            </Suspense>
            <Suspense fallback={null}>
              <PreviewThumbs />
            </Suspense>
          </Canvas>
        </div>
        <p className={"cv-builder-hint" + (shown ? "" : " is-loading")} aria-live="polite">
          {shown && <BuilderIcon name="swap" />}
          {shown ? BUILDER_COPY.dragHint : BUILDER_COPY.loading}
        </p>
        <button
          type="button"
          className="cv-rotate cv-rotate-left"
          aria-label={BUILDER_COPY.rotateLeft}
          onClick={() => turn(PREVIEW_ROTATE_STEP, PREVIEW_ROTATE_MS)}
        >
          <BuilderIcon name="rotateLeft" />
        </button>
        <button
          type="button"
          className="cv-rotate cv-rotate-right"
          aria-label={BUILDER_COPY.rotateRight}
          onClick={() => turn(-PREVIEW_ROTATE_STEP, PREVIEW_ROTATE_MS)}
        >
          <BuilderIcon name="rotateRight" />
        </button>
      </PreviewBoundary>
    </div>
  );
}
