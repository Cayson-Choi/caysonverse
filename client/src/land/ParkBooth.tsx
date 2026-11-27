import { useMemo } from "react";
import { Color, DoubleSide, MeshStandardMaterial, type Texture } from "three";
import { GeoBuilder, norm, type V3 } from "./geoBuilder";
import { addHipRoof, addLathe } from "./parkShapes";
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

function addAwning(cloth: GeoBuilder, fittings: GeoBuilder, x: number, wallZ: number, width: number, colors: [V3, V3]) {
  const bands = Math.round(width / 0.3);
  const projection = 1.14;
  const frontZ = wallZ + projection;
  const railY = 2.48;
  const rise = 0.42;
  const metal: V3 = [0.2, 0.19, 0.16];
  const left = x - width / 2;
  for (let band = 0; band < bands; band++) {
    const color = colors[band % 2]!;
    const x0 = left + width * band / bands;
    const x1 = left + width * (band + 1) / bands;
    // The canvas sags slightly between its attachment at the wall and the front rail.
    for (let row = 0; row <= 4; row++) {
      const t = row / 4;
      const sag = 0.065 * Math.sin(Math.PI * t);
      const y = railY + rise * (1 - t) - sag;
      const normal = norm([0, projection, rise + 0.065 * Math.PI * Math.cos(Math.PI * t)]);
      const a = cloth.rawVertex([x0, y, wallZ + t * projection], normal, 0, t, color);
      cloth.rawVertex([x1, y, wallZ + t * projection], normal, 1, t, color);
      if (row > 0) cloth.idx.push(a - 2, a, a - 1, a - 1, a, a + 1);
    }
    // The hanging hem starts exactly on the leading edge; its rounded lobes droop between the seams.
    for (let k = 0; k <= 6; k++) {
      const u = k / 6;
      const lobe = Math.sin(Math.PI * u);
      const px = x0 + u * (x1 - x0);
      const a = cloth.rawVertex([px, railY, frontZ], [0, 0, 1], u, 1, color);
      cloth.rawVertex([px, railY - 0.07 - 0.11 * lobe, frontZ + 0.014 * lobe], [0, 0, 1], u, 0, color);
      if (k > 0) cloth.idx.push(a - 2, a - 1, a, a, a - 1, a + 1);
    }
  }
  const rodY = railY - 0.025;
  const rodZ = frontZ - 0.024;
  fittings.cylinder([left, rodY, rodZ], [left + width, rodY, rodZ], 0.024, 0.024, 8, metal, true);
  for (const side of [-1, 1]) {
    const px = x + side * (width / 2 - 0.045);
    fittings.box([px, 2.2, wallZ + 0.012], X, Y, 0.035, 0.07, 0.015, metal);
    fittings.cylinder([px, 2.2, wallZ + 0.024], [px, rodY, rodZ], 0.016, 0.016, 8, metal);
  }
}

/** A single spun-sugar shell with uneven windings, closed poles and continuous normals around the stick. */
function addCandyFloss(matte: GeoBuilder, x: number, baseY: number, z: number, tint: V3, seed: number) {
  const sides = 14;
  const rings = 9;
  const height = 0.43 + 0.035 * Math.sin(seed * 1.7);
  const lean = 0.034 * Math.cos(seed * 2.1);
  const bottom = matte.rawVertex([x, baseY, z], Y, 0.5, 0, tint);
  for (let j = 1; j < rings; j++) {
    const angle = j * Math.PI / rings;
    const h = (1 - Math.cos(angle)) / 2;
    for (let k = 0; k < sides; k++) {
      const a = 2 * Math.PI * k / sides;
      const winding = Math.sin(3 * a + 11 * h + seed) * 0.07 + Math.sin(2 * a - 15 * h + seed * 2) * 0.05;
      const r = 0.161 * Math.sin(angle) * (0.91 + 0.2 * h + winding);
      const color = tint.map(c => 0.24 + (0.69 + winding * 0.6) * c) as V3;
      matte.rawVertex([x + lean * h + r * Math.cos(a), baseY + h * height, z + r * Math.sin(a)], Y, k / sides, h, color);
    }
  }
  const top = matte.rawVertex([x + lean, baseY + height, z], Y, 0.5, 1, CREAM);
  for (let k = 0; k < sides; k++) {
    const next = (k + 1) % sides;
    let ring = bottom + 1;
    matte.idx.push(bottom, ring + k, ring + next);
    for (let j = 1; j < rings - 1; j++, ring += sides) {
      matte.idx.push(ring + k, ring + sides + k, ring + next, ring + next, ring + sides + k, ring + sides + next);
    }
    matte.idx.push(ring + k, top, ring + next);
  }
  matte.smoothNormals(bottom);
}

/**
 * The booth's back (#13 exteriors round 2, owner 2026-11-27 "매표소 뒷면": a plain white wall): the staff's way in and a little window,
 * as a real kiosk's back has them. A ledged-and-braced plank door painted in the awning's colour in a timber frame, black iron T-hinges,
 * a ring latch and a stone step; a four-light window in a timber frame on a stone sill, with louvred shutters folded back. All stands
 * proud of the back wall (nothing is cut), within 0.3 m of it.
 */
export const BOOTH_BACK = Object.freeze({ doorW: 0.8, doorTop: 2.42, winW: 0.64, winY0: 1.32, winY1: 2.06 });
function addBack(stone: GeoBuilder, wood: GeoBuilder, goods: GeoBuilder, s: BoothSpec) {
  const { x, z, w, d } = s;
  const zb = z - d / 2; // the back wall's outer face (it looks along -z)
  const floor = 0.37; // the plinth's cap
  const B = BOOTH_BACK;
  const timber: V3 = [0.4, 0.26, 0.16];
  const paint: V3 = s.stripes[0].map((c) => 0.25 + c * 0.75) as V3;
  const iron: V3 = [0.1, 0.1, 0.11];
  // ── the door
  const dx = x - w * 0.18;
  const hw = B.doorW / 2;
  for (const sx of [-1, 1]) wood.box([dx + sx * (hw + 0.045), (floor + B.doorTop + 0.1) / 2, zb - 0.035], X, Y, 0.045, (B.doorTop + 0.1 - floor) / 2, 0.035, timber, 1);
  wood.box([dx, B.doorTop + 0.05, zb - 0.04], X, Y, hw + 0.13, 0.05, 0.04, timber, 1);
  wood.box([dx, B.doorTop + 0.12, zb - 0.06], X, Y, hw + 0.17, 0.025, 0.06, timber, 1); // the drip cap over the head
  const boards = 5;
  for (let i = 0; i < boards; i++) {
    const bw = B.doorW / boards;
    const bx = dx - hw + bw * (i + 0.5);
    const tone = 0.94 + 0.06 * Math.sin(i * 2.3);
    wood.box([bx, (floor + B.doorTop) / 2, zb - 0.016], X, Y, bw / 2 - 0.0012, (B.doorTop - floor) / 2, 0.016, paint.map((c) => c * tone) as V3, 1);
  }
  const ledges = [floor + 0.28, (floor + B.doorTop) / 2, B.doorTop - 0.24];
  for (const ly of ledges) wood.box([dx, ly, zb - 0.044], X, Y, hw - 0.03, 0.055, 0.013, paint, 1);
  for (let i = 0; i + 1 < ledges.length; i++) {
    // the brace climbs from the hinge side's lower ledge to the latch side's upper one
    const a: V3 = [dx - hw + 0.1, ledges[i]! + 0.04, zb - 0.044];
    const b: V3 = [dx + hw - 0.1, ledges[i + 1]! - 0.04, zb - 0.044];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ax: V3 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, 0];
    const ay: V3 = [-ax[1], ax[0], 0];
    wood.box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]], ax, ay, len / 2, 0.045, 0.012, paint, 1);
  }
  // black iron T-hinges on the ledges' hinge ends, the ring latch on the other side
  for (const ly of [ledges[0]!, ledges[2]!]) {
    goods.box([dx - hw + 0.22, ly, zb - 0.06], X, Y, 0.22, 0.018, 0.004, iron);
    goods.box([dx - hw - 0.02, ly, zb - 0.06], X, Y, 0.012, 0.09, 0.004, iron);
    goods.cylinder([dx - hw + 0.44, ly, zb - 0.058], [dx - hw + 0.44, ly, zb - 0.066], 0.02, 0.02, 8, iron, true);
  }
  const lx = dx + hw - 0.12;
  const ly = 1.15;
  goods.cylinder([lx, ly, zb - 0.032], [lx, ly, zb - 0.05], 0.035, 0.035, 10, iron, true);
  const ring: V3[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ring.push([lx + Math.sin(a) * 0.045, ly - 0.045 + Math.cos(a) * 0.045, zb - 0.058]);
  }
  goods.tube(ring, 0.007, 5, iron);
  // the stone step
  stone.box([dx, 0.07, zb - 0.27], X, Y, hw + 0.16, 0.07, 0.13, [0.86, 0.84, 0.8], 1);
  // ── the window
  const wx = x + w * 0.22;
  const hwin = B.winW / 2;
  const wy = (B.winY0 + B.winY1) / 2;
  const hh = (B.winY1 - B.winY0) / 2;
  goods.box([wx, wy, zb - 0.008], X, Y, hwin, hh, 0.006, [0.1, 0.12, 0.14]);
  for (const sx of [-1, 1]) wood.box([wx + sx * (hwin + 0.035), wy, zb - 0.03], X, Y, 0.035, hh + 0.07, 0.03, timber, 1);
  wood.box([wx, B.winY1 + 0.035, zb - 0.03], X, Y, hwin + 0.07, 0.035, 0.03, timber, 1);
  wood.box([wx, B.winY0 - 0.02, zb - 0.03], X, Y, hwin + 0.07, 0.02, 0.03, timber, 1);
  wood.box([wx, wy, zb - 0.022], X, Y, 0.015, hh, 0.012, timber, 1);
  wood.box([wx, wy, zb - 0.022], X, Y, hwin, 0.015, 0.012, timber, 1);
  stone.box([wx, B.winY0 - 0.075, zb - 0.07], X, Y, hwin + 0.13, 0.035, 0.07, [0.9, 0.88, 0.84], 1);
  // the louvred shutters, folded back flat against the wall either side
  const sw = hwin + 0.02;
  for (const sx of [-1, 1]) {
    const cx = wx + sx * (hwin + 0.07 + sw / 2 + 0.01);
    for (const ex of [-1, 1]) wood.box([cx + ex * (sw / 2 - 0.025), wy, zb - 0.018], X, Y, 0.025, hh + 0.07, 0.018, paint, 1);
    for (const ey of [-1, 1]) wood.box([cx, wy + ey * (hh + 0.045), zb - 0.018], X, Y, sw / 2 - 0.05, 0.025, 0.018, paint, 1);
    const slats = 7;
    for (let i = 0; i < slats; i++) {
      const sy = wy - hh + 0.03 + ((2 * hh - 0.06) * (i + 0.5)) / slats;
      wood.box([cx, sy, zb - 0.02], X, norm([0, 1, -0.7]), sw / 2 - 0.05, 0.05, 0.004, paint.map((c) => c * 0.92) as V3, 1);
    }
    goods.box([cx - sx * (sw / 2 - 0.02), wy, zb - 0.04], X, Y, 0.008, 0.02, 0.008, iron); // the shutter dog
  }
}

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
  const counterTop = sill + 0.11;
  wood.box([x, sill + 0.06, counterZ], X, Y, ww / 2 + 0.3, 0.05, 0.38, [0.55, 0.36, 0.2]);
  for (const sx of [-1, 1]) wood.box([x + sx * (ww / 2 + 0.05), sill - 0.22, z + hz + 0.14], X, Y, 0.05, 0.26, 0.2, timber);
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
    wood.box([x, counterTop + 0.035, counterZ], X, Y, ww / 2 - 0.15, 0.035, 0.085, timber, 0.65);
    for (let i = 0; i < 5; i++) {
      const cxp = x - ww / 2 + 0.32 + i * ((ww - 0.64) / 4);
      goods.cylinder([cxp, counterTop + 0.07, counterZ], [cxp, counterTop + 0.27, counterZ], 0.012, 0.022, 8, CREAM);
      addCandyFloss(cloth, cxp, counterTop + 0.23, counterZ, cols[i]!, i);
    }
    for (let i = 0; i < 3; i++) {
      const cxp = x + 0.2 + i * 0.28 - 0.28;
      const body: V3 = i % 2 ? [0.65, 0.14, 0.12] : CREAM;
      addLathe(goods, cxp, counterZ + 0.22, [[0.045, 0], [0.064, 0.15], [0.068, 0.153], [0.067, 0.159], [0.061, 0.159], [0.043, 0.009], [0, 0.009]], body, 1, 12, counterTop);
    }
  } else {
    const cols: V3[] = [[0.92, 0.35, 0.3], [0.3, 0.4, 0.85], [0.95, 0.8, 0.3]];
    // stacks of tickets (little blocks), a brass bell, a small cash drawer
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) goods.box([x - ww / 2 + 0.3 + i * 0.28, 1.92 + k * 0.07, z - hz + t + 0.12], X, Y, 0.09, 0.035, 0.06, cols[(i + k) % 3]!);
    for (let i = 0; i < 4; i++) goods.box([x + 0.1 + i * 0.18, 2.305, z - hz + t + 0.12], X, Y, 0.07, 0.07, 0.05, cols[i % 3]!);
    for (let i = 0; i < 3; i++) {
      const paperX = x - ww / 2 + 0.2 + i * 0.2;
      const paperH = 0.018 + i * 0.007;
      goods.box([paperX, counterTop + paperH / 2, counterZ + 0.06], X, Y, 0.08, paperH / 2, 0.046, CREAM);
      goods.box([paperX + 0.048, counterTop + paperH + 0.001, counterZ + 0.06], X, Y, 0.005, 0.001, 0.046, cols[i]!);
    }
    const bellX = x + ww / 2 - 0.3;
    const brass: V3 = [0.82, 0.58, 0.21];
    addLathe(goods, bellX, counterZ, [[0.106, 0], [0.116, 0.009], [0.116, 0.023], [0.084, 0.031]], [0.13, 0.11, 0.09], 1, 18, counterTop);
    addLathe(goods, bellX, counterZ, [[0.08, 0.029], [0.104, 0.036], [0.101, 0.054], [0.086, 0.084], [0.061, 0.104], [0.03, 0.114], [0.012, 0.116], [0.012, 0.136], [0.03, 0.14], [0.026, 0.15], [0, 0.151]], brass, 1, 18, counterTop);
    wood.box([x + 0.12, counterTop + 0.093, counterZ - 0.06], X, Y, 0.25, 0.093, 0.16, timber, 0.65);
    wood.box([x + 0.12, counterTop + 0.083, counterZ + 0.104], X, Y, 0.23, 0.058, 0.009, [0.58, 0.41, 0.25], 0.65);
    goods.cylinder([x + 0.12, counterTop + 0.085, counterZ + 0.11], [x + 0.12, counterTop + 0.085, counterZ + 0.14], 0.012, 0.018, 8, brass, true);
  }
  addBack(stone, wood, goods, s);
  addAwning(cloth, goods, x, z + hz, ww + 0.6, s.stripes);
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
  // #13 exteriors: the plaster set's mottled colour map read as grime on a new booth; its colour is the booth's own, the set gives the relief
  const plasterMat = useMemo(() => parkMaterial(pickSet(all, "Plaster003"), 0.7, { useColor: false, vertexColors: true, color: new Color(spec.plaster), normalScale: 0.5 }), [all, spec.plaster]);
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
      <mesh geometry={built.cloth} material={clothMat} castShadow receiveShadow />
      <mesh geometry={built.goods} material={goodsMat} castShadow receiveShadow />
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
