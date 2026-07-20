// 안드로이드 NPC 외형 + AI 갤러리 확인 스크린샷.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const OUT = process.env.SHOT_OUT;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
await page.locator("input.cv-input").first().fill("외형확인");
await page.locator(".cv-character", { hasText: /^기사$/ }).click();
await page.locator(".cv-submit").click();
await page.locator("canvas").waitFor({ state: "visible", timeout: 30000 });
await page.waitForFunction(() => !!window.__cv, { timeout: 20000 });
await sleep(1500);

async function moveTo(tx, tz, eps = 0.8) {
  for (let i = 0; i < 200; i++) {
    const p = await page.evaluate(() => window.__cv.getPos());
    const dx = tx - p.x, dz = tz - p.z;
    if (Math.hypot(dx, dz) < eps) return true;
    const keys = [];
    if (dx > 0.35) keys.push("KeyD"); else if (dx < -0.35) keys.push("KeyA");
    if (dz > 0.35) keys.push("KeyS"); else if (dz < -0.35) keys.push("KeyW");
    for (const k of keys) await page.keyboard.down(k);
    await sleep(160);
    for (const k of keys) await page.keyboard.up(k);
  }
  return false;
}

async function dragTurn(times, dir = -1) {
  for (let i = 0; i < times; i++) {
    await page.mouse.move(640, 300);
    await page.mouse.down();
    for (let s = 1; s <= 10; s++) await page.mouse.move(640 + dir * 45 * s, 300, { steps: 2 });
    await page.mouse.up();
    await sleep(200);
  }
}

// 1) 로비 NPC 노바(안드로이드 외형) — 남쪽 우회 후 접근, 서쪽 바라보기.
await moveTo(-15, 10.8);
await moveTo(-21.3, 10.8);
await moveTo(-21.3, 6.2, 0.5);
await dragTurn(2, -1); // 서쪽으로 회전
await sleep(400);
await page.screenshot({ path: join(OUT, "a1-npc-android.png") });

// 2) AI 갤러리 입장 — 문(-15,-18) 경유 중앙까지, 북벽(배너+그림) 정면.
await moveTo(-15, 10.8);
await dragTurn(2, 1); // 북쪽 복귀
await moveTo(-15, 0.5);
await moveTo(-15, -16.2);
await moveTo(-15, -23.5, 0.7);
await sleep(2500); // 그림 텍스처 로드
await page.screenshot({ path: join(OUT, "a2-gallery-north.png") });
await dragTurn(1, -1); // 서벽
await sleep(300);
await page.screenshot({ path: join(OUT, "a3-gallery-west.png") });
await dragTurn(2, 1); // 동벽
await sleep(300);
await page.screenshot({ path: join(OUT, "a4-gallery-east.png") });

const gal = await page.evaluate(() => window.__cvGallery?.() ?? []);
console.log("gallery loads:", JSON.stringify(gal.map((g) => [g.title, g.loaded, Math.round(g.mean ?? -1)])));
await browser.close();
console.log("LOOK SHOTS DONE");
