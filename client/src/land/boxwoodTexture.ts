import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Boxwood leaf mass (canvas, 512 x 512, tiling): a dark gap colour with a couple of thousand small glossy oval leaves in five
 * greens, each with a light rim, so a clipped hedge reads as a leafy mass from a metre away. Returns the colour map and a matching
 * bump map (leaves proud of the gaps). One tile covers about 0.6 m of hedge.
 */
export function boxwoodTextures(): { map: CanvasTexture; bump: CanvasTexture } {
  const N = 512;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    return c;
  };
  const col = mk();
  const bmp = mk();
  const cx = col.getContext("2d")!;
  const bx = bmp.getContext("2d")!;
  cx.fillStyle = "#17301a";
  cx.fillRect(0, 0, N, N);
  bx.fillStyle = "#101010";
  bx.fillRect(0, 0, N, N);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const greens = ["#2d6a30", "#3a7d37", "#245a2b", "#4b8f40", "#2f6e3a"];
  const wrap = (x: number, y: number, draw: (px: number, py: number) => void) => {
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) if (x + ox > -24 && x + ox < N + 24 && y + oy > -24 && y + oy < N + 24) draw(x + ox, y + oy);
  };
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const a = rnd() * Math.PI;
    const l = 7 + rnd() * 6;
    const w = l * (0.5 + rnd() * 0.15);
    const g = greens[Math.floor(rnd() * greens.length)]!;
    const lift = rnd();
    wrap(x, y, (px, py) => {
      cx.save();
      cx.translate(px, py);
      cx.rotate(a);
      cx.fillStyle = g;
      cx.beginPath();
      cx.ellipse(0, 0, l, w, 0, 0, Math.PI * 2);
      cx.fill();
      cx.strokeStyle = "rgba(190,230,150,0.35)";
      cx.lineWidth = 1;
      cx.beginPath();
      cx.ellipse(-l * 0.1, -w * 0.15, l * 0.8, w * 0.7, 0, Math.PI * 1.1, Math.PI * 1.9);
      cx.stroke();
      cx.restore();
      bx.save();
      bx.translate(px, py);
      bx.rotate(a);
      const v = Math.round(90 + lift * 130);
      bx.fillStyle = `rgb(${v},${v},${v})`;
      bx.beginPath();
      bx.ellipse(0, 0, l, w, 0, 0, Math.PI * 2);
      bx.fill();
      bx.restore();
    });
  }
  const map = new CanvasTexture(col);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = 8;
  const bump = new CanvasTexture(bmp);
  bump.wrapS = bump.wrapT = RepeatWrapping;
  return { map, bump };
}
