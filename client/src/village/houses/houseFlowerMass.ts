/**
 * The Colmar houses' flower masses (2026-11-17, owner: the Petite Venise photo's overflowing boxes — "the street view
 * first"): one merged mesh of every window box, hanging basket, terracotta pot and front border (houseFlowerBoxes.ts beds),
 * each a rounded, lumpy mound of blooms and leaves with a drape over its outer rim (a box) or all round (a pot / basket).
 * It is what a box looks like from the street: the individual 3D plants (village vegetation, houses' own LOD) thin out
 * with distance, the mass does not. One draw call, no shadow casting, ~10k triangles for all ten houses.
 *
 * Its own LOD in the vertex shader, per vertex, by the distance to the camera: from nothing (collapsed onto the soil,
 * hidden by the plants) at `near` to full at `full` (vegLod.ts HOUSE_FLOWER_MASS: PC 10-14 m, phone 5.5-8 m) — no
 * CPU work per frame, no popping (it grows in while the plants step down to their simple LOD).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import type { Bed } from "../veg/flowerPlacement";

type BoxBed = Extract<Bed, { kind: "box" }>;

/** Flower colours of the masses (sRGB): geranium reds, a coral, pinks, a magenta, a little white; and two leaf greens. */
const BLOOMS = ["#D21F2C", "#E8323C", "#C81A2A", "#F25A4E", "#E8559A", "#F7A1C0", "#C2187A", "#FBF7F9"];
const LEAVES = ["#3F6B2E", "#4F7D35"];

/**
 * A box's own flowers (Bed.palette, the side boxes: houseSideBoxes.ts): the picture's geranium reds become the first colour, its
 * pinks the second (linear, from sRGB); its whites and leaves stay. A bed without a palette keeps the picture as it is.
 */
const BLOOM_REMAP: Readonly<Record<string, readonly [string, string]>> = {
  geraniumPink: ["#E8559A", "#F7A1C0"],
  geraniumCoral: ["#F25A4E", "#FF9A6B"],
  boxWhite: ["#FBF7F9", "#8A3AA3"],
};

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A smooth value noise in 3D (for the mound's lumps and the colour drifts). */
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const c = (i: number, j: number, k: number) => hash(xi + i, yi + j, zi + k);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

export interface FlowerMassStats {
  beds: number;
  triangles: number;
}

/** The geometry: per bed a grid over its soil raised into a dome (+ lumps) and a skirt that drapes over the rim(s). */
export function flowerMassGeometry(beds: readonly BoxBed[], style: "house" | "park" = "house"): { geometry: BufferGeometry; stats: FlowerMassStats } {
  const pos: number[] = [];
  const soil: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const bloomA: number[] = [];
  const bloomB: number[] = [];
  const blooms = BLOOMS.map((h) => new Color(h));
  const leaves = LEAVES.map((h) => new Color(h));
  const parkPetals = ["#fff7e3", "#ffdbe3", "#ff9bb3", "#f5679a"].map(h => new Color(h));
  // the texture carries the blooms; the vertex colour is a soft light drift (darker low on the drape, in its shade)
  const colour = (x: number, y: number, z: number, seed: number) => {
    const k = 0.82 + 0.25 * vnoise(x * 4 + seed, y * 4, z * 4);
    return [k, k, k];
  };
  void blooms;
  void leaves;
  for (let bi = 0; bi < beds.length; bi++) {
    const b = beds[bi]!;
    const kind = b.plant ?? "window";
    const out = b.out ?? null;
    const lx = b.x1 - b.x0;
    const lz = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    // as the Petite Venise boxes: a mound twice the box's height, bulging well past its rims (a full box seen from the street)
    const H = style === "park" ? 0.28 + hash(bi, 31, 3) * 0.11 : kind === "border" ? 0.22 : kind === "pot" ? 0.32 : 0.36;
    const over = kind === "border" ? 0.04 : 0.11; // how far the mass bulges past the soil's edges
    const nu = Math.max(3, Math.min(8, Math.round(Math.max(lx, lz) / 0.18)));
    const nv = kind === "window" || kind === "border" ? 3 : nu;
    const along = lx >= lz ? "x" : "z";
    const base = pos.length / 3;
    const remap = b.palette ? BLOOM_REMAP[b.palette] : undefined;
    const ra = remap ? new Color(remap[0]) : null;
    const rb = remap ? new Color(remap[1]) : null;
    // the dome: (u, v) over the soil grown to the bulge, height by an ellipse profile + lumps
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const s = i / nu;
        const t = j / nv;
        const a = s * 2 - 1;
        const c = t * 2 - 1;
        const ex = along === "x" ? a : c;
        const ez = along === "x" ? c : a;
        let x = cx + ex * (lx / 2 + over);
        let z = cz + ez * (lz / 2 + over);
        const r = kind === "window" || kind === "border" ? Math.abs(along === "x" ? ez : ex) : Math.min(1, Math.hypot(ex, ez));
        const prof = Math.sqrt(Math.max(0, 1 - Math.min(1, r) ** 2)) * (kind === "window" ? 1 - 0.25 * Math.abs(along === "x" ? ex : ez) ** 4 : 1);
        const lump = (vnoise(x * 9 + bi, b.y * 9, z * 9) - 0.5) * 0.14 + (vnoise(x * 23, b.y * 23 + bi, z * 23) - 0.5) * 0.05;
        let y = b.y + 0.02 + H * prof + lump * prof;
        // a window box's mound leans out over its outer rim
        if (out) {
          x += out[0] * 0.08 * prof;
          z += out[1] * 0.08 * prof;
        }
        // pots and baskets: round, not square
        if (kind === "pot") {
          const rr = Math.hypot(ex, ez);
          if (rr > 1) {
            x = cx + (ex / rr) * (lx / 2 + over);
            z = cz + (ez / rr) * (lz / 2 + over);
          }
        }
        pos.push(x, y, z);
        soil.push(cx + (x - cx) * 0.6, b.y, cz + (z - cz) * 0.6);
        col.push(...colour(x, y, z, bi));
        uv.push(x * 1.6 + (along === "x" ? 0 : z * 1.6), (along === "x" ? z : x) * 1.6 + y * 1.6);
        if (i < nu && j < nv) {
          const p = base + j * (nu + 1) + i;
          if (along === "x") idx.push(p, p + nu + 1, p + 1, p + 1, p + nu + 1, p + nu + 2);
          else idx.push(p, p + 1, p + nu + 1, p + 1, p + nu + 2, p + nu + 1);
        }
      }
    // the drape: a skirt from the mound's outer edge down over the rim (a box: its outer side; a pot or basket: all round)
    if (kind !== "border") {
      const ring: Array<[number, number]> = [];
      if (kind === "window" && out) {
        // the grid row on the out side
        const jOut = (along === "x" ? out[1] : out[0]) > 0 ? nv : 0;
        // This rim is straight and level. Four spans carry the hanging scallops under
        // the finer, lumpy crown in either orientation.
        const spans = Math.min(4, nu);
        for (let k = 0; k <= spans; k++) {
          const i = Math.round(k * nu / spans);
          ring.push([base + jOut * (nu + 1) + i, i]);
        }
      } else {
        for (let i = 0; i <= nu; i++) ring.push([base + i, 0]);
        for (let j = 1; j <= nv; j++) ring.push([base + j * (nu + 1) + nu, 0]);
        for (let i = nu - 1; i >= 0; i--) ring.push([base + nv * (nu + 1) + i, 0]);
        for (let j = nv - 1; j >= 1; j--) ring.push([base + j * (nu + 1), 0]);
        ring.push(ring[0]!);
      }
      const drop = kind === "window" ? 0.34 : 0.22;
      const sb = pos.length / 3;
      for (let k = 0; k < ring.length; k++) {
        const v = ring[k]![0];
        const x = pos[v * 3]!;
        const y = pos[v * 3 + 1]!;
        const z = pos[v * 3 + 2]!;
        const dx = out ? out[0] : x - cx;
        const dz = out ? out[1] : z - cz;
        const dl = Math.hypot(dx, dz) || 1;
        const hang = drop * (0.7 + 0.6 * vnoise(x * 11, y * 5, z * 11));
        const bx = x + (dx / dl) * 0.06;
        const bz = z + (dz / dl) * 0.06;
        pos.push(bx, b.y - hang, bz);
        soil.push(cx + (x - cx) * 0.6, b.y, cz + (z - cz) * 0.6);
        col.push(...colour(bx, b.y - hang, bz, bi + 7).map((v) => v * 0.8));
        uv.push(bx * 1.6 + (along === "x" ? 0 : bz * 1.6), (along === "x" ? bz : bx) * 1.6 + (b.y - hang) * 1.6);
      }
      for (let k = 0; k < ring.length - 1; k++) {
        const a = ring[k]![0];
        const c = ring[k + 1]![0];
        const a2 = sb + k;
        const c2 = sb + k + 1;
        const dx = pos[c * 3]! - pos[a * 3]!;
        const dz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
        const ox = out?.[0] ?? pos[a * 3]! - cx;
        const oz = out?.[1] ?? pos[a * 3 + 2]! - cz;
        if (dx * oz - dz * ox > 0) idx.push(a, a2, c, c, a2, c2);
        else idx.push(a, c, a2, c, c2, a2);
      }
    }
    if (style === "park") {
      // Small petunia trumpets share a flowering stem. In the overview each light truss still
      // covers several pixels, while the darker textured leaves show between adjacent trusses.
      for (let k = 0; k < 7; k++) {
        const a = k * 2.39996 + bi * 1.7;
        const r = 0.83 * Math.sqrt((k + 0.5) / 7);
        const ca = Math.cos(a), sa = Math.sin(a);
        const petal = parkPetals[(bi + (k < 4 ? 0 : 1)) % parkPetals.length]!;
        for (const offset of [-0.046, 0.046]) {
          const x = cx + ca * r * (lx / 2 + over) - sa * offset;
          const z = cz + sa * r * (lz / 2 + over) + ca * offset;
          const lump = (vnoise(x * 9 + bi, b.y * 9, z * 9) - 0.5) * 0.14 + (vnoise(x * 23, b.y * 23 + bi, z * 23) - 0.5) * 0.05;
          const y = b.y + 0.055 + (H + lump) * Math.sqrt(1 - r * r);
          const vertex = (px: number, py: number, pz: number, red: number, green: number, blue: number) => {
            pos.push(px, py, pz);
            soil.push(cx + (px - cx) * 0.6, b.y, cz + (pz - cz) * 0.6);
            uv.push(0.5, 0.5);
            col.push(red, green, blue);
          };
          const centre = pos.length / 3;
          vertex(x, y, z, petal.r * 0.64, petal.g * 0.48, petal.b * 0.44);
          const tilt = 0.25 + 0.68 * r;
          for (let j = 0; j < 10; j++) {
            const theta = j * Math.PI / 5 + a;
            const radius = j % 2 === 0 ? 0.069 : 0.047;
            const u = Math.cos(theta) * radius, v = Math.sin(theta) * radius;
            vertex(x - sa * u + ca * v * Math.cos(tilt), y + 0.016 - v * Math.sin(tilt), z + ca * u + sa * v * Math.cos(tilt), petal.r, petal.g, petal.b);
            idx.push(centre, centre + 1 + j, centre + 1 + (j + 1) % 10);
          }
        }
      }
    }
    // this bed's vertices: its remap colours (x < 0: none)
    for (let v = base; v < pos.length / 3; v++) {
      if (ra && rb) {
        bloomA.push(ra.r, ra.g, ra.b);
        bloomB.push(rb.r, rb.g, rb.b);
      } else {
        bloomA.push(-1, 0, 0);
        bloomB.push(0, 0, 0);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aSoil", new BufferAttribute(new Float32Array(soil), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute("aBloomA", new BufferAttribute(new Float32Array(bloomA), 3));
  g.setAttribute("aBloomB", new BufferAttribute(new Float32Array(bloomB), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, stats: { beds: beds.length, triangles: idx.length / 3 } };
}

/**
 * The mass's picture (tiling, 0.6 m): leaf green with geranium heads — clusters of round florets in the reds, a coral,
 * pinks, a little magenta and white, each with a lighter middle and a shadow under it — so from the street the mound reads
 * as blooms, not cloth. The vertex colours only drift its tone per box.
 */
function bloomTexture(style: "house" | "park"): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  if (!g) return null;
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const wrap = (f: (ox: number, oy: number) => void) => {
    for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) f(ox, oy);
  };
  g.fillStyle = "#355f27";
  g.fillRect(0, 0, N, N);
  // leaves: rounded zonal-geranium leaves in two greens
  for (let k = 0; k < 260; k++) {
    const x = r() * N;
    const y = r() * N;
    const rad = 6 + r() * 8;
    g.fillStyle = r() < 0.5 ? "#4c7d34" : "#3f6d2c";
    wrap((ox, oy) => {
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    });
  }
  const heads = [["#d21f2c", 5], ["#e8323c", 4], ["#c81a2a", 3], ["#f25a4e", 2], ["#e8559a", 2], ["#f7a1c0", 1.5], ["#c2187a", 1], ["#fbf7f9", 1.2]] as const;
  const total = heads.reduce((a, [, w]) => a + w, 0);
  const pick = () => {
    let t = r() * total;
    for (const [h, w] of heads) {
      if (t < w) return h;
      t -= w;
    }
    return heads[0][0];
  };
  for (let k = 0; k < (style === "park" ? 65 : 230); k++) {
    const x = r() * N;
    const y = r() * N;
    const col = pick();
    const R = 7 + r() * 6;
    wrap((ox, oy) => {
      // a soft shadow under the head, then its florets
      g.fillStyle = "rgba(20,30,15,0.35)";
      g.beginPath();
      g.arc(x + ox + 1.5, y + oy + 2, R, 0, Math.PI * 2);
      g.fill();
      for (let f = 0; f < 9; f++) {
        const a = r() * Math.PI * 2;
        const d = r() * R * 0.75;
        g.fillStyle = col;
        g.beginPath();
        g.arc(x + ox + Math.cos(a) * d, y + oy + Math.sin(a) * d, 2.4 + r() * 1.8, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.beginPath();
      g.arc(x + ox - 1, y + oy - 1, R * 0.35, 0, Math.PI * 2);
      g.fill();
    });
  }
  if (style === "park") {
    // The textured cushion and its geometric petal trusses share this atlas and one draw.
    g.fillStyle = "#ffffff";
    g.fillRect(N / 2 - 3, N / 2 - 3, 6, 6);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The mesh: one draw call, grows in with distance (near .. full m). */
export function flowerMassMesh(beds: readonly BoxBed[], near: number, full: number, style: "house" | "park" = "house"): { mesh: Mesh; stats: FlowerMassStats; dispose(): void } {
  const { geometry, stats } = flowerMassGeometry(beds, style);
  const map = bloomTexture(style);
  const mat = new MeshStandardMaterial({ vertexColors: true, map, roughness: 0.82, metalness: 0 });
  mat.name = "M_flower_mass";
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMassNear = { value: near };
    sh.uniforms.uMassFull = { value: full };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aSoil;\nattribute vec3 aBloomA;\nattribute vec3 aBloomB;\nvarying vec3 vBloomA;\nvarying vec3 vBloomB;\nuniform float uMassNear;\nuniform float uMassFull;",
      )
      .replace(
        "#include <begin_vertex>",
        [
          "vec3 transformed = vec3( position );",
          "vec3 mWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;",
          "float mGrow = smoothstep( uMassNear, uMassFull, distance( mWorld, cameraPosition ) );",
          "transformed = mix( aSoil, position, mGrow );",
          "vBloomA = aBloomA;",
          "vBloomB = aBloomB;",
        ].join("\n"),
      );
    // a box's own flowers (BLOOM_REMAP): the picture's saturated reds take the bed's first colour, its pinks (more blue in them)
    // the second, as bright as they were; whites and leaves stay
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vBloomA;\nvarying vec3 vBloomB;").replace(
      "#include <map_fragment>",
      [
        "#include <map_fragment>",
        "#ifdef USE_MAP",
        "if ( vBloomA.x >= 0.0 ) {",
        "\tvec3 bt = sampledDiffuseColor.rgb;",
        "\tfloat bW = smoothstep( 0.12, 0.3, bt.r - max( bt.g, bt.b ) );",
        "\tvec3 bTo = mix( vBloomA, vBloomB, smoothstep( 0.22, 0.42, bt.b / max( bt.r, 1e-3 ) ) );",
        "\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuse * bTo * clamp( bt.r / 0.62, 0.55, 1.2 ), bW );",
        "}",
        "#endif",
      ].join("\n"),
    );
  };
  mat.customProgramCacheKey = () => `flowerMass2:${near}:${full}`;
  const mesh = new Mesh(geometry, mat);
  mesh.name = "house_flower_mass";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    stats,
    dispose() {
      geometry.dispose();
      mat.dispose();
      map?.dispose();
    },
  };
}
