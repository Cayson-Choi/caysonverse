/**
 * DEV look-dev for the M1 PBR material library (client/src/village/pbr): every set on a sphere and a sample surface
 * (floor, wall or 30° roof, by what the set is for) under the village's own light, so builders and the art director can
 * judge each material photo-real up close. Driven by art/materials/tools/shoot-lookdev.mjs.
 *   ?time=day|night        DAY_LOOK / NIGHT_LOOK of village/dayNightBlend.ts (+ a warm street lamp at night)
 *   ?env=g0|none           g0 (default): a sky-matched PMREM environment as G0 will add (reflections on metal,
 *                          specular on stone); none: today's game (hemisphere + key light only)
 *   ?tier=2k|1k            the PC or the phone set
 *   ?group=ground,stone    only these groups (overview)
 *   ?set=<id>&cam=close    one set, first-person close-up (eye 1.6 m, ~1.5 m away); cam=graze: low grazing angle
 *   ?sun=az,el             the key light's direction (° clockwise from north, ° up). Default 115,35: from the right,
 *                          grazing the walls and the ground so their relief shows. sun=70,28 is the village's baked sun.
 *                          Colour and intensity are always the village's (DAY_LOOK / NIGHT_LOOK).
 */
import {
  BackSide,
  BoxGeometry,
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
  PMREMGenerator,
  PointLight,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { DAY_LOOK, NIGHT_LOOK, NIGHT_MOON, directionFrom } from "../src/village/dayNightBlend";
import {
  PBR_IDS,
  createPbrMaterial,
  flipGeometryV,
  getPbrSet,
  pbrSetInfo,
  type PbrSet,
  type PbrTier,
} from "../src/village/pbr/pbrLibrary";

const q = new URLSearchParams(location.search);
const W = window as unknown as { __ready: boolean; __info: unknown };
const night = q.get("time") === "night";
const envMode = q.get("env") ?? "g0";
const tier = (q.get("tier") === "1k" ? "1k" : "2k") as PbrTier;
const only = q.get("set");
const groups = q.get("group")?.split(",");
const cam = q.get("cam") ?? "close";

/** How each set is shown: on the ground, as a wall, or as a 30° roof. */
const WALLS = new Set(["stucco_white", "ceramic_siding", "wood_siding", "concrete_exposed", "brick_red", "tile_white", "wallpaper", "plaster_painted"]);
const ROOFS = new Set(["metal_roof_seam", "roof_shingle", "roof_giwa"]);

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

// ── light: the village's own numbers ──
const sunArg = q.get("sun")?.split(",").map(Number);
const sunDir = sunArg && sunArg.length === 2 ? directionFrom(sunArg[0]!, sunArg[1]!) : night ? directionFrom(NIGHT_MOON.azimuthDeg, NIGHT_MOON.elevationDeg) : directionFrom(115, 35);
const key = new DirectionalLight(night ? NIGHT_LOOK.moonColor : DAY_LOOK.keyColor, night ? NIGHT_LOOK.moonIntensity : DAY_LOOK.keyIntensity);
key.position.set(sunDir[0] * 50, sunDir[1] * 50, sunDir[2] * 50);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 120 });
scene.add(key, key.target);
const hemiIntensity = night ? NIGHT_LOOK.hemiIntensity : DAY_LOOK.hemiIntensity;
const hemi = new HemisphereLight(night ? NIGHT_LOOK.hemiSky : DAY_LOOK.hemiSky, night ? NIGHT_LOOK.hemiGround : DAY_LOOK.hemiGround, hemiIntensity);
scene.add(hemi);

if (envMode === "g0") {
  // a sky dome matched to the village's sky (zenith blue, hazy horizon, darker ground) with the sun/moon disc, PMREM'd
  const env = new Scene();
  const dome = new Mesh(
    new SphereGeometry(100, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new Color(night ? "#0B1430" : "#6F9BCB") },
        horizon: { value: new Color(night ? NIGHT_LOOK.sky : DAY_LOOK.sky) },
        ground: { value: new Color(night ? "#0A0C14" : "#6E6A5C") },
        scale: { value: night ? 0.6 : 1.0 },
      },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform float scale; varying vec3 vDir;" +
        "void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(horizon, zenith, pow(y, 0.6)) : mix(horizon, ground, pow(-y, 0.35));" +
        " gl_FragColor = vec4(c * scale, 1.0); }",
    }),
  );
  env.add(dome);
  const disc = new Mesh(new SphereGeometry(night ? 2 : 4, 16, 8), new MeshBasicMaterial({ color: new Color(night ? "#A6BBFF" : "#FFF0DC").multiplyScalar(night ? 3 : 40) }));
  disc.position.set(sunDir[0] * 90, sunDir[1] * 90, sunDir[2] * 90);
  env.add(disc);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  // the env carries the sky's light now: the hemisphere drops to a fill so the two do not double up
  hemi.intensity = hemiIntensity * 0.35;
  scene.environmentIntensity = night ? 0.5 : 1.0;
}

if (night) {
  // a warm street lamp (3000 K-ish) to judge the night pools on each surface
  const lamp = new PointLight("#FFC27A", 40, 18, 2);
  lamp.position.set(0, 4.5, 2);
  scene.add(lamp);
}

// ── samples ──
const ids = only ? [only] : PBR_IDS.filter((id) => !groups || groups.includes(pbrSetInfo(id).group));
const CELL = 3.2;
const COLS = only ? 1 : Math.min(4, ids.length);
const SURF = only ? 4.0 : 2.4; // metres of sample surface
const ROW = CELL * (ids.some((id) => WALLS.has(id) || ROOFS.has(id)) ? 1.6 : 1.15);
const neutral = new MeshStandardMaterial({ color: "#7d7a72", roughness: 0.9 });
const labels = document.getElementById("labels")!;
const anchors: Array<{ el: HTMLDivElement; p: Vector3 }> = [];

function place(set: PbrSet, i: number): void {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = (col - (COLS - 1) / 2) * CELL;
  const z = row * ROW;
  const mat = createPbrMaterial(set, { repeatMeters: [SURF, SURF] });
  const sphereMat = createPbrMaterial(set, { repeatMeters: [Math.PI * 0.45 * 2, Math.PI * 0.45] });
  const id = set.id;
  const r = only ? 0.6 : 0.45;
  const sphere = new Mesh(flipGeometryV(new SphereGeometry(r, 96, 48)), sphereMat);
  const surf = new Mesh(flipGeometryV(new PlaneGeometry(SURF, SURF, 1, 1)), mat);
  if (WALLS.has(id) || ROOFS.has(id)) {
    const floor = new Mesh(new PlaneGeometry(SURF, SURF), neutral);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0, z);
    floor.receiveShadow = true;
    scene.add(floor);
    if (WALLS.has(id)) {
      surf.position.set(x, SURF / 2, z - SURF / 2);
    } else {
      surf.rotation.x = -Math.PI / 6; // a 30° roof facing the camera
      surf.position.set(x, (SURF / 2) * Math.sin(Math.PI / 6) + 0.3, z - SURF / 2 + 0.1);
    }
    sphere.position.set(x + (only ? 0.9 : 0.55), r, z + (only ? 0.2 : 0.3));
  } else {
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(x, 0, z);
    sphere.position.set(x + (only ? 0.9 : 0.55), r, z - (only ? 0.6 : 0.4));
  }
  sphere.castShadow = true;
  surf.receiveShadow = true;
  surf.castShadow = !WALLS.has(id) && !ROOFS.has(id) ? false : true;
  scene.add(surf, sphere);
  if (!only) {
    // a thin plinth edge so floor samples read as a slab
    const plinth = new Mesh(new BoxGeometry(SURF, 0.02, SURF), neutral);
    plinth.position.set(x, -0.011, z);
    scene.add(plinth);
  }
  const info = set.info;
  const el = document.createElement("div");
  el.innerHTML = `<b>${id}</b><br><small>${info.label}<br>${info.source?.provider ?? ""} ${info.source?.asset ?? ""} · ${info.tileMeters} m</small>`;
  labels.appendChild(el);
  anchors.push({ el, p: new Vector3(x, 0, z + SURF / 2 + 0.05) });
}

// ── camera ──
const camera = new PerspectiveCamera(only ? 60 : 38, innerWidth / innerHeight, 0.05, 400);
if (only) {
  if (cam === "graze") {
    camera.position.set(-0.6, 0.55, 3.2);
    camera.lookAt(0.4, 0.15, -1.2);
  } else if (WALLS.has(only) || ROOFS.has(only)) {
    camera.position.set(-0.4, 1.6, 1.0); // standing ~1.5 m from the wall, eye height
    camera.lookAt(0.3, 1.0, -2);
  } else {
    camera.position.set(-0.3, 1.6, 2.2); // eye height, ~1.5-2 m from the sample: the plan's "1 m first-person" bar
    camera.lookAt(0.2, 0.35, -0.6);
  }
} else {
  const rows = Math.ceil(ids.length / COLS);
  const depth = (rows - 1) * ROW;
  // frame the whole grid: back off until its width fits the horizontal field of view, looking down 38°
  const hfov = 2 * Math.atan(Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.aspect);
  const half = Math.max((COLS * CELL) / 2 + 0.6, ((depth + SURF) / 2 + 1) * camera.aspect * 0.9);
  const d = half / Math.tan(hfov / 2) + 1.5;
  const tilt = (38 * Math.PI) / 180;
  const cz = depth / 2 + 0.3;
  camera.position.set(0, d * Math.sin(tilt), cz + d * Math.cos(tilt));
  camera.lookAt(0, 0, cz);
}

{
  const rows = Math.ceil(ids.length / COLS);
  const cz = only ? 0 : ((rows - 1) * ROW) / 2;
  key.target.position.set(0, 0, cz);
  key.position.set(sunDir[0] * 50, sunDir[1] * 50, sunDir[2] * 50 + cz);
}

function frame(): void {
  renderer.render(scene, camera);
  for (const a of anchors) {
    const v = a.p.clone().project(camera);
    a.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    a.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
}

const hud = document.getElementById("hud")!;
hud.innerHTML = `tier ${tier} · ${night ? "night" : "day"} · env ${envMode} · ${ids.length} sets`;

const t0 = performance.now();
Promise.all(ids.map((id) => getPbrSet(id, tier, renderer).then((s) => ({ ok: true as const, s }), (e: unknown) => ({ ok: false as const, id, e: String(e) }))))
  .then((results) => {
    const report: unknown[] = [];
    let i = 0;
    for (const r of results) {
      if (!r.ok) {
        report.push({ id: r.id, ok: false, error: r.e });
        continue;
      }
      place(r.s, i++);
      const t = (tex: Texture) => ({
        colorSpace: tex.colorSpace,
        format: tex.format,
        w: (tex.image as { width?: number } | null)?.width,
        h: (tex.image as { height?: number } | null)?.height,
        mips: (tex as Texture & { mipmaps?: unknown[] }).mipmaps?.length ?? 0,
      });
      report.push({ id: r.s.id, ok: true, map: t(r.s.map), normal: t(r.s.normalMap), orm: t(r.s.orm) });
    }
    frame();
    requestAnimationFrame(() => {
      frame();
      W.__info = { tier, night, env: envMode, ms: Math.round(performance.now() - t0), sets: report };
      W.__ready = true;
    });
  });

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  frame();
});
