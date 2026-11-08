import { Suspense, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import {
  DataTexture,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import { VILLAGE_LAYOUT, type CubbyAnchor } from "@caysonverse/shared/village/villageLayout";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { buildCubbyPropMeshes, layoutCubbyProps, makePhotoMaterial, placementMatrix } from "./cubbyProps";
import { burningCandles, candleClock, clearCandles, pruneCandles } from "./hallCandles";
import { MEMORIAL_LIGHTMAP_URL, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeMemorial, prepareMemorial } from "./memorialModelPrep";
import { holdMemorialFiles, noteMemorialLoaded } from "./memorialRelease";
import { HALL_CUBBY_ANCHORS, SAMPLE_CUBBIES, SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";
import { DoorPad, HallRoom } from "./VillageHall";

declare global {
  interface Window {
    /** Dev-only: the dressed memorial hall (draw calls, props, candles) for the e2e checks. */
    __cvHall?: () => { meshes: number; instanced: number; props: Record<string, number>; candles: string[]; samples: number };
  }
}

/** At most this many candles burn at once in one client's hall (60 s each; one per visitor per 5 s). */
export const MAX_CANDLES = 64;

/** Where a lit candle stands in its cubby (the cubby's frame, cubbyProps.ts): front right, clear of the name card. */
export const CANDLE_SPOT = { u: 0.155, w: 0.035, dy: 0, turn: 0 } as const;

/**
 * The candle's light, two camera-facing cards (normal alpha blending: an additive glow vanishes on the bright cream
 * cubbies): a warm halo this wide (m) round the flame, and the flame itself (a teardrop), both centred this far above the
 * cubby floor. The flame is drawn past white (no tone mapping) so it reads as a light.
 */
const HALO_SIZE = 0.28;
const FLAME_SIZE = { x: 0.04, y: 0.075 } as const;
const GLOW_HEIGHT = 0.06;

const ANCHOR_BY_ID: ReadonlyMap<string, CubbyAnchor> = new Map(HALL_CUBBY_ANCHORS.map((a) => [a.id, a]));

/** A texture from a per-texel function (u, v in 0..1, v up) returning [r, g, b, a] in 0..1. */
function paintTexture(size: number, texel: (u: number, v: number) => [number, number, number, number]): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = texel((x + 0.5) / size, (y + 0.5) / size);
      const i = (y * size + x) * 4;
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The halo: a warm, soft round falloff. */
function haloTexture(): DataTexture {
  return paintTexture(64, (u, v) => {
    const r = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
    return [1, 0.7, 0.36, 0.8 * Math.pow(1 - r, 1.8)];
  });
}

/** The flame: a teardrop, white-yellow at its heart, orange at its rim, soft at the edge. */
function flameTexture(): DataTexture {
  return paintTexture(64, (u, v) => {
    // a drop: round at the bottom (v about 0.3), drawn to a point at the top
    const y = v - 0.32;
    const halfWidth = y < 0 ? Math.sqrt(Math.max(0, 0.09 - y * y)) : 0.3 * Math.pow(Math.max(0, 1 - y / 0.62), 1.3);
    const d = halfWidth > 0 ? Math.abs(u - 0.5) / halfWidth : 2;
    const edge = Math.max(0, Math.min(1, (1 - d) * 3));
    const core = Math.max(0, 1 - Math.hypot((u - 0.5) * 3, (v - 0.33) * 2.2));
    return [1, 0.62 + 0.38 * core, 0.25 + 0.7 * core, edge];
  });
}

/** The candles: the props file's tealight (its wax and its flame) and a glow disc, as instances (count = what burns). */
function makeCandles(propsScene: Object3D) {
  const group = new Group();
  group.name = "hall_candles";
  const own: Array<{ dispose(): void }> = [];
  const parts: Array<{ mesh: InstancedMesh; local: Matrix4 }> = [];
  const node = propsScene.getObjectByName("prop__tealight");
  if (node) {
    propsScene.updateMatrixWorld(true);
    const inv = new Matrix4().copy(node.matrixWorld).invert();
    node.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const m = o as Mesh;
      const material = (Array.isArray(m.material) ? m.material[0] : m.material) as Material;
      const mesh = new InstancedMesh(m.geometry, material, MAX_CANDLES);
      mesh.name = `inst__candle_${material.name}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      own.push(mesh);
      parts.push({ mesh, local: new Matrix4().multiplyMatrices(inv, m.matrixWorld) });
      group.add(mesh);
    });
  }
  const card = (name: string, map: DataTexture, w: number, h: number, colour: string, order: number) => {
    const material = new MeshBasicMaterial({ map, color: colour, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    material.name = name;
    const geometry = new PlaneGeometry(w, h);
    const mesh = new InstancedMesh(geometry, material, MAX_CANDLES);
    mesh.name = `inst__${name}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    group.add(mesh);
    own.push(mesh, material, geometry, map);
    return mesh;
  };
  const halo = card("candle_halo", haloTexture(), HALO_SIZE, HALO_SIZE, "#FFFFFF", 3);
  const flame = card("candle_flame", flameTexture(), FLAME_SIZE.x, FLAME_SIZE.y, "#FFF2D6", 4);
  return { group, parts, glows: [halo, flame], own };
}

const tmpPlace = new Matrix4();
const tmpPart = new Matrix4();
const tmpGlow = new Matrix4();
const glowPos = new Vector3();
const glowScale = new Vector3();
const glowQuat = new Quaternion();
const placePos = new Vector3();

/** The dressed hall: the model with its light map, the sample props as instances, and the candles. Suspends while loading. */
function MemorialHall() {
  // Every file downloads at once: the textures' requests start before the models' reads suspend this component.
  useTexture.preload([MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url]);
  useGLTF.preload(MEMORIAL_PROPS_URL, DRACO_PATH);
  const hall = useGLTF(MEMORIAL_MODEL_URL, DRACO_PATH);
  const props = useGLTF(MEMORIAL_PROPS_URL, DRACO_PATH);
  const [lightmap, atlas] = useTexture([MEMORIAL_LIGHTMAP_URL, SAMPLE_PHOTO_ATLAS.url]);

  const nodes = useMemo(() => prepareMemorial(hall.scene, lightmap), [hall, lightmap]);
  const photoMaterial = useMemo(() => {
    atlas.flipY = false;
    atlas.colorSpace = SRGBColorSpace;
    atlas.needsUpdate = true;
    return makePhotoMaterial(atlas);
  }, [atlas]);
  const cubbyProps = useMemo(
    () => buildCubbyPropMeshes(props.scene, layoutCubbyProps(HALL_CUBBY_ANCHORS, SAMPLE_CUBBIES), photoMaterial),
    [props, photoMaterial],
  );
  const candles = useMemo(() => makeCandles(props.scene), [props]);

  useEffect(() => noteMemorialLoaded([hall.scene, props.scene], [lightmap, atlas]), [hall, props, lightmap, atlas]);
  useEffect(() => () => disposeMemorial(nodes), [nodes]);
  useEffect(() => () => photoMaterial.dispose(), [photoMaterial]);
  useEffect(() => () => cubbyProps.own.forEach((r) => r.dispose()), [cubbyProps]);
  useEffect(() => () => candles.own.forEach((r) => r.dispose()), [candles]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cvHall = () => {
      let meshes = 0;
      let instanced = 0;
      const count = (root: Object3D) =>
        root.traverse((o) => {
          if (!(o as Mesh).isMesh || !o.visible) return;
          if ((o as InstancedMesh).isInstancedMesh && (o as InstancedMesh).count === 0) return;
          meshes += 1;
          if ((o as InstancedMesh).isInstancedMesh) instanced += 1;
        });
      count(nodes.root);
      count(cubbyProps.group);
      count(candles.group);
      const propCounts: Record<string, number> = {};
      for (const m of cubbyProps.meshes) propCounts[m.name] = m.count;
      return { meshes, instanced, props: propCounts, candles: [...burningCandles().keys()], samples: SAMPLE_CUBBIES.length };
    };
    return () => {
      delete window.__cvHall;
    };
  }, [nodes, cubbyProps, candles]);

  // The candles: what burns now, each at its cubby; the glow faces the camera and breathes a little.
  useFrame(({ camera, clock }) => {
    pruneCandles(candleClock());
    let i = 0;
    const t = clock.elapsedTime;
    glowQuat.copy(camera.quaternion);
    for (const id of burningCandles().keys()) {
      if (i >= MAX_CANDLES) break;
      const anchor = ANCHOR_BY_ID.get(id);
      if (!anchor) continue;
      placementMatrix(anchor, CANDLE_SPOT, tmpPlace);
      for (const p of candles.parts) p.mesh.setMatrixAt(i, tmpPart.multiplyMatrices(tmpPlace, p.local));
      placePos.setFromMatrixPosition(tmpPlace);
      glowPos.set(placePos.x, placePos.y + GLOW_HEIGHT, placePos.z);
      const s = 1 + 0.08 * Math.sin(t * 9.1 + i * 1.7) + 0.05 * Math.sin(t * 23.3 + i);
      glowScale.set(s, s * 1.12, s);
      for (const g of candles.glows) g.setMatrixAt(i, tmpGlow.compose(glowPos, glowQuat, glowScale));
      i += 1;
    }
    for (const p of candles.parts) {
      p.mesh.count = i;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const g of candles.glows) {
      g.count = i;
      g.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {/* dispose={null}: the geometry and the shared materials belong to the loader's cache. */}
      <primitive object={nodes.root} dispose={null} />
      <primitive object={cubbyProps.group} dispose={null} />
      <primitive object={candles.group} dispose={null} />
    </>
  );
}

/**
 * The memorial hall's interior (케이슨 마을 Task 9), mounted while the local player is in the hall. Holds the hall's files
 * for as long as it shows (memorialRelease.ts: loaded on entering, released on leaving), shows the plain room until the
 * model is in, and the way out's door pad. The candles go out when the hall is left.
 */
export function HallArea() {
  useEffect(() => holdMemorialFiles(), []);
  useEffect(() => () => clearCandles(), []);
  return (
    <>
      <Suspense fallback={<HallRoom withPad={false} />}>
        <MemorialHall />
      </Suspense>
      <DoorPad pad={VILLAGE_LAYOUT.memorial.interior.doorPad} />
    </>
  );
}
