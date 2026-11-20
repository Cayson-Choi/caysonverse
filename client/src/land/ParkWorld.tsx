import { groundOld } from "../village/ground/groundMode";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  BackSide,
  CircleGeometry,
  Color,
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
import { PARK_PINE_URL_HI, PARK_PINE_URL_LO, useParkAssets } from "./parkAssets";
import { dayNight } from "../village/dayNightDriver";
import { buildFountainStone, createStoneFountainWater } from "../village/fountain/stoneFountain";
import { STAR_FOUNTAIN, STAR_SPOUTS } from "../village/fountain/fountainDesigns";
import { LAMP_GLOBE, flagstoneRing, victorianLampGeometry } from "../village/lots/gateDress";
import { getPbrSet, pbrTextures } from "../village/pbr/pbrLibrary";
import { BulbHalos, LampPools } from "./nightGlow";

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

/** The gate's tiles come from the houses' scanned set (Poly Haven clay_roof_tiles_03; see models/village/LICENSE.md); its stone is the library's granite. */
const GATE_TEX_DIR = "/models/village/houses/";
const GATE_TEX_URLS = [
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
  // fix/gate-fountain-park: the mossy sandstone scan smeared dark olive under the arch and stretched along the voussoirs (the
  // owner wants everything brand-new, no weathering): the library's flamed granite, warmed to a clean sandstone, at cut-stone grain
  const gl = useThree((st) => st.gl);
  const stone = once("stone", () => {
    const m = new MeshStandardMaterial({ name: "gate_stone", vertexColors: true, color: new Color("#f6e2c6"), roughness: 0.9, metalness: 0, emissive: new Color("#3b2d1e"), emissiveIntensity: 0.4 }); // (the emissive: sky bounce under the arch, which the lawn's green hemisphere light turned olive)
    getPbrSet("granite_flamed", isTouchDevice ? "1k" : "2k", gl).then((set) => {
      const t = pbrTextures(set, { repeat: [3, 3] });
      m.map = t.map;
      m.normalMap = t.normalMap;
      m.normalScale.set(0.8, -0.8);
      m.roughnessMap = t.orm;
      m.needsUpdate = true;
    });
    return m;
  });
  const roof = once("roof", () => {
    const m = parkMaterial({ c: tex[0]!, n: tex[1]!, r: tex[2]! }, 1, { ownedMaps: true, normalScale: 1.4 });
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

/**
 * The plaza's star fountain (fix/gate-fountain-park; the owner: "여기도 너무 허접하다"): STAR_FOUNTAIN turned in pale flamed
 * granite (the library set at its real scale; the wet faces darker and glossier) on a ring of flagstones, eight carved spout
 * piers on the rim throwing arcing jets inward, both bowls overflowing in sheets, the pools rippling with foam where the water
 * lands (stoneFountain.ts), and a bevelled, gilded star turning slowly on the top.
 */
function Fountain({ env, tier }: { env: Texture; tier: VillageTier }) {
  const gl = useThree((st) => st.gl);
  const low = isTouchDevice || tier !== "high";
  const made = useMemo(() => {
    const stoneGeo = buildFountainStone(STAR_FOUNTAIN, low);
    const flagGeo = flagstoneRing(4.72, 5.6, 28, low);
    const dry = new MeshStandardMaterial({ name: "park_fountain_stone", vertexColors: true, roughness: 0.9, metalness: 0, color: new Color(1, 0.99, 0.97) });
    const wet = new MeshStandardMaterial({ name: "park_fountain_wet", vertexColors: true, roughness: 0.32, metalness: 0, color: new Color(0.6, 0.6, 0.6) });
    const water = createStoneFountainWater(STAR_FOUNTAIN, low);
    // the star: bevelled all round (four bevel steps), its points a touch rounded
    const sh = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.6 : 0.27;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    const starGeo = new ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.07, bevelSegments: low ? 3 : 6, curveSegments: 4 });
    starGeo.translate(0, 0, -0.06);
    starGeo.computeVertexNormals();
    const gold = new MeshStandardMaterial({ name: "park_fountain_gilt", color: "#ffd46a", metalness: 0.65, roughness: 0.3, envMap: env, envMapIntensity: 1.4, emissive: new Color("#8a5c0c"), emissiveIntensity: 0.5 });
    // the spouts: a short bronze nozzle out of each pier's inner face, along its jet
    const b = new GeoBuilder();
    for (let k = 0; k < STAR_SPOUTS.count; k++) {
      const a = STAR_SPOUTS.angle0 + (2 * Math.PI * k) / STAR_SPOUTS.count;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const jet = STAR_FOUNTAIN.jets[0]!;
      const len = Math.hypot(jet.out, jet.up);
      const p1: V3 = [c * jet.r, jet.y, s * jet.r];
      const p0: V3 = [p1[0] - ((c * jet.out) / len) * -0.0 - c * 0.14, jet.y - (jet.up / len) * 0.05, p1[2] - s * 0.14];
      b.cylinder(p0, p1, 0.028, 0.022, 12, [1, 1, 1], true);
    }
    const nozzleGeo = b.build();
    const bronze = new MeshStandardMaterial({ name: "park_fountain_bronze", color: "#9a7444", metalness: 0.85, roughness: 0.38, envMap: env, envMapIntensity: 0.9 });
    return { stoneGeo, flagGeo, dry, wet, water, starGeo, gold, nozzleGeo, bronze };
  }, [low, env]);
  // the stone's maps: the library's flamed granite (metre UVs: one tile a metre)
  useEffect(() => {
    let alive = true;
    getPbrSet("granite_flamed", low ? "1k" : "2k", gl).then((set) => {
      if (!alive) return;
      for (const [m, ns] of [[made.dry, 0.75], [made.wet, 0.5]] as const) {
        const t = pbrTextures(set);
        m.map = t.map;
        m.normalMap = t.normalMap;
        m.normalScale.set(ns, -ns);
        m.roughnessMap = t.orm;
        m.aoMap = t.orm;
        m.needsUpdate = true;
      }
    });
    return () => {
      alive = false;
    };
  }, [made, gl, low]);
  useEffect(
    () => () => {
      for (const x of [made.stoneGeo, made.flagGeo, made.dry, made.wet, made.starGeo, made.gold, made.nozzleGeo, made.bronze]) x.dispose();
      for (const x of made.water.own) x.dispose();
    },
    [made],
  );
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.35;
    made.water.update(performance.now() / 1000, dayNight.applied);
  });
  const { x, z } = PARK_PLAZA;
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={made.stoneGeo} material={[made.dry, made.wet]} castShadow receiveShadow />
      {/* the flags sit on the plaza's paving (y 0.04, drawn with a polygon offset), not in it */}
      <mesh geometry={made.flagGeo} material={made.dry} position-y={0.035} receiveShadow />
      <mesh geometry={made.nozzleGeo} material={made.bronze} />
      <primitive object={made.water.group} />
      <mesh position={[0, 3.77, 0]} material={made.gold}><sphereGeometry args={[0.075, 20, 14]} /></mesh>
      <mesh ref={ref} position={[0, 4.48, 0]} geometry={made.starGeo} material={made.gold} castShadow />
    </group>
  );
}

// ───────────────────────────────────────── trees, lamps, flowers, benches ─────────────────────────────────────────

/**
 * The park's lamps (fix/gate-fountain-park): the gate lot's Victorian cast-iron twin lamp (gateDress.ts) in place of the plain
 * stick and ball, its arms along the path they light (round the plaza: along the ring). One instanced draw for the iron, one for
 * the opal globes, one for the bulbs; the halos and the pools of light at night as before (nightGlow.tsx), at the globes.
 */
function lampYaw(l: { x: number; z: number }): number {
  if (Math.hypot(l.x - PARK_PLAZA.x, l.z - PARK_PLAZA.z) < PARK_PLAZA.radius) return Math.atan2(l.z - PARK_PLAZA.z, l.x - PARK_PLAZA.x) + Math.PI / 2;
  // the promenade's and the queue approach's lamps stand beside paths running north-south; the avenue's run east-west
  return Math.abs(l.z + 119) < 0.5 || Math.abs(l.z + 105) < 0.5 ? 0 : Math.PI / 2;
}

function Lamps({ tier }: { tier: VillageTier }) {
  const gl = useThree((st) => st.gl);
  const low = isTouchDevice || tier !== "high";
  const lampSpots = useMemo(() => PARK_LAMPS.map((l) => ({ x: l.x, z: l.z })), []);
  const globesAt = useMemo(
    () =>
      PARK_LAMPS.flatMap((l) => {
        const yaw = lampYaw(l);
        return [-1, 1].map((s) => [l.x + Math.cos(yaw) * s * LAMP_GLOBE.offset, LAMP_GLOBE.y, l.z - Math.sin(yaw) * s * LAMP_GLOBE.offset] as const);
      }),
    [],
  );
  const made = useMemo(() => {
    const iron = victorianLampGeometry(low);
    const ironMat = new MeshStandardMaterial({ name: "park_lamp_iron", vertexColors: true, roughness: 0.55, metalness: 0 });
    const globe = new SphereGeometry(LAMP_GLOBE.r, low ? 14 : 22, low ? 10 : 16);
    const bulb = new SphereGeometry(0.045, 8, 6);
    const globeMat = new MeshStandardMaterial({ name: "park_lamp_globe", color: "#f7f2e8", emissive: new Color("#ffe2b8"), emissiveIntensity: 0.25, roughness: 0.18, transparent: true, opacity: 0.62, depthWrite: false });
    const bulbMat = new MeshStandardMaterial({ name: "park_lamp_bulb", color: "#fff6e0", emissive: new Color("#ffd28a"), emissiveIntensity: 0.4, roughness: 0.4 });
    return { iron, ironMat, globe, bulb, globeMat, bulbMat };
  }, [low]);
  useEffect(() => {
    let alive = true;
    getPbrSet("cast_iron", low ? "1k" : "2k", gl).then((set) => {
      if (!alive) return;
      const t = pbrTextures(set);
      made.ironMat.map = t.map;
      made.ironMat.normalMap = t.normalMap;
      made.ironMat.normalScale.set(0.6, -0.6);
      made.ironMat.roughnessMap = t.orm;
      made.ironMat.needsUpdate = true;
    });
    return () => {
      alive = false;
    };
  }, [made, gl, low]);
  useEffect(() => () => Object.values(made).forEach((x) => x.dispose()), [made]);
  const post = useRef<InstancedMesh>(null);
  const globes = useRef<InstancedMesh>(null);
  const bulbs = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new Matrix4();
    PARK_LAMPS.forEach((l, i) => {
      post.current?.setMatrixAt(i, m.makeRotationY(lampYaw(l)).setPosition(l.x, 0, l.z));
    });
    globesAt.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      globes.current?.setMatrixAt(i, m);
      bulbs.current?.setMatrixAt(i, m);
    });
    for (const r of [post, globes, bulbs]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, [globesAt]);
  // the globes and bulbs burn brighter at night (the halos and the pools on the paving come from nightGlow.tsx)
  useFrame(() => {
    const k = dayNight.applied.lights;
    made.globeMat.emissiveIntensity = 0.25 + 1.9 * k;
    made.bulbMat.emissiveIntensity = 0.4 + 3.2 * k;
  });
  return (
    <group>
      <LampPools places={lampSpots} radius={5.2} strength={0.4} />
      <BulbHalos places={globesAt} size={1.7} />
      <instancedMesh ref={post} args={[made.iron, made.ironMat, PARK_LAMPS.length]} castShadow />
      <instancedMesh ref={bulbs} args={[made.bulb, made.bulbMat, globesAt.length]} />
      <instancedMesh ref={globes} args={[made.globe, made.globeMat, globesAt.length]} renderOrder={3} />
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
  // benches (fix/gate-fountain-park: they were a plank, a board and two blocks): a park bench of five seat slats and three back
  // slats, rounded at the front, on two cast-iron end frames (a scrolled front leg, a rear leg running up into the back, an arm
  // with a curled end); length along z, the back toward +x * face, as before
  const benchSpots = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    for (let z = -170; z <= -140; z += 10) out.push([34, z, -1], [46, z, 1]);
    for (let x = 90; x <= 330; x += 30) out.push([x, -108.2, 1]);
    return out;
  }, []);
  const bedGeo = useMemo(() => {
    const b = new GeoBuilder();
    const wood: V3 = [0.86, 0.62, 0.42];
    for (const [x, z, face] of benchSpots) {
      // seat slats: front (away from the back) to rear, falling 3 cm toward the back
      for (let i = 0; i < 5; i++) {
        const d = -0.2 + i * 0.1; // across the seat, + toward the back
        b.box([x + face * d, 0.455 - 0.006 * i, z], X, Y, 0.042, 0.017, 0.98, wood.map((c) => c * (0.95 + 0.05 * Math.sin(i * 2.1 + x))) as V3);
      }
      // back slats, leaning back 14 degrees
      const lean = 0.24;
      for (let i = 0; i < 3; i++) {
        const h = 0.6 + i * 0.13;
        const ax: V3 = [face * Math.sin(lean), Math.cos(lean), 0];
        const nx: V3 = [face * Math.cos(lean), -Math.sin(lean), 0];
        b.box([x + face * (0.26 + (h - 0.5) * Math.tan(lean)), h, z], nx, ax, 0.016, 0.05, 0.98, wood);
      }
    }
    return b.build();
  }, [benchSpots]);
  const benchIronGeo = useMemo(() => {
    const b = new GeoBuilder();
    const iron: V3 = [1, 1, 1];
    for (const [x, z, face] of benchSpots) {
      for (const dz of [-0.88, 0.88]) {
        const P = (d: number, y: number): V3 => [x + face * d, y, z + dz];
        // the rear leg and the back's upright in one sweep
        b.tube([P(0.3, 0.0), P(0.27, 0.15), P(0.23, 0.32), P(0.22, 0.44), P(0.26, 0.6), P(0.3, 0.75), P(0.33, 0.88), P(0.35, 0.92)], 0.022, 6, iron);
        // the front leg, curving forward at the foot
        b.tube([P(-0.27, 0.0), P(-0.24, 0.12), P(-0.22, 0.28), P(-0.21, 0.44)], 0.022, 6, iron);
        // the seat rail
        b.tube([P(-0.25, 0.44), P(0.24, 0.43)], 0.018, 6, iron);
        // the arm: up from the front leg, back to the upright, a curl at the front
        const arm: V3[] = [P(-0.21, 0.44), P(-0.2, 0.55), P(-0.16, 0.63), P(0.0, 0.66), P(0.18, 0.66), P(0.27, 0.66)];
        b.tube(arm, 0.017, 6, iron);
        const curl: V3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = Math.PI * 0.5 + (i / 8) * Math.PI * 1.5;
          const rr = 0.045 * (1 - i / 14);
          curl.push(P(-0.2 + rr * Math.cos(a), 0.6 + rr * Math.sin(a)));
        }
        b.tube(curl, 0.012, 5, iron);
        // a stretcher between the legs, low
        b.tube([P(-0.23, 0.12), P(0.26, 0.13)], 0.012, 5, iron);
      }
    }
    return b.build();
  }, [benchSpots]);
  const benchIron = useMemo(() => new MeshStandardMaterial({ name: "park_bench_iron", color: "#24282b", roughness: 0.45, metalness: 0.55 }), []);
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
      <mesh geometry={benchIronGeo} material={benchIron} castShadow />
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
      <Fountain env={env} tier={tier} />
      <ParkVegetation />
      <Lamps tier={tier} />
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
