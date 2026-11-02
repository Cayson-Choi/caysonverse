import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  type Mesh,
} from "three";
import { PROGRESS_BOARD } from "@caysonverse/shared/school/hubMap";
import { ROOM_IDS, ROOM_LABELS, type RoomId } from "@caysonverse/shared/escape/constants";
import { canvas2d, canvasTexture, roundRect } from "../spriteCanvas";
import { FONT_FAMILY } from "../nametag";
import { useClassStore } from "../../stores/classStore";
import { BOARD_FLASH_MS, STEADY_LIT_GLOW, WINDOW_COLORS, boardFlash, type BoardFlash } from "./boardTimeline";

/**
 * The school-model progress board on the central hall's north wall (AI 학교 탈출, Task 16): a little
 * school front standing on the PROGRESS_BOARD footprint (8 x 1 m) — a roof, a title band, and one
 * window per classroom (ROOM_IDS, seven) with the room's name under it. A window the class has not
 * cleared is pale grey glass; a room in `litRooms` (some team escaped it) is bright in its own
 * colour with a soft glow, and a window that lights up WHILE you watch sparkles for a moment
 * (boardTimeline.ts: a glow that settles, a halo that swells and fades, a small pop). Rooms already
 * lit when the hall appears are simply lit — no sparkle for old news.
 *
 * The room names and the title are canvas textures (spriteCanvas), never baked into a model. Reads
 * only discrete class state (`litRooms`). Per frame it touches nothing unless a sparkle is running,
 * and then only writes numbers into materials and a reused `BoardFlash` — no allocation.
 *
 * The footprint is the collision box (hubMap PROGRESS_BOARD); the scene skips that box in MapBoxes
 * and draws this instead. TEMPORARY like the other hub parts: the hub model replaces it in Task 23
 * (`board_window__<RoomId>` nodes).
 */

// ── layout (m; the board stands against the wall z = PROGRESS_BOARD.minZ, facing +z) ──
const CX = (PROGRESS_BOARD.minX + PROGRESS_BOARD.maxX) / 2;
const WIDTH = PROGRESS_BOARD.maxX - PROGRESS_BOARD.minX;
const DEPTH = PROGRESS_BOARD.maxZ - PROGRESS_BOARD.minZ;
const CZ = (PROGRESS_BOARD.minZ + PROGRESS_BOARD.maxZ) / 2;

const PODIUM_H = 0.5;
const PANEL_W = WIDTH - 0.4;
const PANEL_H = 2.3;
const PANEL_D = 0.16;
const PANEL_Z = PROGRESS_BOARD.minZ + 0.38; // the front lip of the podium is left free
const PANEL_FRONT = PANEL_Z + PANEL_D / 2;
const BAND_H = 0.4;
const ROOF_H = 0.65;
const ROOF_D = 0.55;

const WINDOW_GAP = 1.08;
const PANE_W = 0.8;
const PANE_H = 0.95;
const PANE_Y = PODIUM_H + 1.45;
const FRAME_PAD = 0.07;
const PLATE_W = 1.0;
const PLATE_H = 0.34;
const PLATE_Y = PODIUM_H + 0.68;

const UNLIT_COLOR = "#C9D3DE";
const COLOR_WALL = "#DCE5FF";
const COLOR_PODIUM = "#C7A26F";
const COLOR_FRAME = "#FFFFFF";
const COLOR_ROOF = "#4B4FD8";
const COLOR_BAND = "#8B5CF6";

/** A label on a rounded plate. Returns the texture and its aspect (w / h). */
function labelTexture(
  text: string,
  w: number,
  h: number,
  px: number,
  bg: string,
  fg: string,
): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas2d(canvas);
  ctx.fillStyle = bg;
  roundRect(ctx, 4, 4, w - 8, h - 8, h / 4);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = `800 ${px}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 3);
  return { texture: canvasTexture(canvas), aspect: w / h };
}

/** A soft round glow (white in the middle, clear at the edge): the sparkle halo, tinted per window. */
function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas2d(canvas);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(canvas);
}

/** The roof: a triangle across the board's width, extruded a little deep. */
function roofGeometry(): ExtrudeGeometry {
  const half = WIDTH / 2;
  const shape = new Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(0, ROOF_H);
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth: ROOF_D, bevelEnabled: false });
  geo.translate(0, 0, -ROOF_D / 2);
  return geo;
}

/** The numbers of one window the frame loop and the lit-state effect share. */
interface WindowState {
  lit: boolean;
  /** performance.now() when the sparkle started; NaN = none running. */
  flashAt: number;
}

/** Everything the board owns (made once per mount, released with it). */
interface BoardParts {
  panes: Record<RoomId, MeshStandardMaterial>;
  halos: Record<RoomId, MeshBasicMaterial>;
  plates: Record<RoomId, { material: MeshBasicMaterial; aspect: number }>;
  title: { material: MeshBasicMaterial; aspect: number };
  glow: CanvasTexture;
  roof: ExtrudeGeometry;
  states: Record<RoomId, WindowState>;
}

function makeParts(): BoardParts {
  const glow = glowTexture();
  const panes = {} as Record<RoomId, MeshStandardMaterial>;
  const halos = {} as Record<RoomId, MeshBasicMaterial>;
  const plates = {} as Record<RoomId, { material: MeshBasicMaterial; aspect: number }>;
  const states = {} as Record<RoomId, WindowState>;
  for (const room of ROOM_IDS) {
    panes[room] = new MeshStandardMaterial({
      color: UNLIT_COLOR,
      roughness: 0.18,
      metalness: 0,
      transparent: true,
      opacity: 0.88,
      emissive: new Color(WINDOW_COLORS[room]),
      emissiveIntensity: 0,
    });
    halos[room] = new MeshBasicMaterial({
      map: glow,
      color: WINDOW_COLORS[room],
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const p = labelTexture(ROOM_LABELS[room], 300, 102, 66, "#FFFFFF", "#3B3FB8");
    plates[room] = { material: new MeshBasicMaterial({ map: p.texture, transparent: true }), aspect: p.aspect };
    states[room] = { lit: false, flashAt: Number.NaN };
  }
  const t = labelTexture("AI 학교 탈출", 640, 120, 76, "#FFFFFF", "#4B4FD8");
  return {
    panes,
    halos,
    plates,
    title: { material: new MeshBasicMaterial({ map: t.texture, transparent: true }), aspect: t.aspect },
    glow,
    roof: roofGeometry(),
    states,
  };
}

function disposeParts(p: BoardParts): void {
  for (const room of ROOM_IDS) {
    p.panes[room].dispose();
    p.halos[room].dispose();
    p.plates[room].material.map?.dispose();
    p.plates[room].material.dispose();
  }
  p.title.material.map?.dispose();
  p.title.material.dispose();
  p.glow.dispose();
  p.roof.dispose();
}

/**
 * A lit pane is drawn WITHOUT tone mapping and its room colour comes mostly from the emissive glow
 * (diffuse at this strength): under the bright-day light and the scene's filmic tone mapping the
 * same colour came out as a dull cream. `EMISSIVE_GAIN` scales boardTimeline's glow (steady 0.55,
 * sparkle 1) into the emissive intensity — the steady glow is just under full colour, the sparkle
 * pushes past it (a white-hot flash).
 */
const LIT_DIFFUSE = 0.35;
const EMISSIVE_GAIN = 1.5;

/** The pane's look for a lit / unlit window at a glow strength. */
function paintPane(m: MeshStandardMaterial, room: RoomId, lit: boolean, glow: number): void {
  if (m.toneMapped === lit) {
    m.toneMapped = !lit;
    m.needsUpdate = true; // the tone-mapping switch is part of the shader program
  }
  if (lit) m.color.set(WINDOW_COLORS[room]).multiplyScalar(LIT_DIFFUSE);
  else m.color.set(UNLIT_COLOR);
  m.opacity = lit ? 0.96 : 0.88;
  m.emissiveIntensity = lit ? glow * EMISSIVE_GAIN : 0;
}

export function ProgressBoard() {
  const litRooms = useClassStore((s) => s.litRooms);
  const parts = useMemo(makeParts, []);
  useEffect(() => () => disposeParts(parts), [parts]);

  // The meshes the frame loop scales (pane pop, halo swell), by room.
  const paneMeshes = useRef<Partial<Record<RoomId, Mesh>>>({});
  const haloMeshes = useRef<Partial<Record<RoomId, Mesh>>>({});
  const flash = useRef<BoardFlash>({ glow: 1, halo: 0, haloScale: 1, pop: 1 }).current;
  // The first lit set after mounting is "old news": no sparkle for it.
  const first = useRef(true);
  // Windows with a sparkle running: the frame loop skips all work while this is 0.
  const running = useRef(0);

  useEffect(() => {
    const now = performance.now();
    for (const room of ROOM_IDS) {
      const st = parts.states[room];
      const lit = litRooms.includes(room);
      if (lit === st.lit) continue;
      st.lit = lit;
      if (lit && !first.current) {
        st.flashAt = now;
        running.current++;
        paintPane(parts.panes[room], room, true, 1);
      } else {
        if (!Number.isNaN(st.flashAt)) running.current--;
        st.flashAt = Number.NaN;
        paintPane(parts.panes[room], room, lit, STEADY_LIT_GLOW);
        parts.halos[room].opacity = 0;
        paneMeshes.current[room]?.scale.setScalar(1);
      }
    }
    first.current = false;
  }, [litRooms, parts]);

  useFrame(() => {
    if (running.current === 0) return;
    const now = performance.now();
    for (const room of ROOM_IDS) {
      const st = parts.states[room];
      if (Number.isNaN(st.flashAt)) continue;
      const elapsed = now - st.flashAt;
      boardFlash(elapsed, flash);
      parts.panes[room].emissiveIntensity = flash.glow * EMISSIVE_GAIN;
      parts.halos[room].opacity = flash.halo;
      haloMeshes.current[room]?.scale.setScalar(flash.haloScale);
      paneMeshes.current[room]?.scale.setScalar(flash.pop);
      if (elapsed >= BOARD_FLASH_MS) {
        st.flashAt = Number.NaN;
        running.current--;
      }
    }
  });

  const bodyH = PANEL_H;
  const panelY = PODIUM_H + bodyH / 2;
  const bandY = PODIUM_H + bodyH + BAND_H / 2;
  const roofY = PODIUM_H + bodyH + BAND_H;

  return (
    <group>
      {/* The podium (the collision footprint). */}
      <mesh position={[CX, PODIUM_H / 2, CZ]} castShadow receiveShadow>
        <boxGeometry args={[WIDTH, PODIUM_H, DEPTH]} />
        <meshStandardMaterial color={COLOR_PODIUM} roughness={0.8} />
      </mesh>
      {/* The facade. */}
      <mesh position={[CX, panelY, PANEL_Z]} castShadow receiveShadow>
        <boxGeometry args={[PANEL_W, bodyH, PANEL_D]} />
        <meshStandardMaterial color={COLOR_WALL} roughness={0.9} />
      </mesh>
      {/* The title band under the roof. */}
      <mesh position={[CX, bandY, PANEL_Z]} castShadow>
        <boxGeometry args={[PANEL_W + 0.2, BAND_H, PANEL_D + 0.1]} />
        <meshStandardMaterial color={COLOR_BAND} roughness={0.6} />
      </mesh>
      <mesh position={[CX, bandY, PANEL_FRONT + 0.06]} material={parts.title.material}>
        <planeGeometry args={[(BAND_H - 0.08) * parts.title.aspect, BAND_H - 0.08]} />
      </mesh>
      {/* The roof, with a clock in the gable. */}
      <mesh position={[CX, roofY, PANEL_Z]} geometry={parts.roof} castShadow>
        <meshStandardMaterial color={COLOR_ROOF} roughness={0.55} />
      </mesh>
      <mesh position={[CX, roofY + 0.27, PANEL_Z + ROOF_D / 2 + 0.005]}>
        <circleGeometry args={[0.17, 28]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh position={[CX, roofY + 0.27, PANEL_Z + ROOF_D / 2 + 0.01]}>
        <ringGeometry args={[0.13, 0.17, 28]} />
        <meshBasicMaterial color="#F1C453" />
      </mesh>

      {ROOM_IDS.map((room, i) => {
        const x = CX + (i - (ROOM_IDS.length - 1) / 2) * WINDOW_GAP;
        const plate = parts.plates[room];
        return (
          <group key={room} position={[x, 0, 0]}>
            {/* The window frame, the pane (it pops when it lights up) and the sparkle halo. */}
            <mesh position={[0, PANE_Y, PANEL_FRONT + 0.02]}>
              <boxGeometry args={[PANE_W + FRAME_PAD * 2, PANE_H + FRAME_PAD * 2, 0.05]} />
              <meshStandardMaterial color={COLOR_FRAME} roughness={0.7} />
            </mesh>
            <mesh
              ref={(m) => {
                if (m) paneMeshes.current[room] = m;
              }}
              position={[0, PANE_Y, PANEL_FRONT + 0.06]}
              material={parts.panes[room]}
            >
              <boxGeometry args={[PANE_W, PANE_H, 0.04]} />
            </mesh>
            <mesh
              ref={(m) => {
                if (m) haloMeshes.current[room] = m;
              }}
              position={[0, PANE_Y, PANEL_FRONT + 0.12]}
              material={parts.halos[room]}
              renderOrder={5}
            >
              <planeGeometry args={[PANE_W * 1.5, PANE_H * 1.5]} />
            </mesh>
            {/* The room's name under the window. */}
            <mesh position={[0, PLATE_Y, PANEL_FRONT + 0.015]} material={plate.material}>
              <planeGeometry args={[PLATE_W, PLATE_H]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
