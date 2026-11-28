// The way to the lake for a first-timer (owner, 2026-11-16): three wooden finger posts from the plaza along lane_lake
// ("케이슨 낚시터 →", the tip pointing the way, readable from both sides), and the lake's name on the top-down map.
// Small procedural models (a square timber post, a pointed board with a painted face), no file to load: they stand from the
// first frame, before the lake itself is fetched.

import { crispTextTexture, sharpenTextMaterial } from "../game/sceneText";
import { addInkLabel, type InkTone } from "../game/inkLabels";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BoxGeometry, CanvasTexture, ExtrudeGeometry, MeshStandardMaterial, SRGBColorSpace, Shape, ShapeGeometry, type Mesh, type Object3D } from "three";
import { viewState } from "../game/viewState";
import { OV_VIS_BLEND } from "../game/viewMode";

/** Where the posts stand (just off the path) and the way their tips point (toward the next bend of the way, m). */
export const LAKE_SIGNPOSTS: ReadonlyArray<{ x: number; z: number; toX: number; toZ: number }> = [
  // the plaza's east edge, where lane_bus leaves the paving for the bus stop and lane_lake
  { x: 29.6, z: 3.5, toX: 39, toZ: 1 },
  // past the bus stop, on lane_lake's south side
  { x: 45, z: 2.4, toX: 66, toZ: -6 },
  // the last bend before the lake
  { x: 80.5, z: -6.9, toX: 96, toZ: -10 },
];
/** The words on the board (no brand, owner's name for the lake). */
export const LAKE_SIGN_TEXT = "케이슨 낚시터";
/** The overview map's label over the lake. */
export const LAKE_MAP_LABEL = { x: 145, z: -12, text: "🎣 케이슨 낚시터" } as const;

const BOARD = { length: 1.5, height: 0.3, depth: 0.045, tip: 0.22, y: 1.78 } as const;
const POST = { side: 0.11, height: 2.15 } as const;

/**
 * The planks' mean colour round a spot `along` m from the face's left end, half way up (sRGB hex): the grain darkens them, so the
 * gradient's middle stop alone reads too light for the light probe (inkLabels.ts). From the words-free face, once per side.
 */
const plankMeans = new Map<string, string>();
function plankAt(tipRight: boolean, along: number): string {
  const key = `${tipRight}|${along}`;
  const hit = plankMeans.get(key);
  if (hit) return hit;
  let out: string = PLANK_MID;
  const t = faceTexture(tipRight, false);
  const c = t.image as HTMLCanvasElement;
  const g = c.getContext("2d");
  if (g) {
    const x = Math.round((along / BOARD.length) * c.width);
    const d = g.getImageData(Math.max(0, x - 8), Math.round(c.height / 2) - 12, 16, 24).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      gg += d[i + 1]!;
      b += d[i + 2]!;
    }
    const n = d.length / 4;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    out = `#${hex(r)}${hex(gg)}${hex(b)}`;
  }
  t.dispose();
  plankMeans.set(key, out);
  return out;
}

/** The face's canvas (px): the texture is laid over the board's 1.5 x 0.3 m box. */
const FACE_PX = { w: 512, h: 104 } as const;
/** The plank's colour half way up (its gradient's middle stop): the light probe's albedo (inkLabels.ts). */
const PLANK_MID = "#8a6139";

/** The painted words, cream, in the face's 512 x 104 px (scale the context for another size), through `tone`. */
function paintFaceWords(g: CanvasRenderingContext2D, tipRight: boolean, tone: InkTone = (c) => c): void {
  g.fillStyle = tone("#f3ead2");
  g.font = "bold 50px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "center";
  const text = tipRight ? `${LAKE_SIGN_TEXT} →` : `← ${LAKE_SIGN_TEXT}`;
  // the tip is the board's narrower end: centre the words in the rectangular part
  g.fillText(text, tipRight ? FACE_PX.w * 0.45 : FACE_PX.w * 0.55, FACE_PX.h / 2 + 2);
}

/** A board face: weathered planks with the words painted on (`words` false: the planks alone), the arrow toward the tip (right: "→", left: "←"). */
function faceTexture(tipRight: boolean, words = true): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = FACE_PX.w;
  c.height = FACE_PX.h;
  const g = c.getContext("2d")!;
  // the wood: warm brown, grain lines, darker edges
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, "#7a5532");
  grd.addColorStop(0.5, "#8a6139");
  grd.addColorStop(1, "#6a4729");
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  let seed = tipRight ? 7 : 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(${40 + rnd() * 30}, ${25 + rnd() * 20}, 10, ${0.18 + rnd() * 0.2})`;
    g.lineWidth = 1 + rnd() * 2;
    const y = rnd() * c.height;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= c.width; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 * rnd());
    g.stroke();
  }
  // the painted words, cream, a little worn
  if (words) paintFaceWords(g, tipRight);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  crispTextTexture(t); // mipmapped, trilinear, the GPU's highest anisotropy (sceneText.ts)
  return t;
}

/** The board's outline in its plane (x along, y up), the tip at +x (or at -x: `tipLeft`). */
function boardShape(tipLeft = false): Shape {
  const L = BOARD.length;
  const H = BOARD.height;
  const k = tipLeft ? -1 : 1;
  const s = new Shape();
  s.moveTo(-k * L / 2, -H / 2);
  s.lineTo(k * (L / 2 - BOARD.tip), -H / 2);
  s.lineTo(k * L / 2, 0);
  s.lineTo(k * (L / 2 - BOARD.tip), H / 2);
  s.lineTo(-k * L / 2, H / 2);
  s.closePath();
  return s;
}

/** A painted face: the outline as a flat sheet, UVs over its box (u along +x). */
function faceGeometry(tipLeft: boolean): ShapeGeometry {
  const g = new ShapeGeometry(boardShape(tipLeft));
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + BOARD.length / 2) / BOARD.length, (pos.getY(i) + BOARD.height / 2) / BOARD.height);
  uv.needsUpdate = true;
  return g;
}

function useSignParts() {
  const parts = useMemo(() => {
    const front = faceTexture(true);
    const back = faceTexture(false);
    const wood = new MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.92 });
    const faceFront = sharpenTextMaterial(new MeshStandardMaterial({ map: front, roughness: 0.85 }));
    const faceBack = sharpenTextMaterial(new MeshStandardMaterial({ map: back, roughness: 0.85 }));
    // the planks without the words: a face shows them while the label overlay draws its words crisp (inkLabels.ts); made on first use
    let blank: { front: MeshStandardMaterial; back: MeshStandardMaterial; dispose(): void } | null = null;
    const blankFaces = () =>
      (blank ??= (() => {
        const bf = faceTexture(true, false);
        const bb = faceTexture(false, false);
        const f = sharpenTextMaterial(new MeshStandardMaterial({ map: bf, roughness: 0.85 }));
        const b = sharpenTextMaterial(new MeshStandardMaterial({ map: bb, roughness: 0.85 }));
        return { front: f, back: b, dispose: () => [bf, bb, f, b].forEach((d) => d.dispose()) };
      })());
    const post = new BoxGeometry(POST.side, POST.height, POST.side);
    post.translate(0, POST.height / 2, 0);
    const cap = new BoxGeometry(POST.side + 0.04, 0.04, POST.side + 0.04);
    cap.translate(0, POST.height + 0.02, 0);
    const body = new ExtrudeGeometry(boardShape(), { depth: BOARD.depth, bevelEnabled: false });
    body.translate(0, 0, -BOARD.depth / 2);
    const faceA = faceGeometry(false);
    faceA.translate(0, 0, BOARD.depth / 2 + 0.002);
    // the other face: the outline with its tip at -x, turned half round (its tip back at +x, its face toward -z)
    const faceB = faceGeometry(true);
    faceB.translate(0, 0, BOARD.depth / 2 + 0.002);
    faceB.rotateY(Math.PI);
    return { front, back, wood, faceFront, faceBack, post, cap, body, faceA, faceB, blankFaces, disposeBlank: () => blank?.dispose() };
  }, []);
  useEffect(
    () => () => {
      for (const d of [parts.front, parts.back, parts.wood, parts.faceFront, parts.faceBack, parts.post, parts.cap, parts.body, parts.faceA, parts.faceB]) d.dispose();
      parts.disposeBlank();
    },
    [parts],
  );
  return parts;
}

type SignParts = ReturnType<typeof useSignParts>;

/** One finger post, its board's tip pointing toward (toX, toZ): "케이슨 낚시터 →" on one face, "← 케이슨 낚시터" on the other. */
function Signpost({ x, z, toX, toZ, parts }: { x: number; z: number; toX: number; toZ: number; parts: SignParts }) {
  // three's rotation.y turns +x toward -z: the board's +x (its tip) points at the way on with yaw = atan2(-dz, dx)
  const yaw = Math.atan2(-(toZ - z), toX - x);
  // both faces' words crisp on the label overlay (inkLabels.ts), each face its planks alone meanwhile
  const [meshA, setMeshA] = useState<Mesh | null>(null);
  const [meshB, setMeshB] = useState<Mesh | null>(null);
  const [anchorA, setAnchorA] = useState<Object3D | null>(null);
  const [anchorB, setAnchorB] = useState<Object3D | null>(null);
  useEffect(() => {
    if (!meshA || !meshB || !anchorA || !anchorB) return;
    const face = (mesh: Mesh, anchor: Object3D, tipRight: boolean) =>
      addInkLabel({
        object: anchor,
        w: BOARD.length,
        h: BOARD.height,
        paint: (g, w, h, tone) => {
          g.save();
          g.scale(w / FACE_PX.w, h / FACE_PX.h);
          paintFaceWords(g, tipRight, tone);
          g.restore();
        },
        // a plain lit board (MeshStandardMaterial under the sun and the sky light): its light worked out from them, day and night
        lit: "standard",
        // the plank between the words and the tip (the square end is shaded by the post standing in front of it)
        probe: { x: tipRight ? BOARD.length / 2 - 0.27 : -BOARD.length / 2 + 0.27, y: 0, albedo: plankAt(tipRight, tipRight ? BOARD.length - 0.27 : 0.27) },
        setInk: (on) => {
          if (on) mesh.material = tipRight ? parts.faceFront : parts.faceBack;
          else mesh.material = tipRight ? parts.blankFaces().front : parts.blankFaces().back;
        },
      });
    const offA = face(meshA, anchorA, true);
    const offB = face(meshB, anchorB, false);
    return () => {
      offA();
      offB();
    };
  }, [meshA, meshB, anchorA, anchorB, parts]);
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]} name="lake_signpost">
      <mesh geometry={parts.post} material={parts.wood} castShadow />
      <mesh geometry={parts.cap} material={parts.wood} />
      <group position={[POST.side / 2 + BOARD.length / 2 - 0.1, BOARD.y, 0]}>
        <mesh geometry={parts.body} material={parts.wood} castShadow />
        <mesh ref={setMeshA} geometry={parts.faceA} material={parts.faceFront} />
        <mesh ref={setMeshB} geometry={parts.faceB} material={parts.faceBack} />
        <object3D ref={setAnchorA} position={[0, 0, BOARD.depth / 2 + 0.002]} name="lake_sign_ink" />
        <object3D ref={setAnchorB} position={[0, 0, -(BOARD.depth / 2 + 0.002)]} rotation={[0, Math.PI, 0]} name="lake_sign_ink" />
      </group>
    </group>
  );
}

/** The lake's name on the top-down map (only in the overview, like "내 위치"). */
function MapLabel() {
  const tag = useRef<HTMLDivElement>(null);
  useFrame(() => {
    if (tag.current) tag.current.style.display = viewState.ovBlend > OV_VIS_BLEND ? "" : "none";
  });
  return (
    <group position={[LAKE_MAP_LABEL.x, 1, LAKE_MAP_LABEL.z]}>
      <Html center zIndexRange={[11, 0]} style={{ pointerEvents: "none" }}>
        <div ref={tag} className="cv-map-me cv-lake-map-label" style={{ display: "none" }} data-lake-map-label>
          {LAKE_MAP_LABEL.text}
        </div>
      </Html>
    </group>
  );
}

export function LakeSigns() {
  const parts = useSignParts();
  return (
    <>
      {LAKE_SIGNPOSTS.map((s, i) => (
        <Signpost key={i} {...s} parts={parts} />
      ))}
      <MapLabel />
    </>
  );
}
