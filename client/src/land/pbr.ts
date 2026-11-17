import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture, Vector2, type MeshStandardMaterialParameters } from "three";
import { isTouchDevice } from "../device";

/** The CC0 ambientCG sets (client/public/textures/park, LICENSE.md): colour, OpenGL normal and roughness maps, 1K. */
export const PARK_SETS = ["Grass001", "PavingStones070", "Gravel023", "PaintedMetal013", "RoofingTiles013A", "Concrete034", "Plaster003", "PaintedPlaster017", "LeafyGrass", "WoodFloor051"] as const;
export type ParkSet = (typeof PARK_SETS)[number];

export const parkTextureUrls = (set: ParkSet): [string, string, string] => [`/textures/park/${set}_c.webp`, `/textures/park/${set}_n.webp`, `/textures/park/${set}_r.webp`];

/** All the sets' maps in one list (the order `parkMaterial` reads them back). */
export const ALL_PARK_URLS: string[] = PARK_SETS.flatMap((s) => parkTextureUrls(s));

export interface PbrMaps {
  c: Texture;
  n: Texture;
  r: Texture;
}

/** Pick one set's three loaded maps out of the list `useTexture(ALL_PARK_URLS)` returned. */
export function pickSet(all: Texture[], set: ParkSet): PbrMaps {
  const i = PARK_SETS.indexOf(set) * 3;
  return { c: all[i]!, n: all[i + 1]!, r: all[i + 2]! };
}

/**
 * A standard material from a set, repeated every `metres` m on a surface with world-metre UVs (`1 / metres` repeats a metre). The textures
 * are cloned so each material has its own repeat. `useColor` false leaves the colour map out (vertex colours paint it; the set gives only the
 * surface: bump and gloss).
 */
export function parkMaterial(maps: PbrMaps, repeat: number | [number, number], params: Omit<MeshStandardMaterialParameters, "normalScale"> & { useColor?: boolean; normalScale?: number } = {}): MeshStandardMaterial {
  const { useColor = true, normalScale = 0.8, ...rest } = params;
  const prep = (t: Texture, srgb: boolean): Texture => {
    const c = t.clone();
    c.wrapS = c.wrapT = RepeatWrapping;
    if (typeof repeat === "number") c.repeat.set(repeat, repeat);
    else c.repeat.set(repeat[0], repeat[1]);
    c.anisotropy = isTouchDevice ? 2 : 8;
    if (srgb) c.colorSpace = SRGBColorSpace;
    c.needsUpdate = true;
    return c;
  };
  return new MeshStandardMaterial({
    map: useColor ? prep(maps.c, true) : null,
    normalMap: prep(maps.n, false),
    normalScale: new Vector2(normalScale, normalScale),
    roughnessMap: prep(maps.r, false),
    roughness: 1,
    metalness: 0,
    ...rest,
  });
}

/** A soft-edged strip for an alpha map (u across the path): opaque in the middle, fading to nothing at both edges, so a gravel path melts into the lawn. */
let featherTex: Texture | null = null;
export function featherTexture(): Texture {
  if (featherTex) return featherTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "#000");
  g.addColorStop(0.22, "#fff");
  g.addColorStop(0.78, "#fff");
  g.addColorStop(1, "#000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  featherTex = new CanvasTexture(c);
  featherTex.wrapS = featherTex.wrapT = RepeatWrapping;
  return featherTex;
}
