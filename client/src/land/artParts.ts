/**
 * A small merged-geometry builder for the park's hand-built rides (the cloud drop tower; the same idea as geoBuilder.ts but on three's own geometries):
 * pieces are added by material key (matrix applied, non-indexed), then merged once per key into a handful of meshes (phone-friendly draw counts). A key may carry
 * a metre tile: its merged geometry then gets UVs in metres / tile (projectMetreUV), so a PBR set repeats at its real-world scale on every surface.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { projectMetreUV } from "./parkShapes";

export type V3 = [number, number, number];

export class Parts<K extends string> {
  private readonly by = new Map<K, BufferGeometry[]>();

  add(key: K, g: BufferGeometry, m?: Matrix4): void {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (m) geo.applyMatrix4(m);
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") geo.deleteAttribute(name);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", geo.getAttribute("position").clone());
    const list = this.by.get(key) ?? [];
    list.push(geo);
    this.by.set(key, list);
  }
  box(key: K, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    this.add(key, new BoxGeometry(w, h, d), new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1)));
  }
  soft(key: K, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.06, rx = 0, ry = 0, rz = 0): void {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    this.add(key, new RoundedBoxGeometry(w, h, d, 3, rr), new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1)));
  }
  /** A cylinder (or cone) from a to b. */
  rod(key: K, a: V3, b: V3, r0: number, r1 = r0, seg = 12): void {
    const A = new Vector3(...a);
    const B = new Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    this.add(key, new CylinderGeometry(r1, r0, len, seg, 1), new Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  }
  ball(key: K, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 16): void {
    this.add(key, new SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz)));
  }
  capsule(key: K, r: number, len: number, pos: V3, rot: V3, scale: V3 = [1, 1, 1]): void {
    this.add(key, new CapsuleGeometry(r, len, 6, 14), new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale)));
  }
  tube(key: K, pts: Vector3[], r: number, seg = 8): void {
    this.add(key, new TubeGeometry(new CatmullRomCurve3(pts), Math.max(8, pts.length * 4), r, seg, false));
  }
  /** A smooth-shaded lumpy cloud puff: an icosphere welded (no seams) and pushed in and out by a few low-frequency waves, `seed` varies each. */
  puff(key: K, r: number, x: number, y: number, z: number, seed: number, squash = 0.8, detail = 4): void {
    const g = new IcosahedronGeometry(r, detail);
    g.deleteAttribute("normal");
    g.deleteAttribute("uv");
    const w = mergeVertices(g, 1e-4);
    const pos = w.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const l = Math.hypot(px, py, pz);
      const n = 1 + 0.09 * Math.sin(px * 3.1 / r + seed) * Math.cos(pz * 2.7 / r + seed * 1.7) + 0.07 * Math.sin(py * 4.3 / r + seed * 2.3) + 0.04 * Math.sin((px + pz) * 6.1 / r + seed * 0.7);
      pos.setXYZ(i, (px / l) * r * n, (py / l) * r * n * squash, (pz / l) * r * n);
    }
    w.computeVertexNormals();
    this.add(key, w, new Matrix4().makeTranslation(x, y, z));
  }
  meshes(mats: Record<K, Material>, tiles: Partial<Record<K, number>> = {}): Mesh[] {
    const out: Mesh[] = [];
    for (const [key, list] of this.by) {
      let geo = mergeGeometries(list, false);
      if (!geo) continue;
      const tile = tiles[key];
      if (tile) geo = projectMetreUV(geo, tile);
      const mesh = new Mesh(geo, mats[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  }
}
