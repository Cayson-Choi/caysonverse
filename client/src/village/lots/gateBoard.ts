import { TEXT_ANISOTROPY, sharpenTextMaterial } from "../../game/sceneText";
import { addInkLabel, type InkTone } from "../../game/inkLabels";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  Object3D,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector2,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * 케이슨랜드's welcome board (owner 2026-11-21: "곧 문을 열어요가 아니라 다른걸 적어봐 이게 개장해서 들어갈 수 있잖아"). The park is open, so
 * the old stand in the middle of the gateway (cream board, "곧 문을 열어요", a belt barrier either side of it) is cut out of the lot's detail
 * (`isOldGateBarrier`), the iron leaves stand open, and a new board stands beside the way in, in front of the west pier:
 *
 *   two turned posts (navy enamel, gilt collars and ball finials) carrying a framed enamel panel under a shallow arched head; the panel's
 *   lettering is embossed (the same drawing as a bump map: the gilt letters and the rule stand proud and catch the sun).
 *
 * World metres. The panel looks at the visitor coming down the avenue (x -24) from the square.
 */
export const GATE_BOARD = Object.freeze({
  /** The panel's centre on the ground plan and the way it looks (a unit vector: mostly toward the village, a little toward the avenue). */
  x: -28.05,
  z: 91.75,
  look: [0.42, -0.9075] as const,
  /** The enamel panel: width, height and its bottom edge above the ground (m). */
  width: 1.5,
  height: 0.86,
  bottom: 0.92,
  /** The lettering, top to bottom: text, the line's share of the panel's height, and whether it is the big gilt line. */
  lines: [
    { text: "어서 오세요!", size: 0.46, gilt: true },
    { text: "케이슨랜드", size: 0.3, gilt: false },
    { text: "활짝 열려 있어요 · 문으로 들어오세요", size: 0.16, gilt: false },
  ],
} as const);

/** The old stand, its belts and their posts: everything of steel / brass / lettering in the gateway's barrier line (lot_gate.glb, gate_kit `barrier`). */
export function isOldGateBarrier(x: number, y: number, z: number, material: string): boolean {
  return /steel|metal|render/i.test(material) && x > -27.06 && x < -20.94 && z > 94.0 && z < 94.4 && y < 1.7;
}

// system faces only: the page's display font (CV Jua) is a subset of the builder's words, and a board set half in it, half in a fallback
// face read as a ransom note
const FONT = `"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
const PX_PER_M = 660;

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/**
 * Draw the panel. `height` false: the colours (navy enamel, a gilt rule round it, gilt and cream lettering); true: the relief (white = proud:
 * the rule, the letters, the stars), a little soft at the edges so the bump reads as a rounded emboss.
 */
export function drawGateBoardCanvas(height: boolean, letters = true, scale = 1): HTMLCanvasElement {
  const w = Math.round(GATE_BOARD.width * PX_PER_M * scale);
  const h = Math.round(GATE_BOARD.height * PX_PER_M * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const GILT = height ? "#fff" : "#f0c460";
  if (height) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    g.filter = `blur(${1.6 * scale}px)`;
  } else {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#27358f");
    grd.addColorStop(1, "#18225f");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
  // the gilt rules: a bold one near the edge, a hairline inside it
  const m = Math.round(h * 0.06);
  g.strokeStyle = GILT;
  g.lineWidth = Math.round(h * 0.022);
  g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  g.lineWidth = Math.max(2 * scale, Math.round(h * 0.006));
  g.strokeRect(m * 1.6, m * 1.6, w - 3.2 * m, h - 3.2 * m);
  if (letters) paintGateLettering(g, w, h, height);
  return c;
}

/**
 * The panel's lettering on a `w` x `h` canvas: the lines, the gilt line's dark under-edge and its two stars. `height`: the relief's
 * white (the bump map); else the colours, through `tone` (the label overlay draws them crisp: inkLabels.ts).
 */
export function paintGateLettering(g: CanvasRenderingContext2D, w: number, h: number, height: boolean, tone: InkTone = (c) => c, emboss = false): void {
  const GILT = tone(height ? "#fff" : "#f0c460");
  const CREAM = tone(height ? "#d8d8d8" : "#f6efe2");
  const m = Math.round(h * 0.06);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const top = m * 2.3;
  const usable = h - 2 * top;
  const total = GATE_BOARD.lines.reduce((s, l) => s + l.size, 0);
  let y = top;
  for (const line of GATE_BOARD.lines) {
    const lh = (line.size / total) * usable;
    // fit the line (and the big line's two stars, 1.1 em each side) in the panel's width, at most the line's height
    let px = lh * 0.84;
    const maxW = w - 4.4 * m;
    g.font = `700 ${px}px ${FONT}`;
    const full = g.measureText(line.text).width + (line.gilt ? 2.2 * px : 0);
    if (full > maxW) {
      px *= maxW / full;
      g.font = `700 ${px}px ${FONT}`;
    }
    const tw = g.measureText(line.text).width;
    const cy = y + lh / 2;
    const stars = (dx: number, dy: number) => {
      if (!line.gilt) return;
      star(g, w / 2 - tw / 2 - px * 0.6 + dx, cy + dy, px * 0.36);
      star(g, w / 2 + tw / 2 + px * 0.6 + dx, cy + dy, px * 0.36);
    };
    if (!height && line.gilt) {
      // a dark edge under the gilt letters: the enamel's shadow side
      g.fillStyle = tone("rgba(6, 10, 40, 0.55)");
      g.fillText(line.text, w / 2 + px * 0.035, cy + px * 0.045);
      if (emboss) stars(px * 0.035, px * 0.045);
    }
    if (emboss && !height) {
      // the embossed letters as the 3D board's bump map shows them (the label overlay's copy has no bump): a soft shade on the lower
      // edge, a lit rim on the upper edge, and the face a little brighter at the top than at the foot
      if (!line.gilt) {
        g.fillStyle = tone("rgba(6, 10, 40, 0.45)");
        g.fillText(line.text, w / 2 + px * 0.03, cy + px * 0.04);
      }
      g.fillStyle = tone(line.gilt ? "rgba(255, 226, 140, 0.7)" : "rgba(255, 255, 255, 0.45)");
      g.fillText(line.text, w / 2 - px * 0.02, cy - px * 0.028);
      stars(-px * 0.02, -px * 0.028);
      const face = g.createLinearGradient(0, cy - px * 0.5, 0, cy + px * 0.5);
      face.addColorStop(0, tone(line.gilt ? "#f7d478" : "#fbf6ec"));
      face.addColorStop(0.55, line.gilt ? GILT : CREAM);
      face.addColorStop(1, tone(line.gilt ? "#d29f3e" : "#ddd5c6"));
      g.fillStyle = face;
    } else g.fillStyle = line.gilt ? GILT : CREAM;
    g.fillText(line.text, w / 2, cy);
    stars(0, 0);
    y += lh;
  }
}

/** The board's turned post as lathe profiles (radius, height): a foot and a shaft (enamel), two collars and a ball finial (gilt). */
function postGeometry(top: number, sides: number): { enamel: BufferGeometry; gilt: BufferGeometry } {
  const lathe = (pts: number[][]) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), sides);
  const enamel = lathe([
    [0.085, 0],
    [0.085, 0.05],
    [0.06, 0.09],
    [0.045, 0.14],
    [0.038, 0.2],
    [0.036, top - 0.2],
  ]);
  const gilt = lathe([
    [0.036, top - 0.2],
    [0.052, top - 0.19],
    [0.052, top - 0.165],
    [0.04, top - 0.15],
    [0.03, top - 0.1],
    [0.05, top - 0.07],
    [0.066, top - 0.03],
    [0.07, top],
    [0.062, top + 0.035],
    [0.04, top + 0.062],
    [0.0, top + 0.072],
  ]);
  return { enamel, gilt };
}

/** Paint a geometry one colour (vertex colours: the board's solid parts share one material). */
function tint(g: BufferGeometry, c: Color): BufferGeometry {
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[3 * i] = c.r;
    a[3 * i + 1] = c.g;
    a[3 * i + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(a, 3));
  return g;
}

export interface GateBoard {
  group: Group;
  geometries: BufferGeometry[];
  materials: MeshStandardMaterial[];
  textures: Texture[];
  triangles: number;
}

/**
 * Build the board (two draw calls: the painted frame and posts, the lettered panel). `patch` hooks the materials into the lots' light
 * (the live sun's shadow, the night's fade), as every piece of the gate's dressing is.
 */
export function buildGateBoard(low: boolean, patch: (m: MeshStandardMaterial, key: string) => void, nightDesaturate: () => number = () => 0): GateBoard {
  const B = GATE_BOARD;
  const NAVY = new Color("#1a2566");
  const GILT = new Color("#d9ae4a");
  const sides = low ? 10 : 18;
  const w = B.width;
  const h = B.height;
  const y0 = B.bottom;
  const fw = 0.045;
  const depth = 0.05;
  const postX = w / 2 + fw + 0.075;
  const postTop = y0 + h + 0.2;
  const parts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const p = postGeometry(postTop, sides);
    parts.push(tint(p.enamel, NAVY).translate(sx * postX, 0, 0), tint(p.gilt, GILT).translate(sx * postX, 0, 0));
  }
  // the frame round the panel: a gilt moulding standing proud of the enamel, a navy back board behind it
  parts.push(tint(new BoxGeometry(w + 0.02, h + 0.02, 0.03), NAVY).translate(0, y0 + h / 2, -0.012));
  for (const [bw, bh, bx, by] of [
    [w + 2 * fw, fw, 0, y0 - fw / 2],
    [w + 2 * fw, fw, 0, y0 + h + fw / 2],
    [fw, h, -(w + fw) / 2, y0 + h / 2],
    [fw, h, (w + fw) / 2, y0 + h / 2],
  ] as const)
    parts.push(tint(new BoxGeometry(bw, bh, depth), GILT).translate(bx, by, 0.004));
  // the arched head over the top rail: a shallow gilt bow with a round boss
  const N = low ? 8 : 14;
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const xa = (t0 - 0.5) * (w + 2 * fw);
    const xb = (t1 - 0.5) * (w + 2 * fw);
    const ya = 0.13 * Math.sin(Math.PI * t0);
    const yb = 0.13 * Math.sin(Math.PI * t1);
    const seg = new BoxGeometry(Math.hypot(xb - xa, yb - ya) + 0.004, 0.035, depth * 0.8);
    seg.rotateZ(Math.atan2(yb - ya, xb - xa));
    seg.translate((xa + xb) / 2, y0 + h + fw + 0.012 + (ya + yb) / 2, 0.004);
    parts.push(tint(seg, GILT));
  }
  const boss = new CylinderGeometry(0.06, 0.06, 0.03, low ? 10 : 20);
  boss.rotateX(Math.PI / 2);
  parts.push(tint(boss, GILT).translate(0, y0 + h + fw + 0.075, 0.012));
  // short rails tie the panel to the posts (top and bottom)
  for (const yy of [y0 + 0.06, y0 + h - 0.06]) for (const sx of [-1, 1]) parts.push(tint(new BoxGeometry(0.09, 0.03, 0.03), NAVY).translate(sx * (w / 2 + fw + 0.035), yy, 0));
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    f.deleteAttribute("uv"); // the paint is a flat colour: the merged parts need the same attributes
    return f;
  });
  const solid = mergeGeometries(flat, false)!;
  for (const g of [...parts, ...flat]) g.dispose();
  const paint = new MeshStandardMaterial({ name: "LM_gate_board_paint", vertexColors: true, roughness: 0.36, metalness: 0 });
  patch(paint, "gate_board_paint");

  const colour = new CanvasTexture(drawGateBoardCanvas(false));
  colour.colorSpace = SRGBColorSpace;
  const bump = new CanvasTexture(drawGateBoardCanvas(true));
  for (const t of [colour, bump]) {
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = TEXT_ANISOTROPY; // the GPU's highest (the renderer clamps it): the board is read at a slant from the road
  }
  const face = new MeshStandardMaterial({ name: "LM_gate_board_face", map: colour, bumpMap: bump, bumpScale: 2.4, roughness: 0.3, metalness: 0 });
  patch(face, "gate_board_face");
  sharpenTextMaterial(face); // the lettering half a mip sharper (sceneText.ts)
  // the lettering crisp on the label overlay where the scene is drawn at fewer pixels than the screen has (inkLabels.ts): the panel
  // shows its enamel and rules only meanwhile (both maps without letters, made on first use at half the pixels)
  let blank: { colour: CanvasTexture; bump: CanvasTexture } | null = null;
  const anchor = new Object3D();
  anchor.name = "gate_board_ink";
  anchor.position.set(0, y0 + h / 2, 0.0045);
  const offInk = addInkLabel({
    object: anchor,
    w,
    h,
    paint: (g, pw, ph, tone) => paintGateLettering(g, pw, ph, false, tone, true),
    // the gilt moulding's bottom rail just under the panel (fw = 4.5 cm wide, the frame's gilt vertex colour): a bright, warm
    // albedo in all three channels, so the lamps' tint at night reads true (the navy enamel had next to no red to measure it by)
    probe: { x: 0, y: -h / 2 - fw / 2, albedo: "#d9ae4a" },
    // the lots' night fade pulls the board's colours toward grey before the light (patchLotLight): the letters' too
    desaturate: nightDesaturate,
    setInk(on) {
      if (!on && !blank) {
        const bc = new CanvasTexture(drawGateBoardCanvas(false, false, 0.5));
        bc.colorSpace = SRGBColorSpace;
        const bb = new CanvasTexture(drawGateBoardCanvas(true, false, 0.5));
        for (const t of [bc, bb]) {
          t.generateMipmaps = true;
          t.minFilter = LinearMipmapLinearFilter;
          t.magFilter = LinearFilter;
          t.anisotropy = TEXT_ANISOTROPY;
        }
        blank = { colour: bc, bump: bb };
      }
      face.map = on || !blank ? colour : blank.colour;
      face.bumpMap = on || !blank ? bump : blank.bump;
    },
  });
  face.addEventListener("dispose", () => {
    offInk();
    colour.dispose();
    bump.dispose();
    blank?.colour.dispose();
    blank?.bump.dispose();
  });
  const panelGeo = new PlaneGeometry(w, h).translate(0, y0 + h / 2, 0.0045);

  const group = new Group();
  group.name = "gate_welcome_board";
  group.position.set(B.x, 0, B.z);
  group.rotation.y = Math.atan2(B.look[0], B.look[1]);
  const frame = new Mesh(solid, paint);
  frame.name = "gate_board_frame";
  frame.castShadow = true;
  const panel = new Mesh(panelGeo, face);
  panel.name = "gate_board_panel";
  for (const m of [frame, panel]) m.raycast = () => {};
  group.add(frame, panel, anchor);
  return { group, geometries: [solid, panelGeo], materials: [paint, face], textures: [colour, bump], triangles: solid.getAttribute("position").count / 3 + 2 };
}
