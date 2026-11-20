import {
  BufferAttribute,
  BufferGeometry,
  Color,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type RenderTargetOptions,
} from "three";
import { houseNightUniform } from "./houseNight";

/**
 * The glass of the houses' round and arched wall mirrors (owner 2026-11-20: "왜 이런 원들이 여기 저기 있는거야": the old mirror glass was
 * the windows' 84 % see-through `M_glass`, so a mirror looked like an empty brass hoop on the wall). The kit builds mirror glass in its
 * own opaque material, `M_mirror` (houses 1–5) / `E_H_mirror` (houses 6–10).
 *
 * Owner 2026-11-21: the painted room in the glass only reflected colours — not the furniture, not the player. Now a mirror is a real
 * planar reflector, live and cheap:
 *  - `dressLoadedHouse` splits the glass triangles of a mesh into one mesh per mirror (a connected piece: `mirrorClusters`), each with
 *    its own plane (`fitMirrorPlane`: centre, the normal into the room, the in-plane axes, half extents) and its own material;
 *  - while a mirror is on screen, near and facing the viewer, `HouseMirrorRig` draws the room from the viewer's mirror image into a small
 *    render target (`mirrorViewFrustum`: the image camera sits behind the wall and looks through the glass, an off-axis frustum fitted to
 *    the glass whose near plane IS the glass plane — nothing behind the mirror's wall can be in the picture) — the furniture, the walls,
 *    the lamps, the player's avatar and the other players standing in front; the glass shader reads that picture at the fragment's own
 *    place (`uMirrorMat`), so it is correct for the viewer's position, sharp (the target is sized to the glass, 4x MSAA on the PC tier)
 *    and does not flicker;
 *  - cost: only mirrors that are drawn this frame; at most `maxActive` redraws per frame (PC 2, phone 1), the phone every other frame;
 *    a mirror over the cap keeps its last picture (consistent matrix + picture), one never drawn (or too far / too oblique) shows the
 *    old painted room (`mirrorRoom`).
 * The glass keeps its look: a cool silver tint, a slightly darker rim by the Fresnel term. The face's normal for the painted fallback
 * comes from screen-space derivatives (the export's normals are not the faces').
 */
export const HOUSE_MIRROR_MATERIALS: ReadonlySet<string> = new Set(["M_mirror", "E_H_mirror"]);

/** Whether `name` is a house's mirror-glass material. */
export function isHouseMirrorMaterial(name: string): boolean {
  return HOUSE_MIRROR_MATERIALS.has(name);
}

// ───────────────────────────────────────── geometry: one mirror = one connected piece ─────────────────────────────────────────

/**
 * The connected pieces of a mesh's triangles (vertices closer than 1 mm are one), each as the list of its triangles' vertex indices (3 per
 * triangle). One mesh of the kit holds all of a floor's mirrors; each is its own piece.
 */
export function mirrorClusters(geometry: BufferGeometry): number[][] {
  const pos = geometry.getAttribute("position");
  const idx = geometry.getIndex();
  const count = idx ? idx.count : pos.count;
  const parent: number[] = [];
  const ids = new Map<string, number>();
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const vid = (i: number): number => {
    const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
      parent.push(id);
    }
    return id;
  };
  const tris: { v: [number, number, number]; i: [number, number, number] }[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    const i: [number, number, number] = [idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2];
    const v: [number, number, number] = [vid(i[0]), vid(i[1]), vid(i[2])];
    parent[find(v[1])] = find(v[0]);
    parent[find(v[2])] = find(v[0]);
    tris.push({ v, i });
  }
  const groups = new Map<number, number[]>();
  for (const t of tris) {
    const root = find(t.v[0]);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(t.i[0], t.i[1], t.i[2]);
  }
  return [...groups.values()];
}

/** A mirror's plane in world space (plain numbers: it lives in `userData`, which a clone copies as JSON). */
export interface MirrorPlane {
  /** The glass's centre. */
  c: [number, number, number];
  /** The unit normal the way the glass faces, into the room. */
  n: [number, number, number];
  /** The in-plane unit axes: t = horizontal, u = up (n × t). */
  t: [number, number, number];
  u: [number, number, number];
  /** Half extents of the glass along t and u. */
  a: number;
  b: number;
  /** The triangles' winding normal agreed with `n` (diagnostics). */
  windingAgrees: boolean;
}

/**
 * The plane of one mirror piece from its world-space points (flat x y z array) and the sum of its triangles' winding normals. A wall
 * mirror is flat and upright: the normal is the horizontal axis the piece is thinnest along (the winding's, flattened, when the wall is
 * not axis-aligned), and it points TOWARD `roomCentre` (a mirror hangs on a wall and looks into the room); the winding's sign is only
 * recorded.
 */
export function fitMirrorPlane(points: ArrayLike<number>, windingNormal: Vector3, roomCentre: Vector3): MirrorPlane {
  const n = points.length / 3;
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < n; i++) {
    lo.x = Math.min(lo.x, points[i * 3]!);
    lo.y = Math.min(lo.y, points[i * 3 + 1]!);
    lo.z = Math.min(lo.z, points[i * 3 + 2]!);
    hi.x = Math.max(hi.x, points[i * 3]!);
    hi.y = Math.max(hi.y, points[i * 3 + 1]!);
    hi.z = Math.max(hi.z, points[i * 3 + 2]!);
  }
  const size = hi.clone().sub(lo);
  const mid = lo.clone().add(hi).multiplyScalar(0.5);
  const flat = windingNormal.clone().setY(0);
  let normal: Vector3;
  if (Math.min(size.x, size.z) < 0.03 || flat.lengthSq() < 1e-12) normal = size.x <= size.z ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  else normal = flat.normalize();
  const toRoom = roomCentre.clone().sub(mid).setY(0);
  if (normal.dot(toRoom) < 0) normal.negate();
  const windingAgrees = windingNormal.lengthSq() < 1e-12 || windingNormal.dot(normal) > 0;
  const t = new Vector3().crossVectors(new Vector3(0, 1, 0), normal).normalize();
  const u = new Vector3().crossVectors(normal, t).normalize();
  let tMin = Infinity;
  let tMax = -Infinity;
  let uMin = Infinity;
  let uMax = -Infinity;
  let nSum = 0;
  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    p.set(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
    const pt = p.dot(t);
    const pu = p.dot(u);
    tMin = Math.min(tMin, pt);
    tMax = Math.max(tMax, pt);
    uMin = Math.min(uMin, pu);
    uMax = Math.max(uMax, pu);
    nSum += p.dot(normal);
  }
  const c = new Vector3().addScaledVector(t, (tMin + tMax) / 2).addScaledVector(u, (uMin + uMax) / 2).addScaledVector(normal, nSum / n);
  return {
    c: [c.x, c.y, c.z],
    n: [normal.x, normal.y, normal.z],
    t: [t.x, t.y, t.z],
    u: [u.x, u.y, u.z],
    a: (tMax - tMin) / 2,
    b: (uMax - uMin) / 2,
    windingAgrees,
  };
}

/**
 * The image camera of a mirror, for a viewer at `eye`: it sits where the viewer's mirror image is (behind the wall), looks along the
 * mirror's normal into the room through the glass, with an asymmetric frustum whose window is exactly the glass (`margin` more) and whose
 * near plane is the glass plane pushed 1 cm out (so the wall, the frame's back and anything behind the wall are cut away). Returns
 * `null` when the viewer is too close to the plane (or behind it): the mirror can not be seen then.
 *
 * `matrixWorld` / `projection` are the camera's (three's conventions: x right, y up, looking down −z); `texMat` takes a world point on the
 * glass to the picture's 0..1 coordinates (x, y, w: divide by w).
 */
export function mirrorViewFrustum(
  plane: MirrorPlane,
  eye: Vector3,
  far = 40,
  margin = 1.02,
  minDistance = 0.15,
): { matrixWorld: Matrix4; projection: Matrix4; texMat: Matrix4; distance: number } | null {
  const c = new Vector3(...plane.c);
  const n = new Vector3(...plane.n);
  const u = new Vector3(...plane.u);
  const d = eye.clone().sub(c).dot(n);
  if (d < minDistance) return null;
  const image = eye.clone().addScaledVector(n, -2 * d);
  // the camera's axes (right-handed: x × y = z): z = −forward = −n, y = u, x = y × z = u × (−n) = n × u
  const x = new Vector3().crossVectors(n, u).normalize();
  const y = u.clone();
  const z = n.clone().negate();
  const matrixWorld = new Matrix4().makeBasis(x, y, z).setPosition(image);
  const rel = c.clone().sub(image);
  const cx = rel.dot(x);
  const cy = rel.dot(y);
  const near = d + 0.01;
  const k = near / d;
  const hw = plane.a * margin;
  const hh = plane.b * margin;
  const projection = new Matrix4().makePerspective((cx - hw) * k, (cx + hw) * k, (cy + hh) * k, (cy - hh) * k, near, far);
  const view = matrixWorld.clone().invert();
  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const texMat = bias.multiply(projection).multiply(view);
  return { matrixWorld, projection, texMat, distance: d };
}

// ───────────────────────────────────────── the glass shader ─────────────────────────────────────────

/** Per-mirror uniforms of the glass material (the picture, the matrix that finds a point of the glass in it, whether there is one). */
interface MirrorUniforms {
  map: { value: Texture | null };
  mat: { value: Matrix4 };
  live: { value: number };
}
const MIRROR_UNIFORMS = new WeakMap<object, MirrorUniforms>();

const PARS = /* glsl */ `
uniform float uMirrorNight;
uniform vec3 uMirrorTint;
uniform sampler2D uMirrorMap;
uniform mat4 uMirrorMat;
uniform float uMirrorLive;
varying vec3 vMirrorWorld;
vec3 mirrorRoom(vec3 r) {
  float up = r.y;
  vec3 ceil = vec3(0.98, 0.93, 0.84);
  vec3 wall = vec3(0.70, 0.60, 0.47);
  vec3 floorC = vec3(0.30, 0.20, 0.12);
  vec3 c = mix(wall, ceil, smoothstep(0.12, 0.6, up));
  c = mix(c, floorC, smoothstep(0.0, -0.3, up));
  float az = atan(r.x, r.z);
  // two tall windows and a glazed door round the room (bright, a little blue), only at wall height
  float band = smoothstep(-0.3, -0.12, up) * (1.0 - smoothstep(0.35, 0.55, up));
  float w1 = smoothstep(0.3, 0.2, abs(az - 0.9));
  float w2 = smoothstep(0.3, 0.2, abs(az + 1.1));
  float w3 = smoothstep(0.42, 0.34, abs(abs(az) - 2.6));
  c = mix(c, vec3(0.80, 0.87, 0.95), clamp(w1 + w2, 0.0, 1.0) * band);
  c = mix(c, vec3(1.0, 0.97, 0.9), w3 * band * 0.9);
  // a dark piece of furniture low down
  c *= 1.0 - 0.35 * smoothstep(0.18, 0.1, abs(az - 2.0)) * smoothstep(-0.05, -0.12, up) * smoothstep(-0.42, -0.3, up);
  return c;
}
vec3 mirrorColor() {
  vec3 n = normalize(cross(dFdx(vMirrorWorld), dFdy(vMirrorWorld)));
  vec3 v = normalize(vMirrorWorld - cameraPosition);
  if (dot(n, v) > 0.0) n = -n;
  vec3 r = reflect(v, n);
  float f = pow(1.0 - clamp(dot(n, -v), 0.0, 1.0), 2.0);
  vec3 c;
  if (uMirrorLive > 0.5) {
    // the real room, drawn from the viewer's mirror image (houseMirror.ts HouseMirrorRig): silver glass, a hair cool, darker at the rim
    vec4 q = uMirrorMat * vec4(vMirrorWorld, 1.0);
    c = texture2D(uMirrorMap, q.xy / q.w).rgb * vec3(0.94, 0.975, 0.985);
    c *= 1.0 - 0.18 * f;
  } else {
    c = mirrorRoom(r) * uMirrorTint * 0.82;
    c *= 1.0 - 0.28 * f;                                  // edge-on: darker (the silvering's fall-off)
    float sheen = smoothstep(0.82, 0.97, dot(r, normalize(vec3(0.55, 0.35, 0.6))));
    c += 0.08 * sheen;                                    // a faint diagonal glint
    c *= mix(1.0, 0.32, uMirrorNight);                    // the room is dim at night: so is its reflection
  }
  return c;
}
`;

/**
 * A mirror material (one per mirror: it carries that mirror's picture; freed with the house like the others): a plain MeshBasicMaterial
 * (its program path is the houses' own) whose fragment colour is replaced by the reflection. (A raw ShaderMaterial drew the same picture
 * but made the page log `glGetProgramiv: Program object expected` warnings.) Until `HouseMirrorRig` has drawn a picture it shows the
 * painted room.
 */
export function houseMirrorMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ name: "house_mirror", color: "#ffffff" });
  const u: MirrorUniforms = { map: { value: null }, mat: { value: new Matrix4() }, live: { value: 0 } };
  MIRROR_UNIFORMS.set(m, u);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMirrorNight = houseNightUniform;
    shader.uniforms.uMirrorTint = { value: new Color(0.84, 0.92, 0.94) };
    shader.uniforms.uMirrorMap = u.map;
    shader.uniforms.uMirrorMat = u.mat;
    shader.uniforms.uMirrorLive = u.live;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vMirrorWorld;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\n  vMirrorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", PARS + "\nvoid main() {")
      .replace("#include <opaque_fragment>", "outgoingLight = mirrorColor();\n  #include <opaque_fragment>");
  };
  m.customProgramCacheKey = () => "house-mirror-live";
  return m;
}

/**
 * Split a loaded house mesh whose glass is the mirror material into one mesh per mirror (same parent and transform, the glass's
 * positions only: it is unlit and untextured), each with its own mirror material and `userData.houseMirror` = its plane. The original
 * mesh goes. `roomCentre` is the floor's middle in world space. Returns the new meshes.
 */
export function splitMirrorMesh(mesh: Mesh, roomCentre: Vector3): Mesh[] {
  const parent = mesh.parent;
  if (!parent) return [];
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const out: Mesh[] = [];
  const p = new Vector3();
  const q = [new Vector3(), new Vector3(), new Vector3()];
  for (const tri of mirrorClusters(g)) {
    const remap = new Map<number, number>();
    const local: number[] = [];
    const world: number[] = [];
    const indices: number[] = [];
    const winding = new Vector3();
    for (let k = 0; k < tri.length; k += 3) {
      for (let j = 0; j < 3; j++) {
        const i = tri[k + j]!;
        let id = remap.get(i);
        if (id === undefined) {
          id = remap.size;
          remap.set(i, id);
          p.fromBufferAttribute(pos, i);
          local.push(p.x, p.y, p.z);
          p.applyMatrix4(mesh.matrixWorld);
          world.push(p.x, p.y, p.z);
        }
        indices.push(id);
        q[j]!.set(world[id * 3]!, world[id * 3 + 1]!, world[id * 3 + 2]!);
      }
      winding.add(q[1]!.clone().sub(q[0]!).cross(q[2]!.clone().sub(q[0]!)));
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(local), 3));
    geo.setIndex(indices);
    const m = new Mesh(geo, houseMirrorMaterial());
    m.name = `${mesh.name}_mirror${out.length}`;
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    m.userData.houseMirror = fitMirrorPlane(world, winding, roomCentre);
    out.push(m);
  }
  for (const m of out) parent.add(m);
  parent.remove(mesh);
  return out;
}

// ───────────────────────────────────────── the live reflection ─────────────────────────────────────────

export interface MirrorRigOptions {
  /** The light (phone) tier: a smaller picture, one redraw at a time, every other frame. */
  low: boolean;
}

interface MirrorEntry {
  mesh: Mesh;
  plane: MirrorPlane;
  uniforms: MirrorUniforms;
  target: WebGLRenderTarget | null;
  /** The rig frame this mirror was last asked to draw in / last redrawn in (−1: never). */
  seen: number;
  drawn: number;
}

/**
 * The live reflections of one house floor's mirrors (see the file's header). `attach` hooks the floor's mirror meshes (`onBeforeRender`:
 * three calls it only for a mesh that is drawn — on screen, its floor shown), `beginFrame` (once per frame, before the scene is drawn)
 * steps the frame counter, `dispose` frees the pictures and puts the painted room back.
 */
export class HouseMirrorRig {
  private readonly entries: MirrorEntry[] = [];
  private readonly camera = new PerspectiveCamera();
  private readonly eye = new Vector3();
  private frame = 1;
  private planFrame = 0;
  private plan = new Set<MirrorEntry>();
  private firsts = 0;
  private drawing = false;
  /** How many mirrors may be redrawn in one frame, every how many frames, and how far a mirror is still worth it (m). */
  readonly maxActive: number;
  readonly period: number;
  readonly maxDistance = 9;
  readonly size: number;
  /** Counters for the e2e / perf probe: redraws so far, and in the last finished frame. */
  redraws = 0;
  lastFrameRedraws = 0;
  private frameRedraws = 0;

  constructor(private readonly opts: MirrorRigOptions) {
    this.maxActive = opts.low ? 1 : 2;
    this.period = opts.low ? 2 : 1;
    this.size = opts.low ? 384 : 512;
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  /** Hook every mirror mesh under `root` (the clone of a floor). */
  attach(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      const plane = mesh.userData?.houseMirror as MirrorPlane | undefined;
      if (!mesh.isMesh || !plane) return;
      for (let q: Object3D | null = mesh; q; q = q.parent) if (!q.visible) return; // the other floor's mirrors are not drawn
      const uniforms = MIRROR_UNIFORMS.get(mesh.material as object);
      if (!uniforms) return;
      const entry: MirrorEntry = { mesh, plane, uniforms, target: null, seen: -1, drawn: -1 };
      this.entries.push(entry);
      mesh.onBeforeRender = (renderer, scene, camera) => this.draw(entry, renderer, scene, camera as PerspectiveCamera);
    });
  }

  get count(): number {
    return this.entries.length;
  }

  /** The planes of the hooked mirrors (the e2e probe stands in front of them). */
  get planes(): MirrorPlane[] {
    return this.entries.map((e) => e.plane);
  }

  beginFrame(): void {
    this.lastFrameRedraws = this.frameRedraws;
    this.frameRedraws = 0;
    this.frame++;
  }

  private targetFor(e: MirrorEntry): WebGLRenderTarget {
    if (e.target) return e.target;
    const low = this.opts.low;
    // PC: half-float linear (the post chain's own format: lamps over 1.0 stay bright), mip-mapped, 4x MSAA; phone: 8 bit, sRGB-encoded so
    // the dark half keeps its steps, no MSAA
    const options: RenderTargetOptions = {
      depthBuffer: true,
      stencilBuffer: false,
      format: RGBAFormat,
      generateMipmaps: !low,
      minFilter: low ? LinearFilter : LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      samples: low ? 0 : 4,
    };
    if (!low) options.type = HalfFloatType;
    const t = new WebGLRenderTarget(this.size, this.size, options);
    if (low) t.texture.colorSpace = SRGBColorSpace;
    t.texture.name = "house_mirror_picture";
    e.target = t;
    return t;
  }

  /** Which mirrors get a redraw this frame: the ones seen last frame, least recently drawn first (round-robin when over the cap). */
  private planFor(e: MirrorEntry): void {
    this.planFrame = this.frame;
    this.plan = new Set();
    this.firsts = 0;
    if (this.frame % this.period !== 0) return;
    const cands = this.entries.filter((x) => x === e || x.seen >= this.frame - this.period - 1);
    cands.sort((x, y) => x.drawn - y.drawn);
    for (const x of cands.slice(0, this.maxActive)) this.plan.add(x);
  }

  private draw(e: MirrorEntry, renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    if (this.drawing) return;
    if (import.meta.env.DEV && (globalThis as { __cvMirrorOff?: boolean }).__cvMirrorOff) return; // dev: the painted room (before / after shots)
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const f = mirrorViewFrustum(e.plane, this.eye);
    if (this.planFrame !== this.frame) this.planFor(e);
    const wasSeen = e.seen;
    e.seen = this.frame;
    if (!f || f.distance > this.maxDistance) return; // too far / too close / behind: it shows its last picture (or the painted room)
    if (!this.plan.has(e)) {
      // over the cap or off the period: the last picture stays; a mirror that has none yet (it came into view) gets one at once
      if (!(e.drawn < 0 && wasSeen < 0 && this.firsts < 1)) return;
      this.firsts++;
    }
    e.drawn = this.frame;
    this.redraws++;
    this.frameRedraws++;
    const target = this.targetFor(e);
    const cam = this.camera;
    cam.matrixWorld.copy(f.matrixWorld);
    cam.matrixWorldInverse.copy(f.matrixWorld).invert();
    cam.projectionMatrix.copy(f.projection);
    cam.projectionMatrixInverse.copy(f.projection).invert();

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevAutoClear = renderer.autoClear;
    const prevInfoReset = renderer.info.autoReset;
    const prevSceneAuto = scene.matrixWorldAutoUpdate;
    const lives = this.entries.map((x) => x.uniforms.live.value);
    this.drawing = true;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.info.autoReset = false; // the draw counts of the frame add up (the stats see this pass)
      scene.matrixWorldAutoUpdate = false;
      e.mesh.visible = false;
      // other mirrors in the picture show their painted room: a reflection of a reflection is not worth a pass
      for (const x of this.entries) x.uniforms.live.value = 0;
      renderer.setRenderTarget(target);
      renderer.autoClear = true;
      renderer.render(scene, cam);
    } finally {
      this.drawing = false;
      e.mesh.visible = true;
      this.entries.forEach((x, i) => (x.uniforms.live.value = lives[i]!));
      renderer.xr.enabled = prevXr;
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.info.autoReset = prevInfoReset;
      renderer.autoClear = prevAutoClear;
      scene.matrixWorldAutoUpdate = prevSceneAuto;
      renderer.setRenderTarget(prevTarget);
    }
    e.uniforms.map.value = target.texture;
    e.uniforms.mat.value.copy(f.texMat);
    e.uniforms.live.value = 1;
  }

  /** Free the pictures, unhook the meshes, show the painted room again (the materials are shared with the cached model). */
  dispose(): void {
    for (const e of this.entries) {
      e.mesh.onBeforeRender = () => undefined;
      e.uniforms.live.value = 0;
      e.uniforms.map.value = null;
      e.target?.dispose();
      e.target = null;
    }
    this.entries.length = 0;
  }
}
