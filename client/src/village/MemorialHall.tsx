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
  Shape,
  ShapeGeometry,
  Path,
  SRGBColorSpace,
  Vector3,
  type Material,
  Mesh,
  type Object3D,
} from "three";
import { VILLAGE_LAYOUT, type CubbyAnchor } from "@caysonverse/shared/village/villageLayout";
import { DRACO_PATH } from "../game/hub/hubModelPrep";
import { SceneWarmUp } from "../game/SceneWarmUp";
import { buildCubbyPropMeshes, layoutCubbyProps, makePhotoMaterial, placementMatrix } from "./cubbyProps";
import { burningCandles, candleClock, pruneCandles, showInstances } from "./hallCandles";
import { MEMORIAL_LIGHTMAP_URLS, MEMORIAL_MODEL_URL, MEMORIAL_PROPS_URL, disposeMemorial, prepareMemorial } from "./memorialModelPrep";
import { clearMemorialCaches, holdMemorialFiles, noteMemorialRequested, setMemorialTier } from "./memorialRelease";
import { disposeHallNight, hallNightReady, hallNightUniform, hallNightWeight, loadHallNight, skylightColour } from "./hallNight";
import { useNightMapWanted } from "./nightLightmap";
import { dayNight } from "./dayNightDriver";
import { setHallDoorLeaves } from "./hallDoor";
import { setSeatSightBlocker, setSeatSpotBlocker } from "../game/seatFraming";
import { setCameraSolids } from "../game/cameraSolids";
import { buildSolidIndex } from "./hallSolidIndex";
import { cubbyFocusAnchor, cubbyFocusWeight } from "./cubbyFocus";
import { glassFocusUniform } from "./hallGlass";
import { useQualityTier } from "../game/QualityEffects";
import { LoadBoundary } from "./LoadBoundary";
import { HALL_CUBBY_ANCHORS, SAMPLE_CUBBIES, SAMPLE_PHOTO_ATLAS } from "./sampleCubbies";
import { DoorPad, HallRoom } from "./VillageHall";
import { PublicAutoDoor } from "./PublicAutoDoor";
import type { Pose } from "../game/types";

declare global {
  interface Window {
    /** Dev-only: the dressed memorial hall (draw calls, props, candles) for the e2e checks. */
    __cvHall?: () => { meshes: number; instanced: number; props: Record<string, number>; candles: string[]; samples: number };
  }
}

/** At most this many candles burn at once in one client's hall (an hour each, one per filled cubby). */
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

const WALL_BY_BANK = new Map(VILLAGE_LAYOUT.memorial.interior.cubbyWalls.map((w) => [w.bank, w]));

/**
 * The chosen cubby's mark in the close-up (review 2026-11-15 round 5: three cubbies looked the same and only a small grey line on
 * the card said which one was open): a thin warm-gold line round its opening, on the boards just outside it, breathing a little.
 * One unit square outline (inner 1 x 1, the line 0.05 of it wide), scaled to the bank's cell.
 */
function makeSelectMark(): Mesh {
  const o = 0.5 + 0.06;
  const shape = new Shape();
  shape.moveTo(-o, -o);
  shape.lineTo(o, -o);
  shape.lineTo(o, o);
  shape.lineTo(-o, o);
  shape.closePath();
  const hole = new Path();
  const i = 0.5 + 0.01;
  hole.moveTo(-i, -i);
  hole.lineTo(-i, i);
  hole.lineTo(i, i);
  hole.lineTo(i, -i);
  hole.closePath();
  shape.holes.push(hole);
  const mat = new MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(new ShapeGeometry(shape), mat);
  mesh.name = "cubby_select_mark";
  mesh.visible = false;
  mesh.renderOrder = 3;
  return mesh;
}

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
      mesh.visible = false;
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
    mesh.visible = false;
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
  // A release from now on must free what this reads, even if it is still loading (memorialRelease.ts).
  noteMemorialRequested();
  // The 2048 px light map on the rich tier, 1024 px on the light one.
  const tier = useQualityTier();
  setMemorialTier(tier);
  const lightmapUrl = MEMORIAL_LIGHTMAP_URLS[tier];
  // Every file downloads at once: the textures' requests start before the models' reads suspend this component.
  useTexture.preload([lightmapUrl, SAMPLE_PHOTO_ATLAS.url]);
  useGLTF.preload(MEMORIAL_PROPS_URL, DRACO_PATH);
  const hall = useGLTF(MEMORIAL_MODEL_URL, DRACO_PATH);
  const props = useGLTF(MEMORIAL_PROPS_URL, DRACO_PATH);
  const [lightmap, atlas] = useTexture([lightmapUrl, SAMPLE_PHOTO_ATLAS.url]);
  // Night (hallNight.ts): the night light map and park are fetched only when night is near.
  const nightWanted = useNightMapWanted();

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
  const selectMark = useMemo(() => makeSelectMark(), []);
  useEffect(
    () => () => {
      selectMark.geometry.dispose();
      (selectMark.material as Material).dispose();
    },
    [selectMark],
  );

  useEffect(() => () => disposeMemorial(nodes), [nodes]);
  // A seat's first framing (seatFraming.ts) must see the seated body, and its camera must not sit in or above something solid: the
  // hall's solid model (glass is not) is indexed once on a plan grid (hallSolidIndex.ts, round 7 review) and tested against.
  useEffect(() => {
    nodes.root.updateMatrixWorld(true);
    const tris: number[] = [];
    const v = new Vector3();
    const each = new Matrix4();
    // Every solid mesh as it stands now: what is hidden is skipped (a mesh shown later is not in it), an instanced one adds each
    // instance. memorial.glb has 3 GPU-instanced nodes (EXT_mesh_gpu_instancing, 368 instances: the LED strip in every cubby of
    // banks A, B and E), so the index holds 59.5k triangles where the file has 55.4k (round 9 tech review: an earlier comment said
    // there were none). Round 7 skipped instanced meshes; since round 8 they are in, which (with the grid DDA visiting every cell
    // a line crosses) is the likely cause of the seat-framing time going from 0.3 to 2.5 ms median (1.7 to 7.1 ms max) — run once
    // per sit, cached. The door leaves are filed closed: no seat or camera spot is near the doors, and their own boxes (the
    // walk's) hold the camera off them.
    nodes.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) return;
      if (Array.isArray(m.material) || (m.material as Material).transparent) return;
      const pos = m.geometry.getAttribute("position");
      if (!pos) return;
      const idx = m.geometry.getIndex();
      const count = idx ? idx.count : pos.count;
      const inst = m as unknown as InstancedMesh;
      const copies = inst.isInstancedMesh ? inst.count : 1;
      for (let c = 0; c < copies; c++) {
        if (inst.isInstancedMesh) {
          inst.getMatrixAt(c, each);
          each.premultiply(m.matrixWorld);
        } else each.copy(m.matrixWorld);
        for (let i = 0; i + 2 < count; i += 3)
          for (let k = 0; k < 3; k++) {
            v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(each);
            tris.push(v.x, v.y, v.z);
          }
      }
    });
    const room = VILLAGE_LAYOUT.memorial.interior.room;
    const solid = buildSolidIndex(Float32Array.from(tris), room.minX - 1, room.maxX + 1, room.minZ - 1, room.maxZ + 1);
    // the last 0.35 m of a sight line is the seat round the body itself (cushions, arms): not a blocker
    const offSight = setSeatSightBlocker((fx, fy, fz, tx, ty, tz) => solid.segmentBlocked(fx, fy, fz, tx, ty, tz, 0.35));
    // the camera spot: not within 0.3 m of a surface, and not up among, over or beside things hung from the ceiling (the lounge's
    // oak louvres: their gaps let sight lines through, their underside does not; a lens level with them a metre away sees them as
    // a brown band over the top of the screen) — 0.25 m under their underside at least, within a metre of them
    const offSpot = setSeatSpotBlocker((x, y, z) => solid.underHung(x, y, z, 2.6, 1.0, 0.25) || solid.nearSolid(x, y, z, 0.3));
    // …and the follow camera (round 8 review: dragged up near the lounge it went up among the louvres; cameraSolids.ts)
    const offCamera = setCameraSolids(solid);
    return () => {
      offSight();
      offSpot();
      offCamera();
    };
  }, [nodes]);
  useEffect(() => {
    setHallDoorLeaves(nodes.doorLeaves);
    return () => setHallDoorLeaves(null);
  }, [nodes]);
  useEffect(() => {
    if (nightWanted) void loadHallNight(tier);
  }, [nightWanted, tier]);
  useEffect(() => () => disposeHallNight(), []);
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
    // The open cubby's gold mark (the close-up's weight fades it in and out).
    const focus = cubbyFocusAnchor();
    const fw = cubbyFocusWeight();
    glassFocusUniform.value = fw;
    if (focus && fw > 0) {
      const wall = WALL_BY_BANK.get(focus.bank);
      const cell = wall ? wall.cell : 0.36;
      selectMark.position.set(focus.x + Math.sin(focus.yaw) * 0.004, focus.y, focus.z + Math.cos(focus.yaw) * 0.004);
      selectMark.rotation.set(0, focus.yaw, 0);
      selectMark.scale.set(cell, cell, 1);
      (selectMark.material as MeshBasicMaterial).opacity = fw * (0.8 + 0.2 * Math.sin(clock.elapsedTime * 3));
      selectMark.visible = true;
    } else selectMark.visible = false;
    // The hall's light follows the village's clock: the day map, the night map, and in between a blend.
    const night = hallNightWeight(dayNight.outdoor.night, hallNightReady());
    if (hallNightUniform.value !== night) {
      hallNightUniform.value = night;
      if (nodes.skylight) {
        const c = skylightColour(night);
        nodes.skylight.color.setRGB(c[0], c[1], c[2]);
      }
    }
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
    for (const p of candles.parts) showInstances(p.mesh, i);
    for (const g of candles.glows) showInstances(g, i);
  });

  return (
    <>
      {/* dispose={null}: the geometry and the shared materials belong to the loader's cache. */}
      <primitive object={nodes.root} dispose={null} />
      <primitive object={cubbyProps.group} dispose={null} />
      <primitive object={candles.group} dispose={null} />
      <primitive object={selectMark} dispose={null} />
    </>
  );
}

/**
 * The memorial hall's interior (케이슨 마을 Task 9), mounted while the local player is in the hall. Holds the hall's files
 * for as long as it shows (memorialRelease.ts: loaded on entering, released on leaving), shows the plain room until the
 * model is in, and the way out's door pad. The candles go out when the hall is left (hallCandles.ts, on the area change).
 */
export function HallArea({ pose }: { pose: Pose }) {
  useEffect(() => holdMemorialFiles(), []);
  return (
    <>
      <LoadBoundary fallback={<HallRoom withPad={false} />} onReset={clearMemorialCaches} notice="추모관을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <Suspense fallback={<HallRoom withPad={false} />}>
          <MemorialHall />
          <SceneWarmUp />
        </Suspense>
      </LoadBoundary>
      <DoorPad pad={VILLAGE_LAYOUT.memorial.interior.doorPad} subtle />
      <PublicAutoDoor area="hall" pose={pose} />
    </>
  );
}
