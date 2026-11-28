import { Suspense, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
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
import { FLAME_BASE_LIFT, FLAME_CARD, WICK, makeCandleLook, makeWicks } from "./hallCandleLook";
import { dressHall, patchSignsAtlas } from "./hallDressing";
import { addInkLabel } from "../game/inkLabels";
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
import { CUBBY_SET, HALL_CUBBY_ANCHORS, SAMPLE_CUBBIES, SAMPLE_PHOTO_ATLAS, type SampleCubby } from "./sampleCubbies";
import { useClaims } from "./memorial/claimsStore";
import { ClaimFrames } from "./memorial/ClaimFrames";

/** A claimed cubby holds the same three things as the sample (CUBBY_SET); ClaimFrames lays the family's photo in the frame. */
const CLAIM_PROPS = CUBBY_SET;
import { HallRoom } from "./VillageHall";
import { PublicAutoDoor } from "./PublicAutoDoor";
import type { Pose } from "../game/types";

declare global {
  interface Window {
    /** Dev-only: the dressed memorial hall (draw calls, props, candles) for the e2e checks. */
    __cvHall?: () => {
      meshes: number;
      instanced: number;
      props: Record<string, number>;
      candles: string[];
      samples: number;
      /** The zone signs (구역 A–D): bank id, what it says, where. */
      zones: Array<{ bank: string; label: string; x: number; y: number; z: number }>;
      painting: { x: number; y: number; z: number; width: number; height: number; url: string; loaded: boolean } | null;
      wicks: number;
    };
  }
}

/** At most this many candles burn at once in one client's hall (an hour each, one per filled cubby). */
export const MAX_CANDLES = 64;

/** The cubby's candle (CUBBY_SET's candle: there from the start, unlit); 촛불 켜기 lights THIS candle. */
export const CANDLE_SPOT = CUBBY_SET.find((p) => p.kind === "candle")!;
/** The wick's tip in the candle prop's own frame (build_props.py candle: x, up, z): where the flame stands. */
export const CANDLE_WICK = { x: 0.0019, y: 0.0715, z: 0 } as const;

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

/**
 * The candles: what a lit candle adds (hallCandleLook.ts: flame, halo, the light on its cubby, the wax lit through), and for a props
 * file without the always-there candle the old tealight, as instances (count = what burns).
 */
function makeCandles(propsScene: Object3D) {
  const group = new Group();
  group.name = "hall_candles";
  const own: Array<{ dispose(): void }> = [];
  const parts: Array<{ mesh: InstancedMesh; local: Matrix4 }> = [];
  // Since 2026-11-17 the candle itself is a cubby prop that is always there (CUBBY_SET); lighting it adds only the flame and its
  // glow. The old tealight instancing stays only for a props file without the candle.
  const node = propsScene.getObjectByName("prop__candle") ? null : propsScene.getObjectByName("prop__tealight");
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
  const look = makeCandleLook(MAX_CANDLES);
  group.add(look.wash, look.wax, look.halo, look.flame);
  own.push(...look.own);
  return { group, parts, look, own };
}

const tmpPlace = new Matrix4();
const tmpPart = new Matrix4();
const tmpGlow = new Matrix4();
const glowPos = new Vector3();
const glowScale = new Vector3();
const glowQuat = new Quaternion();
const placePos = new Vector3();
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const tint = new Color();

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

  const nodes = useMemo(() => {
    const n = prepareMemorial(hall.scene, lightmap);
    // the kiosk's floor plan and the baked plaques name the zones A–D like the new signs (once per loaded material)
    n.root.traverse((o) => {
      const mats = (o as Mesh).isMesh ? (Array.isArray((o as Mesh).material) ? ((o as Mesh).material as Material[]) : [(o as Mesh).material as Material]) : [];
      for (const m of mats) if (m.name === "LM_signs") patchSignsAtlas(m as MeshBasicMaterial);
    });
    return n;
  }, [hall, lightmap]);
  const photoMaterial = useMemo(() => {
    atlas.flipY = false;
    atlas.colorSpace = SRGBColorSpace;
    atlas.needsUpdate = true;
    return makePhotoMaterial(atlas);
  }, [atlas]);
  // The families' cubbies (memorial stage B) get the sample's props; rebuilt only when the set of claimed cubbies changes.
  const claims = useClaims();
  const claimedKey = [...claims.claims.keys()].sort().join(",");
  const cubbyProps = useMemo(() => {
    const claimed: SampleCubby[] = claimedKey
      ? claimedKey.split(",").map((id) => ({ id, name: "", born: 0, passed: 0, line: "", photo: 0, props: CLAIM_PROPS }))
      : [];
    return buildCubbyPropMeshes(props.scene, layoutCubbyProps(HALL_CUBBY_ANCHORS, [...SAMPLE_CUBBIES, ...claimed]), photoMaterial);
  }, [props, photoMaterial, claimedKey]);
  const candles = useMemo(() => makeCandles(props.scene), [props]);
  // Every filled cubby's candle has a wick (lit or not: an unlit candle shows just its dark wick); rebuilt with the claimed set.
  const wicks = useMemo(() => {
    const ids = [...SAMPLE_CUBBIES.map((c) => c.id), ...(claimedKey ? claimedKey.split(",") : [])];
    const w = makeWicks(ids.length);
    const m = new Matrix4();
    let n = 0;
    for (const id of ids) {
      const a = ANCHOR_BY_ID.get(id);
      if (!a) continue;
      placementMatrix(a, CANDLE_SPOT, m);
      m.multiply(new Matrix4().makeTranslation(CANDLE_WICK.x, CANDLE_WICK.y - 0.0005, CANDLE_WICK.z));
      w.mesh.setMatrixAt(n++, m);
    }
    w.mesh.count = n;
    w.mesh.instanceMatrix.needsUpdate = true;
    return w;
  }, [claimedKey]);
  useEffect(() => () => wicks.own.forEach((r) => r.dispose()), [wicks]);
  // The zone signs (구역 A–D in walking order) and the lounge's painting (hallDressing.ts, owner 2026-11-20).
  const dressing = useMemo(() => dressHall(nodes.root, tier), [nodes, tier]);
  useEffect(() => () => dressing.dispose(), [dressing]);
  useEffect(() => dressing.startPainting(), [dressing]);
  // the zone signs' and the museum label's letters crisp on the label overlay (inkLabels.ts)
  useEffect(() => {
    const off = dressing.inks.map((l) => addInkLabel(l));
    return () => {
      for (const o of off) o();
    };
  }, [dressing]);
  // The props' glass (2026-11-17): the candle's votive holder and the frame's glass are clear — a faint white film, so the ivory wax
  // and the photo read true through them (the file's tinted glass made the wax grey-blue).
  useMemo(() => {
    props.scene.traverse((o) => {
      const m = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (!m || Array.isArray(m)) return;
      if (m.name === "M_jar_glass") {
        m.color.set(0xffffff);
        m.opacity = 0.1;
        m.depthWrite = false;
      } else if (m.name === "M_frame_glass") {
        m.color.set(0xffffff);
        m.opacity = 0.035;
        m.depthWrite = false;
      }
    });
  }, [props]);
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
      count(dressing.group);
      count(wicks.mesh);
      const propCounts: Record<string, number> = {};
      for (const m of cubbyProps.meshes) propCounts[m.name] = m.count;
      const canvas = dressing.group.getObjectByName("lounge_painting_canvas") as Mesh | undefined;
      return {
        meshes,
        instanced,
        props: propCounts,
        candles: [...burningCandles().keys()],
        samples: SAMPLE_CUBBIES.length,
        zones: dressing.zones.map((z) => ({ bank: z.bank, label: z.label, x: z.x, y: z.y, z: z.z })),
        painting: dressing.painting ? { ...dressing.painting, loaded: Boolean((canvas?.material as MeshBasicMaterial | undefined)?.map) } : null,
        wicks: wicks.mesh.count,
      };
    };
    return () => {
      delete window.__cvHall;
    };
  }, [nodes, cubbyProps, candles, dressing, wicks]);

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
    dressing.update(night);
    pruneCandles(candleClock());
    let i = 0;
    const t = clock.elapsedTime;
    candles.look.setTime(t);
    const look = candles.look;
    // a lit candle's light shows more against the darker hall at night
    const nightBoost = 1 + 0.25 * night;
    for (const id of burningCandles().keys()) {
      if (i >= MAX_CANDLES) break;
      const anchor = ANCHOR_BY_ID.get(id);
      if (!anchor) continue;
      placementMatrix(anchor, CANDLE_SPOT, tmpPlace);
      for (const p of candles.parts) p.mesh.setMatrixAt(i, tmpPart.multiplyMatrices(tmpPlace, p.local));
      placePos.set(CANDLE_WICK.x, CANDLE_WICK.y, CANDLE_WICK.z).applyMatrix4(tmpPlace); // the wax top at the wick
      // upright cards turned to the camera (a flame does not lean back when looked at from below)
      glowQuat.setFromAxisAngle(UP, Math.atan2(camera.position.x - placePos.x, camera.position.z - placePos.z));
      // this candle's flicker: the same sines as its flame's shader would be too costly to mirror, so a cheaper pair
      const f = 0.86 + 0.09 * Math.sin(t * 9.1 + i * 1.7) + 0.05 * Math.sin(t * 23.3 + i);
      glowPos.set(placePos.x, placePos.y + FLAME_BASE_LIFT + FLAME_CARD.h / 2, placePos.z);
      look.flame.setMatrixAt(i, tmpGlow.compose(glowPos, glowQuat, ONE));
      glowPos.set(placePos.x, placePos.y + WICK.h + 0.008, placePos.z);
      glowScale.setScalar(0.92 + 0.12 * f);
      look.halo.setMatrixAt(i, tmpGlow.compose(glowPos, glowQuat, glowScale));
      look.halo.setColorAt(i, tint.setScalar(Math.min(1, 0.75 + 0.25 * f)));
      glowPos.set(placePos.x, placePos.y + 0.001, placePos.z);
      look.wax.setMatrixAt(i, tmpGlow.compose(glowPos, glowQuat, ONE));
      // the light on the cubby: a card on its opening (facing the room), warm, flickering with the flame
      const fx = Math.sin(anchor.yaw);
      const fz = Math.cos(anchor.yaw);
      glowPos.set(anchor.x + fx * 0.006, anchor.y, anchor.z + fz * 0.006);
      glowQuat.setFromAxisAngle(UP, anchor.yaw);
      look.wash.setMatrixAt(i, tmpGlow.compose(glowPos, glowQuat, ONE));
      const w = Math.min(1, 0.78 * f * nightBoost);
      look.wash.setColorAt(i, tint.setRGB(w, w, w));
      i += 1;
    }
    for (const p of candles.parts) showInstances(p.mesh, i);
    for (const g of [look.flame, look.halo, look.wax, look.wash]) showInstances(g, i);
    if (i > 0) {
      look.halo.instanceColor!.needsUpdate = true;
      look.wash.instanceColor!.needsUpdate = true;
    }
  });

  return (
    <>
      {/* dispose={null}: the geometry and the shared materials belong to the loader's cache. */}
      <primitive object={nodes.root} dispose={null} />
      <primitive object={cubbyProps.group} dispose={null} />
      <ClaimFrames anchors={HALL_CUBBY_ANCHORS} />
      <primitive object={candles.group} dispose={null} />
      <primitive object={wicks.mesh} dispose={null} />
      <primitive object={dressing.group} dispose={null} />
      <primitive object={selectMark} dispose={null} />
    </>
  );
}

/**
 * The memorial hall's interior (케이슨 마을 Task 9), mounted while the local player is in the hall. Holds the hall's files
 * for as long as it shows (memorialRelease.ts: loaded on entering, released on leaving), shows the plain room until the
 * model is in (no floor mark at the way out: owner 2026-11-16). The candles go out when the hall is left (hallCandles.ts, on the area change).
 */
export function HallArea({ pose }: { pose: Pose }) {
  useEffect(() => holdMemorialFiles(), []);
  return (
    <>
      <LoadBoundary fallback={<HallRoom />} onReset={clearMemorialCaches} notice="추모관을 불러오지 못했어요. 잠시 뒤 다시 불러올게요.">
        <Suspense fallback={<HallRoom />}>
          <MemorialHall />
          <SceneWarmUp />
        </Suspense>
      </LoadBoundary>
      <PublicAutoDoor area="hall" pose={pose} />
    </>
  );
}
