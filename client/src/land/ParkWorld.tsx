import { groundOld } from "../village/ground/groundMode";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  BackSide,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  RingGeometry,
  BufferGeometry,
} from "three";
import {
  PARK_LAMPS,
  PARK_PLAZA,
  PARK_TROUGHS,
} from "@caysonverse/shared/village/parkArea";
import { isTouchDevice } from "../device";
import { CoasterWorld } from "./CoasterWorld";
import { CarouselWorld } from "./CarouselWorld";
import { parkReady, setParkReady } from "./parkReady";
import { WheelWorld } from "./WheelWorld";
import { MoonBoatWorld } from "./MoonBoatWorld";
import { DropTowerWorld } from "./DropTowerWorld";
import { Shops } from "./ParkShops";
import { ParkMountains, ParkScenery } from "./ParkScenery";
import { ParkProps } from "./ParkProps";
import { ParkVegetation } from "./ParkVegetation";
import type { VillageTier } from "../village/villageModelPrep";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { gateSignTexture } from "./canvasTextures";
import { GRASS_VARIATION_PARS } from "../village/grassVariation";
import { buildParkTerrain } from "./parkTerrain";
import { parkSkyTexture } from "./parkSkyTexture";
import { ALL_PARK_URLS, featherTexture, parkMaterial, pickSet } from "./pbr";
import { addBellRoof, addHedge, addLathe } from "./parkShapes";
import { boxwoodTextures } from "./boxwoodTexture";
import { parkBorders } from "./parkBorders";
import { grassTuft } from "../village/veg/vegGeometry";
import { soilTextures } from "../village/veg/vegSoil";
import { CLICK_PICK_KEY } from "../game/clickPick";
import { PARK_MARBLE_URL_HI, PARK_MARBLE_URL_LO, PARK_PINE_URL_HI, PARK_PINE_URL_LO, useParkAssets } from "./parkAssets";
import { dayNight } from "../village/dayNightDriver";
import { BulbHalos, LampPools } from "./nightGlow";

const MARBLE_URL = isTouchDevice ? PARK_MARBLE_URL_LO : PARK_MARBLE_URL_HI;
const PINE_URL = isTouchDevice ? PARK_PINE_URL_LO : PARK_PINE_URL_HI;

/** Built once per page (a suspended or re-mounted park must not paint the sky or grow the terrain again: ~100-300 ms each on a phone). */
let skyCache: Texture | null = null;
let terrainCache: BufferGeometry | null = null;
const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

const setRepeat = (m: MeshStandardMaterial, rx: number, ry: number): void => {
  for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.repeat.set(rx, ry);
};

/** A plain daytime sky dome that rides with the camera (the park has no village model to bring one). */
function ParkSky() {
  const ref = useRef<Mesh>(null);
  const geo = useMemo(() => new SphereGeometry(1450, 48, 24), []);
  const map = useMemo(() => (skyCache ??= parkSkyTexture()), []);
  const mat = useRef<MeshBasicMaterial>(null);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
    // the day's dome painted dark and blue with the clock (night audit 2026-11-18: it stayed a pastel noon sky at midnight); the stars
    // and the moon are drawn over it by the village's sky
    const t = dayNight.applied.domeTint;
    mat.current?.color.setRGB(t[0], t[1], t[2]);
  });
  return (
    <mesh ref={ref} geometry={geo} renderOrder={-10} frustumCulled={false}>
      <meshBasicMaterial ref={mat} map={map} side={BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

// ───────────────────────────────────────── ground ─────────────────────────────────────────

/** A brass bar set into the paving: a ring from radius r0 to r1 with bevelled shoulders (never a flat painted disc). */
function brassInlay(r0: number, r1: number): BufferGeometry {
  if (groundOld()) return new RingGeometry(r0, r1, 64);
  const pts = [new Vector2(r0, 0), new Vector2(r0 + 0.025, 0.014), new Vector2(r1 - 0.025, 0.014), new Vector2(r1, 0)];
  return new LatheGeometry(pts, 96).rotateX(Math.PI / 2); // the meshes are laid with rotation-x -90 deg
}

type PadRect = readonly [number, number, number, number, string];

/** The kerb's boxes: a 14 cm x 8 cm granite bar along every pad's edge and round the plaza, in 2 m pieces, left out where another pad lies. */
function parkKerb(pads: readonly PadRect[], plaza: { x: number; z: number; radius: number }): BufferGeometry {
  const b = new GeoBuilder();
  const colour: V3 = [0.62, 0.6, 0.55];
  const insideOther = (x: number, z: number, skip: number): boolean =>
    pads.some((p, i) => i !== skip && Math.abs(x - p[0]) < p[2] / 2 + 0.3 && Math.abs(z - p[1]) < p[3] / 2 + 0.3) ||
    (skip !== -1 && Math.hypot(x - plaza.x, z - plaza.z) < plaza.radius + 0.3);
  pads.forEach(([cx, cz, w, d], i) => {
    const pieces = (len: number): number => Math.max(1, Math.round(len / 2));
    for (const sgn of [-1, 1]) {
      // the two long edges / the two short ends, in pieces
      const nx = pieces(w);
      for (let k = 0; k < nx; k++) {
        const x = cx - w / 2 + ((k + 0.5) * w) / nx;
        const z = cz + (sgn * (d + 0.14)) / 2;
        if (!insideOther(x, z, i)) b.box([x, 0.04, z], X, Y, w / nx / 2 + 0.01, 0.04, 0.07, colour);
      }
      const nz = pieces(d);
      for (let k = 0; k < nz; k++) {
        const z = cz - d / 2 + ((k + 0.5) * d) / nz;
        const x = cx + (sgn * (w + 0.14)) / 2;
        if (!insideOther(x, z, i)) b.box([x, 0.04, z], [0, 0, 1], Y, d / nz / 2 + 0.01, 0.04, 0.07, colour);
      }
    }
  });
  const seg = 72;
  for (let k = 0; k < seg; k++) {
    const a = ((k + 0.5) / seg) * Math.PI * 2;
    const r = plaza.radius + 0.07;
    const x = plaza.x + Math.cos(a) * r;
    const z = plaza.z + Math.sin(a) * r;
    if (pads.some((p) => Math.abs(x - p[0]) < p[2] / 2 + 0.3 && Math.abs(z - p[1]) < p[3] / 2 + 0.3)) continue;
    b.box([x, 0.04, z], [-Math.sin(a), 0, Math.cos(a)], Y, (Math.PI * 2 * r) / seg / 2 + 0.02, 0.04, 0.07, colour);
  }
  return b.build();
}

function Ground({ all }: { all: Texture[] }) {
  const grass = useMemo(() => {
    // the village lawn's own set (Poly Haven leafy_grass), graded green-gold like the village lawn (GROUND_GRADE LM_grass: sunny, lime; the raw albedo is dry straw)
    const m = parkMaterial(pickSet(all, "LeafyGrass"), 1, { color: new Color(0.4, 1.2, 0.26), normalScale: 0.9 });
    setRepeat(m, 1 / 5, 1 / 5); // the terrain's uv is world metres: one tile per 5 m
    // The scanned blades retain their close-up detail. The maintained fairground has long,
    // gently turning mower passes that fade out before the rough beyond the coaster.
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGvWorld;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvGvWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vGvWorld;\n${GRASS_VARIATION_PARS}`)
        .replace("#include <map_fragment>", `#ifdef USE_MAP
          diffuseColor *= gvVary(map, vMapUv, vGvWorld, texture2D(map, vMapUv));
          vec2 p = vGvWorld.xz;
          vec2 inside = min(p - vec2(-155.0, -188.0), vec2(375.0, 10.0) - p);
          float fairground = smoothstep(0.0, 19.0, min(inside.x, inside.y));
          float course = p.x * 0.93 + p.y * 0.36 + 2.7 * sin(p.y * 0.034);
          float swath = smoothstep(-0.64, 0.64, cos(course * 0.49)) * 2.0 - 1.0;
          diffuseColor.rgb *= 1.0 + fairground * swath * vec3(0.17, 0.135, 0.09);
        #endif`);
    };
    m.customProgramCacheKey = () => "park-mown-grass";
    return m;
  }, [all]);
  // the sunny lime lawn cools to a dark moonlit green with the night (the village's lawns do the same: GROUND_GRADE_NIGHT)
  useFrame(() => {
    const n = dayNight.applied.night;
    grass.color.setRGB(0.4 + (0.2 - 0.4) * n, 1.2 + (0.5 - 1.2) * n, 0.26 + (0.32 - 0.26) * n);
  });
  const terrain = useMemo(() => (terrainCache ??= buildParkTerrain()), []);
  const plazaGeo = useMemo(() => new CircleGeometry(PARK_PLAZA.radius, 64), []);
  // the brass inlays are set into the paving, not painted on it: a 1.2 cm bevelled bar, a darker joint either side
  const ring = useMemo(() => brassInlay(PARK_PLAZA.radius - 0.4, PARK_PLAZA.radius), []);
  const inlay = useMemo(() => brassInlay(9.2, 10.2), []);
  const gold = useMemo(() => new MeshStandardMaterial({ color: "#c79a38", roughness: 0.42, metalness: 0.35, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), []);
  const pads = useMemo(() => {
    // paths as rectangles on the ground: [cx, cz, w, d, material key]
    return [
      [40, -161, 18, 54, "p"], // the promenade
      [161, -112, 368, 12, "p"], // the east-west avenue
      [2, -62.5, 12, 87, "g"], // the station approach (gravel): from the avenue's south edge (z -106; the avenue spans -118..-106) to the apron's (z -19), never on or under either (was 94 m long and overlapped the apron by 7 m: z-fighting shimmer)
      [2, -13, 18, 12, "p"], // the station apron: paving at the foot of the platform's north steps (the boarding pad)
    ] as const;
  }, []);
  const setsPave = useMemo(() => pickSet(all, "PavingStones070"), [all]);
  const setsGravel = useMemo(() => pickSet(all, "Gravel023"), [all]);
  const rectMats = useMemo(
    () =>
      pads.map(([, , w, d, k]) =>
        parkMaterial(k === "p" ? setsPave : setsGravel, [w / 3, d / 3], {
          color: new Color(k === "p" ? "#e9dfd2" : "#d9cdb8"),
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -4,
          ...(k === "p" ? {} : { transparent: true, alphaMap: featherTexture(), depthWrite: false }),
        }),
      ),
    [pads, setsPave, setsGravel],
  );
  const rects = pads.map(([cx, cz, w, d], i) => (
    <mesh key={i} rotation-x={-Math.PI / 2} position={[cx, 0.03, cz]} material={rectMats[i]} receiveShadow>
      <planeGeometry args={[w, d]} />
    </mesh>
  ));
  // a granite kerb (14 cm wide, 8 cm over the paving) round every paved pad and the plaza, so none is a sticker on the lawn; where two paved
  // pads meet the kerb stops (no kerb across a crossing)
  const kerbGeo = useMemo(() => (groundOld() ? new BufferGeometry() : parkKerb(pads.filter((p) => p[4] === "p"), PARK_PLAZA)), [pads]);
  const kerbMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), []);
  const plazaMat = useMemo(() => parkMaterial(setsPave, (PARK_PLAZA.radius * 2) / 3, { color: new Color("#e9dfd2"), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), [setsPave]);
  return (
    <group>
      <mesh geometry={terrain} material={grass} receiveShadow />
      {rects}
      <mesh geometry={kerbGeo} material={kerbMat} receiveShadow castShadow />
      <mesh rotation-x={-Math.PI / 2} position={[PARK_PLAZA.x, 0.04, PARK_PLAZA.z]} geometry={plazaGeo} material={plazaMat} receiveShadow />
      <mesh rotation-x={-Math.PI / 2} position={[PARK_PLAZA.x, 0.06, PARK_PLAZA.z]} geometry={ring} material={gold} />
      <mesh rotation-x={-Math.PI / 2} position={[PARK_PLAZA.x, 0.06, PARK_PLAZA.z]} geometry={inlay} material={gold} />
    </group>
  );
}

// ───────────────────────────────────────── the gate arch, the fountain ─────────────────────────────────────────

/** The gate's tiles and stone come from the houses' scanned sets (Poly Haven clay_roof_tiles_03, mossy_sandstone; see models/village/LICENSE.md). */
const GATE_TEX_DIR = "/models/village/houses/";
const GATE_TEX_URLS = [
  `${GATE_TEX_DIR}house_sandstone_albedo.webp`,
  `${GATE_TEX_DIR}house_sandstone_normal${isTouchDevice ? "_512" : ""}.webp`,
  `${GATE_TEX_DIR}house_sandstone_rough.webp`,
  `${GATE_TEX_DIR}house_tile_albedo.webp`,
  `${GATE_TEX_DIR}house_tile_normal${isTouchDevice ? "_512" : ""}.webp`,
  `${GATE_TEX_DIR}house_tile_rough.webp`,
];

/** The tile sheet as an indigo glaze: its luminance (the tile edges, the stamped diamonds) tinted, never a flat colour. */
const GLAZE_FRAGMENT = /* glsl */ `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	float glazeL = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	diffuseColor.rgb *= mix( sampledDiffuseColor.rgb, vec3( glazeL ) * vec3( 0.95, 1.2, 2.7 ), 0.9 );
#endif`;

/** The gate: two sandstone towers with tiled spires and gold finials, a segmental arch of voussoirs between them (a keystone, imposts), an attic with the carved name board, a dentilled cornice, a gold star. */
/** Built once per page: the park's Suspense retries render the gate again and again, and every try must be free. */
const gateCache = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!gateCache.has(key)) gateCache.set(key, make());
  return gateCache.get(key) as T;
}

function GateArch({ all }: { all: Texture[] }) {
  void all;
  // plain loads (no Suspense): the sets stream in beside the park's own, the materials pick them up when they arrive
  const tex = once("tex", () => GATE_TEX_URLS.map((u) => new TextureLoader().load(u)));
  const sign = once("sign", () => gateSignTexture());
  const signMat = once("signMat", () => new MeshStandardMaterial({ map: sign, roughness: 0.5, emissive: new Color("#ffffff"), emissiveMap: sign, emissiveIntensity: 0.15 }));
  const stone = once("stone", () => {
    const m = parkMaterial({ c: tex[0]!, n: tex[1]!, r: tex[2]! }, 1, { ownedMaps: true, vertexColors: true, color: new Color("#fff2e6"), normalScale: 1.1 });
    m.name = "gate_stone";
    return m;
  });
  const roof = once("roof", () => {
    const m = parkMaterial({ c: tex[3]!, n: tex[4]!, r: tex[5]! }, 1, { ownedMaps: true, normalScale: 1.4 });
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", GLAZE_FRAGMENT);
    };
    m.customProgramCacheKey = () => "gate-glaze";
    m.name = "gate_tiles";
    return m;
  });
  const starGeo = once("starGeo", () => {
    const sh = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1.7 : 0.72;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    return new ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  });
  const gold = once("gold", () => new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#6b4a08"), emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 }));
  const CZ = -186.5;
  const geoStone = once("geoStone", () => {
    const b = new GeoBuilder();
    const sand: V3 = [1, 0.96, 0.92];
    const TOWERS = [31.25, 48.75];
    for (const tx of TOWERS) {
      b.box([tx, 5, CZ], X, Y, 1.75, 5, 3.5, [1, 1, 1], 1.4);
      b.box([tx, 10.3, CZ], X, Y, 2.1, 0.3, 3.8, [0.88, 0.85, 0.8], 1.4);
      b.box([tx, 0.25, CZ], X, Y, 2.0, 0.25, 3.75, [0.72, 0.7, 0.66], 1.4);
      // string courses: two projecting bands round the shaft, and a plinth moulding
      for (const y of [3.3, 6.4]) b.box([tx, y, CZ], X, Y, 1.9, 0.12, 3.65, [0.92, 0.9, 0.86], 1.4);
      b.box([tx, 0.62, CZ], X, Y, 1.86, 0.1, 3.6, [0.9, 0.88, 0.84], 1.4);
      // quoins up the four corners: alternating long and short blocks
      for (let k = 0; k < 16; k++) {
        const y = 0.9 + k * 0.58;
        const long = k % 2 === 0;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            b.box([tx + sx * (1.75 - (long ? 0.3 : 0.18)), y, CZ + sz * 3.5], X, Y, long ? 0.3 : 0.18, 0.27, 0.04, [0.97, 0.93, 0.88], 1.4);
            b.box([tx + sx * 1.75, y, CZ + sz * (3.5 - (long ? 0.3 : 0.18))], [0, 0, 1], Y, long ? 0.3 : 0.18, 0.27, 0.04, [0.97, 0.93, 0.88], 1.4);
          }
        }
      }
      // corbel table under the top slab, on all four faces
      for (let i = 0; i < 9; i++) {
        const x = tx - 1.6 + i * 0.4;
        for (const sz of [-1, 1]) b.box([x, 9.72, CZ + sz * 3.62], X, Y, 0.13, 0.2, 0.13, sand, 1.4);
      }
      for (let i = 0; i < 16; i++) {
        const z = CZ - 3.3 + i * 0.44;
        for (const sx of [-1, 1]) b.box([tx + sx * 1.62, 9.72, z], X, Y, 0.13, 0.2, 0.13, sand, 1.4);
      }
      // a pointed-arch window slit on each long face (the dark glass and a deep reveal)
      for (const sz of [-1, 1]) {
        b.box([tx, 7.9, CZ + sz * 3.52], X, Y, 0.34, 0.95, 0.06, [0.1, 0.09, 0.14]);
        b.box([tx, 8.95, CZ + sz * 3.52], [0.7071, 0.7071, 0], [-0.7071, 0.7071, 0], 0.24, 0.24, 0.06, [0.1, 0.09, 0.14]);
        b.box([tx, 6.95, CZ + sz * 3.56], X, Y, 0.5, 0.07, 0.12, sand, 1.4);
        for (const sx of [-1, 1]) b.box([tx + sx * 0.46, 7.9, CZ + sz * 3.54], X, Y, 0.07, 1.0, 0.08, sand, 1.4);
      }
    }
    // the segmental arch of 17 voussoirs between the towers (span 14 m, rise 2 m: R 13.25, springing at y 5.2), 1 m deep ring, a stepped keystone
    const R = 13.25;
    const yc = 7.2 - R;
    const thMax = Math.asin(7 / R);
    const n = 17;
    const dth = (2 * thMax) / n;
    for (let i = 0; i < n; i++) {
      const th = -thMax + (i + 0.5) * dth;
      const key = i === (n - 1) / 2;
      const rc = R + 0.5 + (key ? 0.2 : 0);
      const tone = 0.93 + 0.07 * Math.sin(i * 2.1);
      b.box([40 + rc * Math.sin(th), yc + rc * Math.cos(th), CZ], [Math.cos(th), -Math.sin(th), 0], [Math.sin(th), Math.cos(th), 0], (rc * dth) / 2 + (key ? 0.12 : -0.02), key ? 0.72 : 0.5, key ? 1.78 : 1.6, [tone, tone * 0.98, tone * 0.95], 1.4);
    }
    // the imposts (the springing blocks) and the spandrel above the arch, up to the attic
    for (const sx of [-1, 1]) b.box([40 + sx * 6.85, 5.1, CZ], X, Y, 0.34, 0.13, 1.8, [0.9, 0.88, 0.84], 1.4);
    for (let x = 33.25; x < 47; x += 0.5) {
      const dx = x - 40;
      const yExt = yc + Math.sqrt((R + 1.0) ** 2 - dx * dx);
      const h = 8.2 - yExt;
      if (h > 0.02) b.box([x, yExt + h / 2, CZ], X, Y, 0.255, h / 2, 1.6, [1, 0.97, 0.93], 1.4);
    }
    b.box([40, 9.1, CZ], X, Y, 7.0, 0.9, 1.6, [1, 0.97, 0.93], 1.4); // the attic that carries the name board
    // the carved board's frame: a raised stone border round the name board, on both faces
    for (const sz of [-1, 1]) {
      const z = CZ + sz * 1.64;
      b.box([40, 10.0 - 0.1, z], X, Y, 4.0, 0.1, 0.1, sand, 1.4);
      b.box([40, 8.2 + 0.1, z], X, Y, 4.0, 0.1, 0.1, sand, 1.4);
      for (const sx of [-1, 1]) b.box([40 + sx * 3.95, 9.1, z], X, Y, 0.1, 0.9, 0.1, sand, 1.4);
    }
    // the cornice over the attic with a dentil row under it
    b.box([40, 10.3, CZ], X, Y, 8.0, 0.3, 1.95, [0.9, 0.87, 0.83], 1.4);
    b.box([40, 9.95, CZ], X, Y, 7.4, 0.05, 1.75, [0.88, 0.85, 0.8], 1.4);
    for (let x = 33.3; x <= 46.8; x += 0.4) for (const sz of [-1, 1]) b.box([x, 9.84, CZ + sz * 1.84], X, Y, 0.1, 0.1, 0.09, sand, 1.4);
    return b.build();
  });
  const roofGeo = once("roofGeo", () => {
    const b = new GeoBuilder();
    // a bell-shaped tiled spire on each tower (swept concave sides, an eave kick, the plan rounding into a cone), taller than before
    for (const tx of [31.25, 48.75]) addBellRoof(b, tx, 10.6, CZ, 2.15, 3.7, 7.0, [1, 1, 1], 2.0);
    return b.build();
  });
  const trimGeo = once("trimGeo", () => {
    const b = new GeoBuilder();
    // a gilt collar under each spire's tip and a gilt ball finial with a weather-vane rod, turned on the lathe
    for (const tx of [31.25, 48.75]) {
      addLathe(b, tx, CZ, [[0.01, 0], [0.12, 0.02], [0.34, 0.12], [0.4, 0.3], [0.3, 0.46], [0.12, 0.56], [0.09, 0.7], [0.2, 0.86], [0.26, 1.04], [0.2, 1.24], [0.06, 1.4], [0.01, 1.46], [0.01, 1.9]], [1, 1, 1], 1, 20, 17.5);
    }
    // gilt bosses on the name board's frame, both faces
    for (const sz of [-1, 1]) {
      const z = CZ + sz * 1.74;
      for (const sx of [-1, 1]) for (const yy of [8.35, 9.85]) b.cylinder([40 + sx * 3.95, yy, z], [40 + sx * 3.95, yy, z + sz * 0.1], 0.13, 0.1, 10, [1, 1, 1], true);
    }
    // gilt window sills on the towers and the arch's keystone boss
    for (const tx of [31.25, 48.75]) for (const sz of [-1, 1]) b.box([tx, 6.9, CZ + sz * 3.7], X, Y, 0.52, 0.04, 0.1, [1, 1, 1]);
    for (const sz of [-1, 1]) b.cylinder([40, 7.7, CZ + sz * 1.78], [40, 7.7, CZ + sz * 1.9], 0.32, 0.26, 16, [1, 1, 1], true);
    return b.build();
  });
  return (
    <group>
      <mesh geometry={geoStone} material={stone} castShadow receiveShadow />
      <mesh geometry={roofGeo} material={roof} castShadow />
      <mesh geometry={trimGeo} material={gold} castShadow />
      <mesh position={[40, 9.1, CZ + 1.66]} material={signMat}>
        <planeGeometry args={[5.6, 1.4]} />
      </mesh>
      <mesh position={[40, 9.1, CZ - 1.66]} rotation={[0, Math.PI, 0]} material={signMat}>
        <planeGeometry args={[5.6, 1.4]} />
      </mesh>
      <mesh geometry={starGeo} material={gold} position={[40, 12.2, CZ - 0.2]} scale={1.2} />
    </group>
  );
}

/** The plaza's star fountain: a stepped, moulded marble basin, a baluster and a scalloped upper bowl turned on the lathe, a slender
 * column carrying a turning gilt star, eight arching jets, gilt star finials on the rim. Marble from the village's CC0 set. */
function Fountain({ all, env }: { all: Texture[]; env: Texture }) {
  const marbleTex = useTexture(MARBLE_URL) as Texture;
  const marble = useMemo(() => {
    const t = marbleTex.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.26, metalness: 0.02, envMap: env, envMapIntensity: 0.55 });
  }, [marbleTex, env]);
  const stone = useMemo(() => parkMaterial(pickSet(all, "Concrete034"), 1, { color: new Color("#eee6d8"), normalScale: 0.5 }), [all]);
  const water = useMemo(() => new MeshStandardMaterial({ color: "#6ab4d8", roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 }), []);
  const gold = useMemo(() => new MeshStandardMaterial({ color: "#f2c14e", emissive: new Color("#6b4a08"), emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6 }), []);
  const starGeo = useMemo(() => {
    const sh = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1.3 : 0.55;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    return new ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  }, []);
  const smallStar = useMemo(() => {
    const sh = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.3 : 0.13;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    return new ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  }, []);
  const marbleGeo = useMemo(() => {
    const b = new GeoBuilder();
    const W: V3 = [1, 1, 1];
    // the paving apron and the moulded basin (outer foot, ogee lip, inner wall, floor just under the water)
    addLathe(b, 0, 0, [[5.35, 0], [5.35, 0.06], [4.8, 0.1]], [0.96, 0.95, 0.92], 2, 64);
    addLathe(b, 0, 0, [[0.01, 0.0], [4.6, 0.0], [4.6, 0.2], [4.5, 0.28], [4.5, 0.55], [4.62, 0.62], [4.62, 0.8], [4.5, 0.95], [4.25, 1.0], [4.05, 0.95], [4.0, 0.86], [0.01, 0.86]], W, 2, 72);
    // the baluster: a plinth, a swelling urn, a collar, the upper bowl with a rolled lip, a column to the star
    addLathe(b, 0, 0, [[0.01, 0.86], [1.05, 0.86], [1.05, 1.0], [0.85, 1.08], [0.6, 1.14], [0.5, 1.4], [0.68, 1.72], [0.62, 1.95], [0.5, 2.1], [0.58, 2.3], [1.2, 2.4], [1.75, 2.62], [1.82, 2.78], [1.7, 2.82], [1.52, 2.74], [1.45, 2.68], [0.01, 2.68]], W, 2, 56);
    addLathe(b, 0, 0, [[0.01, 2.68], [0.46, 2.68], [0.38, 2.88], [0.24, 3.1], [0.2, 3.5], [0.22, 4.2], [0.33, 4.36], [0.3, 4.52], [0.16, 4.64], [0.01, 4.66]], W, 2, 28);
    // eight low piers round the rim, each carrying a small gilt star (the gold is its own mesh below)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      addLathe(b, Math.cos(a) * 4.62, Math.sin(a) * 4.62, [[0.01, 0.95], [0.2, 0.95], [0.2, 1.25], [0.26, 1.32], [0.2, 1.4], [0.01, 1.42]], W, 1, 12);
    }
    return b.build();
  }, []);
  const jets = useMemo(() => Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2), []);
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.4;
  });
  const { x, z } = PARK_PLAZA;
  void stone;
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={marbleGeo} material={marble} castShadow receiveShadow />
      <mesh position={[0, 0.92, 0]} material={water}><cylinderGeometry args={[4.0, 4.0, 0.08, 40]} /></mesh>
      <mesh position={[0, 2.75, 0]} material={water}><cylinderGeometry args={[1.45, 1.45, 0.06, 28]} /></mesh>
      <mesh position={[0, 4.78, 0]} material={gold}><sphereGeometry args={[0.2, 14, 10]} /></mesh>
      <mesh ref={ref} position={[0, 5.45, 0]} geometry={starGeo} material={gold} />
      {jets.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * 2.2, 1.7, Math.sin(a) * 2.2]} rotation={[Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]} material={water}>
          <cylinderGeometry args={[0.03, 0.06, 1.4, 6]} />
        </mesh>
      ))}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return <mesh key={`s${i}`} geometry={smallStar} material={gold} position={[Math.cos(a) * 4.62, 1.5, Math.sin(a) * 4.62]} rotation={[0, -a + Math.PI / 2, 0]} castShadow />;
      })}
    </group>
  );
}

// ───────────────────────────────────────── trees, lamps, flowers, benches ─────────────────────────────────────────

function Lamps() {
  const lampSpots = useMemo(() => PARK_LAMPS.map((l) => ({ x: l.x, z: l.z })), []);
  const halos = useMemo(() => PARK_LAMPS.map((l) => [l.x, 4.45, l.z] as const), []);
  const post = useRef<InstancedMesh>(null);
  const bulb = useRef<InstancedMesh>(null);
  const postGeo = useMemo(() => new CylinderGeometry(0.07, 0.11, 4.2, 8), []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.28, 10, 8), []);
  const postMat = useMemo(() => new MeshStandardMaterial({ color: "#2a2d4a", roughness: 0.4, metalness: 0.4 }), []);
  const bulbMat = useMemo(() => new MeshStandardMaterial({ color: "#fff2c6", emissive: new Color("#ffd98a"), emissiveIntensity: 1.2, roughness: 0.3 }), []);
  useEffect(() => {
    const m = new Matrix4();
    PARK_LAMPS.forEach((l, i) => {
      m.makeTranslation(l.x, 2.1, l.z);
      post.current?.setMatrixAt(i, m);
      m.makeTranslation(l.x, 4.45, l.z);
      bulb.current?.setMatrixAt(i, m);
    });
    if (post.current) post.current.instanceMatrix.needsUpdate = true;
    if (bulb.current) bulb.current.instanceMatrix.needsUpdate = true;
  }, []);
  // the bulbs burn brighter at night (the halos and the pools on the paving come from nightGlow.tsx)
  useFrame(() => {
    bulbMat.emissiveIntensity = 1.2 + 2.2 * dayNight.applied.lights;
  });
  return (
    <group>
      <LampPools places={lampSpots} radius={5.2} strength={0.4} />
      <BulbHalos places={halos} size={2.6} />
      <instancedMesh frustumCulled={false} ref={post} args={[postGeo, postMat, PARK_LAMPS.length]} castShadow />
      <instancedMesh frustumCulled={false} ref={bulb} args={[bulbGeo, bulbMat, PARK_LAMPS.length]} />
    </group>
  );
}

/** One mulch surface, one stone edging mesh and one batch of arching grass clumps for the borders. */
function PathBorders({ stone }: { stone: MeshStandardMaterial }) {
  const border = parkBorders();
  const grass = useMemo(() => grassTuft(true, "reed"), []);
  const tufts = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const inst = tufts.current!;
    border.grasses.forEach((matrix, i) => inst.setMatrixAt(i, matrix));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }, [border]);
  const mulch = useRef<MeshStandardMaterial>(null);
  useEffect(() => {
    const mat = mulch.current!;
    let alive = true;
    soilTextures(true, (map, normal) => {
      if (alive) {
        mat.map = map;
        mat.normalMap = normal;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      } else {
        map.dispose();
        normal.dispose();
      }
    });
    return () => {
      alive = false;
      mat.map?.dispose();
      mat.normalMap?.dispose();
    };
  }, []);
  useEffect(() => () => grass.dispose(), [grass]);
  return (
    <group name="park_path_borders" userData={{ [CLICK_PICK_KEY]: "ignore" }}>
      <mesh geometry={border.soil} receiveShadow>
        <meshStandardMaterial ref={mulch} color="#583d2e" roughness={0.96} vertexColors />
      </mesh>
      <mesh geometry={border.edging} material={stone} receiveShadow />
      <instancedMesh ref={tufts} args={[grass, undefined, border.grasses.length]} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.83} side={DoubleSide} />
      </instancedMesh>
    </group>
  );
}

function Beds({ pine, all }: { pine: Texture; all: Texture[] }) {
  const troughGeo = useMemo(() => {
    const b = new GeoBuilder();
    // the flower troughs round the fountain (stone, with a cap course; the flowers and soil are the village flower system's)
    for (const t of PARK_TROUGHS) {
      const cx = (t.x0 + t.x1) / 2;
      const cz = (t.z0 + t.z1) / 2;
      b.box([cx, 0.4, cz], X, Y, (t.x1 - t.x0) / 2, 0.4, (t.z1 - t.z0) / 2, [0.9, 0.88, 0.84], 2);
      b.box([cx, 0.82, cz], X, Y, (t.x1 - t.x0) / 2 + 0.07, 0.04, (t.z1 - t.z0) / 2 + 0.07, [1, 0.98, 0.94], 2);
    }
    return b.build();
  }, []);
  const troughMat = useMemo(() => parkMaterial(pickSet(all, "Concrete034"), 1, { vertexColors: true, color: new Color("#efe6d6"), normalScale: 0.6 }), [all]);
  // hedges lining the promenade's two sides: clipped boxwood, a trimmed profile with a leafy skin (parkShapes.addHedge)
  const hedgeGeo = useMemo(() => {
    const b = new GeoBuilder();
    for (const [i, hx] of [28.6, 51.4].entries()) {
      // a run of short hedges with a hand's gap between them, so it reads as planted sections and not one long box
      const segs: Array<[number, number]> = [];
      for (let z = -178; z < -122; z += 7) segs.push([z + 0.15, Math.min(z + 6.85, -122)]);
      segs.forEach(([a, c], k) =>
        addHedge(b, hx, a, hx, c, { width: 1.25, height: 1.15, bump: 0.05, tile: 0.6, seed: 11 + i * 17 + k }, (_t, crown, lf) => {
          const v = 0.74 + lf * 0.35 + crown * 0.22;
          return [v * 0.9, v, v * 0.88];
        }),
      );
    }
    return b.build();
  }, []);
  const hedgeMat = useMemo(() => {
    const tx = boxwoodTextures();
    return new MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 2.2, vertexColors: true, roughness: 0.72, side: DoubleSide });
  }, []);
  const bedGeo = useMemo(() => {
    const b = new GeoBuilder();
    // benches (a seat plank, a back, two legs) along the avenue and the promenade
    const bench = (x: number, z: number, face: number) => {
      b.box([x, 0.5, z], X, Y, 0.35, 0.05, 1.0, [0.72, 0.5, 0.3]);
      b.box([x + face * 0.3, 0.85, z], X, Y, 0.05, 0.3, 1.0, [0.72, 0.5, 0.3]);
      for (const dz of [-0.8, 0.8]) b.box([x, 0.25, z + dz], X, Y, 0.3, 0.25, 0.05, [0.15, 0.16, 0.22]);
    };
    for (let z = -170; z <= -140; z += 10) {
      bench(34, z, -1);
      bench(46, z, 1);
    }
    for (let x = 90; x <= 330; x += 30) bench(x, -108.2, 1);
    return b.build();
  }, []);
  const benchMat = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.75 });
  }, [pine]);
  return (
    <group>
      <PathBorders stone={troughMat} />
      <mesh geometry={troughGeo} material={troughMat} castShadow receiveShadow />
      <mesh geometry={hedgeGeo} material={hedgeMat} castShadow receiveShadow />
      <mesh geometry={bedGeo} material={benchMat} castShadow receiveShadow />
    </group>
  );
}

// ───────────────────────────────────────── the park ─────────────────────────────────────────

/** A PMREM of a bright sky (with a sun) for the clear-coat and the painted steel: the park has no environment map of its own. */
function useSkyEnv(): Texture {
  const gl = useThree((st) => st.gl);
  return useMemo(() => {
    const sc = new Scene();
    const sky = new Mesh(new SphereGeometry(100, 32, 16), new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false }));
    const g = sky.geometry;
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const hz = new Color("#f2f6fa");
    const zen = new Color("#5d98de");
    const gnd = new Color("#5a7a45");
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 100;
      if (h >= 0) c.copy(hz).lerp(zen, Math.pow(h, 0.5));
      else c.copy(hz).lerp(gnd, Math.min(1, -h * 3));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    sc.add(sky);
    const sun = new Mesh(new SphereGeometry(9, 12, 8), new MeshBasicMaterial({ color: new Color(14, 12, 9), toneMapped: false }));
    sun.position.set(45, 70, 35);
    sc.add(sun);
    const pm = new PMREMGenerator(gl);
    const rt = pm.fromScene(sc, 0.03);
    pm.dispose();
    return rt.texture;
  }, [gl]);
}

/** Everything of 케이슨랜드 that stands in the park area (park-local metres). */
/**
 * Marks the park ready (parkReady.ts: the loading veil lifts) once it has been drawn: three frames in a row with the park's draw calls on screen.
 * Mounting is not enough: after it the shaders still compile for a few seconds on a phone and the frames show a bare sky (first-time-player review,
 * phone). A safety timeout lifts the veil anyway after 30 s.
 */
function ParkReadyProbe() {
  const frames = useRef(0);
  const born = useRef(performance.now());
  useFrame(({ gl }) => {
    if (parkReady()) return;
    if (gl.info.render.calls > 30) frames.current++;
    else frames.current = 0;
    if (frames.current >= 3 || performance.now() - born.current > 30_000) setParkReady(true);
  });
  useEffect(() => () => setParkReady(false), []);
  return null;
}

export function ParkWorld({ tier }: { tier: VillageTier }) {
  useParkAssets(isTouchDevice);
  const all = useLoader(TextureLoader, ALL_PARK_URLS) as Texture[];
  const pine = useLoader(TextureLoader, PINE_URL) as Texture;
  const env = useSkyEnv();
  // (the veil lifts in ParkReadyProbe: once the park has really been DRAWN, not merely mounted)
  return (
    <group>
      <ParkReadyProbe />
      <ParkSky />
      <Ground all={all} />
      <Shops all={all} />
      <GateArch all={all} />
      <Fountain all={all} env={env} />
      <ParkVegetation />
      <Lamps />
      <Beds pine={pine} all={all} />
      <ParkProps all={all} />
      <ParkScenery all={all} />
      <Suspense fallback={null}>
        <ParkMountains tier={tier === "high" ? "high" : "low"} />
      </Suspense>
      <CoasterWorld all={all} pine={pine} env={env} />
      <CarouselWorld env={env} all={all} />
      <WheelWorld env={env} all={all} />
      <MoonBoatWorld all={all} />
      <DropTowerWorld all={all} />
    </group>
  );
}
