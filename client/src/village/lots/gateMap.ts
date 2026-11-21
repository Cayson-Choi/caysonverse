import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  AdditiveBlending,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { versionedUrl } from "../modelUrl";

/**
 * 케이슨랜드 안내도 at the gate (owner 2026-11-21: "지도도 제대로 다시 만들어"). The gate's file carried a generic cartoon map (a pink castle,
 * a pond, a tent: nothing of the real park) on both piers' inner faces and in the six ticket windows. Those are cut out of the lot's detail
 * (`isOldGateMap`) and the real guide map takes their place: client/public/textures/park/park_guide_map.webp, composed from photos of the
 * park itself (tools/park-guide-map.py - every ride at its true place, numbered, with the in-game names, the compass and "현재 위치").
 *
 *   - on each pier's inner face: a notice case - a navy frame with a gilt slip, the print behind a pane (a faint sheen across it), 1.9 m wide
 *     at eye level, lit a little from behind at night so it reads after dark;
 *   - in each ticket window: the same print, small, where the cartoon was.
 *
 * World metres (lot_gate.glb): the piers' inner faces are the planes x = -27 (looking east) and x = -21 (looking west), z 92.6 .. 95.
 */
export const GATE_MAP = Object.freeze({
  /** The print's size (16:9, the texture's) and its centre on a pier's face. */
  width: 1.9,
  height: 1.06875,
  y: 1.72,
  // (clear of the iron leaf's hinge at z 94.8: the case ends at z 94.68, so the leaf swings past it)
  z: 93.66,
  /** The piers' inner faces (x) and which way each looks (+1 east, -1 west). */
  faces: [
    { x: -27, out: 1 },
    { x: -21, out: -1 },
  ],
} as const);

export const GATE_MAP_URL = "/textures/park/park_guide_map.webp";
export const GATE_MAP_URL_PHONE = "/textures/park/park_guide_map_1k.webp";

/**
 * The six ticket windows' map panels (lot_gate.glb: a strip of the cartoon map over each window's shutter): centre, size, and the way
 * they look (north, toward the village).
 */
export const GATE_WINDOW_MAPS: ReadonlyArray<{ x: number; y: number; z: number; w: number; h: number; nx: number; nz: number }> = Object.freeze(
  [-31.85, -30.55, -29.25, -18.75, -17.45, -16.15].map((x) => Object.freeze({ x, y: 2.51, z: 92.78, w: 0.9, h: 0.42, nx: 0, nz: -1 })),
);

/** The old cartoon map's quads (the goods atlas): on the piers' inner faces, and the strip in each ticket window. */
export function isOldGateMap(x: number, y: number, z: number, material: string): boolean {
  if (!/goods/i.test(material)) return false;
  if ((Math.abs(x + 27) < 0.05 || Math.abs(x + 21) < 0.05) && y > 1.0 && y < 2.6 && z > 93.0 && z < 94.6) return true;
  if (Math.abs(z - 92.78) < 0.03 && y > 2.25 && y < 2.78) for (const w of GATE_WINDOW_MAPS) if (Math.abs(x - w.x) < w.w / 2 + 0.02) return true;
  return false;
}

function tint(g: BufferGeometry, c: Color): BufferGeometry {
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[3 * i] = c.r;
    a[3 * i + 1] = c.g;
    a[3 * i + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g.index ? g.toNonIndexed() : g;
}

/** The pane's sheen: two soft diagonal bands of sky light (canvas, additive, very faint). */
function sheenTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 144;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 144);
  const band = (x: number, w: number, a: number) => {
    const grd = g.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.save();
    g.transform(1, 0, -0.55, 1, 60, 0);
    g.fillRect(x, 0, w, 144);
    g.restore();
  };
  band(30, 46, 0.5);
  band(96, 14, 0.3);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface GateMaps {
  group: Group;
  geometries: BufferGeometry[];
  materials: Array<MeshStandardMaterial | MeshBasicMaterial>;
  /** The print's material: its `emissiveIntensity` is the back light (the caller ties it to the night). */
  print: MeshStandardMaterial;
  triangles: number;
  draws: number;
}

/**
 * Build the two notice cases and the small prints. `windows`: the ticket windows' old map quads as (centre, size, facing) - found on the
 * model by the caller. `patch` hooks the lit materials into the lots' light.
 */
export function buildGateMaps(
  low: boolean,
  windows: ReadonlyArray<{ x: number; y: number; z: number; w: number; h: number; nx: number; nz: number }>,
  patch: (m: MeshStandardMaterial, key: string) => void,
): GateMaps {
  const M = GATE_MAP;
  const map: Texture = new TextureLoader().load(versionedUrl(low ? GATE_MAP_URL_PHONE : GATE_MAP_URL));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = low ? 4 : 16;
  map.generateMipmaps = true;
  map.minFilter = LinearMipmapLinearFilter;
  const print = new MeshStandardMaterial({ name: "LM_gate_map_print", map, roughness: 0.5, metalness: 0, emissive: new Color("#ffffff"), emissiveMap: map, emissiveIntensity: 0 });
  patch(print, "gate_map_print");
  const paint = new MeshStandardMaterial({ name: "LM_gate_map_frame", vertexColors: true, roughness: 0.38, metalness: 0 });
  patch(paint, "gate_map_frame");
  const sheenMap = sheenTexture();
  const sheen = new MeshBasicMaterial({ name: "M_gate_map_sheen", map: sheenMap, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  print.addEventListener("dispose", () => map.dispose());
  sheen.addEventListener("dispose", () => sheenMap.dispose());

  const NAVY = new Color("#1a2566");
  const GILT = new Color("#d9ae4a");
  const group = new Group();
  group.name = "gate_guide_maps";
  const frames: BufferGeometry[] = [];
  const prints: BufferGeometry[] = [];
  const panes: BufferGeometry[] = [];
  // a case in its own frame: the print in the plane z = 0 looking +z, x along its width
  const fw = 0.07;
  const caseParts = (): BufferGeometry[] => {
    const p: BufferGeometry[] = [];
    p.push(tint(new BoxGeometry(M.width + 2 * fw, M.height + 2 * fw, 0.03), NAVY).translate(0, 0, -0.016)); // the back board
    for (const [bw, bh, bx, by] of [
      [M.width + 2 * fw, fw, 0, -(M.height + fw) / 2],
      [M.width + 2 * fw, fw, 0, (M.height + fw) / 2],
      [fw, M.height, -(M.width + fw) / 2, 0],
      [fw, M.height, (M.width + fw) / 2, 0],
    ] as const)
      p.push(tint(new BoxGeometry(bw, bh, 0.06), NAVY).translate(bx, by, 0.012));
    // the gilt slip inside the frame
    const s = 0.014;
    for (const [bw, bh, bx, by] of [
      [M.width, s, 0, -(M.height - s) / 2],
      [M.width, s, 0, (M.height - s) / 2],
      [s, M.height, -(M.width - s) / 2, 0],
      [s, M.height, (M.width - s) / 2, 0],
    ] as const)
      p.push(tint(new BoxGeometry(bw, bh, 0.012), GILT).translate(bx, by, 0.012));
    return p;
  };
  for (const f of M.faces) {
    // the case's +z looks out of the pier's face (east for the west pier, west for the east pier)
    const yaw = f.out > 0 ? Math.PI / 2 : -Math.PI / 2;
    const place = (g: BufferGeometry, off: number) => g.rotateY(yaw).translate(f.x + f.out * (0.035 + off), M.y, M.z);
    for (const g of caseParts()) frames.push(place(g, 0));
    prints.push(place(new PlaneGeometry(M.width, M.height), 0.004));
    panes.push(place(new PlaneGeometry(M.width, M.height), 0.03));
  }
  for (const w of windows) {
    // the same print where the cartoon was, fitted to the old panel (letterboxed inside it on a navy mat)
    const yaw = Math.atan2(w.nx, w.nz);
    const fit = Math.min(w.w / M.width, w.h / M.height);
    frames.push(tint(new BoxGeometry(w.w, w.h, 0.01), NAVY).rotateY(yaw).translate(w.x + w.nx * 0.006, w.y, w.z + w.nz * 0.006));
    prints.push(new PlaneGeometry(M.width * fit, M.height * fit).rotateY(yaw).translate(w.x + w.nx * 0.014, w.y, w.z + w.nz * 0.014));
  }
  const frameGeo = mergeGeometries(frames, false)!;
  const printGeo = mergeGeometries(prints, false)!;
  const paneGeo = mergeGeometries(panes, false)!;
  for (const g of [...frames, ...prints, ...panes]) g.dispose();
  const mk = (g: BufferGeometry, m: MeshStandardMaterial | MeshBasicMaterial, name: string) => {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  };
  mk(frameGeo, paint, "gate_map_frames");
  mk(printGeo, print, "gate_map_prints");
  mk(paneGeo, sheen, "gate_map_panes").renderOrder = 2;
  const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  return { group, geometries: [frameGeo, printGeo, paneGeo], materials: [paint, print, sheen], print, triangles: tris(frameGeo) + tris(printGeo) + tris(paneGeo), draws: 3 };
}
