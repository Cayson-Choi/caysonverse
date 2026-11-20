import { Box3, Color, ExtrudeGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Shape, Vector3, type Object3D, type Texture } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Aprons and wedged stretcher ends for the hall's slab-leg oak benches. The model's collider gives the orientation and seat footprint. */
export function hallBenchJoinery(root: Object3D, oak: Texture | null) {
  const benches: Box3[] = [];
  root.traverse((object) => {
    if (object.name.startsWith("col__bench_")) benches.push(new Box3().setFromObject(object));
  });
  if (!benches.length) return null;

  const boards: ExtrudeGeometry[] = [];
  const warmOak = new Color("#ab835a"), walnut = new Color("#876342"), darkWedge = new Color("#68482e");
  // A board cut from an outline in side elevation. U follows its longitudinal grain on the faces and lower edge.
  const board = (outline: [number, number][], z0: number, z1: number, tint: Color) => {
    const shape = new Shape();
    shape.moveTo(...outline[0]!);
    for (const point of outline.slice(1)) shape.lineTo(...point);
    shape.closePath();
    const piece = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 });
    piece.translate(0, 0, z0);
    const count = piece.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) tint.toArray(colors, i * 3);
    piece.setAttribute("color", new Float32BufferAttribute(colors, 3));
    boards.push(piece);
  };
  // The aprons bear on the two end panels. The run between their shoulders is shallower for knee clearance.
  const profile: [number, number][] = [[-0.85, 0.303], [-0.70, 0.303], [-0.60, 0.333], [-0.44, 0.35],
    [0.44, 0.35], [0.60, 0.333], [0.70, 0.303], [0.85, 0.303]];
  const apron: [number, number][] = [...profile, [0.85, 0.401], [-0.85, 0.401]];
  for (const z of [-0.138, 0.112]) board(apron, z, z + 0.026, warmOak);
  for (const side of [-1, 1]) {
    const end = 0.915 * side, tip = 0.995 * side;
    const x0 = Math.min(end, tip), x1 = Math.max(end, tip);
    board([[x0, 0.125], [x1, 0.125], [x1, 0.166], [x0, 0.166]], -0.026, 0.026, walnut);
    const x = 0.948 * side;
    board([[x - 0.010, 0.113], [x + 0.010, 0.113], [x + 0.016, 0.19], [x - 0.009, 0.19]], -0.011, 0.011, darkWedge);
  }
  const geometry = mergeGeometries(boards)!;
  for (const piece of boards) piece.dispose();
  const material = new MeshStandardMaterial({ map: oak, vertexColors: true, roughness: 0.82 });
  const mesh = new InstancedMesh(geometry, material, benches.length);
  mesh.name = "hall_bench_aprons_and_tenons";
  const size = new Vector3(), center = new Vector3(), matrix = new Matrix4();
  benches.forEach((box, i) => {
    box.getSize(size);
    box.getCenter(center);
    matrix.makeRotationY(size.x > size.z ? 0 : Math.PI / 2);
    matrix.scale(new Vector3(Math.max(size.x, size.z) / 2.2, size.y / 0.45, Math.min(size.x, size.z) / 0.42));
    matrix.setPosition(center.x, box.min.y, center.z);
    mesh.setMatrixAt(i, matrix);
  });
  return mesh;
}
