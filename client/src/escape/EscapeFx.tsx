import { memo, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import type { RoomId } from "@caysonverse/shared/escape/constants";
import { ROOM_MAPS } from "@caysonverse/shared/school/roomMaps";
import { escapeClock, escapeFxLevels, type EscapeFxLevels } from "./escapeTimeline";
import { prefersReducedMotion } from "./reducedMotion";

/**
 * The light of the escape (AI 학교 탈출, Task 20): when the last door opens the sun pours into the room.
 * Three cheap, additive parts that read the show's clock (escapeTimeline.ts) every frame:
 *  - a soft sun glow at the door (one camera-facing sprite),
 *  - a patch of light on the floor that grows from the door into the room,
 *  - a few dozen sparkles drifting out of the door and twinkling away.
 * The room's colours coming back is the DOM veil (ui/EscapeVeil); the door leaf is the room model's own part
 * (RoomPlaceholder now, counsel.glb in Task 24) — this effect works with either, from the room's `exit_door`
 * anchor and the south wall.
 *
 * Nothing is allocated per frame: every buffer, material and output object is made once on mount, the frame
 * callback only writes numbers into them, and everything is disposed on unmount (leaving the classroom).
 * With "reduce motion" the sparkles and the pulsing are left out; the glow and the floor light just appear.
 */

const DOOR_ANCHOR_ID = "exit_door";
const SPARKLES = 56;
/** The first sparkles pour out of the door; the rest glitter all over the room (so a player facing away sees them too). */
const DOOR_SPARKLES = 20;
const SPARKLE_SIZE = 0.3;
const SPARK_COLOR = { r: 1, g: 0.88, b: 0.55 } as const;
/** The light stays this far in front of the wall, so it never fights the wall's own surface. */
const WALL_GAP = 0.05;
const SUN_COLOR = "#FFE4A0";
const SPILL_COLOR = "#FFF0C2";

/** A deterministic 0..1 sequence (the same sparkles every time; no Math.random in a render). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTexture(size: number, paint: (g: CanvasRenderingContext2D, size: number) => void): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  paint(g, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A round glow: white in the middle, nothing at the rim. */
function glowTexture(): CanvasTexture | null {
  return canvasTexture(128, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.16)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
  });
}

/** Light on the floor: brightest at the bottom edge (the door side, v = 0), fading out and thinning towards the far end. */
function spillTexture(): CanvasTexture | null {
  return canvasTexture(128, (g, n) => {
    const fade = g.createLinearGradient(0, n, 0, 0);
    fade.addColorStop(0, "rgba(255,255,255,0.95)");
    fade.addColorStop(0.45, "rgba(255,255,255,0.4)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = fade;
    g.fillRect(0, 0, n, n);
    // soften the two long edges so the patch looks like light, not a rug
    g.globalCompositeOperation = "destination-in";
    const edge = g.createLinearGradient(0, 0, n, 0);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(0.22, "rgba(0,0,0,1)");
    edge.addColorStop(0.78, "rgba(0,0,0,1)");
    edge.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = edge;
    g.fillRect(0, 0, n, n);
  });
}

/** A four-point star with a soft core. */
function sparkTexture(): CanvasTexture | null {
  return canvasTexture(64, (g, n) => {
    const c = n / 2;
    const core = g.createRadialGradient(c, c, 0, c, c, c);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(0.2, "rgba(255,255,255,0.7)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.fillRect(0, 0, n, n);
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.moveTo(c, 2);
    g.quadraticCurveTo(c + 3, c - 3, n - 2, c);
    g.quadraticCurveTo(c + 3, c + 3, c, n - 2);
    g.quadraticCurveTo(c - 3, c + 3, 2, c);
    g.quadraticCurveTo(c - 3, c - 3, c, 2);
    g.fill();
  });
}

interface Kit {
  root: Group;
  /** The sun and the sparkles: hidden once they have nothing to show. */
  dynamic: Group;
  sun: Sprite;
  sunMat: SpriteMaterial;
  spill: Mesh;
  spillMat: MeshBasicMaterial;
  points: Points | null;
  pos: Float32Array;
  col: Float32Array;
  /** Per sparkle: phase, speed, sideways offset, height offset, rise, reach. */
  seed: Float32Array;
  levels: EscapeFxLevels;
  /** The anchor of the door and the wall it stands in. */
  door: { x: number; y: number; zWall: number };
  /** The room's floor, for the sparkles that glitter all over it. */
  room: { cx: number; halfW: number; minZ: number; depth: number };
  dispose: () => void;
}

const SEEDS_PER = 6;

function buildKit(door: Kit["door"], room: Kit["room"], reduced: boolean): Kit {
  const textures: Texture[] = [];
  const keep = (t: CanvasTexture | null): CanvasTexture | null => {
    if (t) textures.push(t);
    return t;
  };
  const root = new Group();
  root.name = "escape-fx";
  root.visible = false;
  const dynamic = new Group();

  const sunMat = new SpriteMaterial({
    map: keep(glowTexture()),
    color: SUN_COLOR,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sun = new Sprite(sunMat);
  sun.position.set(door.x, door.y + 0.2, door.zWall - 0.45);
  sun.renderOrder = 4;
  dynamic.add(sun);

  const spillGeo = new PlaneGeometry(1, 1);
  const spillMat = new MeshBasicMaterial({
    map: keep(spillTexture()),
    color: SPILL_COLOR,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const spill = new Mesh(spillGeo, spillMat);
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(door.x, 0.04, door.zWall - 0.5);
  spill.renderOrder = 2;
  root.add(spill);

  const pos = new Float32Array(SPARKLES * 3);
  const col = new Float32Array(SPARKLES * 3);
  const seed = new Float32Array(SPARKLES * SEEDS_PER);
  let points: Points | null = null;
  let pointsGeo: BufferGeometry | null = null;
  let pointsMat: PointsMaterial | null = null;
  if (!reduced) {
    const rnd = lcg(20261101);
    for (let i = 0; i < SPARKLES; i++) {
      const o = i * SEEDS_PER;
      seed[o] = rnd(); // phase
      seed[o + 1] = 0.12 + rnd() * 0.14; // speed (lives per second)
      seed[o + 2] = rnd() * 2 - 1; // sideways
      seed[o + 3] = rnd(); // height
      seed[o + 4] = 0.4 + rnd() * 1.2; // rise
      // door sparkles: how far they reach into the room; room sparkles: where on the floor (0..1 from the far wall)
      seed[o + 5] = i < DOOR_SPARKLES ? 1.8 + rnd() * 3.2 : rnd();
    }
    pointsGeo = new BufferGeometry();
    pointsGeo.setAttribute("position", new BufferAttribute(pos, 3));
    pointsGeo.setAttribute("color", new BufferAttribute(col, 3));
    pointsMat = new PointsMaterial({
      map: keep(sparkTexture()),
      size: SPARKLE_SIZE,
      sizeAttenuation: true,
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    points = new Points(pointsGeo, pointsMat);
    points.frustumCulled = false; // the buffer moves every frame; its bounding sphere is never refreshed
    points.renderOrder = 5;
    dynamic.add(points);
  }
  root.add(dynamic);

  return {
    root,
    dynamic,
    sun,
    sunMat,
    spill,
    spillMat,
    points,
    pos,
    col,
    seed,
    levels: { sun: 0, spill: 0, sparkle: 0 },
    door,
    room,
    dispose: () => {
      spillGeo.dispose();
      spillMat.dispose();
      sunMat.dispose();
      pointsGeo?.dispose();
      pointsMat?.dispose();
      for (const t of textures) t.dispose();
      root.removeFromParent();
    },
  };
}

/** Write the sparkles for time `t` (ms) at strength `level` into the kit's buffers. */
function paintSparkles(k: Kit, t: number, level: number): void {
  const { pos, col, seed, door, room } = k;
  const sec = t / 1000;
  for (let i = 0; i < SPARKLES; i++) {
    const o = i * SEEDS_PER;
    const life = (sec * seed[o + 1] + seed[o]) % 1; // 0 → 1 over one life
    const p = i * 3;
    if (i < DOOR_SPARKLES) {
      pos[p] = door.x + seed[o + 2] * (0.5 + 1.4 * life);
      pos[p + 1] = 0.3 + seed[o + 3] * 1.9 + seed[o + 4] * life;
      pos[p + 2] = door.zWall - 0.4 - life * seed[o + 5];
    } else {
      // glitter in place, drifting up a little
      pos[p] = room.cx + seed[o + 2] * room.halfW;
      pos[p + 1] = 0.4 + seed[o + 3] * 2.2 + seed[o + 4] * 0.5 * life;
      pos[p + 2] = room.minZ + seed[o + 5] * room.depth;
    }
    // fade in and out over one life, with a little twinkle on top
    const bell = Math.sin(Math.PI * life);
    const twinkle = 0.65 + 0.35 * Math.sin(sec * 9 + seed[o] * 40);
    const b = bell * twinkle * level;
    col[p] = b * SPARK_COLOR.r;
    col[p + 1] = b * SPARK_COLOR.g;
    col[p + 2] = b * SPARK_COLOR.b;
  }
  const geo = k.points?.geometry;
  if (geo) {
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}

/**
 * The escape's light effect for `roomId`. Draws nothing (not even a draw call) until the escape clock runs.
 */
export const EscapeFx = memo(function EscapeFx({ roomId }: { roomId: RoomId }) {
  const map = ROOM_MAPS[roomId];
  const anchor = map?.anchors.find((a) => a.id === DOOR_ANCHOR_ID);
  const bounds = map?.geometry.bounds;
  const ax = anchor?.x;
  const ay = anchor?.y;
  const kit = useMemo<Kit | null>(() => {
    if (ax === undefined || ay === undefined || bounds === undefined) return null;
    const room = {
      cx: (bounds.minX + bounds.maxX) / 2,
      halfW: (bounds.maxX - bounds.minX) / 2 - 0.5,
      minZ: bounds.minZ + 0.5,
      depth: bounds.maxZ - bounds.minZ - 1,
    };
    return buildKit({ x: ax, y: ay, zWall: bounds.maxZ - WALL_GAP }, room, prefersReducedMotion());
  }, [ax, ay, bounds]);

  useEffect(() => {
    if (!kit) return;
    return () => kit.dispose();
  }, [kit]);

  useFrame(() => {
    if (!kit) return;
    if (!escapeClock.running()) {
      if (kit.root.visible) kit.root.visible = false;
      return;
    }
    const t = escapeClock.elapsed(performance.now());
    const lv = escapeFxLevels(t, kit.levels);
    kit.root.visible = true;

    // The floor light grows from the door into the room.
    const grow = lv.spill;
    const length = 0.4 + 5.2 * grow;
    kit.spill.scale.set(1.4 + 2.4 * grow, length, 1);
    kit.spill.position.z = kit.door.zWall - 0.15 - length / 2;
    kit.spillMat.opacity = 0.6 * grow;

    // The sun glow and the sparkles.
    const live = lv.sun > 0.001 || lv.sparkle > 0.001;
    kit.dynamic.visible = live;
    if (!live) return;
    const size = 2.2 + 3.8 * lv.sun;
    kit.sun.scale.set(size, size, 1);
    kit.sunMat.opacity = 0.55 * lv.sun;
    if (kit.points && lv.sparkle > 0.001) paintSparkles(kit, t, lv.sparkle);
    if (kit.points) kit.points.visible = lv.sparkle > 0.001;
  });

  return kit ? <primitive object={kit.root} /> : null;
});
