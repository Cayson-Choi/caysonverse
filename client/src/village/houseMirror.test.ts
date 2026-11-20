import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3, Vector4 } from "three";
import { fitMirrorPlane, houseMirrorMaterial, mirrorClusters, mirrorViewFrustum, splitMirrorMesh } from "./houseMirror";

/** A flat quad (two triangles) in the plane x = x0, spanning z0..z1 and y0..y1 (winding facing +x). */
function quadX(x0: number, z0: number, z1: number, y0: number, y1: number): number[] {
  return [x0, y0, z0, x0, y1, z0, x0, y0, z1, x0, y1, z0, x0, y1, z1, x0, y0, z1];
}

function geometryOf(...quads: number[][]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(quads.flat()), 3));
  return g;
}

describe("mirrorClusters", () => {
  it("one cluster per connected piece, vertices that coincide are one", () => {
    const g = geometryOf(quadX(360, -2, -1, 1, 2), quadX(360, -5, -4, 1, 2), quadX(360, -1, 0, 1, 2)); // the third touches the first along z = -1
    const c = mirrorClusters(g);
    expect(c.length).toBe(2);
    expect(c.map((x) => x.length / 3).sort()).toEqual([2, 4]);
  });
});

describe("fitMirrorPlane", () => {
  const room = new Vector3(364, 1.4, 3);
  const quad = quadX(360.02, -1.83, -1.16, 1.22, 1.88);
  it("faces the room whatever the winding says, and fits the glass", () => {
    for (const winding of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0)]) {
      const p = fitMirrorPlane(quad, winding, room);
      expect(p.n[0]).toBeCloseTo(1, 6);
      expect(p.n[2]).toBeCloseTo(0, 6);
      expect(p.c[0]).toBeCloseTo(360.02, 3);
      expect(p.c[1]).toBeCloseTo(1.55, 3);
      expect(p.c[2]).toBeCloseTo(-1.495, 3);
      expect(p.a).toBeCloseTo(0.335, 3);
      expect(p.b).toBeCloseTo(0.33, 3);
      expect(p.windingAgrees).toBe(winding.x > 0);
      // t × u = n, u is up
      expect(p.u[1]).toBeCloseTo(1, 6);
      const cross = new Vector3(...p.t).cross(new Vector3(...p.u));
      expect(cross.distanceTo(new Vector3(...p.n))).toBeLessThan(1e-6);
    }
  });
});

describe("mirrorViewFrustum", () => {
  const plane = fitMirrorPlane(quadX(360, -2, -1, 1, 2), new Vector3(1, 0, 0), new Vector3(364, 1.4, 0));
  const eye = new Vector3(362.5, 1.6, -0.4);

  it("is null for a viewer behind the glass or against it", () => {
    expect(mirrorViewFrustum(plane, new Vector3(359, 1.5, -1.5))).toBeNull();
    expect(mirrorViewFrustum(plane, new Vector3(360.05, 1.5, -1.5))).toBeNull();
  });

  it("the image camera is the viewer's mirror image, looking into the room; its near plane is the glass (+1 cm)", () => {
    const f = mirrorViewFrustum(plane, eye)!;
    const pos = new Vector3().setFromMatrixPosition(f.matrixWorld);
    expect(pos.x).toBeCloseTo(360 - 2.5, 5);
    expect(pos.y).toBeCloseTo(1.6, 5);
    expect(pos.z).toBeCloseTo(-0.4, 5);
    const forward = new Vector3(0, 0, -1).transformDirection(f.matrixWorld);
    expect(forward.x).toBeCloseTo(1, 5);
    expect(f.distance).toBeCloseTo(2.5, 5);
    // a point in the glass plane lies exactly 2.5 m in front of the camera; the near plane is at 2.51
    const view = f.matrixWorld.clone().invert();
    const onGlass = new Vector3(360, 1.5, -1.5).applyMatrix4(view);
    expect(-onGlass.z).toBeCloseTo(2.5, 5);
  });

  it("a point of the room is where the mirror shows it: the same picture coordinate through the glass or straight", () => {
    const f = mirrorViewFrustum(plane, eye)!;
    const q = new Vector3(363.2, 1.1, -3.1); // something in the room (a player, a lamp)
    const image = eye.clone().sub(new Vector3(360, 0, 0)); // mirror image of the eye: E' = E − 2 d n
    const e2 = new Vector3(360 - image.x, eye.y, eye.z);
    // the reflection point: the line E'→q meets the glass plane x = 360
    const s = (360 - e2.x) / (q.x - e2.x);
    const p = e2.clone().lerp(q, s);
    const tq = new Vector4(q.x, q.y, q.z, 1).applyMatrix4(f.texMat);
    const tp = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(f.texMat);
    expect(tp.x / tp.w).toBeCloseTo(tq.x / tq.w, 5);
    expect(tp.y / tp.w).toBeCloseTo(tq.y / tq.w, 5);
    // and p is on the glass (inside 0..1)
    expect(tp.x / tp.w).toBeGreaterThan(0);
    expect(tp.x / tp.w).toBeLessThan(1);
    expect(tp.y / tp.w).toBeGreaterThan(0);
    expect(tp.y / tp.w).toBeLessThan(1);
  });

  it("the glass fills the picture: its centre is the middle, its rim the edges", () => {
    const f = mirrorViewFrustum(plane, eye, 40, 1)!;
    const at = (x: number, y: number, z: number) => {
      const v = new Vector4(x, y, z, 1).applyMatrix4(f.texMat);
      return [v.x / v.w, v.y / v.w];
    };
    const mid = at(360, 1.5, -1.5);
    expect(mid[0]).toBeCloseTo(0.5, 5);
    expect(mid[1]).toBeCloseTo(0.5, 5);
    // the glass is 0.5 wide / 0.5 high round (-1.75 .. -1.25 in z): its two z edges are 0 and 1 apart
    const lo = at(360, 1.5, -1.0); // z = -1 is the plane edge (a = 0.5 half width)
    const hi = at(360, 1.5, -2.0);
    expect(Math.abs(lo[0]! - hi[0]!)).toBeCloseTo(1, 5);
  });
});

describe("splitMirrorMesh", () => {
  it("replaces one mesh holding three mirrors by three meshes, each with its own material and plane", () => {
    const g = geometryOf(quadX(360, -2, -1, 1, 2), quadX(360, -5, -4, 1, 2), quadX(362, 0, 1, 1, 2));
    const root = new Group();
    const floor = new Group();
    root.add(floor);
    const mesh = new Mesh(g, new MeshBasicMaterial({ name: "M_mirror" }));
    mesh.name = "house_1_fx_1";
    floor.add(mesh);
    root.updateMatrixWorld(true);
    const out = splitMirrorMesh(mesh, new Vector3(364, 1.4, 0));
    expect(out.length).toBe(3);
    expect(floor.children.length).toBe(3);
    expect(floor.children).not.toContain(mesh);
    expect(new Set(out.map((m) => m.material)).size).toBe(3);
    for (const m of out) {
      expect((m.material as MeshBasicMaterial).name).toBe("house_mirror");
      expect(m.userData.houseMirror.n[0]).toBeCloseTo(1, 6);
    }
    // the material is a basic material with the live uniforms patched in at compile time
    expect(houseMirrorMaterial().customProgramCacheKey?.()).toBe("house-mirror-live");
  });
});
