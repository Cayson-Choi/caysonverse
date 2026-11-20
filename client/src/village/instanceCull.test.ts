import { describe, expect, it } from "vitest";
import { BoxGeometry, Frustum, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { InstanceCuller } from "./instanceCull";

function setup(positions: Array<[number, number, number]>) {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), positions.length);
  const lift = new InstancedBufferAttribute(new Float32Array(positions.map((_, i) => i + 1)), 1);
  positions.forEach((p, i) => mesh.setMatrixAt(i, new Matrix4().makeTranslation(...p)));
  const culler = new InstanceCuller([mesh], [[lift]], { spheres: positions.map((p) => [p[0], p[1], p[2], 1] as const) });
  const cam = new PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  const f = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  return { mesh, lift, culler, f, cam };
}

describe("InstanceCuller", () => {
  it("packs the instances in view to the front with their per-instance attributes, and counts them", () => {
    const { mesh, lift, culler, f, cam } = setup([[0, 0, -10], [50, 0, -10], [0, 0, 10], [2, 0, -20]]);
    culler.update(f, cam.position);
    expect(mesh.count).toBe(2);
    expect(culler.drawn).toBe(2);
    expect(Array.from(lift.array.slice(0, 2))).toEqual([1, 4]);
    const m = new Matrix4();
    mesh.getMatrixAt(1, m);
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([2, 0, -20]);
  });

  it("changes nothing while the visible set is the same, and follows the camera when it turns", () => {
    const { mesh, lift, culler, f, cam } = setup([[0, 0, -10], [25, 0, -10]]);
    culler.update(f, cam.position);
    expect(mesh.count).toBe(1);
    const v = mesh.instanceMatrix.version;
    culler.update(f, cam.position);
    expect(mesh.instanceMatrix.version).toBe(v);
    cam.position.set(25, 0, 0);
    cam.updateMatrixWorld();
    const g = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    culler.update(g, cam.position);
    expect(mesh.count).toBe(1);
    expect(lift.array[0]).toBe(2);
  });

  it("drops what is past the max distance", () => {
    const { mesh, culler, f, cam } = setup([[0, 0, -10], [0, 0, -90]]);
    culler.update(f, cam.position, 50);
    expect(mesh.count).toBe(1);
  });
});
