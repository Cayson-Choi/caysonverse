import type { BufferGeometry, Camera, Material, Object3D, Scene, Texture, WebGLRenderTarget, WebGLRenderer } from "three";

/**
 * Never wait for a shader in the middle of a frame (perf/no-hitch, 2026-11-17).
 *
 * three compiles a material's program the first time an object with it is drawn, and its first use reads the program's
 * uniforms, which blocks until the GPU process has finished compiling and linking. Content that comes in after the scene's
 * warm-up (the waterfall, the lake and its shop, the bus, the fountain coming back after the hall, a house's rooms) was
 * measured to block 200-850 ms per frame on a desktop GPU, several frames in a row (e2e/perf-routes.mjs: the HUD's
 * compass and minimap stood still for about a second).
 *
 * With KHR_parallel_shader_compile the compile itself runs off the main thread; only the wait blocks. So every draw is
 * gated (the scene's pass and the shadow passes, whose depth materials are compiled the same way against the frame's
 * scene): an object whose program for this material is not compiled yet is not drawn this frame; right after the frame
 * its program is started with `renderer.compile` (with the render target the frame drew into: the program depends on
 * it), at most MAX_COMPILES_PER_FLUSH a frame, and the object is drawn from the first frame its program reports ready
 * (`isReady`, a non-blocking query). A program's first use reads it back from the GPU process, a synchronous call that
 * waits for every compile still queued there (measured: 100-500 ms on ANGLE/D3D11), so a never-used program is held
 * until the gate's compiles are done. The object shows up a few frames
 * late the first time it is ever seen, instead of the whole picture freezing. After `MAX_SKIP_MS` it is drawn anyway
 * (three's own synchronous path), so nothing can stay hidden.
 *
 * Textures too: a texture loaded as an <img> (drei's useTexture: the light maps) is decoded on the main thread by its first
 * upload, 100-250 ms for a 2048² light map. An object whose material has such a texture not uploaded yet is held back the
 * same way while the image is decoded off the main thread (`createImageBitmap`, flipped as three would flip it); the bitmap
 * replaces the image and its upload is a copy.
 *
 * A program is tracked per scene, per material and per object variant (instanced, skinned, batched, morphed, shadow-receiving,
 * vertex colours, tangents: the parts of three's program key that come from the object, not the material). A material
 * whose `version` moved (needsUpdate) is drawn three's way that once (holding it back would make it blink; three usually
 * finds the same program), and the gate follows the program three picked.
 */

interface ProgramLike {
  isReady(): boolean | null;
  program?: unknown;
}
interface Track {
  /** variant → the program `renderer.compile` made for it */
  programs: Map<string, ProgramLike>;
  /** variant → when it was first held back (ms) */
  since: Map<string, number>;
  version: number;
  /** the material's <img> textures are uploaded or decoded (null: not looked at yet) */
  texReady: boolean | null;
}

/** How long (ms) an object may be held back before three draws it its own way (it waits for the compile). */
export const MAX_SKIP_MS = 3000;
/** Bytes of never-drawn geometry a frame may upload (its first draw copies its buffers to the GPU). */
export const GEOMETRY_BYTES_PER_FRAME = 4 * 1024 * 1024;
/** Programs one flush (one frame) may start. */
const MAX_COMPILES_PER_FLUSH = 2;
/** Main-thread time (ms) one flush may spend starting compiles before it hands the thread back. */
const FLUSH_SLICE_MS = 6;

export function variantOf(object: Object3D, geometry: BufferGeometry): string {
  const o = object as Object3D & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isBatchedMesh?: boolean };
  const a = geometry.attributes;
  return (
    (o.isInstancedMesh ? "i" : "") +
    (o.isSkinnedMesh ? "s" : "") +
    (o.isBatchedMesh ? "b" : "") +
    (geometry.morphAttributes?.position || geometry.morphAttributes?.normal ? "m" : "") +
    (object.receiveShadow ? "r" : "") +
    (a.color ? "c" : "") +
    (a.tangent ? "t" : "")
  );
}

/** The bytes a geometry's buffers take (index and attributes). */
export function geometryBytes(g: BufferGeometry): number {
  let n = g.index?.array.byteLength ?? 0;
  for (const k in g.attributes) n += (g.attributes[k] as { array?: { byteLength: number } }).array?.byteLength ?? 0;
  return n;
}

/** The textures a material samples (its own map slots and, for a shader material, its uniforms). */
export function texturesOf(material: Material): Texture[] {
  const out: Texture[] = [];
  const m = material as unknown as Record<string, unknown> & { uniforms?: Record<string, { value?: unknown }> };
  for (const k in m) {
    const v = m[k] as { isTexture?: boolean } | null;
    if (v && typeof v === "object" && v.isTexture === true) out.push(v as Texture);
  }
  const u = m.uniforms;
  if (u) for (const k in u) {
    const v = u[k]?.value as { isTexture?: boolean } | null | undefined;
    if (v && typeof v === "object" && v.isTexture === true && !out.includes(v as Texture)) out.push(v as Texture);
  }
  return out;
}

type RenderBufferDirect = WebGLRenderer["renderBufferDirect"];

export interface ProgramGateStats {
  held: number;
  compiles: number;
  forced: number;
  pending: number;
  /** textures decoded off the main thread */
  decoded: number;
  /** textures uploaded ahead of their first draw */
  uploads: number;
  /** DEV: draws whose program was not the one the gate waited for (a program-key part the variant misses) */
  mismatches: string[];
}

/**
 * A shadow pass's depth material is one three shares between objects and sets up for each (its map, alpha map, alpha
 * test copied from the object's material just before the draw): those parts of its program key, read at the draw.
 */
interface DepthState {
  map: unknown;
  alphaMap: unknown;
  alphaTest: number;
}
function depthStateOf(m: Material): DepthState {
  const d = m as Material & { map?: unknown; alphaMap?: unknown };
  return { map: d.map ?? null, alphaMap: d.alphaMap ?? null, alphaTest: m.alphaTest };
}
function depthVariant(m: Material): string {
  const d = m as Material & { map?: unknown; alphaMap?: unknown };
  return (d.map ? "M" : "") + (d.alphaMap ? "A" : "") + (m.alphaTest > 0 ? "T" : "");
}

/** Install the gate on a renderer; returns the uninstall. Without KHR_parallel_shader_compile it does nothing. */
export function installProgramGate(
  gl: WebGLRenderer,
  now: () => number = () => performance.now(),
): { uninstall: () => void; stats: ProgramGateStats; prefetch: (root: Object3D) => void } {
  const stats: ProgramGateStats = { held: 0, compiles: 0, forced: 0, pending: 0, decoded: 0, uploads: 0, mismatches: [] };
  if (!gl.extensions.has("KHR_parallel_shader_compile")) return { uninstall: () => {}, stats, prefetch: () => {} };
  const own = gl as WebGLRenderer & { renderBufferDirect: RenderBufferDirect };
  const original = own.renderBufferDirect;
  const tracks = new WeakMap<Material, Track>();
  /** compile jobs for after this frame: one per material and variant */
  const queue = new Map<string, { material: Material; object: Object3D; camera: Camera; scene: Scene; target: WebGLRenderTarget | null; variant: string; shadow: boolean; depth: DepthState | null }>();
  /** programs the gate started that are still compiling */
  const compiling = new Set<ProgramLike>();
  /** programs drawn with at least once (their first use reads the program back from the GPU process: a synchronous wait) */
  const used = new WeakSet<ProgramLike>();
  /**
   * The render call in progress, else the last one: three draws a shadow pass with the lights state of that render call's
   * scene (inside `render`), or of the last one rendered (a shadow map drawn on its own, LiveSunShadows' cached slices),
   * so a depth program is compiled against that scene and its camera (whose layers pick the lights).
   */
  const renders: { scene: Scene; camera: Camera }[] = [];
  let lastRender: { scene: Scene; camera: Camera } | null = null;
  const ownRender = gl as WebGLRenderer & { render: WebGLRenderer["render"] };
  const originalRender = ownRender.render;
  ownRender.render = function (this: WebGLRenderer, scene, camera) {
    const r = { scene: scene as Scene, camera };
    renders.push(r);
    try {
      return originalRender.call(this, scene, camera);
    } finally {
      renders.pop();
      lastRender = r;
    }
  } as WebGLRenderer["render"];
  let programCount = 0;
  /** an object's main-pass key, kept while its scene, geometry and shadow-receiving stay (no string built per draw) */
  const keys = new WeakMap<Object3D, { scene: Scene; geometry: BufferGeometry; receive: boolean; key: string }>();
  const keyOf = (shadow: boolean, material: Material, scene: Scene, object: Object3D, geometry: BufferGeometry): string => {
    if (shadow) return `s${depthVariant(material)}.${scene.id}:${variantOf(object, geometry)}`;
    const k = keys.get(object);
    if (k && k.scene === scene && k.geometry === geometry && k.receive === object.receiveShadow) return k.key;
    const key = `${scene.id}:${variantOf(object, geometry)}`;
    keys.set(object, { scene, geometry, receive: object.receiveShadow, key });
    return key;
  };
  /** geometries drawn at least once (their buffers are on the GPU), and this frame's upload budget */
  const drawnGeometries = new WeakSet<BufferGeometry>();
  let geometryBudget = GEOMETRY_BYTES_PER_FRAME;
  let rafId = 0;
  const perFrame = () => {
    geometryBudget = GEOMETRY_BYTES_PER_FRAME;
    rafId = requestAnimationFrame(perFrame);
  };
  if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(perFrame);
  const anyCompiling = (): boolean => {
    // programs made elsewhere (the scenes' warm-ups: compileAsync) count too
    const all = (gl.info as { programs?: ProgramLike[] | null } | undefined)?.programs;
    if (all && all.length !== programCount) {
      programCount = all.length;
      for (const p of all) if (!used.has(p)) compiling.add(p);
    }
    for (const p of compiling) {
      let r: boolean | null = true;
      try {
        r = p.isReady();
      } catch {
        r = true;
      }
      if (r !== false) compiling.delete(p);
    }
    return compiling.size > 0;
  };
  let ids = new WeakMap<Material, number>();
  let nextId = 1;
  let flushQueued = false;
  const seen = new Set<string>();
  const decodes = new WeakMap<Texture, "pending" | "done">();

  /** textures to upload, a few per frame (an upload with its mipmaps is 10-60 ms for 2048²) */
  const uploads = new Set<Texture>();
  /**
   * Textures whose <img> was swapped for its decoded bitmap. Once uploaded, the <img> goes back (and the bitmap is closed:
   * a decoded 2048² light map is 16 MB of memory the page would otherwise keep twice). A later re-upload (needsUpdate, a
   * lost context) reads the <img> again, as three always did.
   */
  const swapped = new WeakMap<Texture, { img: HTMLImageElement; flipY: boolean; bmp: ImageBitmap }>();
  const giveBack = (tex: Texture) => {
    const s = swapped.get(tex);
    if (!s || !isUploaded(tex) || tex.image !== s.bmp) return;
    swapped.delete(tex);
    tex.image = s.img; // the source's version stays: no upload
    tex.flipY = s.flipY;
    s.bmp.close();
  };
  const isUploaded = (tex: Texture) => (gl.properties.get(tex) as { __webglInit?: boolean }).__webglInit === true;

  /** After a frame that held something back: start compiles and upload textures, within a slice of main-thread time. */
  const flush = () => {
    flushQueued = false;
    const prev = gl.getRenderTarget();
    const start = now();
    let started = 0;
    for (const [key, job] of queue) {
      // a few a frame: three builds each shader's source on the main thread (a few ms each), and the GPU process compiles
      // them one after another; a synchronous call of a later frame waits for all those in flight. The held objects ask again.
      if (started >= MAX_COMPILES_PER_FLUSH || now() - start > FLUSH_SLICE_MS) break;
      queue.delete(key);
      const t = tracks.get(job.material);
      if (!t || t.programs.has(job.variant)) continue;
      // compile only this object (not its children: they are gated on their own), against the frame's lights and target
      const kids = job.object.children;
      const own = (job.object as Object3D & { material?: Material | Material[] }).material;
      job.object.children = [];
      // a shadow pass's depth material: compiled as if it were the object's own (for its program's object-dependent parts)
      const mat = job.material as Material & { map?: unknown; alphaMap?: unknown };
      const was = job.depth ? depthStateOf(mat) : null;
      if (job.shadow) (job.object as Object3D & { material?: Material | Material[] }).material = job.material;
      if (job.depth) {
        mat.map = job.depth.map;
        mat.alphaMap = job.depth.alphaMap;
        mat.alphaTest = job.depth.alphaTest;
      }
      try {
        gl.setRenderTarget(job.target);
        gl.compile(job.object, job.camera, job.scene);
        const p = (gl.properties.get(job.material) as { currentProgram?: ProgramLike }).currentProgram;
        if (p) {
          t.programs.set(job.variant, p);
          if (!used.has(p)) compiling.add(p);
        }
        stats.compiles++;
        started++;
      } catch {
        // compile failed (a disposed material, a lost context): leave it to three's own path
        t.programs.set(job.variant, { isReady: () => true });
      } finally {
        job.object.children = kids;
        if (job.shadow) (job.object as Object3D & { material?: Material | Material[] }).material = own;
        if (was) {
          mat.map = was.map;
          mat.alphaMap = was.alphaMap;
          mat.alphaTest = was.alphaTest;
        }
      }
    }
    gl.setRenderTarget(prev);
    // uploads: at least one a frame, more while the slice lasts
    let n = 0;
    for (const tex of uploads) {
      if (n > 0 && now() - start > FLUSH_SLICE_MS) break;
      uploads.delete(tex);
      if (isUploaded(tex)) continue;
      try {
        gl.initTexture(tex);
        stats.uploads++;
      } catch {
        // leave it to three's own path
      }
      giveBack(tex);
      n++;
    }
    stats.pending = queue.size + uploads.size;
  };

  /**
   * Whether the material's textures are on the GPU. If not: an <img> is first decoded off the main thread (and swapped for
   * the decoded bitmap), then every texture is queued for an upload in a later flush.
   */
  const texturesReady = (material: Material, t: Track): boolean => {
    if (t.texReady) return true;
    let ready = true;
    for (const tex of texturesOf(material)) {
      if (isUploaded(tex)) {
        giveBack(tex);
        continue;
      }
      const img = tex.image as { width?: number; height?: number } | null;
      // render targets, depth and empty textures: nothing to upload ahead
      if ((tex as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture || (tex as Texture & { isDepthTexture?: boolean }).isDepthTexture || !img || !img.width) continue;
      ready = false;
      const state = decodes.get(tex);
      if (state === "pending") continue;
      if (state === undefined && typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement && img.complete && img.naturalWidth && typeof createImageBitmap === "function") {
        decodes.set(tex, "pending");
        // decode() runs off the main thread; the bitmap made from the decoded image is then a cheap copy
        img
          .decode()
          .catch(() => undefined)
          .then(() =>
            createImageBitmap(img, {
              imageOrientation: tex.flipY ? "flipY" : "from-image",
              premultiplyAlpha: tex.premultiplyAlpha ? "premultiply" : "none",
              colorSpaceConversion: "none",
            }),
          )
          .then(
            (bmp) => {
              // still the same image and not uploaded meanwhile (three's own path took it): swap the decoded copy in
              if (tex.image === img && !isUploaded(tex)) {
                swapped.set(tex, { img, flipY: tex.flipY, bmp });
                tex.image = bmp;
                tex.flipY = false;
                tex.needsUpdate = true;
                stats.decoded++;
              } else bmp.close();
              decodes.set(tex, "done");
            },
            () => decodes.set(tex, "done"),
          );
        continue;
      }
      decodes.set(tex, "done");
      uploads.add(tex);
    }
    t.texReady = ready;
    return ready;
  };

  own.renderBufferDirect = function (this: WebGLRenderer, camera, scene, geometry, material, object, group) {
    if (!material || !object) return original.call(this, camera, scene, geometry, material, object, group);
    // a shadow pass (three passes no scene): gated the same way, its compile made against the scene three takes its lights from
    const shadow = scene === null;
    const lightsFrom = shadow ? (renders[renders.length - 1] ?? lastRender) : null;
    if (shadow && !lightsFrom) return original.call(this, camera, scene, geometry, material, object, group);
    const sceneFor = (scene ?? lightsFrom!.scene) as Scene;
    let t = tracks.get(material);
    if (!t) {
      // a material three already drew before the gate saw it (the warm-up compiled it): trusted as it is
      const props = gl.properties.get(material) as { currentProgram?: ProgramLike };
      t = { programs: new Map(), since: new Map(), version: material.version, texReady: null };
      tracks.set(material, t);
      if (props.currentProgram && props.currentProgram.isReady() !== false) {
        if (import.meta.env.DEV) (props.currentProgram as { tag?: string }).tag ??= "trusted";
        t.programs.set(keyOf(shadow, material, sceneFor, object, geometry), props.currentProgram);
      }
    }
    const variant = keyOf(shadow, material, sceneFor, object, geometry);
    if (t.version !== material.version) {
      // needsUpdate: three looks the program up again, usually finding the same one. Holding the object back would make it
      // blink, so it is drawn three's way, and the gate follows the program three picked.
      t.version = material.version;
      const r = original.call(this, camera, scene, geometry, material, object, group);
      const cur = (gl.properties.get(material) as { currentProgram?: ProgramLike }).currentProgram;
      if (cur) {
        t.programs.set(variant, cur);
        used.add(cur);
      }
      return r;
    }
    const p = t.programs.get(variant);
    const texOk = texturesReady(material, t);
    if (p && texOk) {
      let ready: boolean | null = true;
      try {
        ready = p.isReady();
      } catch {
        ready = true;
      }
      // its first use waits (synchronously) for whatever the GPU process is still compiling: not while the gate's compiles run
      if (ready !== false && !used.has(p) && anyCompiling()) ready = false;
      // a geometry never drawn uploads its buffers now: a frame takes a few MB of them (the map's first view of the whole
      // village brings hundreds), the rest wait a frame; the first one of a frame always goes (whatever its size)
      if (ready !== false && !drawnGeometries.has(geometry)) {
        const bytes = geometryBytes(geometry);
        if (bytes > geometryBudget && geometryBudget < GEOMETRY_BYTES_PER_FRAME) ready = false;
        else {
          geometryBudget -= bytes;
          drawnGeometries.add(geometry);
        }
      }
      if (ready !== false) {
        used.add(p);
        const t0 = import.meta.env.DEV ? performance.now() : 0;
        const r = original.call(this, camera, scene, geometry, material, object, group);
        const cur = (gl.properties.get(material) as { currentProgram?: ProgramLike & { cacheKey?: string } }).currentProgram;
        // three switched program (the scene's lights changed, a define): follow it, so the next readiness check is about it
        if (cur && cur !== p) {
          t.programs.set(variant, cur);
          used.add(cur);
        }
        if (!import.meta.env.DEV) return r;
        const ms = performance.now() - t0;
        if ((ms > 20 || (cur && cur !== p)) && stats.mismatches.length < 80) {
          const k = `${material.name}|${variant}|${ms > 20 ? "slow" : "other"}`;
          if (!seen.has(k)) {
            seen.add(k);
            stats.mismatches.push(`${k} ${ms.toFixed(0)}ms same:${cur === p} ${(p as { tag?: string }).tag ?? "compiled"} gate:${String((p as { cacheKey?: string }).cacheKey ?? "?").slice(0, 220)} | draw:${String(cur?.cacheKey ?? "").slice(0, 220)}`);
          }
        }
        return r;
      }
    }
    const at = now();
    const since = t.since.get(variant);
    if (since === undefined) t.since.set(variant, at);
    else if (at - since > MAX_SKIP_MS) {
      stats.forced++;
      t.programs.set(variant, { isReady: () => true });
      return original.call(this, camera, scene, geometry, material, object, group);
    }
    stats.held++;
    if (!p) {
      let id = ids.get(material);
      if (id === undefined) ids.set(material, (id = nextId++));
      const key = `${id}|${variant}`;
      if (!queue.has(key))
        queue.set(key, { material, object, camera: shadow ? lightsFrom!.camera : camera, scene: sceneFor, target: gl.getRenderTarget(), variant, shadow, depth: shadow ? depthStateOf(material) : null });
    }
    // once a frame (at most): the work for what was held back
    if (!flushQueued && (queue.size > 0 || uploads.size > 0)) {
      flushQueued = true;
      setTimeout(flush, 0);
    }
  } as RenderBufferDirect;

  /**
   * Put every texture of `root`'s materials on the GPU ahead, a few a frame (an <img> decoded off the main thread first):
   * what the view has not shown yet (the map's whole village, the night's lamps) then costs no upload when it comes.
   */
  const prefetch = (root: Object3D) => {
    const mats = new Set<Material>();
    root.traverse((o) => {
      const m = (o as Object3D & { material?: Material | Material[] }).material;
      if (Array.isArray(m)) for (const x of m) mats.add(x);
      else if (m) mats.add(m);
    });
    // the textures only: the material's program is left for its first draw (a throwaway track, not the gate's)
    for (const m of mats) texturesReady(m, { programs: new Map(), since: new Map(), version: m.version, texReady: null });
    if (!flushQueued && uploads.size > 0) {
      flushQueued = true;
      setTimeout(flush, 0);
    }
  };

  return {
    stats,
    prefetch,
    uninstall: () => {
      if (rafId) cancelAnimationFrame(rafId);
      own.renderBufferDirect = original;
      ownRender.render = originalRender;
      queue.clear();
      uploads.clear();
      ids = new WeakMap();
    },
  };
}
