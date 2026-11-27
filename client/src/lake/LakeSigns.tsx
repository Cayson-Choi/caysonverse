// The way to the lake for a first-timer (owner, 2026-11-16): three wooden finger posts from the plaza along lane_lake
// ("케이슨 낚시터 →", the tip pointing the way, readable from both sides), and the lake's name on the top-down map.
// Small procedural models (a square timber post, a pointed board with a painted face), no file to load: they stand from the
// first frame, before the lake itself is fetched.

import { crispTextTexture, sharpenTextMaterial } from "../game/sceneText";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BoxGeometry, CanvasTexture, ExtrudeGeometry, MeshStandardMaterial, SRGBColorSpace, Shape, ShapeGeometry } from "three";
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

/** A board face: weathered planks with the words painted on, the arrow toward the tip (right: "→", left: "←"). */
function faceTexture(tipRight: boolean): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 104;
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
  g.fillStyle = "#f3ead2";
  g.font = "bold 50px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "center";
  const text = tipRight ? `${LAKE_SIGN_TEXT} →` : `← ${LAKE_SIGN_TEXT}`;
  // the tip is the board's narrower end: centre the words in the rectangular part
  g.fillText(text, tipRight ? c.width * 0.45 : c.width * 0.55, c.height / 2 + 2);
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
    return { front, back, wood, faceFront, faceBack, post, cap, body, faceA, faceB };
  }, []);
  useEffect(
    () => () => {
      for (const d of Object.values(parts)) d.dispose();
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
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]} name="lake_signpost">
      <mesh geometry={parts.post} material={parts.wood} castShadow />
      <mesh geometry={parts.cap} material={parts.wood} />
      <group position={[POST.side / 2 + BOARD.length / 2 - 0.1, BOARD.y, 0]}>
        <mesh geometry={parts.body} material={parts.wood} castShadow />
        <mesh geometry={parts.faceA} material={parts.faceFront} />
        <mesh geometry={parts.faceB} material={parts.faceBack} />
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
