import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Texture,
  Vector3,
} from "three";
import { ROOM_IDS } from "@caysonverse/shared/escape/constants";
import { HUB_DOORS } from "@caysonverse/shared/school/hubMap";
import {
  GATE_BAR_COUNT,
  LIGHTMAP_CHANNEL,
  LIGHTMAP_INTENSITY,
  configureLightmap,
  disposeHub,
  nodeName,
  prepareHub,
  readShafts,
} from "./hubModelPrep";

/**
 * A node tree with the names and materials the hub.glb contract promises (art/school/notes.md): the same shape the
 * GLTFLoader hands over, built by hand so no loader, Draco decoder or WebGL is needed.
 */
interface Fixture {
  root: Object3D;
  mats: Record<string, MeshBasicMaterial>;
}

function mat(name: string, color = "#ffffff"): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color });
  m.name = name;
  return m;
}

function mesh(name: string, material: MeshBasicMaterial, geometry: BufferGeometry = new BoxGeometry(1, 1, 1)): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  return m;
}

function empty(name: string, x: number, y: number, z: number, quat?: Quaternion): Object3D {
  const o = new Object3D();
  o.name = name;
  o.position.set(x, y, z);
  if (quat) o.quaternion.copy(quat);
  return o;
}

function yaw(rad: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad);
}

function fixture(): Fixture {
  const mats = {
    LM_palette: mat("LM_palette"),
    LM_wood: mat("LM_wood"),
    M_glow: mat("M_glow", "#aabbff"),
    M_cloud: mat("M_cloud"),
    M_sky: mat("M_sky"),
    M_board_window: mat("M_board_window", "#b4bcd3"),
  };
  const root = new Object3D();
  root.add(mesh("hub_static_hall", mats.LM_palette));
  root.add(mesh("hub_static_corridor", mats.LM_wood));
  root.add(mesh("hub_glow", mats.M_glow)); // lamps: keep the shared glow
  root.add(mesh("hub_window_sky", mats.M_sky));
  root.add(mesh("backdrop__clouds", mats.M_cloud));
  root.add(mesh("col__plant_20", mats.M_sky), mesh("col__bench", mats.M_sky));

  const gate = empty(nodeName.gate, 14, 0, 0);
  for (let i = 1; i <= GATE_BAR_COUNT; i++) gate.add(mesh(nodeName.gateBar(i), mats.M_glow));
  gate.add(mesh(nodeName.gateRails, mats.M_glow));
  root.add(gate);

  ROOM_IDS.forEach((room, i) => {
    const w = mesh(nodeName.window(room), mats.M_board_window);
    w.position.set(-3 + i * 0.6, 1.55, -11.4);
    root.add(w);
  });

  for (const d of HUB_DOORS) {
    const sign = d.side === "n" ? -1 : 1;
    const door = empty(nodeName.door(d.room), d.x, 0, sign * 3);
    // As in hub.glb: two leaves 0.78 either side of the centre, 0.05 thick, set 0.25 m into the wall's thickness
    // (the door node has no rotation: a north door's leaves sit at local z -0.25, a south door's at +0.25).
    const l = mesh(`${nodeName.door(d.room)}__L`, mats.LM_palette, new BoxGeometry(0.78, 3, 0.05));
    l.position.set(-0.39, 1.5, sign * 0.25);
    const r = mesh(`${nodeName.door(d.room)}__R`, mats.LM_palette, new BoxGeometry(0.78, 3, 0.05));
    r.position.set(0.39, 1.5, sign * 0.25);
    door.add(l, r);
    root.add(door);

    const pad = mesh(nodeName.pad(d.room), mats.LM_palette);
    pad.position.set(d.x, 0, sign * 1.7);
    pad.add(mesh(`${nodeName.pad(d.room)}__glow`, mats.M_glow));
    root.add(pad);
  }

  // Shaft empties, deliberately out of order. A half turn is the case Euler angles get wrong.
  root.add(empty("shaft__10", 13.98, 2.275, 5, yaw(-Math.PI / 2)));
  root.add(empty("shaft__2", -9, 2.275, 11.98, yaw(Math.PI)));
  root.add(empty("shaft__1", -11, 2.275, 11.98, yaw(Math.PI)));
  return { root, mats };
}

const lightmap = (): Texture => new Texture();

describe("configureLightmap", () => {
  it("sets flipY false, sRGB and channel 1, and flags one upload", () => {
    const t = lightmap();
    const v0 = t.version;
    configureLightmap(t);
    expect(t.flipY).toBe(false);
    expect(t.colorSpace).toBe(SRGBColorSpace);
    expect(t.channel).toBe(LIGHTMAP_CHANNEL);
    expect(t.version).toBe(v0 + 1);
  });

  it("is idempotent: a texture that is already right is not uploaded again", () => {
    const t = configureLightmap(lightmap());
    const v = t.version;
    configureLightmap(t);
    configureLightmap(t);
    expect(t.version).toBe(v);
  });

  it("pins the recipe's numbers: channel 1 and intensity 1.6π", () => {
    expect(LIGHTMAP_CHANNEL).toBe(1);
    expect(LIGHTMAP_INTENSITY).toBeCloseTo(1.6 * Math.PI, 12);
  });
});

describe("prepareHub", () => {
  it("light-maps every LM_* material and no M_* one", () => {
    const { root, mats } = fixture();
    const lm = lightmap();
    prepareHub(root, lm);
    for (const name of ["LM_palette", "LM_wood"] as const) {
      expect(mats[name].lightMap, name).toBe(lm);
      expect(mats[name].lightMapIntensity, name).toBeCloseTo(1.6 * Math.PI, 12);
    }
    for (const name of ["M_glow", "M_cloud", "M_sky", "M_board_window"] as const) {
      expect(mats[name].lightMap, name).toBeNull();
    }
    expect(lm.flipY).toBe(false);
    expect(lm.channel).toBe(1);
  });

  it("turns the fog off for the cloud cards only", () => {
    const { root, mats } = fixture();
    prepareHub(root, lightmap());
    expect(mats.M_cloud.fog).toBe(false);
    expect(mats.M_sky.fog).toBe(true);
    expect(mats.LM_palette.fog).toBe(true);
  });

  it("hides every col__* node in the clone and leaves the source tree alone", () => {
    const { root } = fixture();
    const nodes = prepareHub(root, lightmap());
    const cols: Object3D[] = [];
    nodes.root.traverse((o) => {
      if (o.name.startsWith("col__")) cols.push(o);
    });
    expect(cols.map((c) => c.name).sort()).toEqual(["col__bench", "col__plant_20"]);
    expect(cols.every((c) => !c.visible)).toBe(true);
    expect(root.getObjectByName("col__bench")!.visible).toBe(true);
    // Everything else stays visible.
    expect(nodes.root.getObjectByName("hub_static_hall")!.visible).toBe(true);
    expect(nodes.root.getObjectByName(nodeName.gate)!.visible).toBe(true);
  });

  it("gives the gate's bars and rails one private glow material; the lamps keep the shared one", () => {
    const { root, mats } = fixture();
    const nodes = prepareHub(root, lightmap());
    expect(nodes.gate).not.toBeNull();
    const g = nodes.gate!;
    expect(g.group.name).toBe("gate__east");
    expect(g.material).not.toBe(mats.M_glow);
    expect(g.material.name).toBe("M_glow");
    const parts: Mesh[] = [];
    g.group.traverse((o) => {
      if ((o as Mesh).isMesh) parts.push(o as Mesh);
    });
    expect(parts).toHaveLength(GATE_BAR_COUNT + 1);
    expect(parts.every((p) => p.material === g.material)).toBe(true);
    expect((nodes.root.getObjectByName("hub_glow") as Mesh).material).toBe(mats.M_glow);
    // Flashing the gate does not touch the shared material.
    g.material.color.setScalar(1.9);
    expect(mats.M_glow.color.getHexString()).toBe("aabbff");
  });

  it("gives each board window its own pane material and remembers the unlit colour", () => {
    const { root, mats } = fixture();
    const nodes = prepareHub(root, lightmap());
    expect(Object.keys(nodes.windows).sort()).toEqual([...ROOM_IDS].sort());
    const materials = new Set(ROOM_IDS.map((r) => nodes.windows[r]!.material));
    expect(materials.size).toBe(ROOM_IDS.length);
    for (const room of ROOM_IDS) {
      const w = nodes.windows[room]!;
      expect(w.mesh.name).toBe(`board_window__${room}`);
      expect(w.mesh.material).toBe(w.material);
      expect(w.material).not.toBe(mats.M_board_window);
      expect(w.unlit.getHexString()).toBe("b4bcd3");
    }
    // Lighting one room leaves its neighbours and the shared original alone.
    nodes.windows.counsel!.material.color.set("#ffc94d");
    expect(nodes.windows.library!.material.color.getHexString()).toBe("b4bcd3");
    expect(mats.M_board_window.color.getHexString()).toBe("b4bcd3");
    expect(nodes.windows.counsel!.unlit.getHexString()).toBe("b4bcd3");
  });

  it("gives each pad its own material (the baked mat) and leaves its glow ring on the shared one", () => {
    const { root, mats } = fixture();
    const nodes = prepareHub(root, lightmap());
    for (const d of HUB_DOORS) {
      const p = nodes.pads[d.room]!;
      expect(p.mesh.name).toBe(`pad__${d.room}`);
      expect(p.material).not.toBe(mats.LM_palette);
      // The clone keeps the light map (it was cloned after the light map went on).
      expect(p.material.lightMap).not.toBeNull();
      expect(p.material.lightMapIntensity).toBeCloseTo(1.6 * Math.PI, 12);
      expect((p.mesh.getObjectByName(`pad__${d.room}__glow`) as Mesh).material).toBe(mats.M_glow);
    }
    expect(new Set(HUB_DOORS.map((d) => nodes.pads[d.room]!.material)).size).toBe(HUB_DOORS.length);
  });

  it("gives each door one material for both leaves, and finds the face that looks into the corridor", () => {
    const { root, mats } = fixture();
    const nodes = prepareHub(root, lightmap());
    for (const d of HUB_DOORS) {
      const door = nodes.doors[d.room]!;
      expect(door.group.name).toBe(`door__${d.room}`);
      expect(door.material).not.toBe(mats.LM_palette);
      expect(door.material.lightMap).not.toBeNull();
      const leaves = door.group.children as Mesh[];
      expect(leaves).toHaveLength(2);
      expect(leaves.every((l) => l.material === door.material)).toBe(true);
      const wall = d.side === "n" ? -3 : 3;
      if (d.side === "n") {
        // North wall (z -3): the corridor is on +z, so the face that looks into it is the leaf's larger z.
        expect(door.facing).toBe(1);
        expect(door.frontZ).toBeCloseTo(wall - 0.25 + 0.025, 6);
      } else {
        expect(door.facing).toBe(-1);
        expect(door.frontZ).toBeCloseTo(wall + 0.25 - 0.025, 6);
      }
    }
  });

  it("returns the shaft points in numeric order, with the inward yaw (a half turn included)", () => {
    const { root } = fixture();
    const s = prepareHub(root, lightmap()).shafts;
    expect(s).toHaveLength(3);
    expect(s.map((p) => [p.x, p.z])).toEqual([
      [-11, 11.98],
      [-9, 11.98],
      [13.98, 5],
    ]);
    // Local +Z after a half turn is -z (the south wall's windows look north into the hall).
    expect(Math.abs(s[0]!.rotY)).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(s[1]!.rotY)).toBeCloseTo(Math.PI, 6);
    // A -90° turn points -x (the east wall's windows look west).
    expect(s[2]!.rotY).toBeCloseTo(-Math.PI / 2, 6);
    expect(s[0]!.y).toBeCloseTo(2.275, 6);
  });

  it("works on a clone: two calls give independent nodes and the same shared model", () => {
    const { root, mats } = fixture();
    const lm = lightmap();
    const a = prepareHub(root, lm);
    const b = prepareHub(root, lm);
    expect(a.root).not.toBe(b.root);
    expect(a.windows.art!.material).not.toBe(b.windows.art!.material);
    expect(a.gate!.material).not.toBe(b.gate!.material);
    // The shared LM material was light-mapped once and stays so.
    expect(mats.LM_palette.lightMap).toBe(lm);
    // The second call did not queue another upload.
    const v = lm.version;
    prepareHub(root, lm);
    expect(lm.version).toBe(v);
  });

  it("tolerates a model that lacks the nodes (no throw, empty handles)", () => {
    const root = new Object3D();
    root.add(mesh("hub_static_hall", mat("LM_palette")));
    const n = prepareHub(root, lightmap());
    expect(n.gate).toBeNull();
    expect(n.windows).toEqual({});
    expect(n.pads).toEqual({});
    expect(n.doors).toEqual({});
    expect(n.shafts).toEqual([]);
  });
});

describe("disposeHub", () => {
  it("disposes exactly the materials prepareHub made, not the shared ones", () => {
    const { root, mats } = fixture();
    const nodes = prepareHub(root, lightmap());
    const disposed = new Set<string>();
    for (const m of nodes.own) m.addEventListener("dispose", () => disposed.add(`own:${nodes.own.indexOf(m)}`));
    for (const [k, m] of Object.entries(mats)) m.addEventListener("dispose", () => disposed.add(k));
    disposeHub(nodes);
    expect(nodes.own.length).toBeGreaterThan(ROOM_IDS.length + HUB_DOORS.length * 2);
    expect([...disposed].filter((k) => !k.startsWith("own:"))).toEqual([]);
    expect([...disposed].filter((k) => k.startsWith("own:"))).toHaveLength(nodes.own.length);
  });
});

describe("readShafts", () => {
  it("reads empties at any depth with their world position", () => {
    const root = new Object3D();
    const parent = empty("holder", 10, 0, 0);
    parent.add(empty("shaft__1", 1, 2, 3, yaw(Math.PI / 2)));
    root.add(parent);
    const [p] = readShafts(root);
    expect([p!.x, p!.y, p!.z]).toEqual([11, 2, 3]);
    expect(p!.rotY).toBeCloseTo(Math.PI / 2, 6);
  });
});
