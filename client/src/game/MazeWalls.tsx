import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { MAZE_WALLS, MAZE_GOAL, MAZE_PORTAL, MAZE_ORIGIN, MAZE_CELL } from "@caysonverse/shared/maze";
import { WALL_HEIGHT, type AABB } from "@caysonverse/shared/worldMap";
import { canvas2d, canvasTexture, roundRect } from "./spriteCanvas";
import { LANDMARK_EMOJIS, MAZE_LANDMARKS, PLAQUE_SIZE, plaqueQuads } from "./mazeLandmarks";

/**
 * Maze wall tone — a bright lavender-grey (cohesive with the room walls #6a6390
 * but lighter) with a weak self-glow, so faces stay legible under the maze fog and
 * dim floor. The room/lounge walls are unchanged (they live in WorldMap).
 */
const MAZE_WALL_COLOR = "#7d76b0";
const MAZE_WALL_EMISSIVE = "#2a2550";
/** Goal chamber tile — warm, gently emissive (a beckoning centre). */
const GOAL_COLOR = "#ffcf5a";
/** Return portal pad — cyan, brighter emissive (clearly "step here to leave"). */
const PORTAL_COLOR = "#66eaff";

/** Centre + XZ size of an AABB. */
function boxOf(a: AABB) {
  return {
    cx: (a.minX + a.maxX) / 2,
    cz: (a.minZ + a.maxZ) / 2,
    sx: a.maxX - a.minX,
    sz: a.maxZ - a.minZ,
  };
}

/**
 * Every maze wall merged into ONE BufferGeometry → a single draw call. Each wall
 * AABB becomes a box baked at its world position (the geometry carries absolute
 * coords), so the mesh sits at the origin with an identity, non-updating matrix.
 */
function MergedMazeWalls() {
  const geometry = useMemo(() => {
    const geos = MAZE_WALLS.map((w) => {
      const { cx, cz, sx, sz } = boxOf(w);
      const g = new BoxGeometry(sx, WALL_HEIGHT, sz);
      g.translate(cx, WALL_HEIGHT / 2, cz);
      return g;
    });
    const merged = mergeBufferGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return merged ?? new BoxGeometry(0, 0, 0);
  }, []);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={MAZE_WALL_COLOR}
        emissive={MAZE_WALL_EMISSIVE}
        emissiveIntensity={0.4}
        roughness={0.82}
        metalness={0}
      />
    </mesh>
  );
}

/** Resolution (px) of one cached emoji-plaque texture. */
const PLAQUE_PX = 128;

/** Rasterize `glyph` on a bright rounded card (legible against the dim maze). */
function renderPlaqueCanvas(glyph: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PLAQUE_PX;
  canvas.height = PLAQUE_PX;
  const ctx = canvas2d(canvas);
  const inset = 6;
  const r = 26;
  ctx.fillStyle = "rgba(245, 242, 255, 0.95)"; // near-white lavender card
  roundRect(ctx, inset, inset, PLAQUE_PX - inset * 2, PLAQUE_PX - inset * 2, r);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(88, 78, 150, 0.6)";
  roundRect(ctx, inset, inset, PLAQUE_PX - inset * 2, PLAQUE_PX - inset * 2, r);
  ctx.stroke();
  ctx.font = `${Math.round(PLAQUE_PX * 0.62)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, PLAQUE_PX / 2, PLAQUE_PX / 2 + 4);
  return canvas;
}

/**
 * Emoji landmark plaques on the maze walls. Deterministic anchors come from the
 * pure mazeLandmarks module; here each anchor becomes two quads (one flush on each
 * wall face) and quads are MERGED per emoji so the whole system is one draw call
 * PER distinct emoji (≤24) — never one per plaque. Each of the ≤24 textures is
 * built once and shared by its merged group. All geometry/materials/textures are
 * disposed on unmount so a WorldScene remount never leaks GPU memory. Fully static:
 * matrices are baked into world-space geometry with matrixAutoUpdate off.
 */
function MazePlaques() {
  const group = useMemo(() => {
    const quadsByEmoji = new Map<number, ReturnType<typeof plaqueQuads>>();
    for (const q of plaqueQuads(MAZE_LANDMARKS)) {
      const list = quadsByEmoji.get(q.emojiIndex) ?? [];
      list.push(q);
      quadsByEmoji.set(q.emojiIndex, list);
    }

    const root = new Group();
    for (const [emojiIndex, quads] of quadsByEmoji) {
      const geos = quads.map((q) => {
        const g = new PlaneGeometry(PLAQUE_SIZE, PLAQUE_SIZE);
        g.rotateY(q.rotationY);
        g.translate(q.x, q.y, q.z);
        return g;
      });
      const merged = mergeBufferGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const texture = canvasTexture(renderPlaqueCanvas(LANDMARK_EMOJIS[emojiIndex]));
      const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.2, // drop the card's rounded-corner transparency cleanly
        side: DoubleSide,
        depthWrite: true,
      });
      const mesh = new Mesh(merged, material);
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    root.matrixAutoUpdate = false;
    return root;
  }, []);

  // Dispose every merged geometry, material AND its texture on unmount.
  useEffect(
    () => () => {
      for (const child of group.children) {
        const mesh = child as Mesh;
        if (!mesh.isMesh) continue;
        mesh.geometry.dispose();
        const material = mesh.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
    },
    [group],
  );

  // Dev/E2E-only hook: the placed landmarks (world XZ + emoji), so the E2E can
  // assert plaque density and per-corridor distinctness without reaching into the
  // R3F scene graph. Tree-shaken out of production by the DEV guard.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __cvPlaques?: () => { x: number; z: number; emoji: string; emojiIndex: number }[];
    };
    w.__cvPlaques = () =>
      MAZE_LANDMARKS.map((l) => ({ x: l.x, z: l.z, emoji: l.emoji, emojiIndex: l.emojiIndex }));
    return () => {
      delete w.__cvPlaques;
    };
  }, []);

  return <primitive object={group} />;
}

/** A flat emissive floor tile over an AABB (portal pad / goal marker). */
function GlowTile({ box, color, intensity, y }: { box: AABB; color: string; intensity: number; y: number }) {
  const { cx, cz, sx, sz } = boxOf(box);
  return (
    <mesh position={[cx, y, cz]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[sx, sz]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} roughness={0.5} />
    </mesh>
  );
}

/**
 * All maze-specific geometry: merged walls (1 draw call), emoji landmark plaques
 * (≤24 draw calls, merged per emoji), the glowing return portal pad, the subtly-lit
 * goal tile, and a soft chamber light. The two-tone maze FLOOR plane is drawn by
 * WorldMap's ZoneFloor (ZONES.maze). Purely static.
 */
export function MazeWalls() {
  // Chamber centre (for the ambient goal light), from the 2×2 centre cells.
  const chamberX = MAZE_ORIGIN.x + 7 * MAZE_CELL; // between cells 6 and 7 on X
  const chamberZ = MAZE_ORIGIN.z + 7 * MAZE_CELL; // between cells 6 and 7 on Z

  return (
    <group>
      <MergedMazeWalls />
      {/* Emoji landmark plaques — deterministic, per-emoji merged, flush on walls. */}
      <MazePlaques />
      {/* Goal marker: warm, subtle (you feel you've arrived). */}
      <GlowTile box={MAZE_GOAL} color={GOAL_COLOR} intensity={0.55} y={0.03} />
      {/* Return portal: brighter cyan pad. */}
      <GlowTile box={MAZE_PORTAL} color={PORTAL_COLOR} intensity={1.1} y={0.04} />
      {/* Soft point light so the goal chamber reads as lit from within (kept low
          enough that it never spills a glow over the walls to aid peeking). */}
      <pointLight position={[chamberX, 2.6, chamberZ]} intensity={7} distance={9} decay={2} color={GOAL_COLOR} />
    </group>
  );
}
