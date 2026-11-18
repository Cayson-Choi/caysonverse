/**
 * DEV look-dev for B3's lot models (lots v2: 마을 절 outside, the 대웅전 room, the polished 케이슨랜드 정문), in the browser with the
 * game's own KTX2 path: each model's texture manifest (`lots/<dir>/<model>_textures.json`) names PBR library sets loaded through
 * pbrLibrary.ts (getPbrSet → createPbrMaterial, repeatMeters [1, 1], COLOR_0 tint) or the lot's own KTX2 atlas, under the village's
 * day / night light (dayNightBlend). In the room the B3s sacred props (KTX2 GLBs) are loaded at their `lotstatue__` / `lotart__`
 * markers (asset.extras.sacred: PC or phone file, the right 협시보살 mirrored), as L5v2 will. Driven by e2e/temple-lookdev.mjs.
 *   ?model=lot_temple|lot_temple_hall|lot_gate   ?time=day|night   ?tier=2k|1k (PC / phone)   ?view=<name>
 */
import {
  AdditiveBlending,
  AmbientLight,
  Color,
  DirectionalLight,
  DoubleSide,
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
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { DRACOLoader, GLTFLoader } from "three-stdlib";
import { GLTFLoader as GLTFLoaderJsm } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DAY_LOOK, NIGHT_LOOK, NIGHT_MOON, directionFrom } from "../src/village/dayNightBlend";
import { createPbrMaterial, getPbrKtx2Loader, getPbrSet, type PbrTier } from "../src/village/pbr/pbrLibrary";
import { lotLocalToWorld, villageLot, LOT_INTERIORS, type LotId } from "@caysonverse/shared/village/villageLots";

type View = [x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number];

/** Camera presets: [eye local (x, y, z), target local, vertical fov]. Outsides: the lot frame; the room: the room frame. */
export const VIEWS: Record<string, Record<string, View>> = {
  lot_temple: {
    street: [4, 1.7, 24, 0, 4.5, 0, 50], gate: [0.6, 1.6, 17, 0, 4.2, 11, 45], approach: [0.4, 1.6, 11, 0, 4.5, -6, 55],
    hall: [2, 1.6, 2, 0, 5, -7, 60], eaves: [3.5, 1.5, -2.6, 2, 5.4, -5.2, 60], pagoda: [-1.5, 1.6, 6.5, -5, 3.2, 2.5, 50],
    bell: [-6, 1.6, -4, -9.7, 2.6, -8.5, 55], pond: [3, 1.6, 0.5, 7.2, 0, 6, 50], court: [6.5, 1.7, 9.5, -2, 3.5, -4, 60],
  },
  lot_temple_hall: {
    entry: [5.7, 1.6, 0.9, 5.7, 2.4, 7, 65], cushion: [4.9, 0.95, 2.8, 5.7, 2.4, 7, 55], buddha: [5.7, 1.7, 4.2, 5.7, 2.6, 6.6, 45],
    buddha_face: [5.8, 2.75, 5.05, 5.7, 3.0, 6.5, 30], datjip: [5.7, 1.6, 3.3, 5.7, 4.9, 6.3, 60], ceiling: [5.7, 1.5, 1.5, 5.7, 6, 4.5, 75],
    offering: [6.6, 1.35, 4.0, 5.7, 0.95, 5.15, 50], doors: [5.7, 1.6, 5.0, 5.7, 2.0, 0, 65],
    bodhi: [4.7, 1.7, 4.4, 3.55, 2.5, 6.4, 40], bodhi_face: [3.9, 2.6, 5.3, 3.55, 3.05, 6.4, 28], taenghwa: [5.7, 1.9, 2.4, 5.7, 3.6, 7.2, 55],
    scroll: [3.2, 1.7, 4.6, 1.85, 2.5, 7.3, 45], hands: [5.7, 2.0, 5.0, 5.55, 2.0, 6.4, 28],
  },
  lot_gate: {
    street: [3, 1.7, 17, 0, 6.5, -4.5, 60], plaza: [-8, 1.6, 5.5, 0, 4.5, -4, 60], marquee: [0, 3, 8, 0, 10.4, -4, 40],
    booth: [6.9, 1.6, -1.6, 6.9, 2.4, -3.8, 45], fountain: [3.2, 1.6, 5.2, 0, 1, 0.8, 50],
  },
};

const DIR: Record<string, string> = { lot_temple: "temple", lot_temple_hall: "temple", lot_gate: "martgate" };
const TEX: Record<string, string> = { lot_temple: "lot_temple", lot_temple_hall: "lot_temple_hall", lot_gate: "lot_gate" };

interface ManMat { pbr?: string; kind?: string; roughnessScale?: number; normalScale?: number; metal?: boolean; maps?: { albedo: string } }
interface Sacred { node: string; file: string; phone: string; mirrorX: boolean }

const W = window as unknown as { __ready: boolean; __info: unknown };

export async function runTempleLookdev(defaultModel: string): Promise<void> {
  const q = new URLSearchParams(location.search);
  const model = q.get("model") ?? defaultModel;
  const night = q.get("time") === "night";
  const tier = (q.get("tier") === "1k" ? "1k" : "2k") as PbrTier;
  const room = LOT_INTERIORS.find((i) => i.unit === model);
  const lotId = (room ? room.lot : model) as LotId;
  const lot = villageLot(lotId);
  const unit = room ? lot.units.find((u) => u.id === model)! : null;
  const dir = DIR[model]!;
  const t0 = performance.now();

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = (night ? NIGHT_LOOK.exposure : DAY_LOOK.exposure) * (room ? 1.15 : 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new Scene();
  const look = night ? NIGHT_LOOK : DAY_LOOK;
  scene.background = new Color(room ? "#2a1c14" : night ? NIGHT_LOOK.sky : DAY_LOOK.sky);
  scene.add(new HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity * (room ? 0.5 : 0.6)));
  const c0 = room ? new Vector3(unit!.interior.origin.x + unit!.interior.size.x / 2, 0, unit!.interior.origin.z + unit!.interior.size.z / 2) : new Vector3(lot.centre.x, 0, lot.centre.z);
  if (!room) {
    const sunDir = night ? directionFrom(NIGHT_MOON.azimuthDeg, NIGHT_MOON.elevationDeg) : directionFrom(200, 38);
    const key = new DirectionalLight(night ? NIGHT_LOOK.moonColor : DAY_LOOK.keyColor, night ? NIGHT_LOOK.moonIntensity : DAY_LOOK.keyIntensity);
    key.position.set(c0.x + sunDir[0] * 60, sunDir[1] * 60, c0.z + sunDir[2] * 60);
    key.target.position.copy(c0);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.far = 160;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    scene.add(key, key.target);
    const g = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: "#8FA86A", roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(c0.x, -0.01, c0.z);
    g.receiveShadow = true;
    scene.add(g);
  } else {
    // the room: warm baked-like fill (L6 bakes the real bounce), daylight through the 창호지 front, soft accents on the figures
    const o = unit!.interior.origin;
    scene.add(new AmbientLight("#ffe6c8", night ? 0.35 : 0.6));
    const front = new PointLight(night ? "#ffb070" : "#fff2dc", night ? 14 : 30, 14, 1.4);
    front.position.set(o.x + 5.7, 2.6, o.z + 1.2);
    scene.add(front);
    for (const [x, y, z, w] of [[5.7, 4.6, 3.6, 60], [3.4, 4.2, 4.0, 22], [8.0, 4.2, 4.0, 22]] as const) {
      const s = new SpotLight("#ffd9a0", w, 9, Math.PI / 7, 0.6, 1.5);
      s.position.set(o.x + x, y, o.z + z);
      s.target.position.set(o.x + x, 2.4, o.z + 6.5);
      scene.add(s, s.target);
    }
    for (const x of [4.45, 6.95]) {
      const c = new PointLight("#ffb466", 1.8, 3, 1.8);
      c.position.set(o.x + x, 1.7, o.z + 5.15);
      scene.add(c);
    }
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(`/models/village/lots/${model}.glb`);
  const man = (await (await fetch(`/models/village/lots/${dir}/${TEX[model]}_textures.json`)).json()) as { materials: Record<string, ManMat> };
  const mats = new Map<string, Material>();
  const sets: Record<string, unknown> = {};
  for (const [name, m] of Object.entries(man.materials)) {
    if (m.kind === "glass") {
      mats.set(name, new MeshStandardMaterial({ color: "#a8bcc4", roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }));
      continue;
    }
    if (m.kind === "screen" || m.kind === "emit") {
      mats.set(name, new MeshBasicMaterial({ vertexColors: true, toneMapped: true }));
      continue;
    }
    if (m.kind === "lamp") {
      mats.set(name, new MeshStandardMaterial({ color: "#f4efe2", roughness: 0.15, emissive: new Color("#4a4640") }));
      continue;
    }
    if (m.kind === "fire") {
      mats.set(name, new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }));
      continue;
    }
    if (m.kind === "own") {
      const tex = await getPbrKtx2Loader(renderer).loadAsync(`/models/village/lots/${dir}/${m.maps!.albedo}`);
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = false;
      mats.set(name, new MeshStandardMaterial({ map: tex, roughness: 0.6, side: DoubleSide }));
      continue;
    }
    const set = await getPbrSet(m.pbr!, tier, renderer);
    sets[m.pbr!] = set.info.id;
    const mat = createPbrMaterial(set, { repeatMeters: [1, 1] });
    mat.vertexColors = q.get("novc") !== "1";
    mat.metalness = m.metal ? 1 : 0;
    mat.roughness = m.roughnessScale ?? 1;
    mats.set(name, mat);
  }
  // dancheong_wood is an atlas (tileMeters 1, process.atlas): metal only where its ORM says (gold leaf)
  const glow = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  let tris = 0;
  gltf.scene.traverse((o: Object3D) => {
    const me = o as Mesh;
    if (!me.isMesh) return;
    if (o.name.startsWith("col__")) {
      o.visible = false;
      return;
    }
    const nightPart = o.name.startsWith("lotnight__") || o.parent?.name.startsWith("lotnight__");
    if (nightPart) {
      o.visible = night;
      me.material = glow;
      return;
    }
    const src = me.material as Material;
    me.material = mats.get(src.name) ?? src;
    if ((src.name ?? "").includes("dancheong")) (me.material as MeshStandardMaterial).metalness = 1;
    me.castShadow = !room;
    me.receiveShadow = true;
    const g = me.geometry;
    tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
  });
  scene.add(gltf.scene);
  // the sacred props at their markers (the B3s GLBs carry their own KTX2 maps)
  const sacred = ((gltf.parser.json as { asset?: { extras?: { sacred?: Sacred[] } } }).asset?.extras?.sacred) ?? [];
  if (sacred.length) {
    const sl = new GLTFLoaderJsm().setKTX2Loader(getPbrKtx2Loader(renderer));
    gltf.scene.updateMatrixWorld(true);
    for (const s of sacred) {
      const marker = gltf.scene.getObjectByName(s.node);
      if (!marker) continue;
      const g = await sl.loadAsync(`/models/village/lots/${tier === "1k" ? s.phone : s.file}`);
      g.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.receiveShadow = true;
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
        if (s.mirrorX) for (const mt of ([] as Material[]).concat(m.material as Material)) mt.side = DoubleSide;
      });
      marker.add(g.scene);
    }
  }
  if (night && !room) {
    const pts: Vector3[] = [];
    gltf.scene.traverse((o) => {
      if (o.name.startsWith("lotnight__") && (o as Mesh).isMesh) {
        const g = (o as Mesh).geometry;
        g.computeBoundingBox();
        pts.push(g.boundingBox!.getCenter(new Vector3()).applyMatrix4(o.matrixWorld));
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
  W.__info = { model, view: vname, tier, night, triangles: Math.round(tris), sets, gpu: renderer.info.memory, draws: renderer.info.render.calls, ms: Math.round(performance.now() - t0) };
  W.__ready = true;
}
