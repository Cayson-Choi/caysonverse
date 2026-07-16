import { useEffect, useMemo } from "react";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { canvas2d, canvasTexture, roundRect } from "./spriteCanvas";
import {
  DOOR_HALF_WIDTH,
  GALLERY_DOOR_X,
  GALLERY_DOOR_HALF_WIDTH,
  WALLS,
  ZONES,
} from "@caysonverse/shared/worldMap";
import { MAZE_WALL_T, MAZE_WALLS, MAZE_ZONE } from "@caysonverse/shared/maze";
import { MAZE_LANDMARKS, PLAQUE_SIZE } from "./mazeLandmarks";

/**
 * Lounge-side room-name posters (design 26): one eye-level card beside each of
 * the three doors — 미로방 🌀 (maze east wall), 강의실 📚 (divider west face),
 * 갤러리 🖼 (lounge north wall) — so a player standing anywhere in the lounge
 * can tell every room apart at a glance. Placement is a PURE derivation from
 * the shared wall geometry (mazeLandmarks/gallery single-source discipline):
 * each anchor sits ON its wall's lounge-side face line, offset one door width +
 * clearance past the opening, so a wall or door edit re-places the posters with
 * zero literal edits here. RoomPosters.test.ts pins the on-wall / door-clear /
 * into-the-lounge invariants without touching a scene graph.
 */

/** Poster card size (m) — landscape so the room name reads big across the lounge. */
export const POSTER_W = 1.3;
export const POSTER_H = 0.85;

/** Card centre height (m) — avatar eye level (maze plaques sit at 1.5). */
export const POSTER_EYE_Y = 1.6;

/** Outward offset off the wall face (m) — mazeLandmarks' z-fight discipline. */
export const POSTER_WALL_GAP = 0.02;

/** Minimum gap (m) between a poster edge and its door opening's edge. */
export const POSTER_DOOR_CLEARANCE = 0.6;

/** Minimum gap (m) between the poster edge and a maze landmark plaque edge. */
const PLAQUE_CLEARANCE = 0.15;

/** One room-name poster: identity + its wall-face anchor and outward normal. */
export interface RoomPoster {
  /** The room the flanked door leads to. */
  room: "maze" | "lectureHall" | "gallery";
  /** Korean room name (the card's headline). */
  title: string;
  /** Symbol emoji above the name (design 26: 🌀 / 📚 / 🖼). */
  emoji: string;
  /** Card-centre anchor ON the wall's lounge-side face line (y = POSTER_EYE_Y). */
  x: number;
  z: number;
  /** Outward (into-the-lounge) unit normal — offset and facing derive from it. */
  nx: number;
  nz: number;
  /** Y-rotation aligning a +Z-normal plane with (nx, nz). */
  rotY: number;
  /** The flanked door opening, as an interval along the wall's run axis. */
  doorMin: number;
  doorMax: number;
}

/**
 * Derive the three posters from the shared wall data. The maze door is not a
 * named constant anywhere (maze.ts keeps ENTRANCE_ROW private), so it is read
 * off the geometry itself: the maze's east-boundary column yields exactly two
 * wall runs, and the gap between them IS the door. The other two doors have
 * exported half-widths. Every poster hangs on the side of its door that faces
 * the lounge centre, one clearance + half-card past the opening's edge.
 */
function buildRoomPosters(): RoomPoster[] {
  // Maze east boundary runs: vertical (x-extent == wall thickness), centred on
  // the maze zone's east edge. Sorted, the single entrance gap sits between them.
  const eastRuns = MAZE_WALLS.filter(
    (w) =>
      Math.abs(w.maxX - w.minX - MAZE_WALL_T) < 1e-9 &&
      Math.abs((w.minX + w.maxX) / 2 - MAZE_ZONE.maxX) < 1e-9,
  ).sort((a, b) => a.minZ - b.minZ);
  const north = eastRuns[0];
  const south = eastRuns[eastRuns.length - 1];

  // Divider west face — from the WALLS boxes centred on x = 0 (either segment).
  const dividerFaceX = WALLS.find((w) => Math.abs(w.minX + w.maxX) < 1e-9)!.minX;

  /** Door-edge → card-centre offset along the run (clearance + half a card). */
  const side = POSTER_DOOR_CLEARANCE + POSTER_W / 2;

  // The maze east wall's lounge face ALSO carries deterministic landmark
  // plaques (mazeLandmarks hangs one flush quad on each face of every maze
  // wall, boundary included — the first anchor sits right beside the door).
  // Slide the poster south in small steps until it clears every plaque on
  // this face: the 4–6 m plaque stride always leaves a poster-sized slot
  // within one stride, so this terminates quickly and stays door-adjacent.
  const facePlaqueZs = MAZE_LANDMARKS.filter(
    (lm) => lm.axis === "z" && Math.abs(lm.x - MAZE_ZONE.maxX) < 1e-9,
  ).map((lm) => lm.z);
  const clashes = (zc: number) =>
    facePlaqueZs.some(
      (pz) => Math.abs(pz - zc) < POSTER_W / 2 + PLAQUE_SIZE / 2 + PLAQUE_CLEARANCE,
    );
  let mazeZ = south.minZ + side;
  while (clashes(mazeZ)) mazeZ += 0.25;

  return [
    {
      room: "maze",
      title: "미로방",
      emoji: "\u{1F300}", // 🌀
      x: south.maxX, // lounge-side face of the maze east wall
      z: mazeZ, // south of the door, past the first landmark plaque
      nx: 1,
      nz: 0,
      rotY: Math.PI / 2,
      doorMin: north.maxZ,
      doorMax: south.minZ,
    },
    {
      room: "lectureHall",
      title: "강의실",
      emoji: "\u{1F4DA}", // 📚
      x: dividerFaceX,
      z: DOOR_HALF_WIDTH + side, // south of the divider door
      nx: -1,
      nz: 0,
      rotY: -Math.PI / 2,
      doorMin: -DOOR_HALF_WIDTH,
      doorMax: DOOR_HALF_WIDTH,
    },
    {
      room: "gallery",
      title: "갤러리",
      emoji: "\u{1F5BC}\u{FE0F}", // 🖼
      x: GALLERY_DOOR_X + GALLERY_DOOR_HALF_WIDTH + side, // east of the gallery door
      z: ZONES.lounge.minZ, // lounge-side face of the north wall
      nx: 0,
      nz: 1,
      rotY: 0,
      doorMin: GALLERY_DOOR_X - GALLERY_DOOR_HALF_WIDTH,
      doorMax: GALLERY_DOOR_X + GALLERY_DOOR_HALF_WIDTH,
    },
  ];
}

/** The three posters, derived ONCE at module load — identical on every client. */
export const ROOM_POSTERS: readonly RoomPoster[] = buildRoomPosters();

/** Canvas resolution (px) — POSTER_W/H aspect at ~500 px/m (crisp at close range). */
const POSTER_PX_W = 650;
const POSTER_PX_H = 425;

/** Shared Korean UI font stack (lecture slide / gallery plaque precedent). */
const KR_FONT = `"Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
/** Emoji-capable stack (maze plaque precedent). */
const EMOJI_FONT = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;

/**
 * Rasterize one poster: a bright rounded card (the maze plaque's near-white
 * lavender family) with the symbol emoji on top and the room name beneath in
 * large deep-indigo type. The name shrinks to fit so a longer future title can
 * never overflow the card (lecture-slide precedent).
 */
function drawPoster(title: string, emoji: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_PX_W;
  canvas.height = POSTER_PX_H;
  const ctx = canvas2d(canvas);

  const inset = 12;
  ctx.fillStyle = "rgba(245, 242, 255, 0.96)"; // near-white lavender card
  roundRect(ctx, inset, inset, POSTER_PX_W - inset * 2, POSTER_PX_H - inset * 2, 42);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(88, 78, 150, 0.65)"; // maze-plaque rim tone
  roundRect(ctx, inset, inset, POSTER_PX_W - inset * 2, POSTER_PX_H - inset * 2, 42);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = `140px ${EMOJI_FONT}`;
  ctx.fillText(emoji, POSTER_PX_W / 2, 122);

  let size = 180;
  do {
    ctx.font = `700 ${size}px ${KR_FONT}`;
    size -= 4;
  } while (size > 60 && ctx.measureText(title).width > POSTER_PX_W * 0.86);
  ctx.fillStyle = "#322b5e"; // deep indigo — ties to the #6a6390 wall palette
  ctx.fillText(title, POSTER_PX_W / 2, 306);
  return canvas;
}

/**
 * The three posters as static meshes: one shared plane geometry, one canvas
 * texture + unlit material per poster (readable under the dim world light),
 * flush on the wall at POSTER_WALL_GAP. Matrices are baked once and frozen;
 * geometry/materials/textures are disposed on unmount (WorldScene remounts on
 * reconnect — MazePlaques discipline, never a GPU leak).
 */
export function RoomPosters() {
  const group = useMemo(() => {
    const geometry = new PlaneGeometry(POSTER_W, POSTER_H);
    const root = new Group();
    for (const p of ROOM_POSTERS) {
      const texture = canvasTexture(drawPoster(p.title, p.emoji));
      const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.2, // clean rounded-card corners (maze plaque precedent)
        toneMapped: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(p.x + p.nx * POSTER_WALL_GAP, POSTER_EYE_Y, p.z + p.nz * POSTER_WALL_GAP);
      mesh.rotation.y = p.rotY;
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    root.matrixAutoUpdate = false;
    return root;
  }, []);

  useEffect(
    () => () => {
      let shared: PlaneGeometry | null = null;
      for (const child of group.children) {
        const mesh = child as Mesh;
        if (!mesh.isMesh) continue;
        shared = mesh.geometry as PlaneGeometry; // one geometry shared by all three
        const material = mesh.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
      shared?.dispose();
    },
    [group],
  );

  // Dev/E2E-only hook: the mounted posters' identity + anchors, so the E2E can
  // prove the component actually rendered (not just that constants exist).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __cvRoomPosters?: () => { room: string; title: string; x: number; z: number }[];
    };
    w.__cvRoomPosters = () =>
      ROOM_POSTERS.map((p) => ({ room: p.room, title: p.title, x: p.x, z: p.z }));
    return () => {
      delete w.__cvRoomPosters;
    };
  }, []);

  return <primitive object={group} />;
}
