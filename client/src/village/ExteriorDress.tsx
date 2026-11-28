import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { getPbrSet, createPbrMaterial, pbrSetInfo, pbrTierFor, type PbrSet } from "./pbr/pbrLibrary";
import { patchHouseLight } from "./houses/housesPrep";
import { litUniform, type VillageTier } from "./villageModelPrep";
import { SURFACES, findSplits, geometryWithout, memorialTrimBoxes, takeFaces, trimGeometry, type FaceSplit, type SurfaceSpec } from "./exteriorFaces";
import { terraceParasol } from "./cafe/terraceParasol";
import { terraceTableTop } from "./cafe/terraceTableTop";

/** White veined marble (canvas, 512, tiling): a warm white body with soft cloud and a few long grey veins, no joints. */
export function marbleTexture(): CanvasTexture {
  const N = 512;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f3f1ec";
  ctx.fillRect(0, 0, N, N);
  let seed = 977;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrapDraw = (f: (ox: number, oy: number) => void) => {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) f(ox, oy);
  };
  for (let i = 0; i < 26; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const r = 40 + rnd() * 90;
    wrapDraw((ox, oy) => {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(205,208,214,${0.12 + rnd() * 0.1})`);
      g.addColorStop(1, "rgba(205,208,214,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }
  for (let v = 0; v < 9; v++) {
    const pts: Array<[number, number]> = [];
    let x = rnd() * N;
    let y = rnd() * N;
    let a = rnd() * Math.PI * 2;
    for (let k = 0; k < 14; k++) {
      pts.push([x, y]);
      a += (rnd() - 0.5) * 1.1;
      x += Math.cos(a) * 34;
      y += Math.sin(a) * 34;
    }
    const w = 0.7 + rnd() * 1.6;
    const shade = 120 + Math.floor(rnd() * 50);
    wrapDraw((ox, oy) => {
      ctx.strokeStyle = `rgba(${shade},${shade + 4},${shade + 12},0.5)`;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
      ctx.stroke();
      ctx.strokeStyle = `rgba(${shade},${shade + 4},${shade + 12},0.16)`;
      ctx.lineWidth = w * 4;
      ctx.stroke();
    });
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Coral and cream gores with a stitched hem. The hardware samples the charcoal swatch at the wrapping edge. */
export function parasolTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#bf5c4b";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#ebe0cd";
  ctx.fillRect(64, 0, 64, 64);
  // the weave: faint threads both ways
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 128; i += 2) {
    ctx.fillStyle = i % 4 === 0 ? "#000" : "#fff";
    ctx.fillRect(i, 0, 1, 64);
  }
  for (let j = 0; j < 64; j += 2) {
    ctx.fillStyle = j % 4 === 0 ? "#000" : "#fff";
    ctx.fillRect(0, j, 128, 1);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(90,60,45,0.26)";
  ctx.fillRect(0, 54, 128, 1);
  ctx.fillStyle = "#5c5851";
  ctx.fillRect(0, 0, 128, 2);
  ctx.fillRect(0, 59, 128, 5);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A lit library surface (the houses' light: live sun shadows, the night's lamps) for a rule's surface spec. */
function litSurface(spec: SurfaceSpec, set: PbrSet): MeshStandardMaterial {
  const m = createPbrMaterial(set, {
    normalStrength: spec.normalStrength,
    params: { color: new Color().setRGB(spec.tint[0], spec.tint[1], spec.tint[2]), roughness: spec.roughness, metalness: spec.metalness, ...(spec.doubleSided ? { side: DoubleSide } : {}) },
  });
  patchHouseLight(m, `dress-${set.id}`);
  const glow = spec.nightGlow;
  if (glow) {
    // the facade's own night spill (see SurfaceSpec.nightGlow): emissive radiance times how lit the village is
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev.call(m, shader, r);
      shader.uniforms.uDressLit = litUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float uDressLit;\nvoid main() {")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += texture2D( map, vMapUv ).rgb * vec3( ${glow.map((v) => v.toFixed(4)).join(", ")} ) * 2.0 * uDressLit;`);
    };
    const key = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => `${key()}|dress-glow-${glow.join(",")}`;
    m.needsUpdate = true;
  }
  return m;
}

/**
 * The crescent on the plaza fountain in polished marble: a lit physical material with the village's CC0 marble sampled in three planes
 * (it is a smooth curved solid: a single projection would streak), a clear-coat, and a faint warm glow once the lamps are lit.
 */
export function marbleMaterial(map: Texture): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({ map, color: new Color(1.0, 0.99, 0.97), roughness: 0.22, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.12 });
  patchHouseLight(m, "marble");
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    shader.uniforms.uMarbleLit = litUniform;
    shader.vertexShader = shader.vertexShader.replace("void main() {", "varying vec3 vTpPos;\nvarying vec3 vTpNrm;\nvoid main() {").replace("#include <begin_vertex>", "#include <begin_vertex>\nvTpPos = position;\nvTpNrm = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec3 vTpPos;\nvarying vec3 vTpNrm;\nuniform float uMarbleLit;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        `vec3 tpw = pow( abs( normalize( vTpNrm ) ), vec3( 4.0 ) );
tpw /= ( tpw.x + tpw.y + tpw.z );
vec4 tpTex = texture2D( map, vTpPos.zy * 0.22 ) * tpw.x + texture2D( map, vTpPos.xz * 0.22 ) * tpw.y + texture2D( map, vTpPos.xy * 0.22 ) * tpw.z;
diffuseColor *= tpTex;`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( 1.0, 0.9, 0.74 ) * 0.22 * uMarbleLit;");
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|marble-tp`;
  m.needsUpdate = true;
  return m;
}

/** Apply the splits to the village clone; returns what undoes it. */
export function applyDress(root: Object3D, splits: FaceSplit[], sets: ReadonlyMap<string, PbrSet>, parasolMap: Texture | null): { undo: () => void; added: Mesh[] } {
  const added: Mesh[] = [];
  const materials = new Map<string, Material>();
  const geometries: BufferGeometry[] = [];
  const swapped: Array<{ mesh: Mesh; from: BufferGeometry; to: BufferGeometry }> = [];
  // every mesh loses the union of its rules' faces once
  const byMesh = new Map<Mesh, Set<number>>();
  for (const s of splits) {
    const set = byMesh.get(s.mesh) ?? new Set<number>();
    for (const t of s.taken) set.add(t);
    byMesh.set(s.mesh, set);
  }
  const material = (key: string): Material | null => {
    const hit = materials.get(key);
    if (hit) return hit;
    const spec = SURFACES[key];
    if (!spec) return null;
    let m: Material | null = null;
    if (spec.pbr) {
      const set = sets.get(spec.pbr);
      if (set) m = litSurface(spec, set);
    } else if (key === "parasol" && parasolMap) {
      const c = new MeshStandardMaterial({ map: parasolMap, color: new Color().setRGB(spec.tint[0], spec.tint[1], spec.tint[2]), roughness: spec.roughness, metalness: 0, side: DoubleSide });
      patchHouseLight(c, "dress-parasol");
      m = c;
    }
    if (m) materials.set(key, m);
    return m;
  };
  // build the new meshes first (a surface that cannot be made leaves its faces where they are)
  const done = new Set<FaceSplit>();
  for (const s of splits) {
    const mat = material(s.rule.surface);
    if (!mat) continue;
    const spec = SURFACES[s.rule.surface]!;
    const tile = spec.pbr ? pbrSetInfo(spec.pbr).tileMeters : 1;
    const faces = takeFaces(s.mesh, s.taken, spec.uv, tile);
    const parasol = s.rule.surface === "parasol";
    const top = s.rule.surface === "terraceTop";
    const geometry = parasol ? terraceParasol(faces.geometry) : top ? terraceTableTop(faces.geometry, tile) : faces.geometry;
    if (parasol || top) faces.geometry.dispose();
    const m = new Mesh(geometry, mat);
    m.castShadow = parasol;
    m.receiveShadow = parasol || top;
    m.name = `dress__${s.rule.id}`;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.cvDress = true;
    root.add(m);
    added.push(m);
    geometries.push(geometry);
    done.add(s);
  }
  for (const [mesh, taken] of byMesh) {
    const own = new Set<number>();
    for (const s of splits) if (s.mesh === mesh && done.has(s)) for (const t of s.taken) own.add(t);
    if (!own.size) continue;
    const from = mesh.geometry;
    const to = geometryWithout(from, own);
    mesh.geometry = to;
    swapped.push({ mesh, from, to });
    geometries.push(to);
    void taken;
  }
  return {
    added,
    undo() {
      for (const { mesh, from, to } of swapped) if (mesh.geometry === to) mesh.geometry = from;
      for (const m of added) root.remove(m);
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
}

/** The memorial's stone order (exteriorFaces.ts memorialTrimBoxes): the surfaces it is made of. */
const TRIM_SURFACES = ["trimGranite", "trimAshlar", "trimPanel"] as const;

/** Add the memorial's plinth, pilasters and cornice to the village clone (one mesh per surface); returns what takes them away. */
export function addMemorialTrim(root: Object3D, sets: ReadonlyMap<string, PbrSet>): () => void {
  const boxes = memorialTrimBoxes();
  const made: Mesh[] = [];
  for (const [key, list] of [["trimGranite", boxes.granite], ["trimAshlar", boxes.ashlar], ["trimPanel", boxes.panel]] as const) {
    const spec = SURFACES[key]!;
    const set = spec.pbr ? sets.get(spec.pbr) : undefined;
    if (!set || !spec.pbr) continue;
    const m = new Mesh(trimGeometry(list, pbrSetInfo(spec.pbr).tileMeters), litSurface(spec, set));
    m.name = `dress__memorial-${key}`;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.cvDress = true;
    root.add(m);
    made.push(m);
  }
  return () => {
    for (const m of made) {
      root.remove(m);
      m.geometry.dispose();
      (m.material as Material).dispose();
    }
  };
}

/** Swap the fountain crescent's material for polished marble (the original goes back on undo). */
/** Off: the veined marble on the plaza crescent read as cracks (owner 2026-11-19). */
const MARBLE_MOON = false;

export function applyMarbleMoon(root: Object3D, map: Texture): () => void {
  let mesh: Mesh | null = null;
  root.traverse((o) => {
    if (o.name === "fountain_moon" && (o as Mesh).isMesh) mesh = o as Mesh;
  });
  const target = mesh as Mesh | null;
  if (!target) return () => undefined;
  const original = target.material;
  const m = marbleMaterial(map);
  target.material = m;
  return () => {
    if (target.material === m) target.material = original;
    m.dispose();
  };
}

/**
 * The village's exterior dress (see exteriorFaces.ts): the audit's flat-colour parts get real surfaces. Loads the library sets and the
 * marble when the village clone is up, applies once, and gives the faces back when the clone goes.
 */
export function ExteriorDress({ root, tier }: { root: Object3D; tier: VillageTier }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    // DEV before/after sheets: `?dress=off`
    if (import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("dress") === "off") return;
    let cancelled = false;
    let undo: (() => void) | null = null;
    const textures: Texture[] = [];
    void (async () => {
      try {
        const splits = findSplits(root);
        const ids = [...new Set([...splits.map((s) => SURFACES[s.rule.surface]?.pbr), ...TRIM_SURFACES.map((k) => SURFACES[k]?.pbr)].filter((x): x is string => !!x))];
        const sets = new Map<string, PbrSet>();
        const loaded = await Promise.all(ids.map((id) => getPbrSet(id, pbrTierFor(tier), gl as WebGLRenderer).then((s) => [id, s] as const).catch(() => null)));
        for (const e of loaded) if (e) sets.set(e[0], e[1]);
        const marble: Texture | null = !MARBLE_MOON || typeof document === "undefined" ? null : marbleTexture();
        if (cancelled) {
          marble?.dispose();
          return;
        }
        let parasol: Texture | null = null;
        if (splits.some((s) => s.rule.surface === "parasol")) {
          parasol = parasolTexture();
          textures.push(parasol);
        }
        // the faces are found again now: another patch (the old houses cut, the street) may have swapped a mesh geometry while the sets loaded
        const dress = applyDress(root, findSplits(root), sets, parasol);
        const unTrim = splits.some((s) => s.rule.id === "memorial-render") ? addMemorialTrim(root, sets) : null;
        let unMoon: (() => void) | null = null;
        // the plaza crescent keeps its own smooth white (owner 2026-11-19: "하얀 초승달이 왜 이모양이 됐어?" — the marble's dark veins read as cracks)
        if (marble && MARBLE_MOON) {
          textures.push(marble);
          unMoon = applyMarbleMoon(root, marble);
        }
        undo = () => {
          unMoon?.();
          unTrim?.();
          dress.undo();
        };
        if (import.meta.env.DEV) window.__cvDress = () => ({ meshes: dress.added.map((m) => m.name), triangles: dress.added.reduce((n, m) => n + m.geometry.getAttribute("position").count / 3, 0) });
      } catch (e) {
        // an optional dressing: the village stands without it
        console.error("[exterior dress]", e);
      }
    })();
    return () => {
      cancelled = true;
      undo?.();
      for (const t of textures) t.dispose();
      if (import.meta.env.DEV) delete window.__cvDress;
    };
  }, [root, tier, gl]);
  return null;
}

declare global {
  interface Window {
    /** DEV only: the exterior dress's new meshes and their triangle count. */
    __cvDress?: () => { meshes: string[]; triangles: number };
  }
}
