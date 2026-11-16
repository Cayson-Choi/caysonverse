/**
 * DEV look-dev for the plants rebuild (2026-11-16): the plant atlas, and the bushes and bedding plants under the game's
 * vegetation material (vegMaterial.ts, the same shading), on a granite planter. Driven by e2e/plants-lookdev.mjs.
 *   ?atlas                      the atlas
 *   ?scene=planter&cam=close    a square planter (boxwood ball + bed) close up; cam=play: from 6 m; cam=top; cam=bush
 *   ?scene=bushes               boxwood and azalea side by side
 *   ?scene=bed&species=0,1      a bed of the listed species (flowerPlacement.SPECIES order)
 */
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from "three";
import { drawPlantAtlas, makePlantAtlas } from "../src/village/veg/vegPlantAtlas";
import { bushPlant, plantMeshes, type BushSpecies } from "../src/village/veg/vegPlants";
import { vegMaterial } from "../src/village/veg/vegMaterial";
import { linearHex, PALETTES } from "../src/village/veg/flowerPlacement";
import { mulberry32 } from "../src/village/veg/vegRandom";

const q = new URLSearchParams(location.search);
const W = window as unknown as { __ready: boolean; __info: unknown };

if (q.has("atlas")) {
  const c = document.createElement("canvas");
  drawPlantAtlas(c);
  document.body.style.background = q.get("bg") ?? "#556";
  document.body.appendChild(c);
  W.__ready = true;
} else {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(q.get("exp") ?? 1.25);
  renderer.outputColorSpace = SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color("#a9c3da");
  const atlas = makePlantAtlas();
  const flowerMat = vegMaterial({ name: "M_veg_flowers", push: true, map: atlas, alphaTest: 0.5, wind: 0, windFar: 10, ambient: 0.5, sky: 0.12, sun: 0.5, back: 0.45 });
  const bushMat = vegMaterial({ name: "M_veg_bush", push: true, map: atlas, alphaTest: 0.5, wind: 0, windFar: 20, ambient: 0.5, sky: 0.22, sun: 0.4, back: 0.35 });
  const flat = (hex: string) => new MeshBasicMaterial({ color: new Color(hex) });
  const ground = new Mesh(new PlaneGeometry(40, 40), flat("#b9b4ac"));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const tris: Record<string, number> = {};
  const inst = (geo: BufferGeometry, mat: Material, items: Array<{ m: Matrix4; tint: number[] }>, key: string) => {
    const mesh = new InstancedMesh(geo, mat, items.length);
    geo.setAttribute("aLight", new InstancedBufferAttribute(new Float32Array(items.length).fill(1), 1));
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, new Color(it.tint[0], it.tint[1], it.tint[2]));
    });
    scene.add(mesh);
    tris[key] = (tris[key] ?? 0) + ((geo.index?.count ?? 0) / 3) * items.length;
  };
  const meshes = plantMeshes();
  const lod = Number(q.get("lod") ?? 0);
  const pick = (pal: ReadonlyArray<readonly [string, number]>, u: number) => {
    let t = u * pal.reduce((a, [, w]) => a + w, 0);
    for (const [h, w] of pal) {
      if (t < w) return linearHex(h);
      t -= w;
    }
    return linearHex(pal[0]![0]);
  };
  const UP = new Vector3(0, 1, 0);
  const plantM = (x: number, y: number, z: number, yaw: number, s: number) => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(s, s, s));
  const MARI = ["#F7B500", "#F08A1C", "#FFCC1A", "#E2601A"];
  const bed = (x0: number, x1: number, z0: number, z1: number, y: number, species: number[], hole: [number, number, number] | null, seed: number) => {
    const rand = mulberry32(seed);
    const per = new Map<number, Array<{ m: Matrix4; tint: number[] }>>();
    const placed: Array<[number, number]> = [];
    const spacing = [0.2, 0.15, 0.12, 0.15, 0, 0, 0.2];
    for (let i = 0; i < 4000; i++) {
      const x = x0 + rand() * (x1 - x0);
      const z = z0 + rand() * (z1 - z0);
      if (hole && Math.hypot(x - hole[0], z - hole[1]) < hole[2]) continue;
      const drift = Math.floor((x + 10) / 0.5) * 7 + Math.floor((z + 10) / 0.5) * 13;
      const s = species[drift % species.length]!;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < spacing[s]!)) continue;
      placed.push([x, z]);
      const pal = s === 0 ? PALETTES.petunia : s === 1 ? (drift % 3 ? PALETTES.pansy : PALETTES.viola) : s === 2 ? PALETTES.muscari : PALETTES.tulip;
      const tint = s === 6 ? linearHex(MARI[drift % 4]!) : pick(pal, ((drift * 0.6180339) % 1 + rand() * 0.15) % 1);
      if (!per.has(s)) per.set(s, []);
      per.get(s)!.push({ m: plantM(x, y, z, rand() * 6.28, 1 + 0.35 * rand()), tint: [...tint] });
      if (!per.has(7)) per.set(7, []);
      per.get(7)!.push({ m: plantM(x, y + rand() * 0.003, z, rand() * 6.28, 0.9 + 0.3 * rand()), tint: [1, 1, 1] });
    }
    for (const [s, items] of per) inst(lod ? meshes[s]!.lod1 : meshes[s]!.lod0, flowerMat, items, s === 7 ? "mulch" : "flowers");
  };
  const soil = (x: number, z: number, w: number, d: number, y: number) => {
    const m = new Mesh(new PlaneGeometry(w, d), flat("#4a3424"));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    scene.add(m);
  };
  const bush = (sp: BushSpecies, x: number, y: number, z: number, r: number, h: number, tint: number[]) => {
    const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, Number(q.get("yaw") ?? 0.7)), new Vector3(r, h, r));
    inst(bushPlant(sp, lod as 0 | 1 | 2), bushMat, [{ m, tint }], "bush");
  };
  const scn = q.get("scene") ?? "planter";
  const camAt = (eye: [number, number, number], look: [number, number, number], fov = 45) => {
    const cam = new PerspectiveCamera(fov, innerWidth / innerHeight, 0.05, 500);
    cam.position.set(...eye);
    cam.lookAt(...look);
    return cam;
  };
  let cam = camAt([1.6, 1.5, 1.6], [0, 0.8, 0]);
  if (scn === "planter") {
    const box = new Mesh(new BoxGeometry(2.2, 0.5, 2.2), flat("#9d9a94"));
    box.position.y = 0.25;
    scene.add(box);
    soil(0, 0, 1.9, 1.9, 0.505);
    bush((q.get("sp") as BushSpecies) ?? "boxwood", 0, 0.5, 0, 0.94, 1.155, [0.97, 1.0, 0.94]);
    bed(-0.92, 0.92, -0.92, 0.92, 0.51, (q.get("species") ?? "0,1,2,6").split(",").map(Number), [0, 0, 0.62], 7);
    const c = q.get("cam") ?? "close";
    cam =
      c === "play"
        ? camAt([4.6, 2.6, 4.2], [0, 0.7, 0], 50)
        : c === "top"
          ? camAt([0.9, 2.2, 0.9], [0, 0.4, 0], 50)
          : c === "bush"
            ? camAt([1.15, 1.3, 1.15], [0, 1.0, 0], 40)
            : camAt([1.75, 1.4, 1.6], [0, 0.75, 0], 45);
  } else if (scn === "bushes") {
    bush("boxwood", -0.8, 0, 0, 0.6, 0.95, [0.97, 1.0, 0.94]);
    bush("azalea", 0.8, 0, 0, 0.62, 0.95, [...linearHex("#D62E7A")]);
    cam = q.get("cam") === "play" ? camAt([0, 2.2, 6.5], [0, 0.5, 0], 45) : camAt([0, 1.3, 2.6], [0, 0.45, 0], 45);
  } else if (scn === "bed") {
    soil(0, 0, 2, 2, 0.005);
    bed(-1, 1, -1, 1, 0.01, (q.get("species") ?? "0").split(",").map(Number), null, 11);
    cam = q.get("cam") === "play" ? camAt([0, 2.0, 4.5], [0, 0.1, 0], 45) : camAt([0, 0.7, 1.3], [0, 0.1, 0], 45);
  }
  renderer.render(scene, cam);
  requestAnimationFrame(() => {
    renderer.render(scene, cam);
    W.__info = tris;
    W.__ready = true;
  });
}
