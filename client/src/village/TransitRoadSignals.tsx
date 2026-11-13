import { Suspense, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { CanvasTexture, Color, SRGBColorSpace, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { signalPoleSpots } from "@caysonverse/shared/village/crossings";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { transitNowMs } from "../net/transitSync";
import { lampKey, lampsAt, type LampState } from "./signalLamps";

/**
 * The two crossings' signal units (`village_signals.glb`, art/village/tools/build_signals.py): a galvanised post with a
 * cantilever arm, a horizontal red/amber/green head over the lane facing the approaching bus, and a vertical
 * pedestrian head (red standing figure, green walking figure, count-down display) facing across the road. Two units
 * per crossing, on diagonal corners (shared/village/crossings.ts), all four sharing one set of lamp materials: the
 * lamps are the file's separate meshes (lens_red/amber/green, ped_fig_stop/walk, countdown_screen), so a state is
 * a few material writes. The states follow the shared cycle (transit.ts signalAt / pedestrianSignalAt) on the
 * server's clock as the bus snapshots carry it (transitSync.ts transitNowMs), the clock the bus itself runs on.
 *
 * DEV only: `window.__cvSignals = { vehicle, ped }` forces the lamps (screenshots of every state); unset it to
 * go back to the clock.
 */
export const SIGNALS_MODEL_URL = "/models/village/village_signals.glb";

declare global {
  interface Window {
    /** Dev-only: force the crosswalk lamps. Absent in production builds. */
    __cvSignals?: { vehicle?: "green" | "amber" | "red"; ped?: "walk" | "flashing" | "stop" } | null;
  }
}

// review r2: lit lenses read pale pink / mint by day (the emissive was over-exposed by the tone mapping). A real LED head is a deep,
// saturated red / amber / green, so a lit lens also takes the colour as its base and the emissive is gentler.
const LIT = {
  red: "#ff1420",
  amber: "#ff8c00",
  green: "#00d46a",
  pedStop: "#ff1f28",
  pedWalk: "#18e07a",
};
const LAMP_ON = 0.6;
const LAMP_OFF = 0;
/**
 * An unlit lens (review r2: the model's dark red / brown / dark green read as colours from afar, so on and off were hard
 * to tell apart, the off amber a brown lump). A real LED head's off lens is all but black, with a faint tint of its colour
 * by day (reference photos c07, c08).
 */
const UNLIT = {
  red: "#1d0b0c",
  amber: "#1d150a",
  green: "#0a1a12",
  pedStop: "#1d0b0c",
  pedWalk: "#0a1a12",
};

interface Lamps {
  red: MeshStandardMaterial;
  amber: MeshStandardMaterial;
  green: MeshStandardMaterial;
  pedStop: MeshStandardMaterial;
  pedWalk: MeshStandardMaterial;
  count: MeshStandardMaterial;
}

function lampMaterials(root: Object3D): Lamps | null {
  const found: Record<string, MeshStandardMaterial> = {};
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined;
    if (m && "emissive" in m && /^M_(lens_(red|amber|green)|ped_(stop|walk)|countdown)$/.test(m.name)) found[m.name] = m as MeshStandardMaterial;
  });
  const need = ["M_lens_red", "M_lens_amber", "M_lens_green", "M_ped_stop", "M_ped_walk", "M_countdown"];
  if (need.some((n) => !found[n])) return null;
  return {
    red: found["M_lens_red"]!,
    amber: found["M_lens_amber"]!,
    green: found["M_lens_green"]!,
    pedStop: found["M_ped_stop"]!,
    pedWalk: found["M_ped_walk"]!,
    count: found["M_countdown"]!,
  };
}

function setLamp(m: MeshStandardMaterial, color: string, unlit: string, on: boolean): void {
  m.emissive.set(color);
  m.emissiveIntensity = on ? LAMP_ON : LAMP_OFF;
  // lit: the light is the emissive alone (a lit LED's own colour); the lens's base colour and the sky's reflection on it
  // stay near black, else daylight washed the red to salmon and the amber to peach (review r2, phone and PC)
  if (on) m.color.set(color).multiplyScalar(0.06);
  else m.color.set(unlit);
}

/** Draw the count-down digits into the display's canvas (green while walking, red while waiting). */
function drawCountdown(ctx: CanvasRenderingContext2D, tex: CanvasTexture, seconds: number, color: "green" | "red"): void {
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = color === "green" ? "#45ff96" : "#ff4a3a";
  ctx.font = "bold 88px 'Noto Sans KR', 'Arial Black', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.min(99, seconds)), 64, 70);
  tex.needsUpdate = true;
}

function apply(l: Lamps, s: LampState, ctx: CanvasRenderingContext2D | null, tex: CanvasTexture | null): void {
  setLamp(l.red, LIT.red, UNLIT.red, s.vehicle === "red");
  setLamp(l.amber, LIT.amber, UNLIT.amber, s.vehicle === "amber");
  setLamp(l.green, LIT.green, UNLIT.green, s.vehicle === "green");
  setLamp(l.pedStop, LIT.pedStop, UNLIT.pedStop, s.stopLit);
  setLamp(l.pedWalk, LIT.pedWalk, UNLIT.pedWalk, s.walkLit);
  if (ctx && tex) drawCountdown(ctx, tex, s.countdown.seconds, s.countdown.color);
}

function SignalUnits() {
  const gltf = useGLTF(SIGNALS_MODEL_URL, DRACO_PATH);
  const spots = useMemo(() => signalPoleSpots(), []);
  const units = useMemo(
    () =>
      spots.map(() => {
        const u = gltf.scene.clone(true);
        u.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh) mesh.castShadow = /sig_zinc|sig_black/.test(mesh.name);
        });
        return u;
      }),
    [gltf, spots],
  );
  const lamps = useMemo(() => lampMaterials(gltf.scene), [gltf]);
  const display = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = false; // glTF UVs run from the top, like the file's own textures
    return { ctx, tex };
  }, []);
  const last = useMemo(() => ({ key: "" }), []);
  useEffect(() => {
    if (!lamps) return;
    lamps.count.color = new Color("#ffffff");
    if (display) {
      lamps.count.map = display.tex;
      lamps.count.emissiveMap = display.tex;
      lamps.count.emissive = new Color("#ffffff");
      lamps.count.emissiveIntensity = 1.3;
      lamps.count.needsUpdate = true;
    }
    last.key = "";
    return () => {
      lamps.count.map = null;
      lamps.count.emissiveMap = null;
      lamps.count.needsUpdate = true;
      display?.tex.dispose();
    };
  }, [lamps, display, last]);
  useFrame(() => {
    if (!lamps) return;
    const override = import.meta.env.DEV ? window.__cvSignals : null;
    const state = lampsAt(transitNowMs(), override);
    const key = lampKey(state);
    if (key === last.key) return;
    last.key = key;
    apply(lamps, state, display?.ctx ?? null, display?.tex ?? null);
  });
  return (
    <group name="village-crosswalk-signals">
      {units.map((u, i) => (
        <primitive key={`${spots[i]!.crossing}-${spots[i]!.pole}`} object={u} position={[spots[i]!.x, 0, spots[i]!.z]} rotation-y={spots[i]!.yaw} dispose={null} />
      ))}
    </group>
  );
}

/** Crosswalk signal posts of the ring road (a failed or slow model is no signals: the village never waits for it). */
export function TransitRoadSignals() {
  return (
    <Suspense fallback={null}>
      <SignalUnits />
    </Suspense>
  );
}
