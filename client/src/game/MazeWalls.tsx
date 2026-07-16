import { useMemo } from "react";
import { BoxGeometry } from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { MAZE_WALLS, MAZE_GOAL, MAZE_PORTAL, MAZE_ORIGIN, MAZE_CELL } from "@caysonverse/shared/maze";
import { WALL_HEIGHT, type AABB } from "@caysonverse/shared/worldMap";

/** Maze palette — cohesive with the room walls (#6a6390) but cooler/darker. */
const MAZE_WALL_COLOR = "#565080";
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
      <meshStandardMaterial color={MAZE_WALL_COLOR} roughness={0.92} metalness={0} />
    </mesh>
  );
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
 * All maze-specific geometry: merged walls (1 draw call), the glowing return
 * portal pad, the subtly-lit goal tile, and a soft chamber light. The two-tone
 * maze FLOOR plane is drawn by WorldMap's ZoneFloor (ZONES.maze). Purely static.
 */
export function MazeWalls() {
  // Chamber centre (for the ambient goal light), from the 2×2 centre cells.
  const chamberX = MAZE_ORIGIN.x + 7 * MAZE_CELL; // between cells 6 and 7 on X
  const chamberZ = MAZE_ORIGIN.z + 7 * MAZE_CELL; // between cells 6 and 7 on Z

  return (
    <group>
      <MergedMazeWalls />
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
