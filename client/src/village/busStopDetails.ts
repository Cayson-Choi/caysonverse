import { BufferGeometry, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, type Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const stripX = 38.66, stripZ = -10.5, pitch = 0.05, rows = 176;

/** Draw the relief only within arm's reach of the boarding strip. Its original dot tile supplies the distant view. */
export function tactileStuds(phone: boolean) {
  const nearRadius = phone ? 2.4 : 3.2;
  const dots: BufferGeometry[] = [];
  for (let col = 0; col < 6; col++) {
    const dot = new CylinderGeometry(0.010, 0.0157, 0.0055, phone ? 6 : 8);
    // Keep the sides and top. The tile covers the bottom cap.
    const bottom = dot.groups.find(group => group.materialIndex === 2)!;
    dot.setIndex(Array.from(dot.index!.array.slice(0, bottom.start)));
    dot.clearGroups();
    dots.push(dot.translate((col + 0.5) * pitch, 0.00275, 0));
  }
  const row = mergeGeometries(dots)!;
  for (const dot of dots) dot.dispose();
  const material = new MeshStandardMaterial({ color: 0xe8b82a, roughness: 0.78 });
  const batch = new InstancedMesh(row, material, Math.ceil(2 * nearRadius / pitch) + 1);
  batch.name = "pad_warning_studs";
  const matrix = new Matrix4();
  for (let i = 0; i < batch.count; i++) batch.setMatrixAt(i, matrix.makeTranslation(0, 0, (i + 0.5) * pitch));
  batch.raycast = () => {};
  batch.receiveShadow = true;
  batch.computeBoundingSphere();
  batch.visible = false;
  return {
    mesh: batch,
    update(camera: Vector3) {
      const dx = camera.x - (stripX + 0.15), dy = camera.y - 0.049;
      const reach = Math.sqrt(Math.max(0, nearRadius * nearRadius - dx * dx - dy * dy));
      const start = Math.max(0, Math.floor((camera.z - reach - stripZ) / pitch));
      const end = Math.min(rows, Math.ceil((camera.z + reach - stripZ) / pitch));
      batch.count = reach > 0 ? Math.max(0, end - start) : 0;
      batch.visible = batch.count > 0;
      batch.position.set(stripX, 0.049, stripZ + start * pitch);
    },
    dispose() { batch.dispose(); row.dispose(); material.dispose(); },
  };
}
