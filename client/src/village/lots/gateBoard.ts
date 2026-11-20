import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, SRGBColorSpace, type Texture } from "three";

/**
 * The welcome board in front of 케이슨랜드's iron gate (owner 2026-11-21: the park is open, so the stand must not say "곧 문을 열어요").
 * The old board's 3D letters ("곧 문을 열어요", navy on the cream enamel face) are cut out of the lot's detail (isOldGateLetter) and a
 * welcome is drawn in their place: navy enamel letters, a raised bump so the lettering reads as embossed under the sun, fitted to the face.
 *
 * Geometry (world metres, from lot_gate.glb's barrier stand, gate_kit.py `barrier`): the cream face spans x -24 +- 0.9, y 0.99 .. 1.56 at
 * z 94.174, looking toward the village (-z); a gold rule runs across it at y 1.42 .. 1.45, so the lettering lives under it (y 0.99 .. 1.41).
 */
export const GATE_BOARD = Object.freeze({
  x: -24,
  /** The face's centre below the gold rule (m) and its size. */
  y: 1.2,
  z: 94.171,
  width: 1.76,
  height: 0.4,
  /** The lines, big to small: text and their share of the height. */
  lines: [
    { text: "어서 오세요!", size: 0.58 },
    { text: "케이슨랜드에 들어가요", size: 0.26 },
  ],
} as const);

/** The old letters: the board's navy lettering (cream render material, a hand's breadth in front of the face, under the gold rule). */
export function isOldGateLetter(x: number, y: number, z: number, material: string): boolean {
  return /render/i.test(material) && Math.abs(x - GATE_BOARD.x) < 0.95 && y > 0.98 && y < 1.42 && Math.abs(z - 94.174) < 0.04;
}

const PX_PER_M = 640;

/** Draw the lettering: `colour` navy on transparent, or (height map) white on black. Returns the canvas. */
export function drawGateBoardCanvas(height: boolean): HTMLCanvasElement {
  const w = Math.round(GATE_BOARD.width * PX_PER_M);
  const h = Math.round(GATE_BOARD.height * PX_PER_M);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  if (height) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = height ? "#fff" : "#16206a";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let y = 0;
  const total = GATE_BOARD.lines.reduce((s, l) => s + l.size, 0);
  for (const line of GATE_BOARD.lines) {
    const lh = (line.size / total) * h;
    // fit the line in the face's width (a Hangul glyph is ~1 em wide), at most the line's height
    let px = lh * 0.86;
    g.font = `700 ${px}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    const maxW = w * 0.92;
    const mw = g.measureText(line.text).width;
    if (mw > maxW) {
      px *= maxW / mw;
      g.font = `700 ${px}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    }
    g.fillText(line.text, w / 2, y + lh / 2);
    y += lh;
  }
  return c;
}

export interface GateBoardMaterial {
  material: MeshStandardMaterial;
  textures: Texture[];
}

/** The lettering's material: an alpha-tested colour map (navy), the same lettering as a bump (embossed), enamel-glossy. */
export function gateBoardMaterial(): GateBoardMaterial {
  const colour = new CanvasTexture(drawGateBoardCanvas(false));
  colour.colorSpace = SRGBColorSpace;
  colour.anisotropy = 8;
  const bump = new CanvasTexture(drawGateBoardCanvas(true));
  for (const t of [colour, bump]) {
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
  }
  const material = new MeshStandardMaterial({ name: "M_gate_board", map: colour, bumpMap: bump, bumpScale: 2.2, alphaTest: 0.5, roughness: 0.32, metalness: 0 });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  return { material, textures: [colour, bump] };
}
