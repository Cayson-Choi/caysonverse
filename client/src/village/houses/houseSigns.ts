/**
 * 집 외관 A8 (X3): the boards at the houses' owner slots (contract ch. 4, shared houseExterior.ts `houseSlots`, state
 * houseOwnership.ts). Today every house shows its nameplate "N번 집" beside the door; the mailbox's name strip stays blank and
 * the yard sign hidden until a house has an owner or is for sale (the owner's roadmap, 2026-11-16). One merged mesh, one draw
 * call, one canvas atlas: a dark powder-coated aluminium plate with a thin brass rim and brass lettering, as Korean house
 * nameplates are; the sign a white board on a timber stake.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { houseSlots, type HouseSlot } from "@caysonverse/shared/village/houseExterior";
import type { HouseExteriorState } from "@caysonverse/shared/village/houseOwnership";
import type { SceneryHouse } from "@caysonverse/shared/village/villageLayout";
import { patchHouseLight } from "./housesPrep";

/** A board to draw: where (the slot), how big (m), what it says. */
export interface HouseBoard {
  house: string;
  kind: HouseSlot["kind"];
  slot: HouseSlot;
  /** Board thickness (m); a sign also gets its stake. */
  depth: number;
  lines: string[];
}

/** The board thickness per slot: the plate 2.5 cm (its back on the wall), the mailbox strip 5 mm, the sign 2 cm. */
const DEPTH = { nameplate: 0.025, mailbox: 0.005, sign: 0.02 } as const;

/** The boards a set of house states shows (pure): the nameplate always, the mailbox strip and the sign only when there is something to say. */
export function houseBoards(houses: ReadonlyArray<Pick<SceneryHouse, "id" | "centre" | "doorSide">>, states: Readonly<Record<string, Readonly<HouseExteriorState>>>): HouseBoard[] {
  const out: HouseBoard[] = [];
  for (const h of houses) {
    const st = states[h.id];
    if (!st) continue;
    for (const slot of houseSlots(h)) {
      if (slot.kind === "nameplate") out.push({ house: h.id, kind: "nameplate", slot, depth: DEPTH.nameplate, lines: st.ownerName ? [st.label, st.ownerName] : [st.label] });
      else if (slot.kind === "mailbox" && st.ownerName) out.push({ house: h.id, kind: "mailbox", slot, depth: DEPTH.mailbox, lines: [st.ownerName] });
      else if (slot.kind === "sign" && st.sign !== "hidden") out.push({ house: h.id, kind: "sign", slot, depth: DEPTH.sign, lines: st.sign === "forSale" ? ["분양 중", st.label] : [st.ownerName ? `${st.ownerName}님 댁` : st.label] });
    }
  }
  return out;
}

const PX_PER_M = 1100;
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
const PLATE = "#2b2f33";
const BRASS = "#c9a96a";

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Shelf-pack the boards' faces into an atlas `width` px wide; the last cell is the plain edge colour. */
function pack(boards: readonly HouseBoard[], width: number): { cells: Cell[]; edge: Cell; height: number } {
  const cells: Cell[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  for (const b of boards) {
    const w = Math.min(width, Math.round(b.slot.width * PX_PER_M));
    const h = Math.round(b.slot.height * PX_PER_M);
    if (x + w > width) {
      x = 0;
      y += row + 4;
      row = 0;
    }
    cells.push({ x, y, w, h });
    x += w + 4;
    row = Math.max(row, h);
  }
  const edge = { x: 0, y: y + row + 4, w: 16, h: 16 };
  let height = 16;
  while (height < edge.y + edge.h) height *= 2;
  return { cells, edge, height };
}

function drawBoard(ctx: CanvasRenderingContext2D, b: HouseBoard, c: Cell): void {
  const sign = b.kind === "sign";
  ctx.save();
  ctx.translate(c.x, c.y);
  // the face: charcoal powder coat (a white board for the sign), a little grain
  ctx.fillStyle = sign ? "#f1eee6" : PLATE;
  ctx.fillRect(0, 0, c.w, c.h);
  for (let i = 0; i < (c.w * c.h) / 60; i++) {
    ctx.fillStyle = `rgba(${sign ? "0,0,0" : "255,255,255"},${0.015 + Math.random() * 0.02})`;
    ctx.fillRect(Math.random() * c.w, Math.random() * c.h, 1.5, 1.5);
  }
  // a thin brass rim, inset
  const inset = Math.max(3, Math.round(c.h * 0.07));
  ctx.strokeStyle = sign ? "#3b5d46" : BRASS;
  ctx.lineWidth = Math.max(2, Math.round(c.h * 0.025));
  ctx.strokeRect(inset, inset, c.w - inset * 2, c.h - inset * 2);
  // the lettering, centred, the first line large
  ctx.fillStyle = sign ? "#23362a" : BRASS;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const n = b.lines.length;
  b.lines.forEach((line, i) => {
    const size = Math.round(c.h * (n === 1 ? 0.52 : i === 0 ? 0.42 : 0.26));
    ctx.font = `700 ${size}px ${FONT}`;
    const y = n === 1 ? c.h * 0.53 : i === 0 ? c.h * 0.4 : c.h * 0.74;
    ctx.fillText(line, c.w / 2, y, c.w - inset * 4);
  });
  ctx.restore();
}

/** UV of a cell (atlas height H, flipY true: v up). */
function cellUv(c: Cell, W: number, H: number): [number, number, number, number] {
  return [c.x / W, 1 - (c.y + c.h) / H, (c.x + c.w) / W, 1 - c.y / H];
}

/** One board's box (front +z = the street side), its UVs: the front the board's cell, the rest the plain edge. */
function boardGeometry(b: HouseBoard, front: [number, number, number, number], edge: [number, number, number, number]): BufferGeometry {
  const g = new BoxGeometry(b.slot.width, b.slot.height, b.depth);
  const uv = g.getAttribute("uv");
  // BoxGeometry's faces: +x, -x, +y, -y, +z, -z, four corners each (u, v) in (0|1, 0|1)
  for (let f = 0; f < 6; f++) {
    const r = f === 4 ? front : edge;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, r[0] + (r[2] - r[0]) * uv.getX(i), r[1] + (r[3] - r[1]) * uv.getY(i));
    }
  }
  // the nameplate's and the strip's back on the wall face (the slot is 2 cm out from it): the board's centre half its depth out
  const back = b.kind === "nameplate" ? -0.019 : 0;
  g.translate(0, 0, back + b.depth / 2);
  const parts: BufferGeometry[] = [g];
  if (b.kind === "sign") {
    // the timber stake from the bed into the board's back
    const stake = new BoxGeometry(0.05, b.slot.y + b.slot.height / 2 - 0.1, 0.05);
    stake.translate(0, -(b.slot.y - (b.slot.y + b.slot.height / 2 - 0.1) / 2), -0.03);
    const su = stake.getAttribute("uv");
    for (let i = 0; i < su.count; i++) su.setXY(i, edge[0] + (edge[2] - edge[0]) * su.getX(i), edge[1] + (edge[3] - edge[1]) * su.getY(i));
    parts.push(stake);
  }
  const out = parts.length > 1 ? mergeGeometries(parts, false)! : g;
  const m = new Matrix4().compose(new Vector3(b.slot.x, b.slot.y, b.slot.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b.slot.yaw), new Vector3(1, 1, 1));
  out.applyMatrix4(m);
  return out;
}

export interface HouseSignsMesh {
  mesh: Mesh | null;
  dispose(): void;
}

/** The boards as one mesh (null when there is none), with its atlas. */
export function buildHouseSigns(boards: readonly HouseBoard[], anisotropy = 4): HouseSignsMesh {
  if (boards.length === 0 || typeof document === "undefined") return { mesh: null, dispose() {} };
  const W = 1024;
  const { cells, edge, height } = pack(boards, W);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, W, height);
  boards.forEach((b, i) => drawBoard(ctx, b, cells[i]!));
  ctx.fillStyle = PLATE;
  ctx.fillRect(edge.x, edge.y, edge.w, edge.h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const edgeUv = cellUv({ x: edge.x + 4, y: edge.y + 4, w: 8, h: 8 }, W, height);
  const geo = mergeGeometries(
    boards.map((b, i) => boardGeometry(b, cellUv(cells[i]!, W, height), edgeUv)),
    false,
  )!;
  geo.computeBoundingSphere();
  const mat = new MeshStandardMaterial({ name: "M_house_boards", map: tex, roughness: 0.42, metalness: 0.35 });
  patchHouseLight(mat, "boards");
  const mesh = new Mesh(geo, mat);
  mesh.name = "house_boards";
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
