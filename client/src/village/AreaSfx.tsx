import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { rideSfxBuilt, setRideSfxActive } from "../land/rideSfx";
import { panFor, sfxListener } from "../land/sfx/sfxKit";
import { PARK_FOUNTAIN, VILLAGE_FOUNTAIN, createFountainAudio, type FountainSite } from "./fountainAudio";
import { resumeVillageAudio } from "./villageAudio";

/**
 * The area's placed sounds, mounted inside the scene's canvas: the plaza fountain's water (the village's, or the park's star
 * fountain) and, in 케이슨랜드, the rides' sound (land/rideSfx.ts). It writes where the listener is (the camera) every frame
 * (`sfxListener`: the position and the ground-plane right-hand vector for the stereo pan); the sounds themselves read it.
 * Leaving the area unmounts or retargets it, which fades the sounds out and frees their nodes: nothing plays in a hall or a house.
 * The audio context needs a user gesture before it may run: the first press / key / touch resumes it.
 */
export function AreaSfx({ area }: { area: AreaId }) {
  const site: FountainSite | null = area === "village" ? VILLAGE_FOUNTAIN : area === "park" ? PARK_FOUNTAIN : null;
  const fountain = useMemo(() => (site ? createFountainAudio(site) : null), [site]);
  useEffect(() => () => fountain?.dispose(), [fountain]);
  useEffect(() => {
    if (area !== "park") return;
    setRideSfxActive(true);
    return () => setRideSfxActive(false);
  }, [area]);
  useEffect(() => {
    if (!site) return;
    const resume = (): void => resumeVillageAudio();
    const events = ["pointerdown", "keydown", "touchend"] as const;
    for (const e of events) window.addEventListener(e, resume, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, resume);
    };
  }, [site]);
  // DEV probe (the e2e reads it): is the fountain's water running, and how many ride mixes are built
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __cvSfx?: unknown };
    w.__cvSfx = { fountainRunning: () => fountain?.running ?? false, fountainTarget: () => fountain?.target ?? 0, ridesBuilt: rideSfxBuilt };
    return () => {
      delete w.__cvSfx;
    };
  }, [fountain]);
  const dir = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    camera.getWorldDirection(dir);
    const len = Math.hypot(dir.x, dir.z);
    if (len > 0.05) {
      sfxListener.rx = -dir.z / len;
      sfxListener.rz = dir.x / len;
    }
    sfxListener.x = camera.position.x;
    sfxListener.z = camera.position.z;
    sfxListener.valid = true;
    if (fountain && site) {
      const dx = site.x - camera.position.x;
      const dz = site.z - camera.position.z;
      fountain.update(Math.hypot(dx, dz), panFor(dx, dz, sfxListener.rx, sfxListener.rz));
    }
  });
  useEffect(
    () => () => {
      sfxListener.valid = false;
    },
    [],
  );
  return null;
}
