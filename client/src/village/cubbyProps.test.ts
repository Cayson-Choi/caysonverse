import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Texture, Vector3 } from "three";
import { VILLAGE_LAYOUT, cubbyAnchors } from "@caysonverse/shared/village/villageLayout";
import {
  CUBBY_FLOOR_BELOW_ANCHOR,
  PHOTO_MATERIAL,
  buildCubbyPropMeshes,
  layoutCubbyProps,
  makePhotoMaterial,
  photoTileAttribute,
  photoTileOffset,
  placementMatrix,
} from "./cubbyProps";
import {
  HALL_CUBBY_ANCHORS,
  PROP_KINDS,
  SAMPLE_BY_ID,
  SAMPLE_CUBBIES,
  SAMPLE_FILL,
  SAMPLE_LINES,
  SAMPLE_NAMES,
  SAMPLE_PHOTO_ATLAS,
  hashId,
  makeSampleCubbies,
  type SampleCubby,
} from "./sampleCubbies";

const anchors = cubbyAnchors(VILLAGE_LAYOUT);

describe("SAMPLE_CUBBIES — the hall's example memorials (Task 9)", () => {
  it("fills 60 % of the enlarged B hall's 364 cubbies, on both walls and across every row", () => {
    expect(anchors).toHaveLength(364);
    expect(SAMPLE_FILL).toBe(0.6);
    expect(SAMPLE_CUBBIES).toHaveLength(Math.round(364 * 0.6));
    expect(new Set(SAMPLE_CUBBIES.map((s) => s.id)).size).toBe(SAMPLE_CUBBIES.length);
    expect(new Set(SAMPLE_CUBBIES.map((s) => s.id.split("_")[0]))).toEqual(new Set(["n", "e"]));
    for (let row = 0; row < 7; row += 1) expect(SAMPLE_CUBBIES.some((s) => s.id.split("_")[1] === String(row)), `row ${row}`).toBe(true);
    for (const s of SAMPLE_CUBBIES) expect(SAMPLE_BY_ID.get(s.id)).toBe(s);
    expect(HALL_CUBBY_ANCHORS).toEqual(anchors);
  });

  it("is seed-stable: built again it is the same, and each cubby's data depends only on its id", () => {
    expect(makeSampleCubbies(anchors)).toEqual(SAMPLE_CUBBIES);
    const reversed = makeSampleCubbies([...anchors].reverse());
    for (const s of reversed) expect(SAMPLE_BY_ID.get(s.id)).toEqual(s);
    expect(hashId("n_3_10")).toBe(hashId("n_3_10"));
    expect(hashId("n_3_10")).not.toBe(hashId("n_3_11"));
  });

  it("every sample has a name from the list, sensible years, a line, a portrait in the atlas, an urn, a photo and a name card", () => {
    for (const s of SAMPLE_CUBBIES) {
      expect(SAMPLE_NAMES).toContain(s.name);
      expect(SAMPLE_LINES).toContain(s.line);
      expect(s.passed).toBeLessThanOrEqual(2026);
      expect(s.passed - s.born).toBeGreaterThanOrEqual(8);
      expect(s.passed - s.born).toBeLessThanOrEqual(17);
      expect(Number.isInteger(s.photo) && s.photo >= 0 && s.photo < SAMPLE_PHOTO_ATLAS.count).toBe(true);
      const kinds = s.props.map((p) => p.kind);
      expect(kinds.filter((k) => k === "urn_wood" || k === "urn_ceramic")).toHaveLength(1);
      expect(kinds.filter((k) => k === "photo_frame")).toHaveLength(1);
      expect(kinds.filter((k) => k === "name_card")).toHaveLength(1);
      for (const p of s.props) {
        expect(Math.abs(p.u)).toBeLessThanOrEqual(0.2); // inside the 0.4 m cell
        expect(p.w).toBeGreaterThanOrEqual(0);
        expect(p.w).toBeLessThanOrEqual(0.36); // in front of the back panel
      }
    }
    // the portraits are spread over the atlas
    expect(new Set(SAMPLE_CUBBIES.map((s) => s.photo)).size).toBe(SAMPLE_PHOTO_ATLAS.count);
  });

  it("no '!' anywhere in the names or the lines (the hall's gentle tone)", () => {
    for (const t of [...SAMPLE_NAMES, ...SAMPLE_LINES]) expect(t).not.toContain("!");
    for (const line of SAMPLE_LINES) expect(line).toMatch(/요$/);
  });
});

describe("layoutCubbyProps — one instanced mesh per prop type (Task 9)", () => {
  const layout = layoutCubbyProps(anchors, SAMPLE_CUBBIES);

  it("one entry per prop type the samples use, its count the number of placements of that type", () => {
    expect(new Set(layout.map((e) => e.kind)).size).toBe(layout.length);
    for (const kind of PROP_KINDS) {
      const want = SAMPLE_CUBBIES.reduce((n, s) => n + s.props.filter((p) => p.kind === kind).length, 0);
      const entry = layout.find((e) => e.kind === kind);
      if (want === 0) expect(entry).toBeUndefined();
      else {
        expect(entry!.count, kind).toBe(want);
        expect(entry!.matrices).toHaveLength(want * 16);
        expect(entry!.cubbies).toHaveLength(want);
      }
    }
    expect(layout.length).toBe(PROP_KINDS.length); // 160 cubbies use every one of the nine
    expect(layout.find((e) => e.kind === "photo_frame")!.photoTiles).toHaveLength(SAMPLE_CUBBIES.length);
  });

  it("empty cubbies get no props", () => {
    const filled = new Set(SAMPLE_CUBBIES.map((s) => s.id));
    for (const e of layout) for (const id of e.cubbies) expect(filled.has(id), id).toBe(true);
    expect(layoutCubbyProps(anchors, [])).toEqual([]);
    // one sample: only its own props
    const one = SAMPLE_CUBBIES[0]!;
    const single = layoutCubbyProps(anchors, [one]);
    expect(single.reduce((n, e) => n + e.count, 0)).toBe(one.props.length);
    for (const e of single) expect(e.cubbies.every((id) => id === one.id)).toBe(true);
    // a sample whose cubby is not in the hall is skipped
    const stray: SampleCubby = { ...one, id: "n_9_99" };
    expect(layoutCubbyProps(anchors, [stray])).toEqual([]);
  });

  it("a prop sits in its cubby: inside the cell, on its floor, facing into the room", () => {
    const pos = new Vector3();
    for (const e of layout) {
      e.cubbies.forEach((id, i) => {
        const a = anchors.find((x) => x.id === id)!;
        pos.setFromMatrixPosition(new Matrix4().fromArray(e.matrices, i * 16));
        // within the 0.4 m cell around the anchor, behind the opening, at the floor (+ dy)
        const fx = Math.sin(a.yaw);
        const fz = Math.cos(a.yaw);
        const back = -((pos.x - a.x) * fx + (pos.z - a.z) * fz);
        const along = (pos.x - a.x) * fz - (pos.z - a.z) * fx;
        expect(back).toBeGreaterThanOrEqual(-1e-6);
        expect(back).toBeLessThanOrEqual(0.36);
        expect(Math.abs(along)).toBeLessThanOrEqual(0.2);
        expect(pos.y).toBeCloseTo(a.y - CUBBY_FLOOR_BELOW_ANCHOR, 6);
      });
    }
    // the frame: u along the run's right-hand axis, w back into the cell, the yaw turned
    const east = anchors.find((a) => a.id === "e_0_0")!;
    const m = placementMatrix(east, { u: 0.1, w: 0.2, dy: 0.05, turn: 0 });
    const p = new Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(east.x + 0.2, 6); // the east wall faces -x: back into the cubby is +x
    expect(p.z).toBeCloseTo(east.z + 0.1, 6); // and its run goes +z
    expect(p.y).toBeCloseTo(east.y - 0.2 + 0.05, 6);
  });
});

describe("the portraits share one material through a per-instance atlas tile", () => {
  it("tile offsets: 4 x 4, row by row from the top-left", () => {
    expect(photoTileOffset(0)).toEqual([0, 0]);
    expect(photoTileOffset(1)).toEqual([0.25, 0]);
    expect(photoTileOffset(5)).toEqual([0.25, 0.25]);
    expect(photoTileOffset(15)).toEqual([0.75, 0.75]);
    expect(photoTileOffset(16)).toEqual([0, 0]); // wraps
    expect(Array.from(photoTileAttribute([0, 5, 15]))).toEqual([0, 0, 0.25, 0.25, 0.75, 0.75]);
  });

  it("builds one InstancedMesh per prop and slot, the photo slot on the atlas material with a photoTile attribute", () => {
    // a stand-in props file: every kind one mesh, the photo frame and the name card two slots, like memorial_props.glb
    const scene = new Group();
    const props = new MeshBasicMaterial({ name: "M_props" });
    const photo = new MeshBasicMaterial({ name: PHOTO_MATERIAL });
    const name = new MeshBasicMaterial({ name: "M_name" });
    for (const kind of PROP_KINDS) {
      const node = new Group();
      node.name = `prop__${kind}`;
      node.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), props));
      if (kind === "photo_frame") node.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.01), photo));
      if (kind === "name_card") node.add(new Mesh(new BoxGeometry(0.1, 0.04, 0.01), name));
      scene.add(node);
    }
    const layout = layoutCubbyProps(anchors, SAMPLE_CUBBIES);
    const atlasMaterial = makePhotoMaterial(new Texture());
    const built = buildCubbyPropMeshes(scene, layout, atlasMaterial);
    expect(built.meshes).toHaveLength(PROP_KINDS.length + 2); // the draw calls: 11 for ~1,000 props
    for (const e of layout) {
      const ms = built.meshes.filter((m) => m.name.startsWith(`inst__${e.kind}_`));
      for (const m of ms) expect(m.count).toBe(e.count);
    }
    const photoMesh = built.meshes.find((m) => m.material === atlasMaterial)!;
    expect(photoMesh.count).toBe(SAMPLE_CUBBIES.length);
    const attr = photoMesh.geometry.getAttribute("photoTile");
    expect(attr.itemSize).toBe(2);
    expect(attr.count).toBe(SAMPLE_CUBBIES.length);
    // only the photo slot was given a new material; the others share the file's
    expect(built.meshes.filter((m) => m.material !== atlasMaterial).every((m) => m.material === props || m.material === name)).toBe(true);
    for (const r of built.own) r.dispose();
  });
});
