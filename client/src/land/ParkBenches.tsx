import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Matrix4, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { GeoBuilder, type V3 } from "./geoBuilder";

/** A length of milled pine with eased edges. The grain runs along the two-metre board. */
function slat(b: GeoBuilder, x: number, y: number, width: number, angle: number, index: number) {
  const w = width / 2, h = 0.021, bevel = 0.007;
  const profile = [[-w + bevel, -h], [w - bevel, -h], [w, -h + bevel], [w, h - bevel],
    [w - bevel, h], [-w + bevel, h], [-w, h - bevel], [-w, -h + bevel]] as const;
  const c = Math.cos(angle), s = Math.sin(angle);
  const point = (u: number, v: number, z: number): V3 => [x + c * u - s * v, y + s * u + c * v, z];
  const tint = 0.81 + 0.035 * Math.sin(index * 9);
  const wood: V3 = [tint, tint * 0.84, tint * 0.69];
  const grainRow = 0.052 + index * 0.093;
  for (let i = 0; i < profile.length; i++) {
    const [u, v] = profile[i]!, [uu, vv] = profile[(i + 1) % profile.length]!;
    const len = Math.hypot(uu - u, vv - v);
    const nx = (vv - v) / len, ny = (u - uu) / len;
    const normal: V3 = [c * nx - s * ny, s * nx + c * ny, 0];
    const base = b.vertices;
    for (const [du, dv, dz] of [[u, v, -1], [uu, vv, -1], [uu, vv, 1], [u, v, 1]] as const) {
      b.rawVertex(point(du, dv, dz), normal, dz * 0.36 + index * 0.23, grainRow + (du + dv) * 0.22, wood);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const z of [-1, 1]) {
    const base = b.vertices;
    for (const [u, v] of profile) b.rawVertex(point(u, v, z), [0, 0, z], index * 0.23 + u, grainRow + v, wood);
    for (let i = 1; i < profile.length - 1; i++) {
      if (z > 0) b.idx.push(base, base + i, base + i + 1);
      else b.idx.push(base, base + i + 1, base + i);
    }
  }
}

function buildBench() {
  const timber = new GeoBuilder(), frame = new GeoBuilder();
  const iron: V3 = [0.10, 0.13, 0.125];
  for (let i = 0; i < 4; i++) slat(timber, -0.237 + i * 0.135, 0.475, 0.123, 0, i);
  for (let i = 0; i < 3; i++) slat(timber, 0.211 + i * 0.027, 0.61 + i * 0.135, 0.118, 1.37, 4 + i);
  for (const z of [-0.76, 0.76]) {
    for (const side of [-1, 1]) {
      const foot = side * 0.255;
      frame.box([foot, 0.052, z], [1, 0, 0], [0, 1, 0], 0.068, 0.022, 0.061, iron);
      frame.cylinder([foot, 0.065, z], [side * 0.17, 0.425, z], 0.033, 0.043, 8, iron);
    }
    frame.box([0, 0.423, z], [1, 0, 0], [0, 1, 0], 0.283, 0.033, 0.032, iron);
    frame.cylinder([0.224, 0.415, z], [0.312, 0.925, z], 0.032, 0.028, 8, iron, true);
    frame.tube([[-0.18, 0.442, z], [-0.218, 0.603, z], [-0.207, 0.658, z],
      [-0.17, 0.678, z], [0.246, 0.69, z]], 0.023, 7, iron);
  }
  frame.cylinder([0.1, 0.40, -0.76], [0.1, 0.40, 0.76], 0.026, 0.026, 7, iron);
  return { timber: timber.build(), iron: frame.build() };
}

const benches: Array<[number, number, number]> = [];
for (let z = -170; z <= -140; z += 10) benches.push([34, z, Math.PI], [46, z, 0]);
for (let x = 90; x <= 330; x += 30) benches.push([x, -108.2, 0]);

export function ParkBenches({ pine }: { pine: Texture }) {
  const geo = useMemo(buildBench, []);
  const wood = useMemo(() => {
    const t = pine.clone();
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [pine]);
  const boards = useRef<InstancedMesh>(null), frames = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    for (const mesh of [boards.current!, frames.current!]) {
      const m = new Matrix4();
      benches.forEach(([x, z, yaw], i) => mesh.setMatrixAt(i, m.makeRotationY(yaw).setPosition(x, 0, z)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    return () => wood.dispose();
  }, [wood]);
  return <>
    <instancedMesh ref={boards} args={[geo.timber, undefined, benches.length]} castShadow receiveShadow>
      <meshStandardMaterial map={wood} vertexColors roughness={0.63} />
    </instancedMesh>
    <instancedMesh ref={frames} args={[geo.iron, undefined, benches.length]} castShadow receiveShadow>
      <meshStandardMaterial vertexColors metalness={0.36} roughness={0.47} />
    </instancedMesh>
  </>;
}
