import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Object3D,
  type Texture,
} from "three";
import { canvas2d, canvasTexture, roundRect } from "./spriteCanvas";
import { faceColors, renderSegments } from "./wallColors";
import {
  FURNITURE,
  FURNITURE_MODELS,
  FURNITURE_SCALE,
  FURNITURE_URL_BASE,
  WALLS,
  WALL_HEIGHT,
  SCREEN,
  ZONES,
  type AABB,
} from "@caysonverse/shared/worldMap";
import { MazeWalls } from "./MazeWalls";
import { GalleryRoom } from "./GalleryRoom";
import { RoomPosters } from "./RoomPosters";

/**
 * Ground colours per zone — bright architectural finishes (design 30): every
 * room keeps a DISTINCT material so zones stay tellable, but all read as a lit
 * real building instead of the former cosmic-night palette.
 */
const LOUNGE_COLOR = "#c9a97b"; // light oak wood
const HALL_COLOR = "#c3ccd6"; // pale porcelain tile (cool, keeps the hall's identity)
const HALL_GROUT = "#a7b2c0"; // tile joint lines — the hall keeps its floor grid (발주자 요청)
const MAZE_COLOR = "#c7c3d3"; // light limestone with a lavender hint
const GALLERY_COLOR = "#ab7d51"; // mid walnut — clearly deeper than the lounge oak (design 25)
const SCREEN_BODY = "#0b0b14";

/** Edge length (m) of one lecture-hall floor tile. */
const HALL_TILE_M = 2;

/**
 * Wall materials shared by colour (module lifetime — the wall set is static).
 * Face colours come from wallColors.ts; a handful of rooms ⇒ a handful of
 * materials, reused across every wall segment.
 */
const wallMaterials = new Map<string, MeshStandardMaterial>();
function wallMaterial(color: string): MeshStandardMaterial {
  let m = wallMaterials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
    wallMaterials.set(color, m);
  }
  return m;
}

/**
 * One 2 m porcelain tile with grout on its edges. Repeated over the hall floor,
 * the shared edges form the grid pattern the owner asked to keep in the hall
 * (and only there — the other rooms' floors stay plain finishes).
 */
function drawHallTile(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128; // power-of-two: mipmaps stay available for the repeat
  canvas.height = 128;
  const ctx = canvas2d(canvas);
  ctx.fillStyle = HALL_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = HALL_GROUT;
  ctx.lineWidth = 6; // 3px visible per tile edge ≈ 5 cm grout at 2 m tiles
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Welcome slide shown on the lecture-hall screen (design 24). */
const SCREEN_TEXT = "최무호 월드에 오신 것을 환영합니다.";

/**
 * Rasterize the welcome slide for the screen face. The canvas aspect matches
 * the face plane (SCREEN.width*0.94 x SCREEN.height*0.9 ≈ 2.94:1) so the text
 * is not stretched. The gradient keeps the former glow-blue "lit screen" look
 * (#7c8cff family) so the hall reads the same from across the room; the text
 * line shrinks to fit so any future copy change cannot overflow the frame.
 */
function drawWelcomeSlide(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1880;
  canvas.height = 640;
  const ctx = canvas2d(canvas);

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#95a2ff");
  grad.addColorStop(1, "#6272e6");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Thin inner frame — reads as a projected slide, not a painted wall.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineWidth = 6;
  roundRect(ctx, 24, 24, canvas.width - 48, canvas.height - 48, 28);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 152;
  do {
    ctx.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    size -= 4;
  } while (size > 40 && ctx.measureText(SCREEN_TEXT).width > canvas.width * 0.86);
  ctx.fillStyle = "#171335";
  ctx.fillText(SCREEN_TEXT, canvas.width / 2, canvas.height / 2);
  return canvas;
}

const MODEL_IDS = Object.keys(FURNITURE_MODELS) as (keyof typeof FURNITURE_MODELS)[];
const MODEL_URLS = MODEL_IDS.map((id) => `${FURNITURE_URL_BASE}${id}.glb`);
useGLTF.preload(MODEL_URLS);

/** Centre + size (X,Z) of an AABB, for placing a box mesh over it. */
function boxOf(a: AABB) {
  return {
    cx: (a.minX + a.maxX) / 2,
    cz: (a.minZ + a.maxZ) / 2,
    sx: a.maxX - a.minX,
    sz: a.maxZ - a.minZ,
  };
}

/** A flat ground plane covering one zone AABB (optionally textured). */
function ZoneFloor({ zone, color, map }: { zone: AABB; color?: string; map?: Texture }) {
  const { cx, cz, sx, sz } = boxOf(zone);
  return (
    <mesh position={[cx, 0, cz]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[sx, sz]} />
      <meshStandardMaterial color={map ? "#ffffff" : color} map={map} roughness={1} metalness={0} />
    </mesh>
  );
}

/**
 * All furniture as one frozen group: each curated GLB is loaded once and its
 * scene is cloned per placement (clone(true) SHARES geometry + materials — never
 * a per-placement material). Each placement is re-centred so its footprint
 * centre lands on the map position, then scaled and rotated. Matrices are
 * computed once and `matrixAutoUpdate` is switched off, so furniture does zero
 * per-frame work.
 */
function Furniture() {
  const gltfs = useGLTF(MODEL_URLS);

  const root = useMemo(() => {
    const byId = new Map<string, Object3D>();
    MODEL_IDS.forEach((id, i) => byId.set(id, gltfs[i].scene));

    const group = new Group();
    for (const p of FURNITURE) {
      const m = FURNITURE_MODELS[p.model];
      const obj = byId.get(p.model)!.clone(true);
      obj.position.set(-m.cx * FURNITURE_SCALE, 0, -m.cz * FURNITURE_SCALE);
      obj.scale.setScalar(FURNITURE_SCALE);
      obj.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });

      const wrap = new Group();
      wrap.position.set(p.x, 0, p.z);
      wrap.rotation.y = p.rotY;
      wrap.add(obj);
      group.add(wrap);
    }

    // Compute every matrix once, then freeze (static scene — no per-frame TRS).
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      o.matrixAutoUpdate = false;
    });
    return group;
  }, [gltfs]);

  return <primitive object={root} />;
}

/** Walls, ground, big screen and all furniture. Purely static geometry. */
export function WorldMap() {
  const screenFaceX = SCREEN.x - SCREEN.depth / 2 - 0.02;
  // One texture per mount; disposed on unmount (WorldScene remounts on reconnect).
  const screenTexture = useMemo(() => canvasTexture(drawWelcomeSlide()), []);
  useEffect(() => () => screenTexture.dispose(), [screenTexture]);

  // Hall tile texture: power-of-two canvas, default mipmapping (repeat at grazing
  // angles), repeated so each tile spans HALL_TILE_M metres exactly.
  const hallTexture = useMemo(() => {
    const t = new CanvasTexture(drawHallTile());
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    const hall = ZONES.lectureHall;
    t.repeat.set((hall.maxX - hall.minX) / HALL_TILE_M, (hall.maxZ - hall.minZ) / HALL_TILE_M);
    return t;
  }, []);
  useEffect(() => () => hallTexture.dispose(), [hallTexture]);

  return (
    <group>
      {/* Ground, one plane per zone (maze west, lounge centre, hall east,
          gallery annex north). */}
      <ZoneFloor zone={ZONES.maze} color={MAZE_COLOR} />
      <ZoneFloor zone={ZONES.lounge} color={LOUNGE_COLOR} />
      <ZoneFloor zone={ZONES.lectureHall} map={hallTexture} />
      <ZoneFloor zone={ZONES.gallery} color={GALLERY_COLOR} />

      {/* Maze: merged walls (1 draw call), goal tile, return portal, chamber light. */}
      <MazeWalls />

      {/* 최무호 일대기 gallery: 9 portraits, frames, plaques, banner (design 25). */}
      <GalleryRoom />

      {/* Lounge-side room-name posters beside each door: 미로방 🌀 / 강의실 📚 /
          갤러리 🖼 — every room is tellable from the lounge (design 26). */}
      <RoomPosters />

      {/* Walls: box meshes over the collision AABBs, split per room for render
          so each face is painted in the colour of the room that sees it
          (design 30 후속 — collision uses the UNsplit WALLS unchanged). */}
      {WALLS.flatMap(renderSegments).map((seg, i) => {
        const { cx, cz, sx, sz } = boxOf(seg);
        return (
          <mesh
            key={i}
            position={[cx, WALL_HEIGHT / 2, cz]}
            castShadow
            receiveShadow
            material={faceColors(seg).map(wallMaterial)}
          >
            <boxGeometry args={[sx, WALL_HEIGHT, sz]} />
          </mesh>
        );
      })}

      {/* Lecture-hall big screen: dark body + slightly emissive front face. */}
      <group position={[SCREEN.x, SCREEN.y, SCREEN.z]}>
        <mesh castShadow>
          <boxGeometry args={[SCREEN.depth, SCREEN.height, SCREEN.width]} />
          <meshStandardMaterial color={SCREEN_BODY} roughness={0.5} metalness={0.1} />
        </mesh>
      </group>
      {/* Screen face: the welcome slide, unlit so it stays readable ("lit screen")
          under the dim hall lighting. */}
      <mesh position={[screenFaceX, SCREEN.y, SCREEN.z]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[SCREEN.width * 0.94, SCREEN.height * 0.9]} />
        <meshBasicMaterial map={screenTexture} toneMapped={false} />
      </mesh>

      <Furniture />
    </group>
  );
}
