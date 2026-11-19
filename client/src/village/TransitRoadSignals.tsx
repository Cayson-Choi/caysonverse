import { versionedUrl } from "./modelUrl";
import { Suspense, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { BoxGeometry, CanvasTexture, Color, Group, Mesh as ThreeMesh, MeshStandardMaterial as StdMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture } from "three";
import { projectMetreUV } from "../land/parkShapes";
import { signalPoleSpots } from "@caysonverse/shared/village/crossings";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { transitNowMs } from "../net/transitSync";
import { mergeStaticByMaterial } from "./mergeStatic";
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
export const SIGNALS_MODEL_URL = versionedUrl("/models/village/village_signals.glb");

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

/** The signal heads' housings (M_sig_black): a flat near-black in the file. Powder-coated graphite steel with orange-peel relief. */
const SIG_PAINT_URLS = ["/textures/park/PaintedMetal013_n.webp", "/textures/park/PaintedMetal013_r.webp"] as const;

/** A small sticker (canvas): a yellow service label with a bar code. */
function stickerTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2c63a";
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 148);
  ctx.fillStyle = "#1c1c1c";
  ctx.font = "bold 40px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("신호 제어", 128, 54);
  ctx.font = "22px 'Noto Sans KR', sans-serif";
  ctx.fillText("SIGNAL  CTRL  24h", 128, 84);
  for (let i = 0; i < 34; i++) ctx.fillRect(34 + i * 5.8, 100, 1.5 + (i * 7) % 3, 38);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Louvred vents and a sticker on the pedestrian head's housing (local to the unit: x -0.77..0.12, y 2.09..3.39, z -0.61..0.12). */
function cabinetDetail(): Group {
  const g = new Group();
  g.name = "sig_cabinet_detail";
  const dark = new StdMaterial({ color: "#14171b", roughness: 0.55, metalness: 0.3 });
  const slat = new BoxGeometry(0.012, 0.022, 0.36);
  const slatB = new BoxGeometry(0.36, 0.022, 0.012);
  const frameW = new BoxGeometry(0.016, 0.3, 0.42);
  const frameB = new BoxGeometry(0.42, 0.3, 0.016);
  const west = new ThreeMesh(frameW, dark);
  west.position.set(-0.774, 2.5, -0.25);
  const back = new ThreeMesh(frameB, dark);
  back.position.set(-0.33, 2.5, 0.124);
  const east = new ThreeMesh(frameW, dark);
  east.position.set(0.124, 2.5, -0.25);
  g.add(west, back, east);
  const slatMat = new StdMaterial({ color: "#2b3036", roughness: 0.5, metalness: 0.35 }); // one material for all slats: they merge into one draw
  for (let i = 0; i < 9; i++) {
    const w = new ThreeMesh(slat, slatMat);
    w.position.set(-0.784, 2.37 + i * 0.033, -0.25);
    w.rotation.z = 0.35;
    const b = new ThreeMesh(slatB, w.material);
    b.position.set(-0.33, 2.37 + i * 0.033, 0.134);
    b.rotation.x = -0.35;
    const e = new ThreeMesh(slat, w.material);
    e.position.set(0.134, 2.37 + i * 0.033, -0.25);
    e.rotation.z = -0.35;
    g.add(w, b, e);
  }
  const tex = stickerTexture();
  const sticker = new ThreeMesh(new PlaneGeometry(0.26, 0.162), new StdMaterial({ map: tex, roughness: 0.4 }));
  sticker.position.set(-0.7745, 3.02, -0.25);
  sticker.rotation.y = -Math.PI / 2;
  g.add(sticker);
  g.userData.dispose = () => tex.dispose();
  return g;
}

function SignalUnits() {
  const gltf = useGLTF(SIGNALS_MODEL_URL, DRACO_PATH);
  // housings: graphite painted steel with relief, UVs in metres (the file has none)
  useMemo(() => {
    const loader = new TextureLoader();
    const prep = (t: Texture) => {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 4;
      return t;
    };
    const normal = prep(loader.load(SIG_PAINT_URLS[0]));
    const rough = prep(loader.load(SIG_PAINT_URLS[1]));
    const paint = new StdMaterial({ name: "M_sig_black", color: new Color("#4b525b"), roughness: 0.62, metalness: 0.05, normalMap: normal, normalScale: new Vector2(0.5, 0.5), roughnessMap: rough, side: 2 });
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !/sig_black/.test(mesh.name) || (mesh.userData as { cvPainted?: boolean }).cvPainted) return;
      mesh.geometry = projectMetreUV(mesh.geometry, 0.6);
      mesh.material = paint;
      (mesh.userData as { cvPainted?: boolean }).cvPainted = true;
    });
  }, [gltf]);
  const detail = useMemo(cabinetDetail, []);
  const spots = useMemo(() => signalPoleSpots(), []);
  // One template, its parts merged per material (perf/phone-village: the units were 80+ tiny draws in view), cloned per crossing corner
  // (the clones share the merged geometry and the shared lamp materials).
  const template = useMemo(() => {
    const t = gltf.scene.clone(true);
    t.add(detail.clone(true));
    t.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = /sig_zinc|sig_black/.test(mesh.name);
    });
    mergeStaticByMaterial(t);
    return t;
  }, [gltf, detail]);
  const units = useMemo(() => spots.map(() => template.clone(true)), [template, spots]);
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
