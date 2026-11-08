import { createContext, useContext, type RefObject } from "react";
import type { DirectionalLight, HemisphereLight } from "three";

/**
 * The scene lights `PlayShell` makes, handed to a scene's own 3D content so it can move them (케이슨 마을's day and
 * night, Task 7A: the sun's direction, the sky and ground light follow the clock). A scene that does not ask for it
 * (every other one) never touches them; the preset values in sceneLighting.ts stay what they start as.
 */
export interface LightRig {
  /** The sun (the directional key light). */
  sun: RefObject<DirectionalLight | null>;
  hemi: RefObject<HemisphereLight | null>;
  /**
   * The sun's position relative to its target (m), written in place: `PlayShell` keeps the shadow box's sun at the
   * target plus this offset (`SunFollow` too, when the box follows the player). Its length stays the preset's.
   */
  keyOffset: [number, number, number];
}

export const LightRigContext = createContext<LightRig | null>(null);

/** The light rig of the enclosing `PlayShell` (null outside one). */
export function useLightRig(): LightRig | null {
  return useContext(LightRigContext);
}
