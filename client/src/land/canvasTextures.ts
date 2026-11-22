import { CanvasTexture, SRGBColorSpace } from "three";

/** The station's name board: "별똥별 급행" under a gold star, on an indigo board (canvas). */
export function signTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#3a3fb8");
  grd.addColorStop(1, "#2a2d86");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 996, 228);
  star(ctx, 150, 128, 62, 26);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 110px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("별똥별 급행", 250, 112);
  ctx.font = "44px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("케이슨랜드  ·  SHOOTING STAR EXPRESS", 252, 205);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r1: number, r2: number): void {
  ctx.fillStyle = "#f2c14e";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** The lettering on the gate's enamel plaque. Its brass frame and stars are geometry. */
export function gateSignTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#4B4FD8");
  grd.addColorStop(1, "#2f3399");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 140px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("케이슨랜드", 512, 118);
  ctx.font = "40px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText("CAYSONLAND", 512, 214);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A small hanging shop board (canvas, 512 x 256): `title` large, `sub` under it, on `base` with a gold rim. For the park's booths. */
export function boothBoardTexture(title: string, sub: string, base: [string, string] = ["#4B4FD8", "#2f3399"]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 768;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, base[0]);
  grd.addColorStop(1, base[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 768, 256);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 748, 236);
  star(ctx, 70, 128, 34, 14);
  star(ctx, 698, 128, 34, 14);
  ctx.fillStyle = "#f3efea";
  ctx.font = "bold 96px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 384, 100);
  ctx.font = "38px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#f2c14e";
  ctx.fillText(sub, 384, 194);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A chalkboard menu (canvas, 256 x 320): a title and three priced lines in chalk on slate, a painted wooden frame is the booth's. */
export function chalkMenuTexture(title: string, lines: string[]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#26302d";
  ctx.fillRect(0, 0, 256, 320);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 30; i++) ctx.fillRect(Math.random() * 256, Math.random() * 320, 40 + Math.random() * 80, 2);
  ctx.fillStyle = "#f6efe0";
  ctx.font = "bold 44px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 128, 44);
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(30, 78);
  ctx.lineTo(226, 78);
  ctx.stroke();
  ctx.font = "30px 'Jua', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#e9d9b8";
  lines.forEach((l, i) => ctx.fillText(l, 128, 126 + i * 56));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
