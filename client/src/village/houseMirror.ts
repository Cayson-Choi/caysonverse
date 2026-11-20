import { CanvasTexture, Color, EquirectangularReflectionMapping, MeshStandardMaterial, SRGBColorSpace } from "three";
import { houseNightUniform } from "./houseNight";

/**
 * The glass of the houses' round and arched wall mirrors (owner 2026-11-20: "왜 이런 원들이 여기 저기 있는거야": the old mirror glass was
 * the windows' 84 % see-through `M_glass`, so a mirror looked like an empty brass hoop on the wall). The kit now builds mirror glass in
 * its own opaque material, `M_mirror` (houses 1–5) / `E_H_mirror` (houses 6–10), and the game draws it as silvered glass: a metal
 * material reflecting a small painted room (warm ceiling, cream walls, two bright windows, a wooden floor) as an equirect environment —
 * the reflection moves with the viewer, so it reads as glass, not as a grey disc. A slight cool tint; the night dims the reflection.
 */
export const HOUSE_MIRROR_MATERIALS: ReadonlySet<string> = new Set(["M_mirror", "E_H_mirror"]);

let shared: MeshStandardMaterial | null = null;

/** The painted room the mirror reflects (an equirectangular canvas: u = azimuth, v = elevation, top = up). */
function roomEnvironment(): CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, "#fbf3e4"); // the ceiling, lit
  sky.addColorStop(0.38, "#efe0c6");
  sky.addColorStop(0.5, "#d8c6a6"); // the walls at the horizon
  sky.addColorStop(0.62, "#b79a73");
  sky.addColorStop(1.0, "#6f5237"); // the floor boards
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // two tall bright windows and a door's glass, a few soft dark shapes (furniture) so the reflection is not a plain gradient
  const win = (x: number, w: number, y0: number, y1: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y0, w, y1 - y0);
  };
  win(60, 46, 70, 150, "#f4f9ff");
  win(150, 46, 70, 150, "#e9f3ff");
  win(330, 70, 60, 160, "#fffaf0");
  g.fillStyle = "rgba(60,44,30,0.55)";
  g.fillRect(230, 140, 60, 40); // a sideboard
  g.fillRect(440, 150, 40, 36);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(0, 118, W, 3); // the picture rail's line
  if ("filter" in g) (g as unknown as { filter: string }).filter = "blur(5px)";
  g.drawImage(c, 0, 0);
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The one shared mirror material (every house, every mirror). */
export function houseMirrorMaterial(): MeshStandardMaterial {
  if (shared) return shared;
  const m = new MeshStandardMaterial({
    name: "house_mirror",
    color: new Color("#d3dde0"),
    metalness: 1,
    roughness: 0.1,
    envMap: roomEnvironment(),
    envMapIntensity: 1,
  });
  m.userData.shared = true;
  m.onBeforeRender = () => {
    m.envMapIntensity = 1 - 0.62 * houseNightUniform.value; // the room is dim at night: so is its reflection
  };
  shared = m;
  return m;
}

/** Whether `name` is a house's mirror-glass material. */
export function isHouseMirrorMaterial(name: string): boolean {
  return HOUSE_MIRROR_MATERIALS.has(name);
}
