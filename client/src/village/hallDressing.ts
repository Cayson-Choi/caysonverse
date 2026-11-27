import {
  AddEquation,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  Box3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { VILLAGE_LAYOUT, zoneLetter, type CubbyWall } from "@caysonverse/shared/village/villageLayout";
import { versionedUrl } from "./modelUrl";
import { crispTextTexture, sharpenTextMaterial } from "../game/sceneText";

/**
 * Runtime dressing of the memorial hall (owner 2026-11-20), on top of memorial.glb without re-baking it:
 *
 *  1. ZONE SIGNS — "A 구역" … "D 구역" in walking order (shared `zoneLetter`: ids A, C, B along the north wall west → east, E on the
 *     east wall). The baked plaques (52 x 16 cm, unreadable across the hall on a phone) get a real sign in front of them: a 1.2 x
 *     0.36 m walnut plate with a brass border and gilded engraved letters, drawn on a canvas at 2048 px (PC) / 1024 px (phone), with
 *     a soft warm back-glow on the bulkhead (a halo-lit sign). The kiosk's floor plan in the signs atlas gets the same names.
 *  2. LOUNGE PAINTING — the baked pastel abstract (`LM_painting`) is replaced by a public-domain masterpiece (Van Gogh, "Wheat Field
 *     with Cypresses", 1889, The Met Open Access CC0; client/public/textures/memorial/LICENSE.md) at its true aspect ratio, in a
 *     moulded walnut frame with a gilded inner slip (a swept profile, mitred corners), with a small museum label beside it. The
 *     frame is sized to hide the old baked frame behind it.
 *
 * Everything here is unlit like the rest of the hall (MeshBasicMaterial; the room's light is baked), dimmed by the hall's night
 * weight (`update`). Seven draw calls in all.
 */

/** The sign plate (m): wide enough to read "A 구역" from the far side of the hall on a phone. */
export const ZONE_SIGN = { w: 1.2, h: 0.36, d: 0.028 } as const;
/** The sign's centre above the banks' top board (m): on the bulkhead, over the baked plaque (top + 0.14 .. top + 0.30). */
const SIGN_LIFT = 0.315;

export interface ZoneSign {
  bank: CubbyWall["bank"];
  /** What it says: "A 구역" … */
  label: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** The banks' signs in walking order (A, B, C, D): where each stands and what it says. */
export function zoneSigns(walls: readonly CubbyWall[] = VILLAGE_LAYOUT.memorial.interior.cubbyWalls): ZoneSign[] {
  const out: ZoneSign[] = [];
  for (const w of walls) {
    const run = w.cols * (w.cell + w.frame) + w.frame;
    const top = w.plinth + w.rows * (w.cell + w.frame) + w.frame;
    const fx = Math.sin(w.yaw);
    const fz = Math.cos(w.yaw);
    const off = 0.004 + ZONE_SIGN.d / 2 + 0.01; // in front of the bulkhead's face (the baked plaque sits 4 mm out)
    out.push({
      bank: w.bank,
      label: `${zoneLetter(w.bank)} 구역`,
      x: w.start.x + w.along.x * (run / 2) + fx * off,
      y: top + SIGN_LIFT,
      z: w.start.z + w.along.z * (run / 2) + fz * off,
      yaw: w.yaw,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

const FONT = `"Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", "Pretendard", sans-serif`;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function canvasTexture(c: HTMLCanvasElement): CanvasTexture {
  // mipmapped, trilinear, the GPU's highest anisotropy (sceneText.ts; the renderer clamps it)
  const t = crispTextTexture(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A rounded rectangle path. */
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Small deterministic noise for the wood grain (no Math.random: the same sign every time). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gold leaf, vertical (light at the top, deeper below): engraved letters and the brass border. */
function goldGradient(g: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, "#fbe9b4");
  gr.addColorStop(0.45, "#e2b961");
  gr.addColorStop(0.55, "#c99a45");
  gr.addColorStop(1, "#f0d38c");
  return gr;
}

/** The sign's face: dark walnut, a brass border, gilded engraved letters. */
export function paintZoneSign(g: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  const wood = g.createLinearGradient(0, 0, 0, h);
  wood.addColorStop(0, "#4a3020");
  wood.addColorStop(0.5, "#3a2418");
  wood.addColorStop(1, "#2c1a10");
  g.fillStyle = wood;
  g.fillRect(0, 0, w, h);
  // grain: long thin wavy lines
  const r = rng(label.charCodeAt(0) * 7919);
  g.lineWidth = Math.max(1, h / 300);
  for (let i = 0; i < 70; i++) {
    const y = r() * h;
    g.strokeStyle = `rgba(${r() < 0.5 ? "20,10,4" : "120,80,50"},${0.05 + r() * 0.08})`;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += w / 16) g.lineTo(x, y + Math.sin(x / w * 6 + r() * 6) * h * 0.012);
    g.stroke();
  }
  // brass border (inset), with a dark groove inside it
  const m = h * 0.07;
  g.lineWidth = h * 0.028;
  g.strokeStyle = goldGradient(g, m, h - m);
  roundRect(g, m, m, w - 2 * m, h - 2 * m, h * 0.05);
  g.stroke();
  g.lineWidth = h * 0.008;
  g.strokeStyle = "rgba(0,0,0,0.45)";
  roundRect(g, m + h * 0.03, m + h * 0.03, w - 2 * m - h * 0.06, h - 2 * m - h * 0.06, h * 0.035);
  g.stroke();
  // the letters: an engraved cut (dark below-right, light above-left) filled with gold leaf
  const size = Math.round(h * 0.6);
  g.font = `700 ${size}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cx = w / 2;
  const cy = h / 2 + h * 0.02;
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillText(label, cx + h * 0.008, cy + h * 0.012);
  g.fillStyle = "rgba(255,236,190,0.35)";
  g.fillText(label, cx - h * 0.005, cy - h * 0.007);
  g.fillStyle = goldGradient(g, cy - size / 2, cy + size / 2);
  g.fillText(label, cx, cy);
}

/** A soft rounded glow card (white at the middle, nothing at the edge) for the back-lit signs. */
function glowTexture(): CanvasTexture {
  const [c, g] = canvas(256, 128);
  const img = g.createImageData(256, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 256; x++) {
      // a rounded-rectangle distance: flat in the middle, falling off over the outer third
      const dx = Math.max(0, Math.abs(x + 0.5 - 128) / 128 - 0.55) / 0.45;
      const dy = Math.max(0, Math.abs(y + 0.5 - 64) / 64 - 0.35) / 0.65;
      const d = Math.min(1, Math.hypot(dx, dy));
      const v = Math.round(255 * Math.pow(1 - d, 2.2));
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return canvasTexture(c);
}

/** "Light" blending: dst + src * dst — a warm light that brightens what it falls on by its own colour (the wall, not the air). */
export function lightBlend(m: MeshBasicMaterial): MeshBasicMaterial {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = DstColorFactor;
  m.blendDst = OneFactor;
  m.toneMapped = false;
  m.fog = false;
  return m;
}

// ───────────────────────────────────────── the painting ─────────────────────────────────────────

/** The lounge painting (PD; LICENSE.md). Its pixel size gives the true aspect ratio. */
export const LOUNGE_PAINTING = {
  urls: {
    high: versionedUrl("/textures/houses/hi/T_h_art_wheat_cypresses_met.webp"),
    low: versionedUrl("/textures/memorial/T_m_art_wheat_cypresses_1k.webp"),
  },
  aspect: 2048 / 1630,
  artist: "빈센트 반 고흐",
  title: "사이프러스가 있는 밀밭",
  year: "1889",
} as const;

/** The frame's moulding, outer edge → inner edge: [distance in from the outer edge, height off the wall] (m). */
export const FRAME_PROFILE: ReadonlyArray<readonly [number, number, "wood" | "gold"]> = [
  [0, 0, "wood"],
  [0, 0.074, "wood"], // the outer side, straight back to the wall
  [0.005, 0.084, "wood"],
  [0.013, 0.09, "wood"], // a rounded outer edge
  [0.024, 0.093, "wood"],
  [0.034, 0.09, "wood"], // the bead's crown
  [0.043, 0.081, "wood"],
  [0.052, 0.078, "wood"], // the cove
  [0.058, 0.081, "gold"],
  [0.064, 0.087, "gold"], // the gilded inner slip
  [0.07, 0.089, "gold"],
  [0.075, 0.086, "gold"],
  [0.08, 0.08, "wood"], // down into the rabbet, onto the canvas
];
const FRAME_W = FRAME_PROFILE[FRAME_PROFILE.length - 1]![0];
/** The canvas off the wall (m): in front of the old baked frame's face (6.6 cm), just under the rabbet. */
const CANVAS_OFF = 0.079;
/** How far the old baked canvas stands off the wall (build_memorial.py: canvas at z 5.925, wall at 5.996). */
const OLD_CANVAS_OFF = 0.071;
/** The old baked frame reaches this far round its canvas (m), and the new frame covers it with this much to spare. */
const OLD_FRAME_REACH = 0.1;
const COVER = 0.035;

const WALNUT = new Color("#5a3a26");
const GOLD = new Color("#c9a25a");

/**
 * The moulding swept round a rectangle `outerW` x `outerH` (local x right, y up, z off the wall), mitred at the corners, with a
 * fixed light baked into the vertex colours (unlit hall: up-left-front key, soft fill), flat per facet so the profile reads.
 */
export function frameGeometry(outerW: number, outerH: number, profile = FRAME_PROFILE): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const light = new Vector3(-0.35, 0.6, 0.72).normalize();
  // the four sides: [outward direction in the wall plane, the corner order along the side]
  const sides: Array<{ out: [number, number]; a: [number, number]; b: [number, number] }> = [
    { out: [0, -1], a: [-1, -1], b: [1, -1] },
    { out: [1, 0], a: [1, -1], b: [1, 1] },
    { out: [0, 1], a: [1, 1], b: [-1, 1] },
    { out: [-1, 0], a: [-1, 1], b: [-1, -1] },
  ];
  const corner = (c: [number, number], s: number, z: number): Vector3 =>
    new Vector3(c[0] * (outerW / 2 - s), c[1] * (outerH / 2 - s), z);
  const n = new Vector3();
  const tint = new Color();
  for (let k = 0; k + 1 < profile.length; k++) {
    const [s0, h0, m0] = profile[k]!;
    const [s1, h1] = profile[k + 1]!;
    // the facet's normal in the profile plane: perpendicular to (ds, dh), pointing up off the wall, or outward for a vertical side
    let ns = -(h1 - h0);
    let nh = s1 - s0;
    if (nh < 0 || (nh === 0 && ns > 0)) {
      ns = -ns;
      nh = -nh;
    }
    const len = Math.hypot(ns, nh) || 1;
    ns /= len;
    nh /= len;
    const base = m0 === "gold" ? GOLD : WALNUT;
    for (const side of sides) {
      // s grows inward, so the profile's s-normal points against the side's outward direction
      n.set(-ns * side.out[0], -ns * side.out[1], nh);
      const d = Math.max(0, n.dot(light));
      const spec = m0 === "gold" ? Math.pow(d, 12) * 0.5 : Math.pow(d, 20) * 0.15;
      const shade = 0.42 + 0.62 * d;
      tint.copy(base).multiplyScalar(shade).addScalar(spec);
      const a0 = corner(side.a, s0, h0);
      const b0 = corner(side.b, s0, h0);
      const a1 = corner(side.a, s1, h1);
      const b1 = corner(side.b, s1, h1);
      for (const v of [a0, b0, b1, a0, b1, a1]) {
        pos.push(v.x, v.y, v.z);
        col.push(tint.r, tint.g, tint.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** Make the triangles face +z whatever their winding (the frame is seen only from the room): draw both sides. */
function frameMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  m.name = "M_hall_frame";
  return m;
}

/** Where the baked painting was: its centre, size, the wall's normal (into the room) and the "right" direction on the wall. */
export interface PaintingSlot {
  centre: Vector3;
  width: number;
  height: number;
  normal: Vector3;
  right: Vector3;
}

/** Find the baked painting(s) (`LM_painting` meshes), hide them, and say where they were. */
export function takePaintingSlots(root: Object3D): PaintingSlot[] {
  const out: PaintingSlot[] = [];
  const room = VILLAGE_LAYOUT.memorial.interior.origin;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.some((x) => (x as Material).name === "LM_painting")) return;
    const box = new Box3().setFromObject(m);
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    m.visible = false;
    // the thin axis is the wall's normal; it points into the room
    const normal = size.x < size.z ? new Vector3(Math.sign(room.x - centre.x) || 1, 0, 0) : new Vector3(0, 0, Math.sign(room.z - centre.z) || 1);
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), normal).negate(); // seen from the room, x to the right
    out.push({ centre, width: normal.x !== 0 ? size.z : size.x, height: size.y, normal, right });
  });
  return out;
}

/**
 * The museum label beside the painting: artist, title, year. 26 x 10.1 cm (was 20 x 7.8: its two small lines were a grey
 * smear on a phone, fix/pine-text), drawn at 768 x 300 with heavier weights, mipmapped and sampled half a mip sharper.
 */
export const MUSEUM_LABEL = { w: 0.26, h: 0.101 } as const;
function labelTexture(): CanvasTexture {
  const W = 768;
  const H = 300;
  const k = W / 1024;
  const [c, g] = canvas(W, H);
  const paint = () => {
    g.fillStyle = "#f6f1e7";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(60,40,20,0.25)";
    g.lineWidth = 6 * k;
    g.strokeRect(3 * k, 3 * k, W - 6 * k, H - 6 * k);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#241b14";
    g.font = `800 ${Math.round(98 * k)}px ${FONT}`;
    g.fillText(LOUNGE_PAINTING.artist, 56 * k, 142 * k, W - 112 * k);
    g.font = `600 ${Math.round(74 * k)}px ${FONT}`;
    g.fillText(`${LOUNGE_PAINTING.title}, ${LOUNGE_PAINTING.year}`, 56 * k, 248 * k, W - 112 * k);
    g.fillStyle = "#4f4236";
    g.font = `500 ${Math.round(52 * k)}px ${FONT}`;
    g.fillText("Vincent van Gogh · Wheat Field with Cypresses", 56 * k, 336 * k, W - 112 * k);
  };
  paint();
  const t = canvasTexture(c);
  // the canvas is redrawn once the page's fonts are in (a first draw may use a fallback face)
  void document.fonts?.ready.then(() => {
    paint();
    t.needsUpdate = true;
  });
  return t;
}

export interface HallDressing {
  group: Group;
  zones: ZoneSign[];
  /** The painting's placement (for checks), or null when the model has no painting. */
  painting: { x: number; y: number; z: number; width: number; height: number; url: string } | null;
  /** Dim with the hall's night weight (0 day .. 1 night). */
  update(night: number): void;
  /** Load the painting's image while the hall is shown (retrying failed fetches); returns the stop. Call it from an effect. */
  startPainting(): () => void;
  dispose(): void;
}

/** Build the signs and the painting for the dressed hall `root` (its baked painting is hidden). */
export function dressHall(root: Object3D, tier: "high" | "low"): HallDressing {
  const group = new Group();
  group.name = "hall_dressing";
  const own: Array<{ dispose(): void }> = [];
  const lit: Array<{ m: MeshBasicMaterial; day: number; night: number }> = [];
  let night = 0;
  /** A material's colour for the hall's light now (the painting keeps its placeholder colour until its image is in). */
  const tone = (e: { m: MeshBasicMaterial; day: number; night: number }) => {
    if (e.m.map === null && e.m.name === "M_hall_painting") return;
    e.m.color.setScalar(e.day + (e.night - e.day) * night);
  };

  // ── zone signs ──
  const zones = zoneSigns();
  const px = tier === "high" ? 2048 : 1024;
  const plateGeo = new BoxGeometry(ZONE_SIGN.w, ZONE_SIGN.h, ZONE_SIGN.d);
  const brass = new MeshBasicMaterial({ color: "#b48a45" });
  brass.name = "M_zone_brass";
  const glowMap = glowTexture();
  const glowGeo = new PlaneGeometry(ZONE_SIGN.w * 1.55, ZONE_SIGN.h * 2.1);
  const glow = lightBlend(new MeshBasicMaterial({ map: glowMap, color: new Color(0.42, 0.3, 0.17) }));
  glow.name = "M_zone_glow";
  own.push(plateGeo, brass, glowMap, glowGeo, glow);
  lit.push({ m: brass, day: 1, night: 0.8 });
  for (const z of zones) {
    const [c, g] = canvas(px, Math.round((px * ZONE_SIGN.h) / ZONE_SIGN.w));
    paintZoneSign(g, c.width, c.height, z.label);
    const tex = canvasTexture(c);
    const face = sharpenTextMaterial(new MeshBasicMaterial({ map: tex }));
    face.name = `M_zone_${z.bank}`;
    own.push(tex, face);
    lit.push({ m: face, day: 1.0, night: 0.92 });
    // the canvas is redrawn once the page's fonts are in (a first draw may use a fallback face)
    void document.fonts?.ready.then(() => {
      paintZoneSign(g, c.width, c.height, z.label);
      tex.needsUpdate = true;
    });
    const plate = new Mesh(plateGeo, [brass, brass, brass, brass, face, brass]);
    plate.name = `zone_sign_${zoneLetter(z.bank)}`;
    plate.position.set(z.x, z.y, z.z);
    plate.rotation.y = z.yaw;
    plate.userData.label = z.label;
    group.add(plate);
    const halo = new Mesh(glowGeo, glow);
    halo.name = `zone_glow_${zoneLetter(z.bank)}`;
    const back = ZONE_SIGN.d / 2 + 0.008;
    halo.position.set(z.x - Math.sin(z.yaw) * back, z.y, z.z - Math.cos(z.yaw) * back);
    halo.rotation.y = z.yaw;
    halo.renderOrder = 2;
    group.add(halo);
  }

  // ── the lounge painting ──
  let painting: HallDressing["painting"] = null;
  let startPainting: () => () => void = () => () => {};
  const slot = takePaintingSlots(root)[0];
  if (slot) {
    const r = LOUNGE_PAINTING.aspect;
    // cover the old frame (its canvas + OLD_FRAME_REACH round it) with COVER to spare, keeping the painting's own aspect
    const needW = slot.width + 2 * (OLD_FRAME_REACH + COVER);
    const needH = slot.height + 2 * (OLD_FRAME_REACH + COVER);
    const ph = Math.max((needW - 2 * FRAME_W) / r, needH - 2 * FRAME_W);
    const pw = ph * r;
    const outerW = pw + 2 * FRAME_W;
    const outerH = ph + 2 * FRAME_W;
    const wall = slot.centre.clone().addScaledVector(slot.normal, -OLD_CANVAS_OFF);
    const frame = new Group();
    frame.name = "lounge_painting";
    frame.position.copy(wall);
    frame.lookAt(wall.clone().add(slot.normal)); // local +z off the wall, into the room
    const fg = frameGeometry(outerW, outerH);
    const fm = frameMaterial();
    own.push(fg, fm);
    lit.push({ m: fm, day: 1, night: 0.7 });
    frame.add(new Mesh(fg, fm));
    // the canvas, a little under the rabbet; a gentle top-lit gradient baked in (the downlight above it)
    const cg = new PlaneGeometry(pw + 0.01, ph + 0.01, 1, 4);
    const cpos = cg.getAttribute("position");
    const ccol: number[] = [];
    for (let i = 0; i < cpos.count; i++) {
      const t = (cpos.getY(i) + ph / 2) / ph; // 0 bottom .. 1 top
      const v = 0.86 + 0.14 * t;
      ccol.push(v, v, v * 0.98);
    }
    cg.setAttribute("color", new Float32BufferAttribute(ccol, 3));
    const cm = new MeshBasicMaterial({ color: "#d8d2c8", vertexColors: true });
    cm.name = "M_hall_painting";
    own.push(cg, cm);
    const canvasLight = { m: cm, day: 1, night: 0.66 };
    lit.push(canvasLight);
    const canvasMesh = new Mesh(cg, cm);
    canvasMesh.name = "lounge_painting_canvas";
    canvasMesh.position.z = CANVAS_OFF;
    frame.add(canvasMesh);
    const url = LOUNGE_PAINTING.urls[tier];
    // The image loads while the hall is mounted (`startPainting`, from an effect), not once at build time: the dressing is
    // memoised, so a cleanup that ran once (React's dev double effect, a remount) used to cancel the only load and leave the
    // bare placeholder canvas for good. A failed or dropped fetch is retried with a growing pause.
    startPainting = () => {
      let stopped = false;
      let retry: ReturnType<typeof setTimeout> | null = null;
      const load = (attempt: number) => {
        if (cm.map) return;
        new TextureLoader().load(
          url,
          (t: Texture) => {
            if (stopped || cm.map) {
              t.dispose();
              return;
            }
            t.colorSpace = SRGBColorSpace;
            t.anisotropy = 8;
            cm.map = t;
            tone(canvasLight);
            cm.needsUpdate = true;
            own.push(t);
          },
          undefined,
          () => {
            if (stopped) return;
            retry = setTimeout(() => load(attempt + 1), Math.min(30_000, 1_000 * 2 ** attempt));
          },
        );
      };
      load(0);
      return () => {
        stopped = true;
        if (retry !== null) clearTimeout(retry);
      };
    };
    // the museum label, to the right of the frame at its lower third
    const lt = labelTexture();
    const lg = new PlaneGeometry(MUSEUM_LABEL.w, MUSEUM_LABEL.h);
    const lm = sharpenTextMaterial(new MeshBasicMaterial({ map: lt }));
    lm.name = "M_hall_painting_label";
    own.push(lt, lg, lm);
    lit.push({ m: lm, day: 1, night: 0.66 });
    const label = new Mesh(lg, lm);
    label.name = "lounge_painting_label";
    label.position.set(outerW / 2 + 0.06 + MUSEUM_LABEL.w / 2, -outerH / 2 + 0.2, 0.006);
    frame.add(label);
    group.add(frame);
    painting = { x: wall.x, y: wall.y, z: wall.z, width: pw, height: ph, url };
  }

  let lastNight = -1;
  const update = (n: number) => {
    if (Math.abs(n - lastNight) < 0.002) return;
    lastNight = n;
    night = n;
    for (const e of lit) tone(e);
    // the signs' back-glow is a little stronger at night (the bulkhead is darker round it)
    glow.color.setRGB(0.42 + 0.18 * night, 0.3 + 0.12 * night, 0.17 + 0.06 * night);
  };
  update(0);
  return {
    group,
    zones,
    painting,
    update,
    startPainting: () => startPainting(),
    dispose: () => {
      for (const r of own) r.dispose();
    },
  };
}

// ───────────────────────────────────────── the kiosk's floor plan ─────────────────────────────────────────

/**
 * The signs atlas (`LM_signs`, T_m_signs 2048 px) still names the banks the old way on the kiosk's floor plan ("봉안함 A", "기억의
 * 자리", "봉안함 B", "E") and its baked zone plaques say A, B, E, C. Redraw those spots with the walking-order names (A, B, C, D) on a
 * copy of the atlas, once per loaded material (idempotent). Pixel boxes measured on the atlas (2026-11-20).
 */
export function patchSignsAtlas(material: MeshBasicMaterial): void {
  if (material.userData.zonesPatched || !material.map) return;
  const src = material.map.image as CanvasImageSource & { width: number; height: number };
  if (!src || !src.width) return;
  material.userData.zonesPatched = true;
  const W = src.width;
  const k = W / 2048;
  const [c, g] = canvas(W, src.height);
  g.drawImage(src, 0, 0);
  const box = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => {
    g.fillStyle = fill;
    g.fillRect(x * k, y * k, w * k, h * k);
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 2 * k;
      g.strokeRect(x * k, y * k, w * k, h * k);
    }
  };
  const text = (s: string, x: number, y: number, size: number, colour: string) => {
    g.fillStyle = colour;
    g.font = `700 ${Math.round(size * k)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s, x * k, y * k);
  };
  // the kiosk plan: the north strip (room x 292.5 → px 91, x 307.5 → px 1190), the old niche box below it, the east bank's box
  const STRIP = { y: 1421, h: 35, fill: "#e9e4da", stroke: "#8c7a5e", ink: "#4a3a2a" };
  const FLOOR = "#f8f5ec";
  box(530, STRIP.y + STRIP.h, 220, 47, FLOOR); // the niche box's lower half, now open floor
  const toPx = (x: number) => 91 + ((x - 292.5) / 15) * 1099;
  for (const w of VILLAGE_LAYOUT.memorial.interior.cubbyWalls) {
    if (w.wall !== "n") continue;
    const run = w.cols * (w.cell + w.frame) + w.frame;
    const x0 = toPx(w.start.x);
    const x1 = toPx(w.start.x + run);
    box(x0, STRIP.y, x1 - x0, STRIP.h, STRIP.fill, STRIP.stroke);
    text(`${zoneLetter(w.bank)}구역`, (x0 + x1) / 2, STRIP.y + STRIP.h / 2 + 1, 26, STRIP.ink);
  }
  box(1125, 1456, 65, 218, "#dfc59a", STRIP.stroke);
  g.save();
  g.translate(1157.5 * k, 1565 * k);
  g.rotate(Math.PI / 2);
  text("D구역", 0, 0, 26, STRIP.ink);
  g.restore();
  // the baked bank plaques (A, B, E on the first row, C under A): their new letters
  const plaque = (x: number, y: number, w: number, h: number, s: string) => {
    box(x + 12, y + 12, w - 24, h - 24, "#3f2a1d");
    text(s, x + w / 2, y + h / 2 + 4, 108, "#d9b56c");
  };
  plaque(0, 0, 510, 160, "A 구역"); // bank A
  plaque(517, 0, 510, 160, "C 구역"); // bank B (east on the north wall)
  plaque(1033, 0, 510, 160, "D 구역"); // bank E
  plaque(0, 163, 510, 160, "B 구역"); // bank C (the middle)
  const old = material.map;
  const t = new CanvasTexture(c);
  t.colorSpace = old.colorSpace;
  t.flipY = old.flipY;
  t.channel = old.channel;
  t.wrapS = old.wrapS;
  t.wrapT = old.wrapT;
  t.anisotropy = old.anisotropy;
  material.map = t;
  material.needsUpdate = true;
  old.dispose();
}
