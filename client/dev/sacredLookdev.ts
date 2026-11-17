/**
 * DEV look-dev for the B2s/B3s sacred props (client/public/models/village/lots/sacred/*.glb, KTX2 textures).
 *   ?item=lotstatue__lot_chapel_nave_mary&cam=close|full|seat   one prop; cam=close is 1 m from the face, seat is ~6 m (pews/cushions)
 *   &tier=phone                                                 the *_phone GLB (phone LOD + 512 px maps)
 *   &room=chapel|temple|church                                   wall/floor tone and light colour
 * Writes window.__info = { tris, gpuTextures } and window.__ready = true when drawn.
 */
import {
  ACESFilmicToneMapping, AmbientLight, Box3, BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, SpotLight, SRGBColorSpace, Vector3, WebGLRenderer,
  type Material, type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import transcoderUrl from "three/examples/jsm/libs/basis/basis_transcoder.js?url";

const q = new URLSearchParams(location.search);
const W = window as unknown as { __ready: boolean; __info: unknown };
const item = q.get("item") ?? "lotstatue__lot_chapel_nave_mary";
const tier = q.get("tier") === "phone" ? "_phone" : "";
const room = q.get("room") ?? (item.includes("temple") ? "temple" : item.includes("church") ? "church" : "chapel");
const cam = q.get("cam") ?? "full";

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(q.get("exp") ?? 1.0);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const tone = { chapel: ["#8c8274", "#a39d93", "#ffd9a8"], temple: ["#5a2a1e", "#6b4a33", "#ffc98a"], church: ["#d8d0c2", "#8a6a4a", "#fff0d8"] }[room]!;
scene.background = new Color(tone[0]);
const pm = new PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const glassItem = item.startsWith("lotglass");
scene.environmentIntensity = glassItem ? 0.12 : room === "temple" ? 0.8 : 0.4;
scene.add(new AmbientLight(tone[2], glassItem ? 0.05 : 0.2));
const key = new SpotLight(tone[2], 60, 0, Math.PI / 6, 0.6, 1.6);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
scene.add(key, key.target);
const fill = new DirectionalLight(room === "chapel" ? "#cfe0ff" : tone[2], 0.6);
scene.add(fill);
const floor = new Mesh(new PlaneGeometry(30, 30), new MeshStandardMaterial({ color: tone[1], roughness: 0.6 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wall = new Mesh(new PlaneGeometry(30, 12), new MeshStandardMaterial({ color: tone[0], roughness: 0.9 }));
scene.add(wall);

const ktx2 = new KTX2Loader().setTranscoderPath(transcoderUrl.replace(/basis_transcoder\.js.*$/, "")).detectSupport(renderer);
const loader = new GLTFLoader().setKTX2Loader(ktx2);
const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);

loader.load(`/models/village/lots/sacred/${item}${tier}.glb`, (g) => {
  const obj: Object3D = g.scene;
  let tris = 0;
  const textures = new Set<unknown>();
  obj.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    const idx = m.geometry.index; tris += (idx ? idx.count : m.geometry.attributes.position.count) / 3;
    for (const mat of ([] as Material[]).concat(m.material as Material)) {
      const s = mat as MeshStandardMaterial;
      for (const t of [s.map, s.normalMap, s.roughnessMap, s.aoMap, s.emissiveMap]) if (t) textures.add(t);
      if (s.name?.startsWith("M_glass")) { s.emissiveIntensity = 1.6; }
    }
  });
  // statues stand on a plinth (chapel 0.9 m, temple 수미단 1.1 m); wall pieces hang with their bottom at 1.2 m
  const isWall = /lotglass|lotart|lotprop|crucifix/.test(item);
  const box = new Box3().setFromObject(obj);
  const size = box.getSize(new Vector3());
  const plinth = isWall ? (item.includes("station") ? 1.4 : item.includes("crucifix") ? 2.2 : 1.2) : room === "temple" ? 1.1 : 0.9;
  obj.position.y += plinth - box.min.y;
  obj.position.x -= (box.min.x + box.max.x) / 2;
  const back = isWall ? box.min.z - 0.02 : box.min.z - 0.6;
  obj.position.z -= back; // the prop's back at z = 0
  wall.position.set(0, 6, 0);
  if (!isWall) {
    const p = new Mesh(new BoxGeometry(size.x * 1.15, plinth, size.z * 1.15), new MeshStandardMaterial({ color: room === "temple" ? "#6e1c12" : "#d9d2c6", roughness: 0.5 }));
    p.position.set(0, plinth / 2, 0.6 + size.z / 2); p.receiveShadow = true; scene.add(p);
  }
  scene.add(obj);
  const H = size.y, cy = plinth + H * 0.55, cz = isWall ? 0.05 : 0.6 + size.z / 2;
  key.position.set(-1.8, plinth + H + 1.8, cz + 3); key.target.position.set(0, cy, cz);
  fill.position.set(3, plinth + H, cz + 2);
  const shots: Record<string, [Vector3, Vector3]> = {
    close: [new Vector3(0.2, plinth + H * 0.82, cz + 1.0 + size.z / 2), new Vector3(0, plinth + H * 0.8, cz)],
    full: [new Vector3(0.4, cy, cz + Math.max(2.4, H * 1.9)), new Vector3(0, cy, cz)],
    seat: [new Vector3(-1.2, room === "temple" ? 0.8 : 1.1, cz + 6), new Vector3(0, cy, cz)],
  };
  const [eye, at] = shots[cam] ?? shots.full;
  camera.position.copy(eye); camera.lookAt(at);
  renderer.render(scene, camera);
  W.__info = { item, tier: tier || "pc", tris, textures: textures.size, size: size.toArray().map((v) => +v.toFixed(3)) };
  W.__ready = true;
}, undefined, (e) => { W.__info = { error: String(e) }; W.__ready = true; });
