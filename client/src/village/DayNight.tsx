import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, Color, Sprite, SpriteMaterial, type Camera, type Scene, type WebGLRenderer } from "three";
import { isIndoorArea, isLotArea, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { useLightRig } from "../game/lightRig";
import { QUALITY, exposureFor, inverseNeutralToneMap, type QualityTier } from "../game/quality";
import { useSettingsStore } from "../stores/settingsStore";
import { keyOffset } from "./dayNightBlend";
import { dayNight, resetOnVisible } from "./dayNightDriver";
import { villageClock } from "./villageClock";
import { BAKED_ROOM_LIGHT, roomBaked } from "./lots/roomBaked";

declare global {
  interface Window {
    /** Dev-only: the village's time of day (the eased look the scene shows now and the clock's reading). */
    __cvDayNight?: () => { applied: typeof dayNight.applied; outdoor: typeof dayNight.outdoor; utcMs: number; offsetMs: number };
    /** Dev-only: the renderer, scene and camera (the night frames' walkable-area mask is rendered from them). */
    __cvThree?: () => { gl: WebGLRenderer; scene: Scene; camera: Camera };
  }
}

/**
 * The village's day and night in the scene (Task 7A): every frame it steps the driver (the clock's target, read every
 * 10 s and eased) and writes the look into what `PlayShell` made — the sun and the sky light (direction, colour,
 * strength), the fog and clear colour, the tone-mapping exposure. The model's own materials follow in `VillageModel`
 * (`applyDayNight`). Plain number writes, no allocation, no shader changes.
 *
 * In the memorial hall (`area`) the driver hands out the hall's warm indoor light instead; the open village's look
 * keeps easing under it (`dayNight.outdoor`: the hall's windows show it in Task 9).
 *
 * The rich tier tone-maps the whole frame, clear colour included, so there the clear colour is the one that
 * tone-maps back into the haze (the same compensation as `PlayShell`'s `skyClear`, here per frame); the fog's colour
 * is the haze itself on both tiers.
 */
/** The rich tier's clear colour, written in place every frame (no allocation). */
const SKY_CLEAR: [number, number, number] = [0, 0, 0];

/** How far the sun glow sprite sits from the camera (m): past the hills and the sky dome (1.4 km; the dome does not write depth), inside the far plane (1.6 km). */
const SUN_DISTANCE = 1550;
/** The sprite's side (m): about 20 degrees across, a halo, not a wash. */
const SUN_SIZE = 810; // 680 m at 1.3 km: the same angle
/** ... and this much bigger with a low sun (morning, evening). */
const SUN_SIZE_LOW_EXTRA = 453;

/** The glow's picture: a small soft core and a wide faint halo (alpha, white), fading to nothing at the edge. */
function sunGlowTexture(): CanvasTexture {
  const n = 128;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2; // 0 centre .. 1 edge
        const t = Math.min(1, Math.max(0, (r - 0.05) / 0.07));
        const disc = 1 - t * t * (3 - 2 * t); // the sun's disc, a touch bloomed (~2 degrees across)
        const bloom = 1.3 * Math.exp(-((r / 0.1) ** 1.2));
        const halo = 1.0 * Math.exp(-((r / 0.3) ** 1.6)); // the wide soft halo
        const ef = Math.min(1, Math.max(0, (1 - r) / 0.4));
        const edge = ef * ef * (3 - 2 * ef); // exactly 0 with zero slope at the picture's edge (the last 40% of the radius): no visible rim
        const sum = (disc + bloom + halo) * edge;
        const a = Math.min(1, sum);
        const i = (y * n + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  return new CanvasTexture(canvas);
}

/**
 * Inside a lot building's room (lots v2) the hall's warm indoor light is turned down to a lit interior's (the builders' look-dev rooms:
 * the sky half, the key a third, a touch more exposure) — the room's own fill and lamps (LotRoom.tsx) carry it.
 */
export const LOT_ROOM_LIGHT = { hemi: 0.55, key: 0.35, exposure: 1.1 } as const;

export function DayNight({ area, tier }: { area: AreaId; tier: QualityTier }) {
  const rig = useLightRig();
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const toneMappedFrame = QUALITY[tier].bloom;
  const glow = useMemo(() => {
    const material = new SpriteMaterial({
      map: sunGlowTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(SUN_SIZE, SUN_SIZE, 1);
    sprite.frustumCulled = false;
    sprite.visible = false;
    sprite.raycast = () => {};
    return sprite;
  }, []);
  useEffect(
    () => () => {
      glow.material.map?.dispose();
      glow.material.dispose();
    },
    [glow],
  );

  // Back from a hidden tab: snap to the clock instead of gliding from the look the tab was hidden with.
  useEffect(() => (typeof document !== "undefined" ? resetOnVisible(document) : undefined), []);

  useEffect(() => {
    dayNight.reset(); // a new scene starts from the clock itself
    if (import.meta.env.DEV) {
      window.__cvDayNight = () => ({
        applied: dayNight.applied,
        outdoor: dayNight.outdoor,
        utcMs: villageClock.nowMs(),
        offsetMs: villageClock.offsetMs(),
      });
      window.__cvThree = () => {
        const { gl: renderer, scene: root, camera } = get();
        return { gl: renderer, scene: root, camera };
      };
    }
    return () => {
      if (import.meta.env.DEV) {
        delete window.__cvDayNight;
        delete window.__cvThree;
      }
    };
  }, [get]);

  useFrame((_, delta) => {
    dayNight.step(Math.min(delta, 1), isIndoorArea(area));
    const s = dayNight.applied;

    // Exposure: the scene's (the clock's) times the player's brightness.
    const exposure = exposureFor(useSettingsStore.getState().settings.brightness) * s.exposure * (isLotArea(area) ? LOT_ROOM_LIGHT.exposure : 1);
    if (gl.toneMappingExposure !== exposure) gl.toneMappingExposure = exposure;

    // Fog and the clear colour.
    if (scene.fog) scene.fog.color.setRGB(s.sky[0], s.sky[1], s.sky[2]);
    if (scene.background instanceof Color) {
      if (toneMappedFrame) {
        const c = inverseNeutralToneMap(s.sky, exposure, SKY_CLEAR);
        scene.background.setRGB(c[0], c[1], c[2]);
      } else {
        scene.background.setRGB(s.sky[0], s.sky[1], s.sky[2]);
      }
    }

    // The sun glow: a soft halo where the real sun is (never anywhere else), none indoors or once the sun is down.
    const camera = get().camera;
    const indoor = isIndoorArea(area);
    const strength = indoor ? 0 : s.sunGlow;
    glow.visible = strength > 0.01;
    if (glow.visible) {
      glow.position.set(
        camera.position.x + s.sunDir[0] * SUN_DISTANCE,
        camera.position.y + s.sunDir[1] * SUN_DISTANCE,
        camera.position.z + s.sunDir[2] * SUN_DISTANCE,
      );
      glow.material.color.setRGB(s.glowColor[0], s.glowColor[1], s.glowColor[2]);
      glow.material.opacity = Math.min(1, strength * 3);
      const size = SUN_SIZE + SUN_SIZE_LOW_EXTRA * Math.min(1, Math.max(0, (strength - 0.34) / 0.3));
      // A tall phone screen is narrow: the same angle would fill it, so the glow shrinks with the aspect.
      const aspect = (camera as { aspect?: number }).aspect ?? 1.6;
      const fit = Math.min(1, Math.max(0.3, aspect / 1.6));
      glow.scale.set(size * fit, size * fit, 1);
    }

    if (!rig) return;
    const hemi = rig.hemi.current;
    if (hemi) {
      hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2]);
      hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2]);
      hemi.intensity = s.hemiIntensity * (isLotArea(area) ? LOT_ROOM_LIGHT.hemi * (roomBaked.on ? BAKED_ROOM_LIGHT.hemi : 1) : 1);
    }
    const sun = rig.sun.current;
    if (sun) {
      sun.color.setRGB(s.keyColor[0], s.keyColor[1], s.keyColor[2]);
      sun.intensity = s.keyIntensity * (isLotArea(area) ? LOT_ROOM_LIGHT.key * (roomBaked.on ? BAKED_ROOM_LIGHT.key : 1) : 1);
      keyOffset(s.keyDir, rig.keyOffset);
      if (!rig.aim.external) {
        const t = sun.target.position;
        sun.position.set(t.x + rig.keyOffset[0], t.y + rig.keyOffset[1], t.z + rig.keyOffset[2]);
      }
    }
  });
  return <primitive object={glow} />;
}
