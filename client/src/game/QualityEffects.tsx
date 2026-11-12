import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, NeutralToneMapping, Vector2 } from "three";
import { isTouchDevice } from "../device";
import { useSettingsStore } from "../stores/settingsStore";
import { BLOOM, QUALITY, exposureFor, resolveQuality, type GraphicsSetting, type QualityTier, type ToneCurve } from "./quality";
import { DEFAULT_DECAL_Y, decalY, type GroundDecal } from "./groundDecal";
import { PostChain } from "./postChain";
import { FrameGovernor, budgetSteps, startLevel, stepScale, useRenderBudget } from "./renderBudget";
import { interactionPressureActive, noteInteraction } from "./renderScale";
import { viewState } from "./viewState";
import { softwareGl } from "./gpuProbe";
import "./quality.css";

/**
 * The look of the school scenes' rendering (AI 학교 탈출, Task 21): the quality tier's post effects and
 * the brightness. Mounted by `PlayShell` inside the Canvas for the scenes that ask for it (`effects`: the hall,
 * the classrooms and 케이슨 마을); the legacy world never sees it.
 *
 *  - Brightness: the renderer's `toneMappingExposure`, whatever the tier (a tone-mapped frame is the same
 *    on both tiers: the rich tier tone-maps in its final pass instead of in the renderer).
 *  - High tier: the scene is drawn into a half-float target and a bloom pass lets the bright things glow
 *    (windows, the sun's patch, sparkles), then one final pass tone-maps and converts to sRGB like the renderer
 *    does itself, and smooths the edges (postChain.ts: no MSAA target, no second full-screen blend — the old chain
 *    kept a laptop's GPU at 30-46 fps, perf/interaction-latency). A frame governor (renderBudget.ts) lowers the
 *    scene's render scale while the GPU cannot keep up.
 *    The bloom's strength and radius are the brief's (0.6 / 0.4). Its threshold is raised from the
 *    brief's 0.85 to 1.6 for a scene as bright as ours: at 0.85 the whole floor and the (tone-map-compensated)
 *    sky glow and the frame turns into a blue-white haze; the baked sun patches reach about 1.4, so 1.3 hazed them too (Task 24);
 *    at 1.6 only real highlights bloom.
 *  - Low tier: nothing — no extra pass, so no extra fill-rate on a phone.
 *
 * Per frame: only the post chain and the governor's sample (number writes; the chain resizes on a change only). The
 * rest is set on change.
 */

/** The tier in force: the player's graphics setting, or the device's call for "auto" (touch or software WebGL → light). */
export function useQualityTier(): QualityTier {
  const graphics = useSettingsStore((s) => s.settings.graphics);
  return resolveQuality(graphics, isTouchDevice, graphics === "auto" && softwareGl());
}

/** The post chain drawing the frame right now (null on the light tier): SceneWarmUp compiles for its target. */
let activeChain: PostChain | null = null;
export function activePostChain(): PostChain | null {
  return activeChain;
}

/** Frame start marks for the governor: the first frame callback of every frame (before any scene work). */
const FIRST = -1_000_000;

/** A User Timing mark per step, for measurements (e2e/interaction-latency.mjs): cheap, and nothing reads it in the game. */
function markStep(level: number, scale: number): void {
  try {
    performance.mark("cv:render-scale", { detail: { level, scale } });
  } catch {
    // (an old browser without mark details: nothing to measure there)
  }
}

/**
 * The rich tier's post chain (postChain.ts), drawn on the frame callback at priority 1 (which also tells
 * react-three-fiber not to draw the frame itself), and the frame governor that steps its render scale (renderBudget.ts).
 * The canvas keeps the tier's dpr: a step is the chain's scale only, taken before the frame is drawn, so it costs
 * nothing and the frame it lands on is already drawn at the new scale.
 */
function PostEffects({ setting }: { setting: GraphicsSetting }) {
  const chain = useMemo(() => new PostChain(BLOOM), []);
  useEffect(() => {
    activeChain = chain;
    return () => {
      if (activeChain === chain) activeChain = null;
      chain.dispose();
    };
  }, [chain]);
  const deviceDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const steps = useMemo(() => budgetSteps(QUALITY.high.dpr, deviceDpr), [deviceDpr]);

  // A pointer/keyboard event can arrive while the GPU still has the previous rich frame in flight. Mark it in a
  // passive capture listener and draw the next frame at the governor's lowest scale; this keeps the input path free of
  // React work and makes the first interaction responsive before the governor's normal warm-up window has elapsed.
  useEffect(() => {
    const onPointerDown = () => noteInteraction();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.repeat) noteInteraction();
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", onPointerDown, opts);
    window.addEventListener("keydown", onKeyDown, opts);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, opts);
      window.removeEventListener("keydown", onKeyDown, opts);
    };
  }, []);

  const governor = useRef<FrameGovernor | null>(null);
  useEffect(() => {
    const g = new FrameGovernor(steps.length, startLevel(setting), performance.now());
    governor.current = g;
    chain.setScale(stepScale(steps, g.level));
    return () => {
      governor.current = null;
    };
  }, [setting, steps, chain]);
  // When the main thread is free again after a frame: a message posted at the end of the frame's callbacks is handled
  // only after the browser's own work for that frame (style, layout, paint, the commit to the compositor) and any task
  // queued before it (input, network, React) — on a slow CPU all of that is CPU time too, not a wait on the GPU.
  const frame = useRef({ ts: 0, prevTs: 0, start: 0, prevStart: 0, freeAt: 0 });
  const channel = useRef<MessageChannel | null>(null);
  useEffect(() => {
    if (typeof MessageChannel === "undefined") return;
    const c = new MessageChannel();
    c.port1.onmessage = () => {
      frame.current.freeAt = performance.now();
    };
    channel.current = c;
    return () => {
      channel.current = null;
      c.port1.onmessage = null;
      c.port1.close();
      c.port2.close();
    };
  }, []);
  const size = useMemo(() => new Vector2(), []);
  useFrame(() => {
    const f = frame.current;
    f.prevStart = f.start;
    f.start = performance.now();
    // The frame's own time (the rAF timestamp: whole display refreshes apart), not when its callback happened to start.
    const t = typeof document === "undefined" ? null : document.timeline?.currentTime;
    f.prevTs = f.ts;
    f.ts = typeof t === "number" ? t : f.start;
  }, FIRST);
  useFrame(({ gl, scene, camera }) => {
    const g = governor.current;
    const f = frame.current;
    const c = channel.current;
    // The main thread's idle time before this frame began: from when it was free after the previous frame (none seen:
    // it was busy all along) to this frame's first callback. The rest of the interval was CPU work.
    const interval = f.ts - f.prevTs;
    const idle = f.freeAt > f.prevStart ? Math.max(0, f.start - f.freeAt) : 0;
    f.freeAt = 0;
    if (g && f.prevTs !== 0 && c) {
      const next = g.sample(f.start, interval, Math.max(0, interval - idle));
      if (next !== null) {
        // The step itself: the chain's scale for this very frame (and the next scene's start, useRenderBudget).
        useRenderBudget.getState().setLevel(setting, next);
        const scale = stepScale(steps, next);
        chain.setScale(scale);
        markStep(next, scale);
      }
    }
    const governorScale = stepScale(steps, g?.level ?? startLevel(setting));
    const scale = interactionPressureActive() ? Math.min(governorScale, stepScale(steps, steps.length - 1)) : governorScale;
    const firstPersonSharp = viewState.mode === "fp" && viewState.blend > 0.95;
    chain.setScale(firstPersonSharp ? 1 : scale);
    chain.setFxaaEnabled(!firstPersonSharp);
    gl.getDrawingBufferSize(size);
    chain.setSize(size.x, size.y);
    chain.render(gl, scene, camera);
    c?.port2.postMessage(0);
  }, 1);
  return null;
}

/** Just above the rug (0.01) and the door pads (0.015-0.02), so the shadow is never under them; 3 cm is not seen. */
const SHADOW_Y = DEFAULT_DECAL_Y;
const SHADOW_OPACITY = 0.3;
const SHADOW_COLOR = "#2b2a55";

/**
 * The high tier's ground for the characters' real-time shadows: a see-through plane over the whole map that
 * shows only the shadow (ShadowMaterial). The room models arrive with baked, unlit floors that cannot take a
 * shadow themselves (Task 23); this plane is what lets the live characters still stand on the floor. `decal`: the
 * scene's own height and polygon offset (groundDecal.ts; 케이슨 마을's offset ground layers need it), else 3 cm.
 */
export function ShadowFloor({
  bounds,
  decal = null,
}: {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  decal?: GroundDecal | null;
}) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const y = decal ? decalY(decal) : SHADOW_Y;
  return (
    <mesh position={[(minX + maxX) / 2, y, (minZ + maxZ) / 2]} rotation-x={-Math.PI / 2} renderOrder={2} receiveShadow>
      <planeGeometry args={[maxX - minX, maxZ - minZ]} />
      <shadowMaterial
        transparent
        opacity={SHADOW_OPACITY}
        color={SHADOW_COLOR}
        depthWrite={false}
        polygonOffset={!!decal}
        polygonOffsetFactor={decal ? decal.polygonOffsetFactor : 0}
        polygonOffsetUnits={decal ? decal.polygonOffsetUnits : 0}
      />
    </mesh>
  );
}

/**
 * `exposure` and `toneCurve`: the scene's own (sceneLighting.ts `Lighting`; defaults 1 and ACES, the school's). The
 * exposure is multiplied with the player's brightness; the curve is the renderer's tone mapping, which the rich
 * tier's final pass follows too. 케이슨 마을's unlit, light-mapped model uses the neutral curve at 1.4: under ACES its
 * dark woods and shadows sank to black while its pale plaza went white. Both are given back on unmount.
 */
export function QualityEffects({
  tier,
  brightness,
  exposure = 1,
  toneCurve = "aces",
}: {
  tier: QualityTier;
  brightness: number;
  exposure?: number;
  toneCurve?: ToneCurve;
}) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = exposureFor(brightness) * exposure;
    return () => {
      gl.toneMappingExposure = 1;
    };
  }, [gl, brightness, exposure]);
  useEffect(() => {
    if (toneCurve === "aces") return;
    gl.toneMapping = NeutralToneMapping;
    return () => {
      gl.toneMapping = ACESFilmicToneMapping;
    };
  }, [gl, toneCurve]);
  const setting = useSettingsStore((s) => s.settings.graphics);
  return QUALITY[tier].bloom ? <PostEffects setting={setting} /> : null;
}
