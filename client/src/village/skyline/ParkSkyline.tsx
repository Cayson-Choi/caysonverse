/**
 * The 케이슨랜드 skyline in the village (2026-11-19): a light distant view of the park behind the south gate, so a visitor sees the coaster,
 * the wheel, the carousel and the gate castle without entering. Geometry: skylineGeometry.ts; place: skylinePlacement.ts.
 *
 *  - Built lazily: only once the village is dressed (AfterDressed in VillageScene) AND the outer ground exists, in a timer of its own, then
 *    its programs are compiled with compileSafely (the night-only bulbs included) before the first frame that shows it.
 *  - Alive on the real clocks: the wheel, the coaster's train and the carousel's canopy take their angles from the shared deterministic
 *    functions with `villageClock.liveMs()` (the same numbers the park draws), so what you see from the village is what the ride is doing.
 *  - Night: the bulbs' halos follow `dayNight.applied.lights`; the unlit surfaces follow the land's tint (the same function the ridges use),
 *    with a faint lamp glow on the paving and the lit wheel.
 *  - Not part of the world: no collider, no click target (every raycast is a no-op), no shadows. It is only mounted in the village area, so it
 *    is gone while the player is inside the park (where the real park is drawn).
 */
import { useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  type Object3D,
} from "three";
import { COASTER_CARS, carArc, coasterAt, emptyFrame, frameAt, type CoasterState } from "@caysonverse/shared/land/coaster";
import { WHEEL_HUB_Y, WHEEL_N, WHEEL_SITE, wheelAt, wheelPivot, wheelSway, type WheelState } from "@caysonverse/shared/land/wheel";
import { carouselAt, type CarouselState } from "@caysonverse/shared/land/carousel";
import { compileSafely } from "../../game/compileSafely";
import { dayNight } from "../dayNightDriver";
import { mountainLandTint } from "../mountains";
import { villageClock } from "../villageClock";
import { getOuterGround, type OuterGround } from "../outerGround";
import type { VillageTier } from "../villageModelPrep";
import { buildSkyline, type SkylineBuild } from "./skylineGeometry";
import { skylineMode, skylinePlacement } from "./skylinePlacement";

declare global {
  interface Window {
    /** Dev-only: the skyline's numbers (triangles, draw calls, world bounds). */
    __cvSkyline?: () => { triangles: number; drawCalls: number; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } } | null;
  }
}

/** Unlit surfaces are tone-mapped darker than the lit village; this lifts them to read like the lawn next to them (measured on the shots). */
const BRIGHT = 1.25;
/** How much of the sky's haze colour the skyline takes on (the distance between the village's fog and the ridges' own haze). */
const HAZE = 0.12;
const NIGHT_LAMP_GLOW: readonly [number, number, number] = [0.1, 0.085, 0.07];

const hazeUniforms = { uHazeColor: { value: new Color(0.7, 0.8, 0.9) }, uHaze: { value: HAZE } };

function patchHaze(m: MeshBasicMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHazeColor = hazeUniforms.uHazeColor;
    shader.uniforms.uHaze = hazeUniforms.uHaze;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uHazeColor;\nuniform float uHaze;")
      .replace("#include <fog_fragment>", "#include <fog_fragment>\n  gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, uHaze );");
  };
  m.customProgramCacheKey = () => "skyline-haze";
}

function haloTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const noRaycast = (): void => {};
function inert(o: Object3D): void {
  o.raycast = noRaycast;
  o.castShadow = false;
  o.receiveShadow = false;
}

interface Built {
  root: Group;
  rotor: Group;
  carousel: Mesh;
  gondolas: InstancedMesh;
  train: InstancedMesh;
  wheelPoints: Points;
  staticPoints: Points;
  matStatic: MeshBasicMaterial;
  matGlow: MeshBasicMaterial;
  halo: PointsMaterial[];
  build: SkylineBuild;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  dispose(): void;
}

function pointsOf(positions: Float32Array, mat: PointsMaterial): Points {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const p = new Points(g, mat);
  p.frustumCulled = false;
  p.renderOrder = 6;
  return p;
}

function make(tier: VillageTier, ground: OuterGround): Built {
  const placement = skylinePlacement(ground.heightAt);
  const build = buildSkyline(tier === "high" ? "high" : "low", placement.groundLocal);
  const root = new Group();
  root.name = "park_skyline";
  root.matrixAutoUpdate = false;
  root.matrix.set(...placement.elements);
  root.matrixWorldNeedsUpdate = true;

  const matStatic = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  matStatic.name = "M_skyline";
  patchHaze(matStatic);
  const matGlow = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  matGlow.name = "M_skyline_lit";
  patchHaze(matGlow);
  const halo = haloTexture();
  const mkHalo = (size: number, color: string): PointsMaterial =>
    new PointsMaterial({ map: halo, color, size, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false });
  const haloWheel = mkHalo(2.4, "#ffc873");
  const haloStatic = mkHalo(1.5, "#ffc070");

  const staticMesh = new Mesh(build.staticGeo, matStatic);
  staticMesh.name = "skyline_static";
  const rotor = new Group();
  rotor.position.set(WHEEL_SITE.x, WHEEL_HUB_Y, WHEEL_SITE.z);
  const rotorMesh = new Mesh(build.rotorGeo, matGlow);
  rotorMesh.name = "skyline_rotor";
  const wheelPoints = pointsOf(build.wheelBulbs, haloWheel);
  rotor.add(rotorMesh, wheelPoints);

  const gondolas = new InstancedMesh(build.gondolaGeo, matGlow, WHEEL_N);
  gondolas.name = "skyline_gondolas";
  gondolas.frustumCulled = false;
  const tmpC = new Color();
  build.gondolaColors.forEach((c, i) => gondolas.setColorAt(i, tmpC.setRGB(c[0], c[1], c[2])));
  if (gondolas.instanceColor) gondolas.instanceColor.needsUpdate = true;

  const train = new InstancedMesh(build.trainGeo, matStatic, COASTER_CARS);
  train.name = "skyline_train";
  train.frustumCulled = false;

  const carousel = new Mesh(build.carouselGeo, matStatic);
  carousel.name = "skyline_carousel";
  carousel.position.set(build.carouselAt[0], build.carouselAt[1], build.carouselAt[2]);
  const staticPoints = pointsOf(build.staticBulbs, haloStatic);

  root.add(staticMesh, rotor, gondolas, train, carousel, staticPoints);
  root.traverse(inert);
  // groups keep their matrix auto-update (the rotor turns); the root's matrix is the placement
  root.matrixAutoUpdate = false;

  const b = placement.worldBounds;
  return {
    root,
    rotor,
    carousel,
    gondolas,
    train,
    wheelPoints,
    staticPoints,
    matStatic,
    matGlow,
    halo: [haloWheel, haloStatic],
    build,
    bounds: b,
    dispose() {
      for (const g of [build.staticGeo, build.rotorGeo, build.gondolaGeo, build.trainGeo, build.carouselGeo, wheelPoints.geometry, staticPoints.geometry]) g.dispose();
      matStatic.dispose();
      matGlow.dispose();
      haloWheel.dispose();
      haloStatic.dispose();
      halo.dispose();
      gondolas.dispose();
      train.dispose();
    },
  };
}

const wheelSt: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 };
const coasterSt: CoasterState = { cycle: 0, phase: 0, status: "boarding", s: 0, departsInMs: 0 };
const carouselSt: CarouselState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, rideT: 0, departsInMs: 0 };
const piv = { x: 0, y: 0, z: 0 };
const m4 = new Matrix4();
const frame = emptyFrame();
const tint: [number, number, number] = [1, 1, 1];

export function ParkSkyline({ tier }: { tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [ground, setGround] = useState<OuterGround | null>(() => getOuterGround());
  const [built, setBuilt] = useState<Built | null>(null);
  const [ready, setReady] = useState(false);

  // the outer ground is built with the mountains (their own Suspense): wait for it
  useEffect(() => {
    if (skylineMode() === "off") return;
    const t = window.setInterval(() => {
      // once the ground has been seen the skyline keeps its own copy of the heights (the ground is rebuilt when the lake draws; the
      // skyline must not blink out and rebuild then)
      setGround((prev) => prev ?? getOuterGround());
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // build once the ground exists, in a timer of its own (never inside the frame that dresses the village)
  useEffect(() => {
    if (!ground || skylineMode() === "off") return;
    let cancelled = false;
    let b: Built | null = null;
    const t = window.setTimeout(() => {
      try {
        b = make(tier, ground);
      } catch (e) {
        if (import.meta.env.DEV) console.error("skyline build failed", e);
        return;
      }
      if (!cancelled) setBuilt(b);
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      b?.dispose();
      setBuilt(null);
      setReady(false);
    };
  }, [ground, tier]);

  // compile every program (the bulbs' too: they are invisible by day) before the skyline's first frame
  useEffect(() => {
    if (!built) return;
    let dead = false;
    built.wheelPoints.visible = true;
    built.staticPoints.visible = true;
    void compileSafely(gl, built.root, camera).then(() => {
      if (!dead) setReady(true);
    });
    return () => {
      dead = true;
    };
  }, [built, gl, camera]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvSkyline = () => (built ? { triangles: built.build.triangles, drawCalls: built.build.drawCalls, bounds: built.bounds } : null);
    return () => {
      delete window.__cvSkyline;
    };
  }, [built]);

  useEffect(() => () => built?.dispose(), [built]);

  useFrame(() => {
    if (!built || !ready) return;
    const s = dayNight.applied;
    const lights = s.lights;
    mountainLandTint(s, tint);
    const lamp = Math.min(1, lights);
    built.matStatic.color.setRGB(
      tint[0] * BRIGHT + NIGHT_LAND_GLOW(lamp, 0),
      tint[1] * BRIGHT + NIGHT_LAND_GLOW(lamp, 1),
      tint[2] * BRIGHT + NIGHT_LAND_GLOW(lamp, 2),
    );
    // the wheel and its cabins are lit at night: a floor of their own light
    const litK = 0.09 + 0.2 * lamp;
    built.matGlow.color.setRGB(Math.max(tint[0] * BRIGHT, litK * 1.15), Math.max(tint[1] * BRIGHT, litK), Math.max(tint[2] * BRIGHT, litK * 0.8));
    // the haze: the sky's horizon colour, a little less of it at night
    const fogColor = scene.fog?.color;
    if (fogColor) hazeUniforms.uHazeColor.value.copy(fogColor);
    else hazeUniforms.uHazeColor.value.setRGB(s.sky[0], s.sky[1], s.sky[2]);
    hazeUniforms.uHaze.value = HAZE * (1 - 0.5 * s.night);
    const o = Math.min(1, lights);
    for (const h of built.halo) h.opacity = o * 0.9;
    built.wheelPoints.visible = built.staticPoints.visible = o > 0.01;

    const now = villageClock.liveMs();
    // the wheel: the rotor turns clockwise seen from the south; the cabins hang upright and swing with the real acceleration
    wheelAt(now, wheelSt);
    built.rotor.rotation.z = -wheelSt.angle;
    for (let g = 0; g < WHEEL_N; g++) {
      wheelPivot(g, wheelSt.angle, piv);
      const sw = wheelSway(g, wheelSt);
      const c = Math.cos(sw);
      const sn = Math.sin(sw);
      m4.set(c, -sn, 0, piv.x, sn, c, 0, piv.y, 0, 0, 1, piv.z, 0, 0, 0, 1);
      built.gondolas.setMatrixAt(g, m4);
    }
    built.gondolas.instanceMatrix.needsUpdate = true;
    // the coaster's one train
    coasterAt(now, coasterSt);
    for (let i = 0; i < COASTER_CARS; i++) {
      frameAt(built.build.track, carArc(coasterSt.s, i), frame);
      m4.set(-frame.rx, frame.ux, frame.tx, frame.x, -frame.ry, frame.uy, frame.ty, frame.y, -frame.rz, frame.uz, frame.tz, frame.z, 0, 0, 0, 1);
      built.train.setMatrixAt(i, m4);
    }
    built.train.instanceMatrix.needsUpdate = true;
    // the carousel's canopy
    carouselAt(now, carouselSt);
    built.carousel.rotation.y = -carouselSt.angle;
  });

  if (!built || !ready) return null;
  return <primitive object={built.root} dispose={null} />;
}

/** The lamps' faint light on the unlit surfaces at night (paving, gate, carousel). */
function NIGHT_LAND_GLOW(lamp: number, ch: 0 | 1 | 2): number {
  return NIGHT_LAMP_GLOW[ch] * lamp;
}
