/**
 * Village lots v2 — plan sheet from the shared numbers (no game, no Blender): the whole village and one zoomed panel per lot, with
 * every village collider, the houses (today's and A8), the ring road, lanes, the lake trail, and each lot's footprint, body,
 * colliders, roof slabs, door pads / arrivals, seats and slots. Evidence for design.md 1 and the builders' starting drawing.
 *
 *   npx tsx docs/designs/village-lots-v2/tools/plan-svg.ts [out.svg]   (default docs/designs/village-lots-v2/shots/plan.svg)
 *   node docs/designs/village-lots-v2/tools/svg-to-png.mjs <in.svg> <out.png>
 */
import fs from "node:fs";
import path from "node:path";
import type { AABB } from "../../../../shared/src/collision";
import { VILLAGE_LAYOUT, boxAt, villageGeometry } from "../../../../shared/src/village/villageLayout";
import { LAKE_TRAIL, LAKE_TRAIL_WIDTH } from "../../../../shared/src/village/lakeLayout";
import {
  LOT_ROOF_SLABS,
  VILLAGE_LOTS,
  lotBox,
  lotColliders,
  lotDoorPoints,
  lotFootprint,
  lotSeatMarkers,
  lotSlots,
  type VillageLot,
} from "../../../../shared/src/village/villageLots";

const A8_HOUSES: readonly [string, number, number, number, number][] = [
  ["house_1", 21, -43.175, 11.2, 10.75], ["house_2", -21, -43.175, 11.2, 10.75], ["house_3", 29, 38.775, 11.2, 10.75],
  ["house_4", -32.4, 40.575, 11.2, 10.75], ["house_5", -46.775, -8, 10.75, 11.2], ["house_6", 42, 43.675, 11.2, 10.75],
  ["house_7", 31, -58.375, 11.2, 10.75], ["house_8", -49.775, 40.6, 10.75, 11.2], ["house_9", -31, -58.375, 11.2, 10.75],
  ["house_10", -40.375, 26.4, 10.75, 11.2],
];
const KO: Record<string, string> = { lot_school: "학교", lot_chapel: "성당", lot_library: "도서관", lot_temple: "절", lot_church: "교회", lot_gate: "케이슨랜드 정문" };

function panel(view: AABB, px: number, title: string, focus: VillageLot | null): string {
  const s = px / Math.max(view.maxX - view.minX, view.maxZ - view.minZ);
  const X = (x: number) => ((x - view.minX) * s).toFixed(1);
  const Z = (z: number) => ((z - view.minZ) * s).toFixed(1);
  const W = (w: number) => (w * s).toFixed(1);
  const box = (b: AABB, cls: string) => `<rect class="${cls}" x="${X(b.minX)}" y="${Z(b.minZ)}" width="${W(b.maxX - b.minX)}" height="${W(b.maxZ - b.minZ)}"/>`;
  const out: string[] = [];
  out.push(`<rect class="bg" x="0" y="0" width="${px}" height="${px}"/>`);
  const ring = VILLAGE_LAYOUT.ringRoad;
  out.push(`<circle class="road" cx="${X(0)}" cy="${Z(0)}" r="${W(ring.radius)}" stroke-width="${W(ring.width)}"/>`);
  for (const lane of VILLAGE_LAYOUT.lanes) out.push(`<polyline class="lane" stroke-width="${W(lane.width)}" points="${lane.points.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}"/>`);
  out.push(`<polyline class="trail" stroke-width="${W(LAKE_TRAIL_WIDTH)}" points="${LAKE_TRAIL.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}"/>`);
  for (const p of VILLAGE_LAYOUT.plots) out.push(box(boxAt(p.centre, p.size), "plot"));
  for (const h of VILLAGE_LAYOUT.sceneryHouses) out.push(box(boxAt(h.centre, h.size), "house"));
  for (const [, x, z, sx, sz] of A8_HOUSES) out.push(box(boxAt({ x, z }, { x: sx, z: sz }), "a8"));
  for (const o of villageGeometry.obstacles) out.push(box(o, o.minX === -72.4 && o.maxX === -66.3 ? "gone" : "obst"));
  for (const l of VILLAGE_LOTS) {
    out.push(box(lotFootprint(l), "foot"));
    out.push(box(lotBox(l, l.body), "body"));
    for (const c of lotColliders(l)) out.push(box(c.box, c.camera ? "colcam" : "col"));
    for (const r of LOT_ROOF_SLABS[l.id]) out.push(box(lotBox(l, r.rect), "slab"));
    for (const d of lotDoorPoints(l)) {
      out.push(`<circle class="pad" cx="${X(d.pad.x)}" cy="${Z(d.pad.z)}" r="${W(d.pad.radius)}"/>`);
      out.push(`<circle class="arr" cx="${X(d.arrival.x)}" cy="${Z(d.arrival.z)}" r="${W(0.3)}"/>`);
    }
    for (const m of lotSeatMarkers(l)) {
      const dx = Math.sin(m.yaw), dz = Math.cos(m.yaw);
      out.push(`<circle class="seat" cx="${X(m.x)}" cy="${Z(m.z)}" r="${W(0.35)}"/><line class="seatdir" x1="${X(m.x)}" y1="${Z(m.z)}" x2="${X(m.x + dx)}" y2="${Z(m.z + dz)}"/>`);
    }
    for (const sl of lotSlots(l)) if (sl.where === "exterior") out.push(`<circle class="slot" cx="${X(sl.x)}" cy="${Z(sl.z)}" r="${W(0.22)}"/>`);
    const c = l.centre;
    if (!focus || focus === l) out.push(`<text class="lbl" x="${X(c.x)}" y="${Z(c.z)}" font-size="${focus ? 16 : 11}">${KO[l.id]}</text>`);
  }
  if (focus) {
    for (const cc of lotColliders(focus)) {
      const b = cc.box;
      out.push(`<text class="small" x="${X((b.minX + b.maxX) / 2)}" y="${Z((b.minZ + b.maxZ) / 2)}">${cc.id.replace(`${focus.id}_`, "").replace(focus.id, "몸체")}</text>`);
    }
  }
  out.push(`<text class="title" x="8" y="20">${title}</text>`);
  return out.join("\n");
}

function main(): void {
  const outFile = path.resolve(process.argv[2] ?? "docs/designs/village-lots-v2/shots/plan.svg");
  const P = 560;
  const panels: string[] = [];
  panels.push(`<svg x="0" y="0" width="${P}" height="${P}" overflow="hidden">${panel({ minX: -95, maxX: 95, minZ: -95, maxZ: 95 }, P, "케이슨 마을 부지 v2 — 전체 (북쪽이 위)", null)}</svg>`);
  VILLAGE_LOTS.forEach((l, i) => {
    const f = lotFootprint(l);
    const m = 8;
    const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2, half = Math.max(f.maxX - f.minX, f.maxZ - f.minZ) / 2 + m;
    const col = (i + 1) % 4, row = Math.floor((i + 1) / 4);
    panels.push(`<svg x="${col * (P + 10)}" y="${row * (P + 10)}" width="${P}" height="${P}" overflow="hidden">${panel({ minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half }, P, `${KO[l.id]} (${l.id}, ${l.plot ?? "남쪽 둑"}) — 문 ${l.doorSide}`, l)}</svg>`);
  });
  const css = `
  .bg{fill:#eef3e6}.road{fill:none;stroke:#9a9a9a}.lane{fill:none;stroke:#c9b99a;stroke-linecap:round}.trail{fill:none;stroke:#d8c79f;stroke-linecap:round}
  .plot{fill:#bfe3ff55;stroke:#5aa7e0;stroke-dasharray:4 3}.house{fill:#d9c3a7;stroke:#8a6d4c}.a8{fill:none;stroke:#8a6d4c;stroke-dasharray:3 2}
  .obst{fill:#6d8f5c88;stroke:#4c6b3d;stroke-width:.5}.gone{fill:#ff000022;stroke:#c00;stroke-dasharray:3 2}
  .foot{fill:#ffffff88;stroke:#2b4f9e;stroke-width:1.5;stroke-dasharray:6 3}.body{fill:#5b5b7a55;stroke:#2d2d4a;stroke-width:1.5}
  .col{fill:#e0573d55;stroke:#b02e17;stroke-width:.8}.colcam{fill:#b02e1788;stroke:#6e1406;stroke-width:1}.slab{fill:none;stroke:#7a3fbf;stroke-dasharray:2 2}
  .pad{fill:#2f7bea33;stroke:#2f7bea}.arr{fill:#2f7bea}.seat{fill:#1f9e4a}.seatdir{stroke:#1f9e4a;stroke-width:2}.slot{fill:#f29a1d}
  .lbl{font:bold 11px 'Noto Sans KR',sans-serif;fill:#111;text-anchor:middle}.small{font:9px sans-serif;fill:#300;text-anchor:middle}
  .title{font:bold 14px 'Noto Sans KR',sans-serif;fill:#111}`;
  const legend = `<g transform="translate(${3 * (P + 10) + 10},${P + 30})" font-family="Noto Sans KR,sans-serif" font-size="12">${[
    ["foot", "부지 발자국"], ["body", "건물 몸체"], ["col", "충돌(카메라는 넘겨 봄)"], ["colcam", "충돌 + 카메라 상자"], ["slab", "지붕 판(카메라 아래만)"],
    ["pad", "문 패드 / 도착점"], ["seat", "좌석(선 = 바라보는 쪽)"], ["slot", "상호작용 자리"], ["obst", "지금 마을 충돌"], ["gone", "없앨 것(col__construction)"], ["house", "집(지금)"], ["a8", "집(A8)"],
  ].map(([c, t], k) => `<rect class="${c}" x="0" y="${k * 20}" width="16" height="12"/><text x="24" y="${k * 20 + 11}">${t}</text>`).join("")}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * (P + 10)}" height="${2 * (P + 10)}"><style>${css}</style><rect width="100%" height="100%" fill="#fff"/>${panels.join("\n")}${legend}</svg>`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, svg, "utf8");
  console.log(`PASS: ${outFile}`);
}
main();
