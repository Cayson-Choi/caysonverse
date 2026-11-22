/**
 * Seam-preserving triangulation of a local, projected surface patch.
 *
 * `hole` contains original vertex-ID triples. `points[id]` has x/y/z (mm).
 * Only the interior is resampled: every boundary vertex and boundary segment
 * survives verbatim. The staggered sampling grid is triangulated inside the
 * exact polygon, then all unconstrained edges are made locally Delaunay.
 *
 * Return values:
 *   sites: { q:[u,v], w:Map<originalID,weight>, boundary, originalId? }[]
 *   triangles: local site-ID triples, with the original boundary winding
 *   boundary: Set of local site IDs; border: original-ID boundary segments
 *   loops: local site-ID loops; diagnostics: topology/projection statistics
 *
 * `w` always refers directly to original vertices, never to another new site.
 * Interpolate position, UV and original normal using the same weights. Source
 * projection folds inside old nostrils are resolved by the outermost crossing
 * along `depth`; they are reported, but are not copied into the new topology.
 * Optional `gridFilter(q)` keeps regular-grid sites for which it returns true.
 * `extraPoints` adds projected interior sites after the grid; both use the same
 * source weights and insertion rules. Sites within 0.02 * spacing of a prior
 * site, outside the patch, or inside boundaryClearance are skipped.
 */

const SQRT3 = Math.sqrt(3);
const DEFAULT_COS = SQRT3 / 2;
const keyOf = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function polygonArea(loop, q) {
  let twice = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = q[loop[i]], b = q[loop[(i + 1) % loop.length]];
    twice += a[0] * b[1] - a[1] * b[0];
  }
  return twice / 2;
}

function inPolygon(p, loop, q) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = q[loop[i]], b = q[loop[j]];
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

function segmentDistance2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}

function insideTriangle(p, a, b, c, eps) {
  return orient(a, b, p) >= -eps && orient(b, c, p) >= -eps && orient(c, a, p) >= -eps;
}

function earClip(loop, q, eps) {
  const ring = [...loop], triangles = [];
  // Boundary is CCW. Keep collinear boundary vertices, because their segments
  // must remain one-to-one with the untouched triangles outside this patch.
  while (ring.length > 3) {
    let selected = -1, bestQuality = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      const area2 = orient(q[a], q[b], q[c]);
      if (area2 <= eps) continue;
      if (ring.some(v => v !== a && v !== b && v !== c && insideTriangle(q[v], q[a], q[b], q[c], eps))) continue;
      const longest2 = Math.max(...[[a, b], [b, c], [c, a]].map(([u, v]) => (q[u][0] - q[v][0]) ** 2 + (q[u][1] - q[v][1]) ** 2));
      const quality = area2 / longest2;
      if (quality > bestQuality) { selected = i; bestQuality = quality; }
    }
    if (selected < 0) throw Error(`Cannot triangulate patch boundary (${ring.length} vertices remain): self-intersection or coincident boundary vertices`);
    triangles.push([ring[(selected + ring.length - 1) % ring.length], ring[selected], ring[(selected + 1) % ring.length]]);
    ring.splice(selected, 1);
  }
  if (orient(q[ring[0]], q[ring[1]], q[ring[2]]) <= eps) throw Error('Degenerate final boundary triangle');
  triangles.push(ring);
  return triangles;
}

function makeMesh(q, initial, eps) {
  const triangles = new Map(), edges = new Map();
  let serial = 0;
  const add = tri => {
    if (orient(q[tri[0]], q[tri[1]], q[tri[2]]) < 0) [tri[1], tri[2]] = [tri[2], tri[1]];
    if (orient(q[tri[0]], q[tri[1]], q[tri[2]]) <= eps) throw Error('Attempt to create a degenerate patch triangle');
    const id = serial++;
    triangles.set(id, tri);
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], key = keyOf(a, b);
      if (!edges.has(key)) edges.set(key, {a, b, tids: new Set()});
      edges.get(key).tids.add(id);
      if (edges.get(key).tids.size > 2) throw Error('Nonmanifold triangulation edge');
    }
    return id;
  };
  const remove = id => {
    const tri = triangles.get(id);
    for (let k = 0; k < 3; k++) {
      const key = keyOf(tri[k], tri[(k + 1) % 3]), edge = edges.get(key);
      edge.tids.delete(id);
      if (!edge.tids.size) edges.delete(key);
    }
    triangles.delete(id);
  };
  initial.forEach(add);
  return {triangles, edges, add, remove};
}

function inCircle(a, b, c, p) {
  const ax = a[0] - p[0], ay = a[1] - p[1];
  const bx = b[0] - p[0], by = b[1] - p[1];
  const cx = c[0] - p[0], cy = c[1] - p[1];
  return (ax * ax + ay * ay) * (bx * cy - by * cx) -
    (bx * bx + by * by) * (ax * cy - ay * cx) +
    (cx * cx + cy * cy) * (ax * by - ay * bx);
}

function legalize(mesh, q, fixed, eps, maxFlips) {
  const queue = [...mesh.edges.keys()];
  let flips = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const key = queue[cursor], edge = mesh.edges.get(key);
    if (!edge || fixed.has(key) || edge.tids.size !== 2) continue;
    const [t0, t1] = [...edge.tids], tri0 = mesh.triangles.get(t0), tri1 = mesh.triangles.get(t1);
    let {a, b} = edge;
    const c = tri0.find(v => v !== a && v !== b), d = tri1.find(v => v !== a && v !== b);
    if (orient(q[a], q[b], q[c]) < 0) [a, b] = [b, a];
    // An edge may only flip inside a strictly convex quadrilateral.
    if (orient(q[c], q[d], q[b]) <= eps || orient(q[d], q[c], q[a]) <= eps) continue;
    const circle = inCircle(q[a], q[b], q[c], q[d]);
    const extent2 = Math.max(...[a, b, c].map(v => (q[v][0] - q[d][0]) ** 2 + (q[v][1] - q[d][1]) ** 2));
    if (circle <= 1e-12 * extent2 * extent2) continue;
    mesh.remove(t0); mesh.remove(t1);
    mesh.add([c, d, b]); mesh.add([d, c, a]);
    for (const [u, v] of [[a, c], [c, b], [b, d], [d, a]]) queue.push(keyOf(u, v));
    if (++flips > maxFlips) throw Error('Delaunay edge legalization did not converge');
  }
  return flips;
}

/** See the module header for the return contract. No input objects are changed. */
export function remeshPatch({
  points, hole, spacing,
  project = p => [p.x, DEFAULT_COS * p.y + .5 * p.z],
  depth = p => -.5 * p.y + DEFAULT_COS * p.z,
  boundaryClearance = .22 * spacing,
  gridOrigin = [0, 0],
  gridFilter = null,
  extraPoints = [],
  allowSourceFolds = true,
  perspective = false,
  maxSites = 20000,
}) {
  if (!Number.isFinite(spacing) || spacing <= 0) throw Error('Patch spacing must be positive');
  if (!hole?.length) throw Error('Cannot remesh an empty patch');
  if (gridFilter !== null && typeof gridFilter !== 'function') throw Error('gridFilter must be a function');
  if (!Array.isArray(extraPoints)) throw Error('extraPoints must be an array of projected points');
  const getPoint = i => points instanceof Map ? points.get(i) : points[i];
  const sourceQ = new Map(), sourceDepth = new Map(), sourceEdges = new Map();
  for (const tri of hole) for (const id of tri) if (!sourceQ.has(id)) {
    const p = getPoint(id);
    if (!p) throw Error(`Missing original patch vertex ${id}`);
    const q = project(p), d = depth(p);
    if (q.length !== 2 || !q.every(Number.isFinite) || !Number.isFinite(d)) throw Error(`Invalid projection for vertex ${id}`);
    sourceQ.set(id, q); sourceDepth.set(id, d);
  }
  const xs = [...sourceQ.values()].map(p => p[0]), ys = [...sourceQ.values()].map(p => p[1]);
  const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), spacing);
  const eps = scale * scale * 1e-12;
  for (const tri of hole) for (let k = 0; k < 3; k++) {
    const a = tri[k], b = tri[(k + 1) % 3], key = keyOf(a, b);
    if (!sourceEdges.has(key)) sourceEdges.set(key, []);
    sourceEdges.get(key).push([a, b]);
  }
  if ([...sourceEdges.values()].some(e => e.length > 2)) throw Error('Original patch contains a nonmanifold edge');
  const border = [...sourceEdges.values()].filter(e => e.length === 1).map(e => e[0]);
  const outgoing = new Map(), incoming = new Map();
  for (const [a, b] of border) {
    if (outgoing.has(a) || incoming.has(b)) throw Error('Original patch boundary branches or has inconsistent winding');
    outgoing.set(a, b); incoming.set(b, a);
  }
  for (const id of outgoing.keys()) if (!incoming.has(id)) throw Error('Original patch has an open boundary chain');
  const oldLoops = [], unvisited = new Set(outgoing.keys());
  while (unvisited.size) {
    const first = unvisited.values().next().value, loop = [];
    let current = first;
    do {
      if (!unvisited.delete(current)) throw Error('Original patch boundary repeats a vertex');
      loop.push(current); current = outgoing.get(current);
    } while (current !== first);
    oldLoops.push(loop);
  }
  if (oldLoops.length !== 1) throw Error(`Expected one simple patch boundary, found ${oldLoops.length} loops`);
  const sites = oldLoops[0].map(id => ({q: [...sourceQ.get(id)], w: new Map([[id, 1]]), boundary: true, originalId: id}));
  const q = sites.map(v => v.q), boundary = new Set(sites.map((_, i) => i));
  const loop = [...boundary], originalArea = polygonArea(loop, q), winding = Math.sign(originalArea);
  if (!winding) throw Error('Patch boundary has zero projected area');
  if (winding < 0) loop.reverse();
  const fixed = new Set(loop.map((v, i) => keyOf(v, loop[(i + 1) % loop.length])));
  // Check non-adjacent boundary segments before ear clipping. A crossing would
  // make the promise of an exact, non-overlapping planar replacement impossible.
  for (let i = 0; i < loop.length; i++) for (let j = i + 1; j < loop.length; j++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], c = loop[j], d = loop[(j + 1) % loop.length];
    if (a === c || a === d || b === c || b === d) continue;
    const abC = orient(q[a], q[b], q[c]), abD = orient(q[a], q[b], q[d]);
    const cdA = orient(q[c], q[d], q[a]), cdB = orient(q[c], q[d], q[b]);
    if (abC * abD < -eps * eps && cdA * cdB < -eps * eps) throw Error(`Projected patch boundary crosses at edges ${i} and ${j}`);
    if (Math.min(segmentDistance2(q[a], q[c], q[d]), segmentDistance2(q[b], q[c], q[d])) < eps * 1e-6) {
      throw Error(`Projected patch boundary touches itself at edges ${i} and ${j}`);
    }
  }
  const source = hole.map(ids => {
    const p = ids.map(i => sourceQ.get(i)), det = orient(...p);
    return {ids, p, det, bbox: [Math.min(...p.map(v => v[0])), Math.min(...p.map(v => v[1])), Math.max(...p.map(v => v[0])), Math.max(...p.map(v => v[1]))]};
  });
  const foldedSourceTriangles = source.filter(t => t.det * winding < -eps).length;
  const degenerateSourceTriangles = source.filter(t => Math.abs(t.det) <= eps).length;
  if (!allowSourceFolds && (foldedSourceTriangles || degenerateSourceTriangles)) throw Error('Source patch projection is not injective');
  let overlappingSamples = 0;
  const weightsAt = p => {
    let best = null, maxDepth = -Infinity, hits = 0;
    for (const t of source) {
      if (Math.abs(t.det) <= eps) continue;
      if (p[0] < t.bbox[0] - 1e-8 || p[1] < t.bbox[1] - 1e-8 || p[0] > t.bbox[2] + 1e-8 || p[1] > t.bbox[3] + 1e-8) continue;
      const w = [orient(t.p[1], t.p[2], p) / t.det, orient(t.p[2], t.p[0], p) / t.det, orient(t.p[0], t.p[1], p) / t.det];
      if (Math.min(...w) < -1e-8) continue;
      const sum = w.reduce((s, v, k) => s + Math.max(0, v) / (perspective ? sourceDepth.get(t.ids[k]) : 1), 0);
      w.forEach((v, k) => w[k] = Math.max(0, v) / (perspective ? sourceDepth.get(t.ids[k]) : 1) / sum);
      const d = w.reduce((s, v, k) => s + v * sourceDepth.get(t.ids[k]), 0);
      if (w.every(v => v > 1e-7)) hits++;
      if (d > maxDepth) { maxDepth = d; best = new Map(t.ids.map((id, k) => [id, w[k]]).filter(([, v]) => v > 1e-14)); }
    }
    if (!best) throw Error(`No original source triangle covers projected sample [${p.join(', ')}]`);
    if (hits > 1) overlappingSamples++;
    return best;
  };
  const mesh = makeMesh(q, earClip(loop, q, eps), eps);
  let flips = legalize(mesh, q, fixed, eps, maxSites * 100);
  const minX = Math.min(...q.map(p => p[0])), maxX = Math.max(...q.map(p => p[0]));
  const minY = Math.min(...q.map(p => p[1])), maxY = Math.max(...q.map(p => p[1]));
  const minimumSiteDistance2 = (.02 * spacing) ** 2;
  const insert = input => {
    if (!Array.isArray(input) || input.length !== 2 || !input.every(Number.isFinite)) throw Error('Patch sample must be a finite projected point [u, v]');
    const p = [...input];
    if (!inPolygon(p, loop, q)) return;
    if (loop.some((v, k) => segmentDistance2(p, q[v], q[loop[(k + 1) % loop.length]]) < boundaryClearance ** 2)) return;
    if (q.some(v => (p[0] - v[0]) ** 2 + (p[1] - v[1]) ** 2 < minimumSiteDistance2)) return;
    if (sites.length >= maxSites) throw Error(`Patch exceeds ${maxSites} sites; increase spacing`);
    let containing = null;
    for (const [id, tri] of mesh.triangles) {
      if (insideTriangle(p, ...tri.map(v => q[v]), eps)) { containing = [id, tri]; break; }
    }
    if (!containing) throw Error(`Sample lies inside boundary but outside mesh: ${p}`);
    const [id, tri] = containing, k = sites.length;
    // A site can land exactly on an existing internal diagonal. Split both
    // incident triangles together; never leave a T-junction.
    let edgeHit = null;
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      if (Math.abs(orient(q[a], q[b], p)) <= eps) { edgeHit = mesh.edges.get(keyOf(a, b)); break; }
    }
    sites.push({q: p, w: weightsAt(p), boundary: false}); q.push(p);
    if (edgeHit) {
      const {a, b} = edgeHit, toSplit = [...edgeHit.tids].map(tid => [tid, mesh.triangles.get(tid)]);
      if (fixed.has(keyOf(a, b))) throw Error('Interior sample hit a fixed boundary edge');
      for (const [tid] of toSplit) mesh.remove(tid);
      for (const [, old] of toSplit) {
        const c = old.find(v => v !== a && v !== b);
        mesh.add([a, k, c]); mesh.add([k, b, c]);
      }
    } else {
      mesh.remove(id);
      mesh.add([tri[0], tri[1], k]); mesh.add([tri[1], tri[2], k]); mesh.add([tri[2], tri[0], k]);
    }
  };
  const dy = spacing * SQRT3 / 2;
  for (let j = Math.floor((minY - gridOrigin[1]) / dy); j <= Math.ceil((maxY - gridOrigin[1]) / dy); j++) {
    const offset = (Math.abs(j) % 2) * .5;
    const y = gridOrigin[1] + j * dy;
    for (let i = Math.floor((minX - gridOrigin[0]) / spacing - offset); i <= Math.ceil((maxX - gridOrigin[0]) / spacing - offset); i++) {
      const p = [gridOrigin[0] + (i + offset) * spacing, y];
      if (!gridFilter || gridFilter(p)) insert(p);
    }
  }
  extraPoints.forEach(insert);
  flips += legalize(mesh, q, fixed, eps, maxSites * 100);
  const triangles = [...mesh.triangles.values()];
  let area = 0, minDoubleArea = Infinity;
  for (const tri of triangles) {
    const value = orient(...tri.map(i => q[i]));
    if (value <= eps) throw Error('Final patch contains an inverted or degenerate triangle');
    area += value / 2; minDoubleArea = Math.min(minDoubleArea, value);
  }
  for (const [key, edge] of mesh.edges) {
    if (edge.tids.size !== (fixed.has(key) ? 1 : 2)) throw Error('Final patch has an open seam or a nonmanifold edge');
  }
  for (const edge of fixed) if (!mesh.edges.has(edge)) throw Error('Final patch lost an original boundary segment');
  if (sites.length - mesh.edges.size + triangles.length !== 1) throw Error('Final patch Euler characteristic is not one');
  if (Math.abs(area - Math.abs(originalArea)) > Math.abs(originalArea) * 1e-8) throw Error('Final patch does not exactly cover its boundary polygon');
  if (winding < 0) for (const tri of triangles) [tri[1], tri[2]] = [tri[2], tri[1]];
  return {
    sites, triangles, boundary, border, loops: [oldLoops[0].map((_, i) => i)],
    diagnostics: {sourceTriangles: hole.length, sourceVertices: sourceQ.size, sourceBoundaryEdges: border.length,
      foldedSourceTriangles, degenerateSourceTriangles, overlappingSamples, spacing,
      sites: sites.length, triangles: triangles.length, internalEdges: mesh.edges.size - border.length,
      edgeFlips: flips, area, boundaryArea: Math.abs(originalArea), minDoubleArea, winding,
      eulerCharacteristic: sites.length - mesh.edges.size + triangles.length,
      openSeams: 0, nonmanifoldEdges: 0, changedBoundarySegments: 0},
  };
}

export default remeshPatch;
