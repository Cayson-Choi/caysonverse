/**
 * Frustum culling for the instances of a few spread-out GPU-instanced sets (perf/phone-library, 2026-11-21).
 *
 * three culls an InstancedMesh as ONE object (its bounding sphere), so a set spread over the whole village (25 lamp posts of
 * 3.7k triangles, the banner arms...) is drawn in full whenever any one of them is in view: ~94k triangles for the posts alone
 * on the plaza. `InstanceCuller` keeps the full source data and, when the camera's view changes the visible set, repacks the
 * visible instances (matrix + the per-instance attributes it was told about) to the front and sets `mesh.count`.
 *
 * Pure of three's renderer: `update(frustum, camera)` is the only per-frame call: one sphere test per instance, and a buffer
 * write only when the visible set changed (the camera standing still or turning slowly changes nothing).
 */
import type { Frustum, InstancedBufferAttribute, InstancedMesh, Vector3 } from "three";

export interface CullSource {
  /** The instances' world-space bounding spheres (centre x, y, z and radius), one per instance, in instance order. */
  spheres: ReadonlyArray<readonly [number, number, number, number]>;
}

export class InstanceCuller {
  private readonly n: number;
  private readonly srcAttr: Float32Array[];
  private readonly meshes: InstancedMesh[];
  private readonly attrs: InstancedBufferAttribute[][];
  private readonly spheres: ReadonlyArray<readonly [number, number, number, number]>;
  private readonly visible: Uint8Array;
  private lastKey = "";
  /** How many instances were drawn at the last update (DEV probes read it). */
  drawn: number;

  /**
   * @param meshes InstancedMeshes sharing the instance order of `source.spheres` (each with its instanceMatrix filled in that order)
   * @param extra  per mesh, the per-instance attributes to keep in step (an InstancedBufferAttribute each, itemSize 1..4)
   */
  constructor(meshes: InstancedMesh[], extra: InstancedBufferAttribute[][], source: CullSource) {
    this.meshes = meshes;
    this.attrs = extra;
    this.spheres = source.spheres;
    this.n = source.spheres.length;
    // every mesh has its own matrices (copies are cheap at this size)
    this.srcAttr = [];
    for (const list of extra) for (const a of list) this.srcAttr.push(new Float32Array(a.array as Float32Array));
    this.visible = new Uint8Array(this.n);
    this.drawn = this.n;
    this.srcMeshMatrix = meshes.map((m) => new Float32Array(m.instanceMatrix.array as Float32Array));
  }

  private readonly srcMeshMatrix: Float32Array[];

  update(frustum: Frustum, camera: Vector3, maxDist = Infinity): void {
    let key = "";
    let count = 0;
    const planes = frustum.planes;
    for (let i = 0; i < this.n; i++) {
      const s = this.spheres[i]!;
      let vis = 1;
      if (maxDist !== Infinity) {
        const dx = s[0] - camera.x, dy = s[1] - camera.y, dz = s[2] - camera.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - s[3];
        if (d > maxDist) vis = 0;
      }
      if (vis) {
        for (let p = 0; p < 6; p++) {
          const pl = planes[p]!;
          if (pl.normal.x * s[0] + pl.normal.y * s[1] + pl.normal.z * s[2] + pl.constant < -s[3]) {
            vis = 0;
            break;
          }
        }
      }
      this.visible[i] = vis;
      if (vis) {
        count++;
        key += i + ",";
      }
    }
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.drawn = count;
    for (let m = 0; m < this.meshes.length; m++) {
      const mesh = this.meshes[m]!;
      const dst = mesh.instanceMatrix.array as Float32Array;
      const src = this.srcMeshMatrix[m]!;
      let o = 0;
      for (let i = 0; i < this.n; i++) {
        if (!this.visible[i]) continue;
        dst.set(src.subarray(i * 16, i * 16 + 16), o * 16);
        o++;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    let k = 0;
    for (const list of this.attrs) {
      for (const a of list) {
        const src = this.srcAttr[k++]!;
        const size = a.itemSize;
        const dst = a.array as Float32Array;
        let o = 0;
        for (let i = 0; i < this.n; i++) {
          if (!this.visible[i]) continue;
          for (let c = 0; c < size; c++) dst[o * size + c] = src[i * size + c]!;
          o++;
        }
        a.needsUpdate = true;
      }
    }
  }
}
