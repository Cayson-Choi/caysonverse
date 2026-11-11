import { describe, it, expect } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import type { BuiltAvatar } from "./characterAvatar";
import { SELF_FADE_OPACITY, SELF_FADE_RENDER_ORDER } from "./clickRing";
import { createSelfFade, endSelfFade, registerSelfBody, selfBody, stepSelfFade } from "./selfBody";

/** An avatar of one mesh whose material is as assembled (its authored state in `userData.base`, characterAvatar.ts). */
function fakeAvatar() {
  const mat = new MeshBasicMaterial();
  mat.userData.base = { transparent: false, depthWrite: true, opacity: 1 };
  const root = new Group();
  const mesh = new Mesh(new BoxGeometry(), mat);
  mesh.renderOrder = 3;
  root.add(mesh);
  const avatar = { root, materials: [mat], parts: [], solidKey: "", drawMeshes: 1, triangles: 12, topY: 2.15 } as BuiltAvatar;
  return { avatar, mat, mesh };
}

describe("selfBody — the own body fades while it hides the destination ring (round 6 review)", () => {
  it("fades to SELF_FADE_OPACITY within a few tenths of a second, writes no depth and is drawn after the ring", () => {
    const { avatar, mat, mesh } = fakeAvatar();
    const f = createSelfFade();
    let o = 1;
    for (let i = 0; i < 6; i++) o = stepSelfFade(f, avatar, true, 1 / 60);
    expect(o).toBeLessThan(1);
    expect(o).toBeGreaterThan(SELF_FADE_OPACITY); // eased, not cut
    for (let i = 0; i < 60; i++) o = stepSelfFade(f, avatar, true, 1 / 60);
    expect(o).toBe(SELF_FADE_OPACITY);
    expect(mat.opacity).toBeCloseTo(SELF_FADE_OPACITY, 6);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    // drawn after the ring, its depth first: a copy of the mesh that writes depth only, just before it
    expect(mesh.renderOrder).toBe(SELF_FADE_RENDER_ORDER + 1);
    const copies = avatar.root.children.filter((c) => c.userData.selfDepth);
    expect(copies).toHaveLength(1);
    const copy = copies[0] as Mesh;
    expect(copy.geometry).toBe(mesh.geometry);
    expect(copy.renderOrder).toBe(SELF_FADE_RENDER_ORDER);
    expect((copy.material as MeshBasicMaterial).colorWrite).toBe(false);
    expect((copy.material as MeshBasicMaterial).depthWrite).toBe(true);
  });

  it("comes back in full when the ring no longer hides behind it: its own state and render order again", () => {
    const { avatar, mat, mesh } = fakeAvatar();
    const f = createSelfFade();
    for (let i = 0; i < 60; i++) stepSelfFade(f, avatar, true, 1 / 60);
    for (let i = 0; i < 60; i++) stepSelfFade(f, avatar, false, 1 / 60);
    expect(f.opacity).toBe(1);
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mesh.renderOrder).toBe(3);
    expect(avatar.root.children.filter((c) => c.userData.selfDepth)).toHaveLength(0); // the depth copy gone
  });

  it("a see-through part (the face plane) gets no depth copy: it would cut the head in front of it", () => {
    const { avatar } = fakeAvatar();
    const face = new MeshBasicMaterial({ transparent: true, depthWrite: false });
    face.userData.base = { transparent: true, depthWrite: false, opacity: 1 };
    avatar.root.add(new Mesh(new BoxGeometry(), face));
    avatar.materials.push(face);
    const f = createSelfFade();
    for (let i = 0; i < 60; i++) stepSelfFade(f, avatar, true, 1 / 60);
    expect(avatar.root.children.filter((c) => c.userData.selfDepth)).toHaveLength(1); // the body's only
  });

  it("a body never faded is never touched; an unmount mid-fade restores it at once", () => {
    const { avatar, mat } = fakeAvatar();
    mat.opacity = 0.9; // whatever the material says, an idle fade leaves it
    const f = createSelfFade();
    for (let i = 0; i < 10; i++) stepSelfFade(f, avatar, false, 1 / 60);
    expect(mat.opacity).toBe(0.9);
    const b = fakeAvatar();
    const g = createSelfFade();
    for (let i = 0; i < 10; i++) stepSelfFade(g, b.avatar, true, 1 / 60);
    endSelfFade(g, b.avatar);
    expect(b.mat.opacity).toBe(1);
    expect(b.mesh.renderOrder).toBe(3);
  });

  it("registerSelfBody: the unmount clears only its own registration", () => {
    const a = new Group();
    const b = new Group();
    const offA = registerSelfBody(a, 2);
    selfBody.hidingRing = true;
    const offB = registerSelfBody(b, 2.2);
    expect(selfBody.hidingRing).toBe(false);
    offA(); // an older mount going after the newer one came
    expect(selfBody.object).toBe(b);
    offB();
    expect(selfBody.object).toBeNull();
    expect(selfBody.height).toBe(0);
  });
});
