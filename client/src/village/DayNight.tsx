import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, type Camera, type Scene, type WebGLRenderer } from "three";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { useLightRig } from "../game/lightRig";
import { QUALITY, exposureFor, inverseNeutralToneMap, type QualityTier } from "../game/quality";
import { useSettingsStore } from "../stores/settingsStore";
import { keyOffset } from "./dayNightBlend";
import { dayNight } from "./dayNightDriver";
import { villageClock } from "./villageClock";

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
export function DayNight({ area, tier }: { area: AreaId; tier: QualityTier }) {
  const rig = useLightRig();
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const toneMappedFrame = QUALITY[tier].bloom;

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
    dayNight.step(Math.min(delta, 1), area === "hall");
    const s = dayNight.applied;

    // Exposure: the scene's (the clock's) times the player's brightness.
    const exposure = exposureFor(useSettingsStore.getState().settings.brightness) * s.exposure;
    if (gl.toneMappingExposure !== exposure) gl.toneMappingExposure = exposure;

    // Fog and the clear colour.
    if (scene.fog) scene.fog.color.setRGB(s.sky[0], s.sky[1], s.sky[2]);
    if (scene.background instanceof Color) {
      if (toneMappedFrame) {
        const c = inverseNeutralToneMap(s.sky, exposure);
        scene.background.setRGB(c[0], c[1], c[2]);
      } else {
        scene.background.setRGB(s.sky[0], s.sky[1], s.sky[2]);
      }
    }

    if (!rig) return;
    const hemi = rig.hemi.current;
    if (hemi) {
      hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2]);
      hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2]);
      hemi.intensity = s.hemiIntensity;
    }
    const sun = rig.sun.current;
    if (sun) {
      sun.color.setRGB(s.keyColor[0], s.keyColor[1], s.keyColor[2]);
      sun.intensity = s.keyIntensity;
      keyOffset(s.keyDir, rig.keyOffset);
      const t = sun.target.position;
      sun.position.set(t.x + rig.keyOffset[0], t.y + rig.keyOffset[1], t.z + rig.keyOffset[2]);
    }
  });
  return null;
}
