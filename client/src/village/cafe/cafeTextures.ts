import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";

/** The chalkboard menu's lines (Korean, like the café's name board; no prices: the village has no money). */
export const MENU_LINES = {
  title: "오늘의 메뉴",
  drinks: ["에스프레소", "카페 라떼", "따뜻한 초콜릿", "홍차 · 허브차"],
  bakes: ["쿠글로프", "사과 타르트", "브레첼", "크루아상"],
  note: "케이슨 카페",
} as const;

const FONT = `"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;

function chalkLine(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  ctx.strokeStyle = "rgba(240,238,228,0.75)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  for (let x = x0; x <= x1; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.17) * 1.2);
  ctx.stroke();
}

function board(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#26302B";
  ctx.fillRect(x, y, w, h);
  // chalk dust: a few soft wipes
  for (let i = 0; i < 40; i++) {
    const gx = x + ((i * 97) % w);
    const gy = y + ((i * 53) % h);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 70);
    g.addColorStop(0, "rgba(220,225,215,0.05)");
    g.addColorStop(1, "rgba(220,225,215,0)");
    ctx.fillStyle = g;
    ctx.fillRect(gx - 70, gy - 70, 140, 140);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#F4F0E2";
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(MENU_LINES.title, x + w / 2, y + 78);
  chalkLine(ctx, x + 70, x + w - 70, y + 100);
  const col = (cx: number, head: string, lines: readonly string[], tint: string) => {
    ctx.textAlign = "center";
    ctx.fillStyle = tint;
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(head, cx, y + 160);
    ctx.fillStyle = "#EDEADF";
    ctx.font = `500 31px ${FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, cx, y + 222 + i * 62));
  };
  col(x + w * 0.27, "커피 · 차", MENU_LINES.drinks, "#F2C879");
  col(x + w * 0.74, "빵 · 케이크", MENU_LINES.bakes, "#F2A9A0");
  // a vertical chalk rule between the columns and a small cup and a wheat ear drawn in chalk
  ctx.strokeStyle = "rgba(240,238,228,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.505, y + 130);
  ctx.lineTo(x + w * 0.505, y + 440);
  ctx.stroke();
  ctx.fillStyle = "#F4F0E2";
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(MENU_LINES.note, x + w / 2, y + h - 44);
  chalkLine(ctx, x + 120, x + w - 120, y + h - 78);
  // a cup with steam
  ctx.strokeStyle = "rgba(244,240,226,0.85)";
  ctx.lineWidth = 3;
  const cx = x + w / 2;
  const cy = y + h - 130;
  ctx.beginPath();
  ctx.moveTo(cx - 24, cy - 12);
  ctx.lineTo(cx - 18, cy + 18);
  ctx.quadraticCurveTo(cx, cy + 28, cx + 18, cy + 18);
  ctx.lineTo(cx + 24, cy - 12);
  ctx.closePath();
  ctx.moveTo(cx + 24, cy - 4);
  ctx.quadraticCurveTo(cx + 40, cy, cx + 24, cy + 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 22);
  ctx.quadraticCurveTo(cx - 14, cy - 34, cx - 6, cy - 44);
  ctx.moveTo(cx + 8, cy - 22);
  ctx.quadraticCurveTo(cx + 2, cy - 34, cx + 10, cy - 44);
  ctx.stroke();
}

/** A print: cream paper, a coffee cup and a plume of steam, the word CAFÉ. */
function printCup(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#F2E8D5";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#B3452F";
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.52, w * 0.27, h * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#F7F2E6";
  ctx.strokeStyle = "#3B2A22";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.3, y + h * 0.34);
  ctx.lineTo(x + w * 0.34, y + h * 0.52);
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.58, x + w * 0.66, y + h * 0.52);
  ctx.lineTo(x + w * 0.7, y + h * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + w * 0.74, y + h * 0.42, w * 0.07, -1.2, 1.3);
  ctx.stroke();
  ctx.strokeStyle = "#8A6B55";
  ctx.lineWidth = 3;
  for (const dx of [-0.08, 0.05]) {
    ctx.beginPath();
    ctx.moveTo(x + w * (0.5 + dx), y + h * 0.3);
    ctx.bezierCurveTo(x + w * (0.45 + dx), y + h * 0.24, x + w * (0.56 + dx), y + h * 0.2, x + w * (0.5 + dx), y + h * 0.12);
    ctx.stroke();
  }
  ctx.fillStyle = "#3B2A22";
  ctx.font = `700 ${Math.round(w * 0.17)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("CAFÉ", x + w / 2, y + h * 0.86);
  ctx.strokeStyle = "#3B2A22";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
}

/** A print: a Colmar-style row of half-timbered pastel gables on the canal. */
function printTown(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, "#BFD9E6");
  sky.addColorStop(1, "#F2E9D4");
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  const cols = ["#E9A8A0", "#F2D58A", "#A9CDB7", "#9FB9DB", "#F0B98C"];
  for (let i = 0; i < 4; i++) {
    const bx = x + 12 + i * (w - 24) / 4;
    const bw = (w - 24) / 4 - 6;
    const top = y + h * (0.28 + (i % 2) * 0.1);
    ctx.fillStyle = cols[i % cols.length]!;
    ctx.fillRect(bx, top + bw * 0.45, bw, y + h * 0.78 - top - bw * 0.45);
    ctx.beginPath();
    ctx.moveTo(bx - 4, top + bw * 0.45);
    ctx.lineTo(bx + bw / 2, top);
    ctx.lineTo(bx + bw + 4, top + bw * 0.45);
    ctx.fillStyle = "#8A4E3A";
    ctx.fill();
    ctx.strokeStyle = "#4A3426";
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) ctx.strokeRect(bx + 8 + k * (bw - 16) / 3, top + bw * 0.55 + (k % 2) * 6, (bw - 16) / 3 - 4, 16);
  }
  ctx.fillStyle = "#6FA0B5";
  ctx.fillRect(x, y + h * 0.78, w, h * 0.22);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(x + 20, y + h * (0.83 + k * 0.04));
    ctx.lineTo(x + w - 20, y + h * (0.83 + k * 0.04));
    ctx.stroke();
  }
  ctx.strokeStyle = "#3B2A22";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
}

/** A print: a bundt kougelhopf in profile on cream, with its name. */
function printKugel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#EBE0C8";
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h * 0.5;
  ctx.fillStyle = "#B9793A";
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.3, cy + h * 0.14);
  ctx.quadraticCurveTo(cx - w * 0.36, cy - h * 0.02, cx - w * 0.2, cy - h * 0.1);
  ctx.lineTo(cx - w * 0.07, cy - h * 0.2);
  ctx.lineTo(cx + w * 0.07, cy - h * 0.2);
  ctx.lineTo(cx + w * 0.2, cy - h * 0.1);
  ctx.quadraticCurveTo(cx + w * 0.36, cy - h * 0.02, cx + w * 0.3, cy + h * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#7A4A22";
  ctx.lineWidth = 3;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.moveTo(cx + k * w * 0.075, cy - h * 0.18);
    ctx.lineTo(cx + k * w * 0.095, cy + h * 0.13);
    ctx.stroke();
  }
  ctx.fillStyle = "#F7F2E6";
  ctx.fillRect(cx - w * 0.07, cy - h * 0.23, w * 0.14, h * 0.03);
  ctx.fillStyle = "#3B2A22";
  ctx.font = `700 ${Math.round(w * 0.12)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("KOUGELHOPF", cx, y + h * 0.82);
  ctx.strokeStyle = "#3B2A22";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
}

/** A print: vine rows on hills in autumn colours. */
function printVines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
  sky.addColorStop(0, "#D9E6EA");
  sky.addColorStop(1, "#F5EAD0");
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  const bands = ["#B3A04A", "#8F9B3E", "#C0873A", "#6E8A3C"];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = bands[i]!;
    ctx.beginPath();
    ctx.moveTo(x, y + h * (0.55 + i * 0.1));
    ctx.quadraticCurveTo(x + w * 0.5, y + h * (0.4 + i * 0.1), x + w, y + h * (0.55 + i * 0.1));
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.fill();
    ctx.strokeStyle = "rgba(60,50,20,0.35)";
    ctx.lineWidth = 2;
    for (let k = 0; k < 12; k++) {
      ctx.beginPath();
      ctx.moveTo(x + (k + 0.5) * (w / 12), y + h * (0.6 + i * 0.1));
      ctx.lineTo(x + (k + 0.2) * (w / 12), y + h);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "#3B2A22";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
}

/** A wide print: the café's name in a line of type. */
function printWide(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#2E4A3F";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#EFE6CF";
  ctx.font = `700 ${Math.round(h * 0.5)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("케이슨 카페 · CAFÉ & PÂTISSERIE", x + w / 2, y + h * 0.65);
  ctx.strokeStyle = "#C9A04A";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
}

/** The atlas the art quads read (1024 x 1024; regions in cafeBuild ATLAS_REGIONS, v up). */
export function artAtlas(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, 1024, 1024);
  // canvas y runs down: v 1 is the top
  board(ctx, 0, 0, 512, 512);
  printCup(ctx, 512, 164, 256, 348);
  printTown(ctx, 768, 164, 256, 348);
  printWide(ctx, 512, 0, 512, 164);
  printKugel(ctx, 0, 1024 - 348, 256, 348);
  printVines(ctx, 256, 1024 - 348, 256, 348);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

/** A soft round gradient (white centre to nothing), 128 x 128: the contact shadows' and the lamp pools' shape. */
export function softDisc(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
