import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Effects } from "@react-three/drei";
import { Vector2 } from "three";
import { UnrealBloomPass } from "three-stdlib";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { isTouchDevice } from "../device";
import { useSettingsStore } from "../stores/settingsStore";
import { BLOOM, QUALITY, exposureFor, resolveQuality, type QualityTier } from "./quality";
import "./quality.css";

/**
 * The look of the school scenes' rendering (AI 학교 탈출, Task 21): the quality tier's post effects and
 * the brightness. Mounted by `PlayShell` inside the Canvas, only for the hall and the classrooms
 * (`effects`); the legacy world never sees it.
 *
 *  - Brightness: the renderer's `toneMappingExposure`, whatever the tier (a tone-mapped frame is the same
 *    on both tiers: the rich tier tone-maps in its final pass instead of in the renderer).
 *  - High tier: the scene is drawn into a half-float target and a bloom pass lets the bright things glow
 *    (windows, the sun's patch, sparkles), then OutputPass tone-maps and converts to sRGB like the renderer
 *    does itself. The bloom's strength and radius are the brief's (0.6 / 0.4). Its threshold is raised from the
 *    brief's 0.85 to 1.3 for a scene as bright as ours: at 0.85 the whole floor and the (tone-map-compensated)
 *    sky glow and the frame turns into a blue-white haze; at 1.3 only real highlights bloom.
 *  - Low tier: nothing — no extra pass, so no extra fill-rate on a phone.
 *
 * No per-frame work lives here: the composer runs on drei's frame callback, the rest is set on change.
 */

/** MSAA samples of the half-float target (the canvas' own antialiasing does not reach a render target). */
const MSAA_SAMPLES = 4;

/** The tier in force: the player's graphics setting, or the device's call for "auto". */
export function useQualityTier(): QualityTier {
  const graphics = useSettingsStore((s) => s.settings.graphics);
  return resolveQuality(graphics, isTouchDevice);
}

/** The rich tier's post chain: bloom, then tone mapping and colour space (replaces the renderer's own output). */
function BloomChain() {
  const bloom = useMemo(
    () => new UnrealBloomPass(new Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold),
    [],
  );
  const output = useMemo(() => new OutputPass(), []);
  useEffect(
    () => () => {
      bloom.dispose();
      output.dispose();
    },
    [bloom, output],
  );
  return (
    <Effects disableGamma multisamping={MSAA_SAMPLES}>
      <primitive object={bloom} />
      <primitive object={output} />
    </Effects>
  );
}

/** Just above the rug (0.01) and the door pads (0.015-0.02), so the shadow is never under them; 3 cm is not seen. */
const SHADOW_Y = 0.03;
const SHADOW_OPACITY = 0.3;
const SHADOW_COLOR = "#2b2a55";

/**
 * The high tier's ground for the characters' real-time shadows: a see-through plane over the whole map that
 * shows only the shadow (ShadowMaterial). The room models arrive with baked, unlit floors that cannot take a
 * shadow themselves (Task 23); this plane is what lets the live characters still stand on the floor.
 */
export function ShadowFloor({ bounds }: { bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }) {
  const { minX, maxX, minZ, maxZ } = bounds;
  return (
    <mesh position={[(minX + maxX) / 2, SHADOW_Y, (minZ + maxZ) / 2]} rotation-x={-Math.PI / 2} renderOrder={2} receiveShadow>
      <planeGeometry args={[maxX - minX, maxZ - minZ]} />
      <shadowMaterial transparent opacity={SHADOW_OPACITY} color={SHADOW_COLOR} depthWrite={false} />
    </mesh>
  );
}

export function QualityEffects({ tier, brightness }: { tier: QualityTier; brightness: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = exposureFor(brightness);
    return () => {
      gl.toneMappingExposure = 1;
    };
  }, [gl, brightness]);
  return QUALITY[tier].bloom ? <BloomChain /> : null;
}
