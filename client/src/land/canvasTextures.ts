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

/** The park's gate board: "케이슨랜드" with a star, cream on indigo. */
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
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 1000, 232);
  star(ctx, 120, 128, 70, 30);
  star(ctx, 904, 128, 70, 30);
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
