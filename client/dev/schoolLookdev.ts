/**
 * DEV look-dev for B1's lot models (lots v2: the school and the library, outside and their walk-in rooms), in the browser with
 * the game's own KTX2 path: each model's texture manifest (`lots/<dir>/<model>_textures.json`) names PBR library sets, loaded
 * through pbrLibrary.ts (getPbrSet → createPbrMaterial, repeatMeters [1, 1], COLOR_0 tint), under the village's day / night
 * light (dayNightBlend DAY_LOOK / NIGHT_LOOK). Driven by e2e/school-lookdev.mjs and e2e/library-lookdev.mjs.
 *   ?model=lot_school|lot_library|lot_school_class|lot_library_reading   ?time=day|night   ?tier=2k|1k (PC / phone)
 *   ?view=<name>   a camera preset (VIEWS below; local lot frame for the outsides, the room frame inside)
 */
import {
  AdditiveBlending,
  AmbientLight,
  DoubleSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { DRACOLoader, GLTFLoader } from "three-stdlib";
import { DAY_LOOK, NIGHT_LOOK, NIGHT_MOON, directionFrom } from "../src/village/dayNightBlend";
import { createPbrMaterial, getPbrKtx2Loader, getPbrSet, type PbrTier } from "../src/village/pbr/pbrLibrary";
import { lotLocalToWorld, villageLot, LOT_INTERIORS, type LotId } from "@caysonverse/shared/village/villageLots";

type View = [x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number];

/** Camera presets: [eye local (x, y, z), target local, vertical fov]. Outsides: the lot frame; rooms: the room frame. */
export const VIEWS: Record<string, Record<string, View>> = {
  lot_school: {
    street: [1.5, 1.7, 24, 0, 6.5, -4, 50], corner: [-17, 2, 17, 0, 6, -4, 55], yard: [7.5, 1.6, 8.5, -2, 4, -3, 60],
    entrance: [0.6, 1.6, 4.5, 0, 2.6, -2, 55], door: [0.4, 1.5, 1.0, 0, 1.7, -2.3, 55], clock: [2, 3, 7, 0, 10, -3, 30],
    playground: [-2.5, 1.6, 7.5, -9, 1, 5, 55], swing: [-7, 1.4, 6.6, -8.2, 1, 3.2, 50], sandpit: [5.4, 1.5, 9.6, 5.4, 0.2, 6.5, 50],
    bench: [-5, 1.2, 0.6, -5, 0.6, -1.8, 50], window: [3.3, 1.7, -0.3, 3.3, 2, -2.1, 50], gate: [0.6, 1.6, 15, 0, 2.2, 8, 45],
  },
  lot_library: {
    street: [-2, 1.7, 22, -3, 4.5, 0, 50], corner_r: [18, 2, 15, -1, 4, -2, 55], garden: [16, 1.7, -2, 4, 3, -2, 50],
    entrance: [-2.6, 1.6, 8.5, -3, 3, 3.4, 50], door: [-2.7, 1.5, 5.6, -3, 1.8, 3.2, 50], nook: [-7, 1.4, 6, -7.1, 0.9, 3.6, 50],
    pergola: [5.4, 1.6, 2.6, 7.5, 2.4, -4.5, 60], bench: [7, 1.2, 3, 7, 0.6, 1.4, 50], book_return: [-8.6, 1.4, 6.8, -9.2, 0.8, 5.05, 45],
  },
  lot_school_class: {
    entry: [7.7, 1.6, 0.9, 6, 1.4, 6, 65], board: [11, 1.55, 5, 0, 1.5, 5, 55], windows: [3, 1.6, 3, 11, 1.8, 7.4, 65],
    seat: [4.15, 1.05, 3.6, 0, 1.4, 5, 55], corridor: [14.6, 1.6, 1.4, 2, 1.4, 0.6, 60], aquarium: [7.3, 1.35, 5.9, 7.3, 1.1, 7.2, 45],
  },
  lot_library_reading: {
    entry: [6.7, 1.6, 1.0, 6.7, 1.6, 9, 65], fireplace: [6.7, 1.6, 5.5, 6.7, 1.6, 10.4, 55], nook: [2.6, 1.4, 3.2, 2.6, 0.9, -0.6, 50],
    nook_seat: [2.4, 1.05, 0.45, 6, 1.2, 6, 60], tables: [11, 2.2, 2.8, 6.5, 0.8, 6, 60], ladder: [9, 1.6, 5, 13, 1.8, 7.5, 60],
    desk: [8, 1.5, 4, 11, 0.9, 1.8, 55],
  },
};

interface Manifest { materials: Record<string, { pbr?: string; kind?: string; roughnessScale?: number; normalScale?: number; metal?: boolean; maps?: { albedo: string } }> }

const W = window as unknown as { __ready: boolean; __info: unknown };

export async function runLookdev(defaultModel: string): Promise<void> {
  const q = new URLSearchParams(location.search);
  const model = q.get("model") ?? defaultModel;
  const night = q.get("time") === "night";
  const tier = (q.get("tier") === "1k" ? "1k" : "2k") as PbrTier;
  const room = LOT_INTERIORS.find((i) => i.unit === model);
  const lotId = (room ? room.lot : model) as LotId;
  const lot = villageLot(lotId);
  const unit = room ? lot.units.find((u) => u.id === model)! : null;
  const dir = lotId === "lot_school" ? "school" : "library";
  const t0 = performance.now();

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = night ? NIGHT_LOOK.exposure : DAY_LOOK.exposure;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(night ? NIGHT_LOOK.sky : DAY_LOOK.sky);
  const look = night ? NIGHT_LOOK : DAY_LOOK;
  scene.add(new HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity * (room ? 0.9 : 0.6)));
  const sunDir = night ? directionFrom(NIGHT_MOON.azimuthDeg, NIGHT_MOON.elevationDeg) : directionFrom(200, 38);
  const key = new DirectionalLight(night ? NIGHT_LOOK.moonColor : DAY_LOOK.keyColor, night ? NIGHT_LOOK.moonIntensity : DAY_LOOK.keyIntensity);
  const c0 = room ? new Vector3(unit!.interior.origin.x + unit!.interior.size.x / 2, 0, unit!.interior.origin.z + unit!.interior.size.z / 2) : new Vector3(lot.centre.x, 0, lot.centre.z);
  key.position.set(c0.x + sunDir[0] * 60, sunDir[1] * 60, c0.z + sunDir[2] * 60);
  key.target.position.copy(c0);
  key.castShadow = !room;
  key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -26;
  sc.right = sc.top = 26;
  sc.far = 160;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  if (room) scene.add(new AmbientLight("#fff4e6", night ? 0.25 : 0.55)); // stands in for L6's baked bounce light
  if (!room) {
    const g = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: "#8FA86A", roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(c0.x, -0.01, c0.z);
    g.receiveShadow = true;
    scene.add(g);
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(`/models/village/lots/${model}.glb`);
  const man = (await (await fetch(`/models/village/lots/${dir}/${model}_textures.json`)).json()) as Manifest;
  const mats = new Map<string, Material>();
  const sets: Record<string, unknown> = {};
  for (const [name, m] of Object.entries(man.materials)) {
    if (m.kind === "glass") {
      mats.set(name, new MeshStandardMaterial({ color: "#a8bcc4", roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.25, vertexColors: false, depthWrite: false }));
      continue;
    }
    if (m.kind === "screen") {
      mats.set(name, new MeshBasicMaterial({ vertexColors: true, toneMapped: true }));
      continue;
    }
    if (m.kind === "fire") {
      // the M_fire hook as L5v2 would draw it (static here): additive, unlit, vertex RGBA
      mats.set(name, new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }));
      continue;
    }
    if (m.kind === "own") {
      const tex = await getPbrKtx2Loader(renderer).loadAsync(`/models/village/lots/${dir}/${(m as unknown as { maps: { albedo: string } }).maps.albedo}`);
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = false;
      mats.set(name, new MeshStandardMaterial({ map: tex, roughness: 0.5 }));
      continue;
    }
    const set = await getPbrSet(m.pbr!, tier, renderer);
    sets[m.pbr!] = set.info.id;
    const mat = createPbrMaterial(set, { repeatMeters: [1, 1] });
    mat.vertexColors = q.get("novc") !== "1";
    if (m.metal) mat.metalness = 1;
    else mat.metalness = 0;
    mat.roughness = m.roughnessScale ?? 1;
    mats.set(name, mat);
  }
  const glow = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  let tris = 0;
  gltf.scene.traverse((o: Object3D) => {
    const me = o as Mesh;
    if (!me.isMesh) return;
    if (o.name.startsWith("col__")) {
      o.visible = false;
      return;
    }
    const night_ = o.name.startsWith("lotnight__") || o.parent?.name.startsWith("lotnight__");
    if (night_) {
      o.visible = night;
      me.material = glow;
      return;
    }
    const src = me.material as Material;
    me.material = mats.get(src.name) ?? src;
    me.castShadow = !room;
    me.receiveShadow = true;
    const g = me.geometry;
    tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
  });
  scene.add(gltf.scene);
  if (night) {
    // the night glow lights: a warm light at each window glow / lamp cluster (the bake does this in the game)
    const pts: Vector3[] = [];
    gltf.scene.traverse((o) => {
      if (o.name.startsWith("lotnight__") && (o as Mesh).isMesh) {
        const g = (o as Mesh).geometry;
        g.computeBoundingBox();
        const c = g.boundingBox!.getCenter(new Vector3());
        pts.push(c.applyMatrix4(o.matrixWorld));
      }
    });
    for (const p of pts.slice(0, 8)) {
      const l = new PointLight("#ffcf94", 18, 14, 1.6);
      l.position.copy(p);
      scene.add(l);
    }
  }

  const views = VIEWS[model] ?? {};
  const vname = q.get("view") ?? Object.keys(views)[0]!;
  const v = views[vname]!;
  const toWorld = (x: number, y: number, z: number): Vector3 => {
    if (room) return new Vector3(unit!.interior.origin.x + x, y, unit!.interior.origin.z + z);
    const w = lotLocalToWorld(lot, x, z);
    return new Vector3(w.x, y, w.z);
  };
  const cam = new PerspectiveCamera(v[6], innerWidth / innerHeight, 0.05, 400);
  cam.position.copy(toWorld(v[0], v[1], v[2]));
  cam.lookAt(toWorld(v[3], v[4], v[5]));
  renderer.render(scene, cam);
  await new Promise((r) => requestAnimationFrame(r));
  renderer.render(scene, cam);
  W.__info = { model, view: vname, tier, night, triangles: Math.round(tris), sets, gpu: renderer.info.memory, ms: Math.round(performance.now() - t0) };
  W.__ready = true;
}


