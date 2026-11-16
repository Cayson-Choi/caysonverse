/**
 * e2e/memorial-look.mjs — 추모관 안 모습 촬영(사실감 점검용): 넓게 본 홀, 식물 둘레, 그리고 칸 가까이 보기(유리문 칸 E, 흰 칸 A)를
 * PC 1280×800 / iPhone 13 375×812, 낮·밤으로 찍는다. 촛불은 켜기 전·후. 가까이 보기 확대(최소·기본·최대)도 찍는다.
 *
 *   node e2e/memorial-look.mjs --out=<폴더> [--slots=M1-E-r3-c02,M1-A-r3-c11] [--devices=pc,phone] [--times=day,night] [--light]
 *   (서버·클라는 memorial-claim.mjs와 같이 띄워 둔다. 칸은 미리 모셔 둔다: --slots의 칸은 이미 모신 칸이어야 함)
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { enterHall, joinVillage } from "./lib/village.mjs";

const run = createRun("memorial-look");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const SLOTS = opt("slots", "M1-E-r3-c02,M1-A-r3-c11").split(",").filter(Boolean);
const DEVICES = opt("devices", "pc,phone").split(",");
const TIMES = opt("times", "day,night").split(",");
const WIDE = !args.includes("--no-wide");
const LIGHT = args.includes("--light");
const ZOOM = args.includes("--zoom");
const TIME = { day: "2026-11-03T12:30", night: "2026-11-03T21:30" };

const parse = (id) => {
  const m = /^M1-([A-Z])-r(\d+)-c(\d+)$/.exec(id);
  return { bank: m[1], row: Number(m[2]), col: Number(m[3]) };
};
const openCubby = (p, id) => p.page.evaluate(async (s) => (await window.__imp("/src/village/cubbyCard.ts")).openCubbyAt(s), parse(id));
const hideHud = (p) =>
  p.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    window.__hidden = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el)) continue;
      if (el.style.visibility !== "hidden") {
        window.__hidden.push(el);
        el.style.visibility = "hidden";
      }
    }
  });
const showHud = (p) => p.page.evaluate(() => (window.__hidden ?? []).forEach((el) => (el.style.visibility = "")));

const browser = await launchBrowser();
try {
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const p = await openPlayer(browser, run, { tag: `${dev}-${time}`, device: dev === "pc" ? DESKTOP : PHONE, settings: { graphics: dev === "pc" ? "high" : "low" } });
      await run.step(`${dev} ${time}: into the hall`, async () => {
        await joinVillage(p, "보기", TIME[time]);
        await enterHall(p);
        await p.page.waitForFunction(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot().status === "ready", null, { timeout: 15000 });
        await sleep(1500);
      });
      if (WIDE) {
        await run.step(`${dev} ${time}: wide views`, async () => {
          const views = [
            ["wide-north", [300, 2.8], [300, -6]],
            ["wide-east", [301.5, 0], [307.5, -2]],
            ["wide-lounge", [299, -1], [294, 4]],
            ["wide-west", [301, -2], [292.5, -1]],
          ];
          for (const [name, at, look] of views) {
            await walkAndWait(p, at[0], at[1], 15000, 0.6);
            await turnCameraTo(p, look[0], look[1]);
            await sleep(1200);
            await hideHud(p);
            await run.shot(p, `${dev}-${time}-${name}.png`);
            await showHud(p);
          }
        });
      }
      for (const id of SLOTS) {
        await run.step(`${dev} ${time}: close-up ${id}`, async () => {
          await openCubby(p, id);
          await p.page.locator(".cv-cubby").waitFor({ timeout: 8000 });
          await sleep(2500);
          await run.shot(p, `${dev}-${time}-${id}-card.png`);
          await hideHud(p);
          await run.shot(p, `${dev}-${time}-${id}-view.png`);
          await showHud(p);
          if (ZOOM) {
            const zoom = (dir) =>
              p.page.evaluate(async (d) => (await window.__imp("/src/village/cubbyFocus.ts")).nudgeCubbyZoom?.(d), dir);
            for (const [tag, dir] of [
              ["zoom-in", -1],
              ["zoom-out", 1],
            ]) {
              for (let i = 0; i < 12; i++) await zoom(dir);
              await sleep(1500);
              await hideHud(p);
              await run.shot(p, `${dev}-${time}-${id}-${tag}.png`);
              await showHud(p);
              await run.shot(p, `${dev}-${time}-${id}-${tag}-card.png`);
            }
            await p.page.evaluate(async () => (await window.__imp("/src/village/cubbyFocus.ts")).resetCubbyZoom?.());
            await sleep(800);
          }
          if (LIGHT) {
            const btn = p.page.locator(".cv-cubby-light");
            if ((await btn.textContent()) === "촛불 켜기") {
              await btn.click();
              await sleep(2500);
              await hideHud(p);
              await run.shot(p, `${dev}-${time}-${id}-lit.png`);
              await showHud(p);
            }
          }
        });
      }
      await p.ctx.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(run.finish());
