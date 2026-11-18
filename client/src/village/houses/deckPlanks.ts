/**
 * The porch decks and steps as oak planks (second exteriors pass, 2026-11-18). The houses' model builds each porch slab and its two
 * steps out of LM_stone; a stone slab wearing the sandstone's grain reads as cork, not as a deck. Their triangles are cut out of the
 * stone geometry (`splitDeckTriangles`, in the world) and drawn as `LM_deck`: the oak sheet's grain laid out as boards
 * (`deckHouseSurface`): 14 cm boards with a dark 6 mm gap, butt joints every 1.6 m, each board its own slice of the grain and its
 * own tint. The boards run along the wall; on the steps' risers they run level. Looks only: no collider, seat or door is touched.
 */
import { BufferAttribute, BufferGeometry, MeshStandardMaterial, ShaderChunk } from "three";
import { HOUSE_BODY_FRONT, houseWorldToLocal, porchSlabLocal, porchTreadsLocal } from "@caysonverse/shared/village/houseExterior";
import type { SceneryHouse } from "@caysonverse/shared/village/villageLayout";

type Frame = Pick<SceneryHouse, "id" | "centre" | "doorSide">;

/** The deck's boards: width and the gap between them (m), the length between butt joints (m). */
export const DECK = { board: 0.14, gap: 0.006, run: 1.6 } as const;

/** The porch region of a house, local: its half width either side of the door and how far out the steps reach. */
export function porchRegion(h: Frame): { half: number; z1: number } {
  const slab = porchSlabLocal(h.id);
  const treads = porchTreadsLocal(h.id);
  const half = Math.max(slab.x1, ...treads.map((t) => t.x1)) + 0.08;
  const z1 = Math.max(slab.z1, ...treads.map((t) => t.z1)) + 0.05;
  return { half, z1 };
}

/** Which house's porch (deck or step) a world point lies in, if any. */
export function inPorch(houses: readonly Frame[], x: number, y: number, z: number): Frame | null {
  if (y > 0.4 || y < -0.06) return null;
  for (const h of houses) {
    if (Math.abs(x - h.centre.x) > 9 || Math.abs(z - h.centre.z) > 9) continue;
    const { lx, lz } = houseWorldToLocal(h, x, z);
    const r = porchRegion(h);
    if (lz > HOUSE_BODY_FRONT + 0.02 && lz < r.z1 && Math.abs(lx) < r.half) return h;
  }
  return null;
}

const gather = (geo: BufferGeometry, tris: number[][], names: string[]): BufferGeometry => {
  const g = new BufferGeometry();
  for (const name of names) {
    const a = geo.getAttribute(name);
    const size = a.itemSize;
    // the same array type and normalisation as the source (the pieces are merged with the model's own geometry)
    const out = new BufferAttribute(new (a.array.constructor as new (n: number) => ArrayLike<number> & { [i: number]: number })(tris.length * 3 * size) as unknown as Float32Array, size, a.normalized);
    let o = 0;
    for (const tri of tris) for (const v of tri) { for (let k = 0; k < size; k++) out.setComponent(o, k, a.getComponent(v, k)); o++; }
    g.setAttribute(name, out);
  }
  // indexed like the model's own geometry, so the pieces merge with it
  g.setIndex(Array.from({ length: tris.length * 3 }, (_, i) => i));
  return g;
};

/**
 * Split a WORLD-space geometry into the triangles that belong to a porch (all three corners in the same one) and the rest. The deck
 * part gets a `uv` in metres (along the boards, across them) and a white vertex colour; the rest keeps its attributes. Either may be null.
 */
export function splitDeckTriangles(geo: BufferGeometry, houses: readonly Frame[]): { rest: BufferGeometry | null; deck: BufferGeometry | null } {
  const pos = geo.getAttribute("position");
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const at = (i: number): number => (idx ? idx.getX(i) : i);
  const rest: number[][] = [];
  const deck: number[][] = [];
  const owner: Frame[] = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const ids = [at(i), at(i + 1), at(i + 2)];
    let h: Frame | null = null;
    let all = true;
    for (const v of ids) {
      const hh = inPorch(houses, pos.getX(v), pos.getY(v), pos.getZ(v));
      if (!hh || (h && hh !== h)) {
        all = false;
        break;
      }
      h = hh;
    }
    if (all && h) {
      deck.push(ids);
      owner.push(h);
    } else rest.push(ids);
  }
  if (deck.length === 0) return { rest: null, deck: null };
  const names = ["position", "normal", "color", "uv"].filter((n) => geo.getAttribute(n));
  const restGeo = rest.length ? gather(geo, rest, names) : null;
  const deckGeo = gather(geo, deck, ["position", "normal"]);
  const uv = new Float32Array(deck.length * 3 * 2);
  let o = 0;
  deck.forEach((ids, t) => {
    const h = owner[t]!;
    // local axes (lx along the front wall, lz out from it) and height y of each corner; the face's dominant axis picks the layout
    const p = ids.map((v) => {
      const { lx, lz } = houseWorldToLocal(h, pos.getX(v), pos.getZ(v));
      return [lx, pos.getY(v), lz] as const;
    });
    const e1 = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2]];
    const e2 = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]];
    const nx = Math.abs(e1[1]! * e2[2]! - e1[2]! * e2[1]!);
    const ny = Math.abs(e1[2]! * e2[0]! - e1[0]! * e2[2]!);
    const nz = Math.abs(e1[0]! * e2[1]! - e1[1]! * e2[0]!);
    for (const q of p) {
      if (ny >= nx && ny >= nz) {
        uv[o++] = q[0];
        uv[o++] = q[2];
      } else if (nz >= nx) {
        uv[o++] = q[0];
        uv[o++] = q[1];
      } else {
        uv[o++] = q[2];
        uv[o++] = q[1];
      }
    }
  });
  deckGeo.setAttribute("uv", new BufferAttribute(uv, 2));
  deckGeo.setAttribute("color", new BufferAttribute(new Float32Array(deck.length * 3 * 3).fill(1), 3));
  return { rest: restGeo, deck: deckGeo };
}

const DECK_PARS = /* glsl */ `float deckHash( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
void main() {`;

const f = (n: number, d = 4): string => n.toFixed(d);

/** The board layout: the oak sheet's slice per board, the gaps and the tint (replaces map_fragment). */
const DECK_COLOUR = /* glsl */ `{
	vec2 pk = vMapUv;
	float row = floor( pk.y / ${f(DECK.board)} );
	float fy = fract( pk.y / ${f(DECK.board)} );
	float rh = deckHash( row );
	float seg = pk.x + rh * ${f(DECK.run, 2)};
	float ex = mod( seg, ${f(DECK.run, 2)} );
	float segId = floor( seg / ${f(DECK.run, 2)} );
	float sh = deckHash( row * 7.0 + segId * 3.1 );
	deckUv = vec2( pk.x / 1.83 + sh * 5.0, 0.02 + 0.30 * deckHash( row + segId * 13.0 ) + fy * ${f((DECK.board / 0.915) * 0.5)} );
	float edgeY = min( fy, 1.0 - fy ) * ${f(DECK.board)};
	float fwY = fwidth( pk.y );
	float fade = 1.0 - smoothstep( 0.006, 0.05, fwY );
	float edgeX = min( ex, ${f(DECK.run, 2)} - ex );
	float deckGap = ( 1.0 - 0.8 * fade * ( 1.0 - smoothstep( ${f(DECK.gap / 2)}, ${f(DECK.gap / 2)} + max( 0.004, fwY ), edgeY ) ) ) * ( 1.0 - 0.8 * fade * ( 1.0 - smoothstep( 0.002, 0.002 + max( 0.005, fwY ), edgeX ) ) );
	float deckTone = 0.9 + 0.2 * sh + 0.06 * deckHash( row + 91.7 );
	vec2 dkx = vec2( dFdx( pk.x ) / 1.83, dFdx( pk.y ) * ${f((DECK.board / 0.915) * 0.5 / DECK.board)} );
	vec2 dky = vec2( dFdy( pk.x ) / 1.83, dFdy( pk.y ) * ${f((DECK.board / 0.915) * 0.5 / DECK.board)} );
	diffuseColor *= textureGrad( map, deckUv, dkx, dky );
	float deckL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	diffuseColor.rgb = mix( vec3( deckL ), diffuseColor.rgb, 0.5 ) * vec3( 2.5, 2.1, 1.75 ) * deckTone * deckGap;
}`;

/** Lay the oak sheet out as planks on an LM_deck material (made by `houseSurfaceMaterial` with the wood maps; repeat 1, uv in metres). */
export function deckHouseSurface(m: MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    // the normal and roughness lookups read the board uv instead of the vertex uv
    const chunk = (name: string): string => (ShaderChunk as unknown as Record<string, string>)[name]!.replace(/vMapUv|vNormalMapUv|vRoughnessMapUv/g, "deckUv");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", DECK_PARS)
      .replace("#include <map_fragment>", DECK_COLOUR)
      .replace("#include <normalmap_pars_fragment>", "vec2 deckUv;\n" + chunk("normalmap_pars_fragment"))
      .replace("#include <normal_fragment_begin>", chunk("normal_fragment_begin"))
      .replace("#include <normal_fragment_maps>", chunk("normal_fragment_maps"))
      .replace("#include <roughnessmap_fragment>", chunk("roughnessmap_fragment"));
  };
  m.customProgramCacheKey = () => `${prevKey()}|deck`;
  m.needsUpdate = true;
}
