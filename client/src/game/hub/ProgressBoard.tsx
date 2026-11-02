import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, Color, MeshBasicMaterial, type Mesh } from "three";
import { ROOM_IDS, type RoomId } from "@caysonverse/shared/escape/constants";
import { canvas2d, canvasTexture } from "../spriteCanvas";
import { useClassStore } from "../../stores/classStore";
import { BOARD_FLASH_MS, STEADY_LIT_GLOW, WINDOW_COLORS, boardFlash, type BoardFlash } from "./boardTimeline";
import { useHubNodes } from "./HubModel";
import type { WindowNode } from "./hubModelPrep";

/**
 * The school-model progress board on the central hall's north wall (AI 학교 탈출, Task 16, driven from the model in
 * Task 23): hub.glb's little school front has one window per classroom — the nodes `board_window__<RoomId>`, seven
 * panes, west rooms on the left wing and east rooms on the right. A window the class has not cleared is the model's
 * pale glass; a room in `litRooms` (some team escaped it) is bright in its own colour, and a window that lights up
 * WHILE you watch sparkles for a moment (boardTimeline.ts: a glow that settles, a halo that swells and fades, a small
 * pop). Rooms already lit when the hall appears are simply lit — no sparkle for old news.
 *
 * The board's title ("AI 학교 탈출") is a runtime label on the model's blank plate (HubSigns). Each pane has its own
 * material (hubModelPrep.ts clones it per room), so one room's colour never reaches its neighbours. This component reads
 * only discrete class state (`litRooms`). Per frame it touches nothing unless a sparkle is running, and then only
 * writes numbers into materials and a reused `BoardFlash` — no allocation.
 */

/** The halo hangs this far (m) in front of its pane (the window frames stand about 8 cm out of the wall). */
const HALO_OUT = 0.12;
const HALO_W = 0.75;
const HALO_H = 0.93;

/**
 * A lit pane is drawn WITHOUT tone mapping and its colour comes from the room's bright colour at a strength that
 * follows the glow: under the bright-day light and the scene's filmic tone mapping the same colour came out as a
 * dull cream. The strength is `LIT_BASE + GAIN * glow` (boardTimeline's glow: steady 0.55 → a little over full colour,
 * the sparkle's 1 → past it, a white-hot flash).
 */
const LIT_BASE = 0.35;
const GLOW_GAIN = 1.5;

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

/** The numbers of one window the frame loop and the lit-state effect share. */
interface WindowState {
  lit: boolean;
  /** performance.now() when the sparkle started; NaN = none running. */
  flashAt: number;
}

/** What the board makes itself (once per mount, released with it): the halos. */
interface BoardParts {
  halos: Record<RoomId, MeshBasicMaterial>;
  glow: CanvasTexture;
  states: Record<RoomId, WindowState>;
  /** Each room's lit colour as a `Color`, made once: the sparkle loop copies it (`Color.set(hex string)` allocates). */
  colors: Record<RoomId, Color>;
}

function makeParts(): BoardParts {
  const glow = glowTexture();
  const halos = {} as Record<RoomId, MeshBasicMaterial>;
  const states = {} as Record<RoomId, WindowState>;
  const colors = {} as Record<RoomId, Color>;
  for (const room of ROOM_IDS) {
    colors[room] = new Color(WINDOW_COLORS[room]);
    halos[room] = new MeshBasicMaterial({
      map: glow,
      color: WINDOW_COLORS[room],
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    states[room] = { lit: false, flashAt: Number.NaN };
  }
  return { halos, glow, states, colors };
}

function disposeParts(p: BoardParts): void {
  for (const room of ROOM_IDS) p.halos[room].dispose();
  p.glow.dispose();
}

/** The pane's look for a lit / unlit window at a glow strength. */
function paintPane(w: WindowNode, room: RoomId, lit: boolean, glow: number): void {
  const m = w.material;
  if (m.toneMapped === lit) {
    m.toneMapped = !lit;
    m.needsUpdate = true; // the tone-mapping switch is part of the shader program
  }
  if (lit) m.color.set(WINDOW_COLORS[room]).multiplyScalar(LIT_BASE + GLOW_GAIN * glow);
  else m.color.copy(w.unlit);
}

export function ProgressBoard() {
  const { windows } = useHubNodes();
  const litRooms = useClassStore((s) => s.litRooms);
  const parts = useMemo(makeParts, []);
  useEffect(() => () => disposeParts(parts), [parts]);

  // The halo meshes the frame loop scales, by room.
  const haloMeshes = useRef<Partial<Record<RoomId, Mesh>>>({});
  const flash = useRef<BoardFlash>({ glow: 1, halo: 0, haloScale: 1, pop: 1 }).current;
  // The first lit set after mounting is "old news": no sparkle for it.
  const first = useRef(true);
  // Windows with a sparkle running: the frame loop skips all work while this is 0.
  const running = useRef(0);

  useEffect(() => {
    const now = performance.now();
    for (const room of ROOM_IDS) {
      const w = windows[room];
      if (!w) continue;
      const st = parts.states[room];
      const lit = litRooms.includes(room);
      if (lit === st.lit) continue; // (the model's glass is the unlit look already)
      st.lit = lit;
      if (lit && !first.current) {
        st.flashAt = now;
        running.current++;
        paintPane(w, room, true, 1);
      } else {
        if (!Number.isNaN(st.flashAt)) running.current--;
        st.flashAt = Number.NaN;
        paintPane(w, room, lit, STEADY_LIT_GLOW);
        parts.halos[room].opacity = 0;
        w.mesh.scale.setScalar(1);
      }
    }
    first.current = false;
  }, [litRooms, parts, windows]);

  useFrame(() => {
    if (running.current === 0) return;
    const now = performance.now();
    for (const room of ROOM_IDS) {
      const st = parts.states[room];
      const w = windows[room];
      if (Number.isNaN(st.flashAt) || !w) continue;
      const elapsed = now - st.flashAt;
      boardFlash(elapsed, flash);
      w.material.color.copy(parts.colors[room]).multiplyScalar(LIT_BASE + GLOW_GAIN * flash.glow);
      parts.halos[room].opacity = flash.halo;
      haloMeshes.current[room]?.scale.setScalar(flash.haloScale);
      w.mesh.scale.setScalar(flash.pop);
      if (elapsed >= BOARD_FLASH_MS) {
        st.flashAt = Number.NaN;
        running.current--;
      }
    }
  });

  return (
    <group>
      {ROOM_IDS.map((room) => {
        const w = windows[room];
        if (!w) return null;
        const p = w.mesh.position;
        return (
          <mesh
            key={room}
            ref={(m) => {
              if (m) haloMeshes.current[room] = m;
            }}
            position={[p.x, p.y, p.z + HALO_OUT]}
            material={parts.halos[room]}
            renderOrder={5}
          >
            <planeGeometry args={[HALO_W, HALO_H]} />
          </mesh>
        );
      })}
    </group>
  );
}
