// render.mjs - headless Chrome (playwright-core) renders of the lake gear on the real character.
//   node art/lake/tools/viewer/render.mjs <job.json>   job: {out, W, H, cols, frames:[{label, cfg}], query?}
//   or as a module: import { open } from "./render.mjs"
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".webp": "image/webp" };

export async function open(query = "") {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    let f = u.startsWith("/models/") ? path.join(ROOT, "client/public", u) : u.startsWith("/viewer/") ? path.join(ROOT, "art/lake/tools", u) : path.join(ROOT, u);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[page]", m.text()); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`http://localhost:${port}/viewer/viewer.html?${query}`);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
  return { page, close: async () => { await browser.close(); server.close(); } };
}

export async function sheet(page, { out, W = 480, H = 480, cols = 4, frames, fn = "shot" }) {
  const rows = Math.ceil(frames.length / cols);
  const urls = [];
  for (const f of frames) urls.push(await page.evaluate(([fn, cfg, W, H]) => window[fn](cfg, W, H), [fn, f.cfg, W, H]));
  const png = await page.evaluate(async ([urls, labels, W, H, cols, rows]) => {
    const c = document.createElement("canvas"); c.width = W * cols; c.height = H * rows;
    const g = c.getContext("2d"); g.fillStyle = "#e9e4dc"; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < urls.length; i++) {
      const im = new Image(); im.src = urls[i]; await im.decode();
      const x = (i % cols) * W, y = Math.floor(i / cols) * H;
      g.drawImage(im, x, y);
      g.fillStyle = "rgba(0,0,0,0.65)"; g.fillRect(x, y, W, 22);
      g.fillStyle = "#fff"; g.font = "14px sans-serif"; g.fillText(labels[i], x + 6, y + 16);
    }
    return c.toDataURL("image/png");
  }, [urls, frames.map((f) => f.label), W, H, cols, rows]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
  console.log("wrote", out);
}

if (process.argv[2] && process.argv[2].endsWith(".json")) {
  const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { page, close } = await open(job.query || "");
  await sheet(page, job);
  await close();
}
