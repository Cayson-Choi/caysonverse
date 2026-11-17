/**
 * DEV look-dev for B2's lot models (lots v2: 성당 lot_chapel and 교회 lot_church, outside and their walk-in rooms), in the
 * browser with the game's own KTX2 path: the texture manifest (`lots/<dir>/<model>_textures.json`) names PBR library sets
 * (pbrLibrary.ts getPbrSet → createPbrMaterial, repeatMeters [1, 1], COLOR_0 tint) and the lot's own KTX2 maps (the light
 * pools); the rooms load their sacred props (asset.extras.sacred: statues, stained glass, KTX2) at their placements, the
 * phone tier loads `<unit>_phone.glb` and the props' *_phone files. Day / night under the village's look (dayNightBlend);
 * inside, a few warm lights stand in for L6's baked light (chandeliers, the altar, the statues, the candles).
 *   ?model=lot_chapel|lot_church|lot_chapel_nave|lot_church_nave   ?time=day|night   ?tier=2k|1k   ?view=<name>
 * Driven by e2e/chapel-lookdev.mjs and e2e/church-lookdev.mjs (window.__ready / window.__info).
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
import { DAY_LOOK, NIGHT_LOOK, NIGHT_MOON, directionFrom } from "../src/village/dayNightBlend";
import { createPbrMaterial, getPbrKtx2Loader, getPbrSet, type PbrTier } from "../src/village/pbr/pbrLibrary";
import { lotLocalToWorld, villageLot, LOT_INTERIORS, type LotId } from "@caysonverse/shared/village/villageLots";

type View = [x: number, y: number, z: number, tx: number, ty: number, tz: number, fov: number];

/** Camera presets: [eye (x, y, z), target, vertical fov]. Outsides: the lot frame; rooms: the room frame. */
export const VIEWS: Record<string, Record<string, View>> = {
  lot_chapel: {
    street: [2, 1.7, 26, 0, 8, -2, 50], corner: [15, 1.8, 19, 0, 7.5, -2, 52], entrance: [0.8, 1.6, 9.5, 0, 3.2, 4, 55],
    portal: [0.4, 1.55, 7.2, 0, 2.6, 4.8, 55], fountain: [5.2, 1.6, 2.8, 8.2, 0.6, -1.4, 55], rosearch: [-8.2, 1.6, 3.6, -8.2, 2, -2, 55],
    spire: [5, 2, 14, 0, 16.5, 4.4, 40],
  },
  lot_church: {
    street: [2, 1.7, 26, 0, 8.5, -2, 50], corner: [14, 1.8, 17, 0, 8, -2.5, 52], porch: [0.5, 1.55, 6.6, 0, 2.6, 2.9, 55],
    entrance: [0.8, 1.6, 9, 0, 3, 3, 55], bench: [-7, 1.2, 7.5, -7, 0.7, 4.3, 50], steeple: [5, 2, 12, 0, 15, 1.5, 42],
  },
  lot_chapel_nave: {
    entry: [4.7, 1.62, 0.9, 4.7, 2.7, 12.5, 62], seat: [2.55, 1.05, 4.15, 4.5, 2.4, 12.8, 58], altar: [4.7, 1.6, 9.0, 4.7, 2.6, 13.2, 52],
    mary: [2.3, 1.55, 8.3, 0.6, 1.85, 9.9, 45], glass: [6.9, 2.3, 4.3, 9.4, 4.3, 5.1, 55], rose: [4.7, 1.7, 9.6, 4.7, 6.0, 0, 60],
    crucifix: [4.7, 1.9, 10.3, 4.7, 3.4, 13.1, 45], pools: [7.4, 2.4, 3.0, 3.6, 0, 9.0, 60],
  },
  lot_church_nave: {
    entry: [3.9, 1.62, 0.8, 3.9, 2.4, 10.4, 62], seat: [2.15, 1.05, 3.9, 3.9, 2.0, 10.4, 58], chancel: [3.9, 1.6, 6.9, 3.9, 2.6, 10.4, 52],
    cross: [3.9, 1.7, 8.2, 3.9, 3.4, 10.4, 45], window: [5.2, 1.7, 4.6, 7.8, 3.0, 5.7, 52], ceiling: [3.9, 1.6, 1.2, 3.9, 6.8, 7, 65],
  },
};

interface ManMat { pbr?: string; kind?: string; roughnessScale?: number; normalScale?: number; metal?: boolean; maps?: { albedo: string } }
interface Sacred { node: string; file: string; phoneFile: string; phone: boolean; drawOnly?: string; showOnly?: string; hidePrefix?: string; glass?: { emissiveIntensity: { day: number; night: number } } }

const W = window as unknown as { __ready: boolean; __info: unknown };

/** The warm lights that stand in for L6's bake inside (room frame): [x, y, z, colour, intensity, distance] and spots. */
const ROOM_LIGHTS: Record<string, { points: [number, number, number, string, number, number][]; spots: [number, number, number, number, number, number, string, number][] }> = {
  lot_chapel_nave: {
    points: [[4.7, 3.9, 5.1, "#ffc98a", 9, 9], [4.7, 3.9, 8.5, "#ffc98a", 9, 9], [0.6, 1.2, 9.6, "#ffaa66", 1.2, 2.5], [4.7, 1.8, 11.9, "#ffbb77", 1.5, 3], [4.7, 5.3, 1.4, "#ffd09a", 2.5, 6]],
    spots: [[4.7, 7.0, 9.4, 4.7, 2.2, 12.6, "#ffe0b8", 60], [0.6 + 2.6, 5.2, 9.85 - 2.6, 0.6, 1.75, 9.85, "#ffe4c4", 30], [8.8 - 2.6, 5.2, 9.85 - 2.6, 8.8, 1.75, 9.85, "#ffe4c4", 30]],
  },
  lot_church_nave: {
    points: [[3.9, 3.6, 3.6, "#ffcf96", 7, 8], [3.9, 3.6, 6.9, "#ffcf96", 7, 8], [3.9, 1.5, 9.7, "#ffbb77", 1.2, 3]],
    spots: [[3.9, 5.6, 6.6, 3.9, 3.2, 10.4, "#fff0d8", 40]],
  },
};

export async function runLookdev(defaultModel: string): Promise<void> {
  const q = new URLSearchParams(location.search);
  const model = q.get("model") ?? defaultModel;
  const night = q.get("time") === "night";
  const tier = (q.get("tier") === "1k" ? "1k" : "2k") as PbrTier;
  const phone = tier === "1k";
  const room = LOT_INTERIORS.find((i) => i.unit === model);
  const lotId = (room ? room.lot : model) as LotId;
  const lot = villageLot(lotId);
  const unit = room ? lot.units.find((u) => u.id === model)! : null;
  const dir = lotId === "lot_chapel" ? "chapel" : "church";
  const t0 = performance.now();

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = (night ? NIGHT_LOOK.exposure : DAY_LOOK.exposure) * (room ? 1.15 : 1.0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(night ? NIGHT_LOOK.sky : DAY_LOOK.sky);
  const look = night ? NIGHT_LOOK : DAY_LOOK;
  scene.add(new HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity * (room ? 0.5 : 0.6)));
  const sunDir = night ? directionFrom(NIGHT_MOON.azimuthDeg, NIGHT_MOON.elevationDeg) : directionFrom(200, 38);
  const key = new DirectionalLight(night ? NIGHT_LOOK.moonColor : DAY_LOOK.keyColor, (night ? NIGHT_LOOK.moonIntensity : DAY_LOOK.keyIntensity) * (room ? 0.35 : 1));
  const c0 = room ? new Vector3(unit!.interior.origin.x + unit!.interior.size.x / 2, 0, unit!.interior.origin.z + unit!.interior.size.z / 2) : new Vector3(lot.centre.x, 0, lot.centre.z);
  key.position.set(c0.x + sunDir[0] * 60, sunDir[1] * 60, c0.z + sunDir[2] * 60);
  key.target.position.copy(c0);
  key.castShadow = !room;
  key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -28;
  sc.right = sc.top = 28;
  sc.far = 170;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);
  if (room) scene.add(new AmbientLight("#ffe9d0", night ? 0.35 : 0.6)); // stands in for L6's baked bounce
  if (!room) {
    const g = new Mesh(new PlaneGeometry(220, 220), new MeshStandardMaterial({ color: "#8FA86A", roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(c0.x, -0.01, c0.z);
    g.receiveShadow = true;
    scene.add(g);
  }

  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const ktx2 = getPbrKtx2Loader(renderer);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2 as never);
  const file = room && phone ? `${model}_phone` : model;
  const gltf = await loader.loadAsync(`/models/village/lots/${file}.glb`);
  const man = (await (await fetch(`/models/village/lots/${dir}/${model}_textures.json`)).json()) as { materials: Record<string, ManMat> };
  const mats = new Map<string, Material>();
  const sets: Record<string, unknown> = {};
  const dayK = night ? 0.0 : 1.0;
  for (const [name, m] of Object.entries(man.materials)) {
    if (m.kind === "glass") {
      mats.set(name, new MeshStandardMaterial({ color: "#a8bcc4", roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.25, depthWrite: false }));
      continue;
    }
    if (m.kind === "screen") {
      mats.set(name, new MeshBasicMaterial({ vertexColors: true, toneMapped: true }));
      continue;
    }
    if (m.kind === "fire") {
      mats.set(name, new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }));
      continue;
    }
    if (m.kind === "lightpool" || m.kind === "own") {
      const tex = await ktx2.loadAsync(`/models/village/lots/${dir}/${m.maps!.albedo}`);
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = false;
      if (m.kind === "lightpool") {
        const mm = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 });
        mm.color.setScalar(0.85 * dayK);
        mats.set(name, mm);
      } else mats.set(name, new MeshStandardMaterial({ map: tex, roughness: 0.5 }));
      continue;
    }
    const set = await getPbrSet(m.pbr!, tier, renderer);
    sets[m.pbr!] = set.info.id;
    const mat = createPbrMaterial(set, { repeatMeters: [1, 1] });
    mat.vertexColors = true;
    mat.metalness = m.metal ? 1 : 0;
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
    if (o.name.startsWith("lotnight__") || o.parent?.name.startsWith("lotnight__")) {
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

  // the sacred props at their placements (rooms)
  const extras = (gltf.asset as { extras?: { sacred?: Sacred[] } }).extras ?? {};
  let sacredTris = 0;
  for (const s of extras.sacred ?? []) {
    if (phone && !s.phone) continue;
    const anchor = gltf.scene.getObjectByName(s.node);
    if (!anchor) continue;
    const pg = await loader.loadAsync(`/models/village/${phone ? s.phoneFile : s.file}`);
    pg.scene.traverse((o) => {
      const me = o as Mesh;
      if (!me.isMesh) return;
      const base = o.name.replace(/_phone$/, "");
      if (s.drawOnly && base !== s.drawOnly) {
        o.visible = false;
        return;
      }
      if (s.hidePrefix && o.name.startsWith(s.hidePrefix) && o.name !== s.showOnly) {
        o.visible = false;
        return;
      }
      for (const m of ([] as Material[]).concat(me.material as Material)) {
        const st = m as MeshStandardMaterial;
        if (s.glass && st.emissiveMap) st.emissiveIntensity = night ? s.glass.emissiveIntensity.night : s.glass.emissiveIntensity.day * 1.1;
      }
      me.castShadow = false;
      me.receiveShadow = true;
      const g = me.geometry;
      sacredTris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    });
    anchor.add(pg.scene);
  }
  if (room) {
    const o = unit!.interior.origin;
    const L = ROOM_LIGHTS[model] ?? { points: [], spots: [] };
    for (const [x, y, z, col, k, d] of L.points) {
      const l = new PointLight(col, k * (night ? 1.6 : 1.0), d, 1.6);
      l.position.set(o.x + x, y, o.z + z);
      scene.add(l);
    }
    for (const [x, y, z, tx, ty, tz, col, k] of L.spots) {
      const l = new SpotLight(col, k * (night ? 1.3 : 1.0), 0, Math.PI / 7, 0.6, 1.6);
      l.position.set(o.x + x, y, o.z + z);
      l.target.position.set(o.x + tx, ty, o.z + tz);
      scene.add(l, l.target);
    }
  } else if (night) {
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
  W.__info = { model, file, view: vname, tier, night, triangles: Math.round(tris), sacredTriangles: Math.round(sacredTris), sets, gpu: renderer.info.memory,
    calls: renderer.info.render.calls, ms: Math.round(performance.now() - t0) };
  W.__ready = true;
}

if (location.pathname.endsWith("chapel-lookdev.html")) void runLookdev("lot_chapel");
if (location.pathname.endsWith("church-lookdev.html")) void runLookdev("lot_church");
