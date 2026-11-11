/**
 * The old vegetation cards in `village.glb`, read back at runtime (veg3d). Pure: works on attribute-like arrays, so it
 * is unit-tested without three or a GPU.
 *
 * Every card the art script drew (`parts_trees.flower_patch`, `Forest.card`) is a quad: 4 vertices, 2 triangles, not
 * connected to any other card. `readCards` groups the triangles into cards by the vertices they share (so it does not
 * depend on the order Draco left them in) and measures each one: where its base edge stands, how tall it is, which row
 * of the atlas it shows and how much baked light its vertices carry (COLOR_0).
 *
 * `keepTriangles` then gives the index buffer without the cards a new system replaces: the old cards are hidden by a
 * copy of the index (the loader's geometry and the file are not touched).
 */

/** The slice of a three `BufferAttribute` the reader needs (works for normalized integer colours too). */
export interface AttributeLike {
  readonly count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}

export interface Card {
  /** Index of this card in the list `readCards` returned. */
  id: number;
  /** Centre of the quad (world, metres; the mesh sits at the origin). */
  x: number;
  y: number;
  z: number;
  /** The base edge's two ends (the two lowest vertices) and its height. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** The lowest vertex's height: the floor the card stands on. */
  floor: number;
  /** Top minus floor. 0 for a card lying flat. */
  h: number;
  /** Mean texture coordinates (glTF: v grows downward in the image). */
  u: number;
  v: number;
  /** Mean luminance of the baked light (COLOR_0), 1 when there is none. */
  light: number;
  /** The triangles (index of the triangle, i.e. index buffer offset / 3) of this card. */
  tris: number[];
}

/** The rows of `T_flora` (top to bottom of the image): pink, yellow-orange, purple spikes, grass and reeds. */
export const FLORA_ROW = { pink: 0, yellow: 1, purple: 2, grass: 3 } as const;

/** Which row of a 4-row atlas a card shows, from its mean v (glTF orientation). */
export function floraRow(v: number): number {
  return Math.max(0, Math.min(3, Math.floor(v * 4)));
}

function find(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r]! !== r) r = parent[r]!;
  // path compression
  let j = i;
  while (parent[j]! !== r) {
    const n = parent[j]!;
    parent[j] = r;
    j = n;
  }
  return r;
}

/**
 * Group a mesh's triangles into cards and measure them. `index` may be null (non-indexed: every 3 vertices a
 * triangle). Components larger than `maxVerts` vertices are not cards and are left out.
 */
export function readCards(
  position: AttributeLike,
  index: ArrayLike<number> | null,
  uv: AttributeLike | null,
  color: AttributeLike | null,
  maxVerts = 8,
): Card[] {
  const nv = position.count;
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(nv / 3);
  const vi = (t: number, k: number) => (index ? index[t * 3 + k]! : t * 3 + k);
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  for (let t = 0; t < triCount; t++) {
    const a = find(parent, vi(t, 0));
    const b = find(parent, vi(t, 1));
    const c = find(parent, vi(t, 2));
    if (a !== b) parent[b] = a;
    const a2 = find(parent, a);
    if (a2 !== c) parent[c] = a2;
  }
  // component -> triangles, vertices
  const compTris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const r = find(parent, vi(t, 0));
    let list = compTris.get(r);
    if (!list) compTris.set(r, (list = []));
    list.push(t);
  }
  const cards: Card[] = [];
  for (const tris of compTris.values()) {
    const verts = new Set<number>();
    for (const t of tris) for (let k = 0; k < 3; k++) verts.add(vi(t, k));
    if (verts.size > maxVerts) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    let u = 0;
    let v = 0;
    let lum = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    const vs = [...verts];
    for (const i of vs) {
      const px = position.getX(i);
      const py = position.getY(i);
      const pz = position.getZ(i);
      x += px;
      y += py;
      z += pz;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (uv) {
        u += uv.getX(i);
        v += uv.getY(i);
      }
      lum += color ? 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i) : 1;
    }
    const n = vs.length;
    // the base edge: the two lowest vertices
    const byY = vs.slice().sort((p, q) => position.getY(p) - position.getY(q));
    const a = byY[0]!;
    const b = byY[1] ?? a;
    cards.push({
      id: cards.length,
      x: x / n,
      y: y / n,
      z: z / n,
      ax: position.getX(a),
      az: position.getZ(a),
      bx: position.getX(b),
      bz: position.getZ(b),
      floor: minY,
      h: maxY - minY,
      u: u / n,
      v: v / n,
      light: lum / n,
      tris,
    });
  }
  return cards;
}

/** The index buffer with the triangles of `drop` cards left out (a new array; the source is not changed). */
export function keepTriangles(index: ArrayLike<number> | null, vertexCount: number, drop: readonly Card[]): Uint32Array {
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(vertexCount / 3);
  const gone = new Uint8Array(triCount);
  for (const c of drop) for (const t of c.tris) gone[t] = 1;
  let kept = 0;
  for (let t = 0; t < triCount; t++) if (!gone[t]) kept++;
  const out = new Uint32Array(kept * 3);
  let o = 0;
  for (let t = 0; t < triCount; t++) {
    if (gone[t]) continue;
    for (let k = 0; k < 3; k++) out[o++] = index ? index[t * 3 + k]! : t * 3 + k;
  }
  return out;
}
