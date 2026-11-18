import { useMemo } from "react";
import { Color, DoubleSide, MeshStandardMaterial, type Texture } from "three";
import { GeoBuilder, type V3 } from "./geoBuilder";
import { addHipRoof } from "./parkShapes";
import { boothBoardTexture, chalkMenuTexture } from "./canvasTextures";
import { parkMaterial, pickSet } from "./pbr";

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];

export interface BoothSpec {
  /** Centre of the footprint (m). */
  x: number;
  z: number;
  /** Footprint width (x) and depth (z): the front, with the service window, faces +z. */
  w: number;
  d: number;
  /** "snack": cotton candy, cups and jars; "ticket": the ticket window, a bell and ticket stacks. */
  kind: "snack" | "ticket";
  /** The plaster's colour (sRGB hex). */
  plaster: string;
  /** The roof tile's tint. */
  tile: string;
  /** The signboard's words. */
  title: string;
  sub: string;
  /** Awning stripe colours. */
  stripes: [V3, V3];
}

const CREAM: V3 = [0.97, 0.94, 0.88];

/** The booth's parts as merged geometry per material (the goods and the awning stand out of the plaster). */
export function buildBooth(s: BoothSpec) {
  const stone = new GeoBuilder();
  const plaster = new GeoBuilder();
  const roof = new GeoBuilder();
  const wood = new GeoBuilder();
  const cloth = new GeoBuilder();
  const goods = new GeoBuilder();
  const { x, z, w, d } = s;
  const hx = w / 2;
  const hz = d / 2;
  const timber: V3 = [0.4, 0.26, 0.16];
  const wallTop = 3.0;
  const plinthH = 0.34;
  const t = 0.16; // wall thickness
  const sill = 1.08;
  const lintel = 2.3;
  const ww = Math.min(w - 1.2, s.kind === "snack" ? 2.7 : 2.0); // the window's width
  const white: V3 = [1, 1, 1];

  // a stone plinth with a cap course, and the floor inside
  stone.box([x, plinthH / 2, z], X, Y, hx + 0.1, plinthH / 2, hz + 0.1, [0.82, 0.8, 0.76], 2);
  stone.box([x, plinthH + 0.03, z], X, Y, hx + 0.14, 0.03, hz + 0.14, [0.92, 0.9, 0.86], 2);
  // the walls: back, two sides and the front in four pieces round the service window
  plaster.box([x, (plinthH + wallTop) / 2, z - hz + t / 2], X, Y, hx, (wallTop - plinthH) / 2, t / 2, white, 2);
  for (const sx of [-1, 1]) plaster.box([x + sx * (hx - t / 2), (plinthH + wallTop) / 2, z], X, Y, t / 2, (wallTop - plinthH) / 2, hz, white, 2);
  const fz = z + hz - t / 2;
  const sideW = (w - ww) / 2;
  for (const sx of [-1, 1]) plaster.box([x + sx * (ww / 2 + sideW / 2), (plinthH + wallTop) / 2, fz], X, Y, sideW / 2, (wallTop - plinthH) / 2, t / 2, white, 2);
  plaster.box([x, (plinthH + sill) / 2, fz], X, Y, ww / 2, (sill - plinthH) / 2, t / 2, white, 2);
  plaster.box([x, (lintel + wallTop) / 2, fz], X, Y, ww / 2, (wallTop - lintel) / 2, t / 2, white, 2);
  // the inside: a warm floor and ceiling so the open window shows a room, not the sky
  wood.box([x, plinthH + 0.01, z], X, Y, hx - t, 0.01, hz - t, [0.5, 0.36, 0.24]);
  wood.box([x, wallTop - 0.02, z], X, Y, hx - t, 0.02, hz - t, [0.86, 0.78, 0.62]);
  // timber: corner posts, a plate under the eave, the window frame, the counter and its brackets
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.box([x + sx * (hx - 0.03), (plinthH + wallTop) / 2, z + sz * (hz - 0.03)], X, Y, 0.09, (wallTop - plinthH) / 2, 0.09, timber);
  wood.box([x, wallTop - 0.08, z + hz + 0.02], X, Y, hx + 0.02, 0.1, 0.06, timber);
  wood.box([x, wallTop - 0.08, z - hz - 0.02], X, Y, hx + 0.02, 0.1, 0.06, timber);
  for (const sx of [-1, 1]) {
    wood.box([x + sx * (hx + 0.02), wallTop - 0.08, z], X, Y, 0.06, 0.1, hz + 0.02, timber);
    wood.box([x + sx * (ww / 2 + 0.07), (sill + lintel) / 2, fz + 0.05], X, Y, 0.08, (lintel - sill) / 2 + 0.06, 0.09, timber);
  }
  wood.box([x, lintel + 0.06, fz + 0.05], X, Y, ww / 2 + 0.15, 0.08, 0.1, timber);
  wood.box([x, sill - 0.02, fz + 0.05], X, Y, ww / 2 + 0.15, 0.05, 0.1, timber);
  // the counter: a thick plank over the sill, reaching out, on two brackets
  const counterZ = z + hz + 0.28;
  wood.box([x, sill + 0.06, counterZ], X, Y, ww / 2 + 0.3, 0.05, 0.38, [0.55, 0.36, 0.2]);
  for (const sx of [-1, 1]) wood.box([x + sx * (ww / 2 + 0.05), sill - 0.22, z + hz + 0.14], X, Y, 0.05, 0.26, 0.2, timber);
  // the shutter flap, propped open above the window on two stays
  const flap: V3 = [0, 0.9, -0.43];
  wood.box([x, lintel + 0.38, z + hz + 0.34], X, [flap[0], 0.98, 0.2], ww / 2 + 0.08, 0.04, 0.3, [0.28, 0.4, 0.55]);
  // inside the window: a back shelf with jars / tickets, so the opening has depth
  wood.box([x, 1.85, z - hz + t + 0.12], X, Y, ww / 2 - 0.1, 0.035, 0.12, timber);
  wood.box([x, 2.2, z - hz + t + 0.12], X, Y, ww / 2 - 0.1, 0.035, 0.12, timber);
  const jar = (jx: number, jy: number, jz: number, c: V3) => {
    goods.cylinder([jx, jy, jz], [jx, jy + 0.22, jz], 0.07, 0.07, 10, c, true);
    goods.cylinder([jx, jy + 0.22, jz], [jx, jy + 0.26, jz], 0.075, 0.075, 10, [0.85, 0.7, 0.3], true);
  };
  if (s.kind === "snack") {
    const cols: V3[] = [[0.96, 0.5, 0.6], [0.98, 0.82, 0.3], [0.5, 0.78, 0.95], [0.6, 0.85, 0.5], [0.85, 0.6, 0.95]];
    for (let i = 0; i < 7; i++) jar(x - ww / 2 + 0.25 + i * ((ww - 0.5) / 6), 1.885, z - hz + t + 0.12, cols[i % cols.length]!);
    for (let i = 0; i < 6; i++) jar(x - ww / 2 + 0.32 + i * ((ww - 0.64) / 5), 2.235, z - hz + t + 0.12, cols[(i + 2) % cols.length]!);
    // cotton candy on the counter: paper cones with soft puffs, and striped cups
    for (let i = 0; i < 5; i++) {
      const cxp = x - ww / 2 + 0.32 + i * ((ww - 0.64) / 4);
      goods.cylinder([cxp, sill + 0.11, counterZ], [cxp, sill + 0.4, counterZ], 0.025, 0.1, 8, CREAM, true);
      const puff = cols[i % cols.length]!;
      goods.cylinder([cxp, sill + 0.4, counterZ], [cxp, sill + 0.66, counterZ], 0.13, 0.17, 10, [puff[0] * 0.55 + 0.45, puff[1] * 0.55 + 0.45, puff[2] * 0.55 + 0.45], true);
      goods.cylinder([cxp, sill + 0.66, counterZ], [cxp, sill + 0.74, counterZ], 0.17, 0.08, 10, [puff[0] * 0.5 + 0.5, puff[1] * 0.5 + 0.5, puff[2] * 0.5 + 0.5], true);
    }
    for (let i = 0; i < 3; i++) {
      const cxp = x + 0.2 + i * 0.28 - 0.28;
      goods.cylinder([cxp, sill + 0.11, counterZ + 0.22], [cxp, sill + 0.3, counterZ + 0.22], 0.07, 0.05, 10, i % 2 ? [0.86, 0.3, 0.3] : CREAM, true);
    }
  } else {
    const cols: V3[] = [[0.92, 0.35, 0.3], [0.3, 0.4, 0.85], [0.95, 0.8, 0.3]];
    // stacks of tickets (little blocks), a brass bell, a small cash drawer
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) goods.box([x - ww / 2 + 0.3 + i * 0.28, 1.885 + k * 0.08, z - hz + t + 0.12], X, Y, 0.09, 0.035, 0.06, cols[(i + k) % 3]!);
    for (let i = 0; i < 4; i++) goods.box([x + 0.3 + i * 0.18 - 0.2, 2.24, z - hz + t + 0.12], X, Y, 0.07, 0.07, 0.05, cols[i % 3]!);
    for (let i = 0; i < 6; i++) goods.box([x - ww / 2 + 0.3 + i * 0.22, sill + 0.14 + (i % 2) * 0.01, counterZ], X, Y, 0.1, 0.012 + 0.02 * (i % 3), 0.07, CREAM);
    goods.cylinder([x + ww / 2 - 0.35, sill + 0.11, counterZ], [x + ww / 2 - 0.35, sill + 0.2, counterZ], 0.13, 0.1, 14, [0.88, 0.7, 0.28], true);
    goods.cylinder([x + ww / 2 - 0.35, sill + 0.2, counterZ], [x + ww / 2 - 0.35, sill + 0.27, counterZ], 0.1, 0.03, 14, [0.92, 0.75, 0.3], true);
    goods.box([x - 0.1, sill + 0.2, counterZ + 0.1], X, Y, 0.28, 0.11, 0.17, [0.3, 0.2, 0.14]);
  }
  // the striped awning over the window: sloped slabs and a scalloped valance
  const stripes = Math.round((ww + 0.6) / 0.3);
  for (let i = 0; i < stripes; i++) {
    const col = i % 2 ? s.stripes[1] : s.stripes[0];
    const px = x - ww / 2 - 0.3 + (i + 0.5) * ((ww + 0.6) / stripes);
    cloth.box([px, lintel + 0.4, z + hz + 0.56], X, [0, 0.9553, -0.2955], (ww + 0.6) / stripes / 2, 0.02, 0.62, col);
    cloth.box([px, lintel + 0.02 - (i % 2) * 0.03, z + hz + 1.14], X, Y, (ww + 0.6) / stripes / 2, 0.11 + (i % 2) * 0.03, 0.02, col);
  }
  // a tiled hip roof with a deep overhang, a ridge cap, fascia and a finial
  const over = 0.55;
  const rise = 1.15;
  addHipRoof(roof, x, wallTop, z, hx + over, hz + over, rise, [1, 1, 1], 1.7);
  const rl = Math.max(0, hx - hz);
  wood.box([x, wallTop + 0.04, z + hz + over], X, Y, hx + over, 0.07, 0.04, timber);
  wood.box([x, wallTop + 0.04, z - hz - over], X, Y, hx + over, 0.07, 0.04, timber);
  for (const sx of [-1, 1]) wood.box([x + sx * (hx + over), wallTop + 0.04, z], X, Y, 0.04, 0.07, hz + over, timber);
  plaster.box([x, wallTop + rise + 0.05, z], X, Y, rl + 0.28, 0.08, 0.13, [0.7, 0.34, 0.28], 1);
  goods.cylinder([x, wallTop + rise + 0.1, z], [x, wallTop + rise + 0.52, z], 0.03, 0.01, 6, [0.88, 0.7, 0.28]);
  goods.cylinder([x, wallTop + rise + 0.34, z], [x, wallTop + rise + 0.46, z], 0.12, 0.0, 10, [0.88, 0.7, 0.28]);
  // a hanging lantern at each front corner
  for (const sx of [-1, 1]) {
    goods.cylinder([x + sx * (hx + 0.12), wallTop - 0.2, z + hz + 0.12], [x + sx * (hx + 0.12), wallTop - 0.06, z + hz + 0.12], 0.01, 0.01, 4, [0.2, 0.2, 0.24]);
    goods.box([x + sx * (hx + 0.12), wallTop - 0.42, z + hz + 0.12], X, Y, 0.08, 0.14, 0.08, [1, 0.86, 0.5]);
  }
  // a litter barrel and a wooden crate by the wall with goods in it (the booth's own props, inside its footprint's skirt)
  return { stone: stone.build(), plaster: plaster.build(), roof: roof.build(), wood: wood.build(), cloth: cloth.build(), goods: goods.build(), signY: wallTop + 0.34, signZ: z + hz + over + 0.07, ww };
}

/** A storybook park booth: stone plinth, plastered walls, a service window with a counter and goods, a striped awning, a tiled hip roof, a signboard and a chalk menu. */
export function Booth({ all, spec }: { all: Texture[]; spec: BoothSpec }) {
  const built = useMemo(() => buildBooth(spec), [spec]);
  const stoneMat = useMemo(() => parkMaterial(pickSet(all, "Concrete034"), 1, { vertexColors: true, color: new Color("#efe6d6"), normalScale: 0.6 }), [all]);
  const plasterMat = useMemo(() => parkMaterial(pickSet(all, "Plaster003"), 0.7, { vertexColors: true, color: new Color(spec.plaster), normalScale: 1.0 }), [all, spec.plaster]);
  const roofMat = useMemo(() => parkMaterial(pickSet(all, "RoofingTiles013A"), 1, { color: new Color(spec.tile), normalScale: 1.1, side: DoubleSide }), [all, spec.tile]);
  const woodMat = useMemo(() => parkMaterial(pickSet(all, "WoodFloor051"), 1, { vertexColors: true, normalScale: 0.8 }), [all]);
  const clothMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide }), []);
  const goodsMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05, side: DoubleSide }), []);
  const board = useMemo(() => boothBoardTexture(spec.title, spec.sub), [spec.title, spec.sub]);
  const boardMat = useMemo(() => new MeshStandardMaterial({ map: board, roughness: 0.6, emissive: new Color("#ffffff"), emissiveMap: board, emissiveIntensity: 0.12 }), [board]);
  const menu = useMemo(() => chalkMenuTexture(spec.kind === "snack" ? "오늘의 간식" : "이용 안내", spec.kind === "snack" ? ["솜사탕", "별 사탕", "달빛 주스"] : ["달빛 회전목마", "하늘 등불 바퀴", "별똥별 급행"]), [spec.kind]);
  const menuMat = useMemo(() => new MeshStandardMaterial({ map: menu, roughness: 0.9 }), [menu]);
  const { x, z, w, d } = spec;
  return (
    <group>
      <mesh geometry={built.stone} material={stoneMat} castShadow receiveShadow />
      <mesh geometry={built.plaster} material={plasterMat} castShadow receiveShadow />
      <mesh geometry={built.roof} material={roofMat} castShadow receiveShadow />
      <mesh geometry={built.wood} material={woodMat} castShadow receiveShadow />
      <mesh geometry={built.cloth} material={clothMat} castShadow />
      <mesh geometry={built.goods} material={goodsMat} castShadow />
      {/* the signboard, standing on the eave in front of the roof */}
      <mesh position={[x, built.signY, built.signZ]} material={woodMat} castShadow>
        <boxGeometry args={[Math.min(w + 0.7, 3.1), 0.66, 0.07]} />
      </mesh>
      <mesh position={[x, built.signY, built.signZ + 0.037]} material={boardMat}>
        <planeGeometry args={[Math.min(w + 0.7, 3.1) - 0.08, 0.58]} />
      </mesh>
      {/* the chalk menu on a small easel by the window */}
      <group position={[x + w / 2 + 0.55, 0, z + d / 2 + 0.45]} rotation={[0, -0.35, 0]}>
        <mesh position={[0, 0.5, 0]} material={menuMat} castShadow>
          <boxGeometry args={[0.55, 0.75, 0.05]} />
        </mesh>
        <mesh position={[0, 0.5, 0.027]} material={menuMat}>
          <planeGeometry args={[0.5, 0.7]} />
        </mesh>
        <mesh position={[-0.2, 0.15, -0.08]} rotation={[0.25, 0, 0.08]} material={woodMat}>
          <boxGeometry args={[0.04, 0.55, 0.04]} />
        </mesh>
        <mesh position={[0.2, 0.15, -0.08]} rotation={[0.25, 0, -0.08]} material={woodMat}>
          <boxGeometry args={[0.04, 0.55, 0.04]} />
        </mesh>
      </group>
    </group>
  );
}
