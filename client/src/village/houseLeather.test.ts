import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { LEATHER_SHEEN, isHouseLeatherMaterial, smoothNormalsByPosition } from "./houseLeather";
import { patchHouseLightmapMaterial } from "./houseNight";
import { dressLoadedHouse } from "./houseModelPrep";

/** Two triangles of a roof-like fold that share an edge by POSITION only (split vertices, as a light-map UV seam leaves them). */
function fold(): BufferGeometry {
  const g = new BufferGeometry();
  // tri A in the plane x = z (tilted one way), tri B tilted the other way; the shared edge (0,0,0)-(0,1,0) is duplicated
  const p = [0, 0, 0, 0, 1, 0, 1, 0, -1, /* B */ 0, 0, 0, -1, 0, -1, 0, 1, 0];
  g.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  return g;
}

describe("house leather (polish 3, owner 2026-11-28: the house 6 leather sofa looked flat)", () => {
  it("names the two builders' leather materials only", () => {
    expect(isHouseLeatherMaterial("LM_leather")).toBe(true);
    expect(isHouseLeatherMaterial("E_H_leather")).toBe(true);
    expect(isHouseLeatherMaterial("E_H_fabric")).toBe(false);
    expect(isHouseLeatherMaterial("LM_wood_oak")).toBe(false);
  });

  it("smooths the normals across a seam that splits the vertices (one normal per position), once", () => {
    const g = fold();
    expect(smoothNormalsByPosition(g)).toBe(true);
    const n = g.getAttribute("normal");
    expect(n.count).toBe(6);
    // the seam's two copies of (0,0,0) (vertex 0 and 3) get the same normal
    expect([n.getX(0), n.getY(0), n.getZ(0)]).toEqual([n.getX(3), n.getY(3), n.getZ(3)]);
    for (let i = 0; i < 6; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
    expect(smoothNormalsByPosition(g)).toBe(false);
  });

  it("dressing a loaded house gives the leather (and only the leather) normals", () => {
    const root = new Group();
    const leather = new Mesh(fold(), new MeshBasicMaterial({ name: "E_H_leather" }));
    const fabric = new Mesh(fold(), new MeshBasicMaterial({ name: "E_H_fabric" }));
    root.add(leather, fabric);
    dressLoadedHouse(root, 6);
    expect(leather.geometry.getAttribute("normal")).toBeDefined();
    expect(fabric.geometry.getAttribute("normal")).toBeUndefined();
  });

  it("the leather's light-mapped material adds a view-dependent sheen scaled by the baked light; other materials do not", () => {
    const run = (name: string) => {
      const m = new MeshBasicMaterial({ name });
      patchHouseLightmapMaterial(m);
      const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: "#include <common>\n#include <project_vertex>",
        fragmentShader: "void main() {\nvec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\n#include <opaque_fragment>",
      };
      (m.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
      return { shader, key: m.customProgramCacheKey() };
    };
    const l = run("E_H_leather");
    expect(l.shader.vertexShader).toContain("vLeatherN");
    expect(l.shader.fragmentShader).toContain("cameraPosition - vHouseFireW");
    expect(l.shader.fragmentShader).toContain("lightMapTexel.rgb");
    expect(l.shader.fragmentShader).toContain("#include <opaque_fragment>");
    expect(l.key).toBe("house-lightmap-night-leather");
    const f = run("E_H_fabric");
    expect(f.shader.fragmentShader).not.toContain("vLeatherN");
    expect(f.key).toBe("house-lightmap-night");
    // a sheen, not a mirror: a broad lobe, a small share of the light
    expect(LEATHER_SHEEN.spec).toBeLessThan(0.3);
    expect(LEATHER_SHEEN.power).toBeLessThan(40);
  });
});
