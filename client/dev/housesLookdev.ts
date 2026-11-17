/**
 * DEV look-dev for the A8 house body kit (X1, 2026-11-16): `village_houses.glb` (shells + body detail of the ten houses)
 * with the houses' PBR tiling sets (`models/village/houses/house_textures.json`: albedo + normal + roughness per material,
 * bound by material name — the same binding the game's loader (X3) makes), lit by the village's day / night look
 * (dayNightBlend.ts DAY_LOOK / NIGHT_LOOK: hemisphere, key light, exposure, neutral tone curve) with live sun shadows.
 * The houses stand at their A8 places on a plain lawn, with X2's porches, steps, beds, LPG, gardens and decks (2026-11-17).
 * The beds' and gardens' flower cards (M_leaf_flora) are planting spots: as in the game, the village's 3D vegetation
 * (villageVegetation.ts createVegetation, veg3d) grows its plants from them and hides them (`?veg=cards` keeps the cards).
 *   ?house=1..10   which house the camera looks at        ?time=day|night
 *   ?view=street|front|gable|wall|window|door|eave|fp|porch|steps|deck|post|mailbox|lpg|garden|bed|flush|back
 *   (window.__view(name) / window.__time(t) switch without a reload)
 * Driven by e2e/houses-lookdev.mjs.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  PointLight,
  WebGLRenderer,
  BackSide,
  ShaderMaterial,
  SphereGeometry,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_A8, HOUSE_BODY_FRONT, HOUSE_BODY_HALF, houseLocalToWorld } from "@caysonverse/shared/village/houseExterior";
import { DAY_LOOK, NIGHT_LOOK, stateFor } from "../src/village/dayNightBlend";
import { cherryTintUniform, foliageTintUniform, liftUniform, litUniform, vegNightUniform } from "../src/village/villageModelPrep";
import { HOUSE_PORCH_KIND } from "@caysonverse/shared/village/houseExterior";
import { createVegetation, type VillageVegetation } from "../src/village/veg/villageVegetation";

const q = new URLSearchParams(location.search);
const W = window as unknown as {
  __ready: boolean;
  __info: unknown;
  __view: (v: string) => void;
  __time: (t: string) => void;
};

interface TexMeta {
  materials: Record<string, { maps: { albedo: string; normal: string; rough: string } }>;
}

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = NeutralToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(innerWidth < innerHeight ? 62 : 50, innerWidth / innerHeight, 0.05, 900);

const hemi = new HemisphereLight();
scene.add(hemi);
const key = new DirectionalLight();
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
const sc = key.shadow.camera;
sc.left = sc.bottom = -16;
sc.right = sc.top = 16;
sc.near = 1;
sc.far = 120;
scene.add(key, key.target);

const lawn = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: new Color("#6e8a4e"), roughness: 0.95 }));
lawn.rotation.x = -Math.PI / 2;
lawn.receiveShadow = true;
scene.add(lawn);

// a sky dome for the background and, through PMREM, the glass's reflections
const skyMat = new ShaderMaterial({
  side: BackSide,
  depthWrite: false,
  uniforms: { top: { value: new Color() }, horizon: { value: new Color() }, ground: { value: new Color() } },
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader:
    "uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }",
});
const sky = new Mesh(new SphereGeometry(500, 32, 16), skyMat);
scene.add(sky);
const pmrem = new PMREMGenerator(renderer);

const house = `house_${q.get("house") ?? "1"}`;
const H = VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === house)!;
const L = (x: number, y: number, z: number) => {
  const p = houseLocalToWorld(H, x, z);
  return new Vector3(p.x, y, p.z);
};

const ZF = HOUSE_BODY_FRONT;
const HZ = HOUSE_A8.depth / 2;
const ZB = -HOUSE_A8.depth / 2 + HOUSE_A8.backMargin;
const ZC = (-HOUSE_A8.depth / 2 + HOUSE_A8.backMargin + ZF) / 2;
const HB = HOUSE_BODY_HALF;
const EYE = 1.6;
const LIFT = HOUSE_A8.floorLift;
/** The views (house local: x right of the door, z out of it), as the Blender renders (build_house_body.py VIEWDEF). */
const VIEWS: Record<string, { cam: [number, number, number]; at: [number, number, number]; fov?: number }> = {
  street: { cam: [-7.5, EYE, ZF + 13.5], at: [0.3, 4.9, ZC + 1.0] },
  front: { cam: [0, EYE, ZF + 15], at: [0, 5.2, ZF] },
  gable: { cam: [HB + 12, EYE, ZC + 3], at: [0, 5.0, ZC] },
  wall: { cam: [-1.75, EYE + LIFT, ZF + 1.0], at: [-1.75, 1.0, ZF], fov: 60 },
  window: { cam: [-2.75, EYE + LIFT, ZF + 1.05], at: [-3.3, 1.75, ZF], fov: 62 },
  door: { cam: [0.55, EYE + LIFT, ZF + 1.15], at: [0.25, 1.5, ZF], fov: 66 },
  eave: { cam: [HB + 0.9, 6.7, ZF + 1.6], at: [HB + 0.15, 7.9, ZF + 0.55], fov: 70 },
  roof: { cam: [-HB - 1.5, 9.6, ZF + 2.2], at: [-1.5, 9.4, ZC + 1.2], fov: 55 },
  fp: { cam: [2.4, EYE, ZF + 3.6], at: [1.2, 2.6, ZF], fov: 60 },
  // X2 porch views (build_house_body.py VIEWDEF): the porch 3/4 at 6 m and 1 m close-ups
  porch: { cam: [-4.6, 1.75, HZ + 4.2], at: [0.2, 1.3, ZF + 0.6], fov: 50 },
  steps: { cam: [1.15, 1.25, HZ + 1.55], at: [0.55, 0.08, HZ + 0.25], fov: 50 },
  deck: { cam: [2.6, 1.9, HZ + 0.7], at: [1.5, 0.28, ZF + 0.9], fov: 56 },
  post: { cam: [1.25, 1.9, HZ - 0.55], at: [2.3, 0.75, 5.155], fov: 56 },
  mailbox: { cam: [-0.95, 1.9, ZF + 1.0], at: [-1.55, 1.42, ZF + 0.1], fov: 50 },
  lpg: { cam: [2.6, 1.6, ZB - 1.9], at: [4.2, 0.95, ZB - 0.3], fov: 60 },
  garden: { cam: [-4.6, 1.7, ZB - 5.4], at: [-0.4, 0.2, ZB - 1.8], fov: 56 },
  bed: { cam: [3.0, 1.85, HZ + 1.1], at: [4.2, 0.35, ZF + 0.9], fov: 56 },
  flush: { cam: [9.6, 1.6, 5.5], at: [6.6, 0.2, 0.0], fov: 56 },
  back: { cam: [-3.5, 1.7, ZB - 5.5], at: [0.0, 0.6, ZB - 0.5], fov: 56 },
};
/** House 10's LPG cage is on the other back corner. */
const MIRRORED = new Set(house === "house_10" ? ["lpg"] : []);

let lookTime = q.get("time") === "night" ? "night" : "day";
const porchLights: PointLight[] = [];
const glows: MeshStandardMaterial[] = [];
const lamps: MeshStandardMaterial[] = [];

function setTime(t: string) {
  lookTime = t === "night" ? "night" : "day";
  const day = lookTime === "day";
  // night: the moonlit ambient desaturated (the game's night light map, X4, carries the real night light)
  hemi.color.set(day ? DAY_LOOK.hemiSky : "#A3ABBC");
  hemi.groundColor.set(day ? DAY_LOOK.hemiGround : "#2A3040");
  hemi.intensity = day ? DAY_LOOK.hemiIntensity * 0.55 : 0.22;
  key.color.set(day ? DAY_LOOK.keyColor : "#C9D3EE");
  key.intensity = day ? DAY_LOOK.keyIntensity * 1.15 : NIGHT_LOOK.moonIntensity * 0.3;
  renderer.toneMappingExposure = day ? DAY_LOOK.exposure : NIGHT_LOOK.exposure;
  scene.background = new Color(day ? DAY_LOOK.sky : NIGHT_LOOK.sky);
  skyMat.uniforms.top!.value.set(day ? "#7FA6CF" : "#060B1A");
  skyMat.uniforms.horizon!.value.set(day ? DAY_LOOK.sky : NIGHT_LOOK.sky);
  skyMat.uniforms.ground!.value.set(day ? "#55603F" : "#0B0F18");
  scene.environment = pmrem.fromScene(skyScene(), 0.02).texture;
  for (const m of glows) m.emissiveIntensity = day ? 0 : 2.2;
  // the 3D flowers' own light (the game's applyDayNight writes the same uniforms)
  const st = stateFor(day ? 40 : -25, 150);
  liftUniform.value = st.lift;
  foliageTintUniform.value.set(st.foliageTint[0], st.foliageTint[1], st.foliageTint[2]);
  cherryTintUniform.value.set(st.cherryTint[0], st.cherryTint[1], st.cherryTint[2]);
  vegNightUniform.value = st.night;
  litUniform.value = st.lights;
  // the porch lamps' pools (the game's night light map, X4, carries them; here two small warm lights)
  for (const l of porchLights) l.visible = !day;
  for (const m of lamps) m.emissiveIntensity = day ? 0.4 : 2.0;
  // the sun from the front-left, 40 degrees up (as the Blender renders); the moon from the back-right
  const f = L(-0.55 * 30, 0, 30);
  const c = L(0, 0, 0);
  const dir = new Vector3(f.x - c.x, 0, f.z - c.z).normalize();
  const el = (day ? 40 : 42) * (Math.PI / 180);
  const d = dir.multiplyScalar(Math.cos(el) * (day ? 1 : -1)).add(new Vector3(0, Math.sin(el), 0));
  const target = L(0, 4, ZC);
  key.target.position.copy(target);
  key.position.copy(target).addScaledVector(d, 60);
}

function skyScene(): Scene {
  const s = new Scene();
  s.add(new Mesh(new SphereGeometry(10, 32, 16), skyMat.clone()));
  return s;
}

/** Houses with a neighbour close in front of them (7 and 9 behind 1 and 2, 8 facing 4's side): a nearer street view. */
const NEAR_STREET: Record<string, number> = { house_7: 5.0, house_9: 5.0, house_8: 5.0 };

function setView(v: string) {
  let def = VIEWS[v] ?? VIEWS.street!;
  if (v === "street" && NEAR_STREET[house] !== undefined) {
    const d = NEAR_STREET[house]!;
    def = { cam: [-0.45 * d, EYE, ZF + d], at: [0.3, 4.9, ZC + 1.0], fov: d < 6 ? 78 : 60 };
  }
  if (MIRRORED.has(v)) def = { ...def, cam: [-def.cam[0], def.cam[1], def.cam[2]], at: [-def.at[0], def.at[1], def.at[2]] };
  camera.position.copy(L(...def.cam));
  camera.lookAt(L(...def.at));
  camera.fov = (def.fov ?? 50) * (innerWidth < innerHeight ? 1.25 : 1);
  camera.updateProjectionMatrix();
}

async function main() {
  const meta = (await (await fetch("/models/village/houses/house_textures.json")).json()) as TexMeta;
  const tl = new TextureLoader();
  const load = (f: string, srgb: boolean): Promise<Texture> =>
    new Promise((res, rej) =>
      tl.load(
        `/models/village/houses/${f}`,
        (t) => {
          t.flipY = false; // glTF UVs
          t.wrapS = t.wrapT = RepeatWrapping;
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
          if (srgb) t.colorSpace = SRGBColorSpace;
          res(t);
        },
        undefined,
        rej,
      ),
    );
  const sets: Record<string, { map: Texture; normalMap: Texture; roughnessMap: Texture }> = {};
  await Promise.all(
    Object.entries(meta.materials).map(async ([name, m]) => {
      const [map, normalMap, roughnessMap] = await Promise.all([load(m.maps.albedo, true), load(m.maps.normal, false), load(m.maps.rough, false)]);
      sets[name] = { map, normalMap, roughnessMap };
    }),
  );
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`/models/village/village_houses.glb?t=${Date.now()}`);
  const info: Record<string, number> = {};
  gltf.scene.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    for (const mat of mats) {
      const m = mat as MeshStandardMaterial;
      const set = sets[m.name];
      if (set) {
        m.map = set.map;
        m.normalMap = set.normalMap;
        m.normalScale.set(1, -1); // glTF tangent space without tangents (as GLTFLoader does)
        m.roughnessMap = set.roughnessMap;
        m.roughness = 1;
        m.metalness = 0;
        m.envMapIntensity = 0.35;
        m.needsUpdate = true;
      } else if (m.name === "M_glass") {
        m.roughness = 0.04;
        m.metalness = 0.0;
        m.envMapIntensity = 1.6;
        m.depthWrite = false;
        m.opacity = 0.5;
      } else if (m.name === "M_window") {
        m.emissive.set("#FFB066");
        if (!glows.includes(m)) glows.push(m);
      } else if (m.name === "M_lamp") {
        m.emissive.set("#9CCBFF");
        if (!lamps.includes(m)) lamps.push(m);
      }
    }
    const g = mesh.geometry;
    info[mesh.name] = (info[mesh.name] ?? 0) + (g.index ? g.index.count : g.attributes.position!.count) / 3;
  });
  scene.add(gltf.scene);
  // where X2's porch lamps are (porch_kit.py): the gable porch's downlight, the box canopies' two, the wall lights
  const kind = HOUSE_PORCH_KIND[house];
  const lampAt: Array<[number, number, number]> =
    kind === "gable" ? [[0, 3.4, 4.19]] : kind === "canopy" && house !== "house_8" ? [[-0.65, 3.4, ZF + 0.85], [0.65, 3.4, ZF + 0.85]] : [[-1.3, 2.3, ZF + 0.2], [1.3, 2.3, ZF + 0.2]];
  for (const p of lampAt) {
    const l = new PointLight("#FFB877", 2.2, 6, 2);
    l.position.copy(L(...p));
    l.visible = lookTime === "night";
    porchLights.push(l);
    scene.add(l);
  }
  let veg: VillageVegetation | null = null;
  if (q.get("veg") !== "cards") {
    veg = await createVegetation(gltf.scene, "high", "new");
    if (veg) {
      // only the flowers, grass tufts and mulch grown from the houses' cards: the village's trees (grown from its own
      // baked data at their pre-A8 places, X4 moves seven) are not this page's subject
      for (const c of [...veg.group.children]) if (!c.name.startsWith("veg_flowers")) veg.group.remove(c);
      scene.add(veg.group);
    }
    (W as unknown as { __veg: unknown }).__veg = veg ? (veg as unknown as { stats?: unknown }).stats ?? true : null;
  }
  setTime(lookTime);
  setView(q.get("view") ?? "street");
  W.__view = setView;
  W.__time = setTime;
  W.__info = info;
  let frames = 0;
  const t0 = performance.now();
  const tick = () => {
    veg?.update(camera, (performance.now() - t0) / 1000, innerHeight);
    renderer.render(scene, camera);
    if (++frames === 4) W.__ready = true;
    requestAnimationFrame(tick);
  };
  tick();
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

void main();
