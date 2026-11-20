/**
 * e2e/memorial-reqs.mjs — 추모관 주인 요청 여섯 가지(2026-11-20) 확인과 전·후 사진:
 *   1. 구역 이름 A·B·C·D(걷는 순서) 표지판   2. 라운지 액자의 명화   3. 가까이 보기 카드 접기·펼치기
 *   4. 촛불 밝히기·끄기(두 사람 사이 동기화)   5. 추모관 안 이모지   6. 실감 나는 촛불(켜짐·꺼짐 가까이)
 *
 *   node e2e/memorial-reqs.mjs --out=<폴더> [--phase=before|after] [--devices=pc,phone] [--times=day,night] [--no-checks]
 *   (서버·클라는 미리 띄워 둔다: CV_CLIENT_URL=http://localhost:5503, 서버 2903)
 *
 * --phase=before 는 사진만(옛 코드), after 는 사진 + 검사(두 PC 플레이어: 표지판, 그림, 이모지, 촛불 동기화, 카드 접기).
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, press, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { enterHall, joinVillage } from "./lib/village.mjs";

const run = createRun("memorial-reqs");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const PHASE = opt("phase", "after");
const AFTER = PHASE === "after";
const DEVICES = opt("devices", "pc,phone").split(",").filter(Boolean);
const TIMES = opt("times", "day,night").split(",").filter(Boolean);
const CHECKS = AFTER && !args.includes("--no-checks");
const TIME = { day: "2026-11-03T12:30", night: "2026-11-03T21:30" };
const SAMPLE = { bank: "A", row: 3, col: 11, id: "M1-A-r3-c11" };
const LIGHT = AFTER ? "촛불 밝히기" : "촛불 켜기";

const openCubby = (p, s = SAMPLE) => p.page.evaluate(async (s) => (await window.__imp("/src/village/cubbyCard.ts")).openCubbyAt(s), s);
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
const bare = async (p, file) => {
  await hideHud(p);
  await run.shot(p, file);
  await showHud(p);
};
const cardState = (p) =>
  p.page.evaluate(() => {
    const el = document.querySelector(".cv-cubby");
    if (!el) return null;
    const panel = el.querySelector(".cv-cubby-panel")?.getBoundingClientRect();
    const btn = el.querySelector(".cv-cubby-light");
    return {
      id: el.getAttribute("data-cubby"),
      folded: el.getAttribute("data-folded"),
      panelH: panel ? Math.round(panel.height) : null,
      barName: el.querySelector(".cv-cubby-bar-name")?.textContent ?? null,
      where: el.querySelector(".cv-cubby-where, .cv-cubby-bar-where")?.textContent ?? null,
      button: btn?.textContent ?? null,
      disabled: btn ? btn.disabled : null,
      by: el.querySelector(".cv-cubby-by")?.textContent ?? null,
      hint: el.querySelector(".cv-cubby-hint")?.textContent ?? null,
    };
  });
const candles = (p) => p.page.evaluate(() => window.__cvHall?.().candles ?? []);
const zoom = (p, d, n) => p.page.evaluate(async ([d, n]) => {
  const m = await window.__imp("/src/village/cubbyFocus.ts");
  for (let i = 0; i < n; i++) m.nudgeCubbyZoom?.(d);
}, [d, n]);

async function intoHall(p, prefix, time) {
  await joinVillage(p, prefix, time);
  await enterHall(p);
  await p.page
    .waitForFunction(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot().status === "ready", null, { timeout: 15000 })
    .catch(() => {});
  await sleep(2000);
}

const browser = await launchBrowser();
try {
  // ── photos: PC and phone, day and night ──
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const tag = `${PHASE}-${dev}-${time}`;
      const p = await openPlayer(browser, run, { tag, device: dev === "pc" ? DESKTOP : PHONE, settings: { graphics: dev === "pc" ? "high" : "low" } });
      await run.step(`${tag}: into the hall`, async () => {
        await intoHall(p, "사진", TIME[time]);
      });
      await run.step(`${tag}: zone signs`, async () => {
        await walkAndWait(p, 300, 2.8, 15000, 0.6);
        await turnCameraTo(p, 300, -6);
        await sleep(1500);
        await bare(p, `${tag}-hall-signs.png`);
        await run.shot(p, `${tag}-hall-signs-hud.png`);
        await turnCameraTo(p, 307.5, -1);
        await sleep(1200);
        await bare(p, `${tag}-hall-sign-east.png`);
      });
      await run.step(`${tag}: lounge painting`, async () => {
        await walkAndWait(p, 297.2, 1.6, 15000, 0.6);
        await turnCameraTo(p, 294.7, 6);
        await sleep(1500);
        await bare(p, `${tag}-lounge-painting.png`);
      });
      await run.step(`${tag}: the sample cubby, its card and its candle`, async () => {
        await walkAndWait(p, 300, 2.8, 15000, 0.8);
        await openCubby(p);
        await p.page.locator(".cv-cubby").waitFor({ timeout: 8000 });
        await sleep(2500);
        const c0 = await cardState(p);
        if (c0?.button === LIGHT) await bare(p, `${tag}-candle-unlit.png`);
        await run.shot(p, `${tag}-card${c0?.button === LIGHT ? "-unlit" : ""}.png`);
        if (c0?.button === LIGHT) {
          await press(p, p.page.getByRole("button", { name: LIGHT, exact: true }));
          await p.page.waitForFunction((id) => (window.__cvHall?.().candles ?? []).includes(id), SAMPLE.id, { timeout: 6000 }).catch(() => {});
          await sleep(1500);
        }
        await run.shot(p, `${tag}-card-lit.png`);
        await bare(p, `${tag}-candle-lit.png`);
        await zoom(p, -1, 12);
        await sleep(1500);
        await bare(p, `${tag}-candle-lit-close.png`);
        if (AFTER) {
          // the same close-up at its own zoom, folded: the cubby shows behind the slim bar
          await p.page.evaluate(async () => (await window.__imp("/src/village/cubbyFocus.ts")).resetCubbyZoom?.());
          await press(p, p.page.locator(".cv-cubby-fold"));
          await sleep(1500);
          await run.shot(p, `${tag}-card-folded.png`);
          await press(p, p.page.locator(".cv-cubby-fold"));
          await sleep(1200);
          await run.shot(p, `${tag}-card-unfolded.png`);
          // put it out (the next run lights it again), and look at it unlit, close
          const c1 = await cardState(p);
          if (c1?.button === "촛불 끄기") {
            await press(p, p.page.getByRole("button", { name: "촛불 끄기", exact: true }));
            await p.page.waitForFunction((id) => !(window.__cvHall?.().candles ?? []).includes(id), SAMPLE.id, { timeout: 6000 }).catch(() => {});
            await sleep(1200);
            await zoom(p, -1, 12);
            await sleep(1500);
            await bare(p, `${tag}-candle-unlit-close.png`);
            await p.page.evaluate(async () => (await window.__imp("/src/village/cubbyFocus.ts")).resetCubbyZoom?.());
          }
        }
        await p.page.keyboard.press("Escape").catch(() => {});
      });
      await p.ctx.close();
    }
  }

  // ── checks: two visitors in the hall ──
  if (CHECKS) {
    const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "high" } });
    const B = await openPlayer(browser, run, { tag: "B", device: PHONE, settings: { graphics: "low" } });
    await run.step("checks: both visitors in the hall", async () => {
      await Promise.all([intoHall(A, "가", TIME.day), intoHall(B, "나", TIME.day)]);
      run.check("both are in the hall", true);
    });

    await run.step("1. zone signs A–D in walking order", async () => {
      const h = await A.page.evaluate(() => window.__cvHall?.());
      const z = h?.zones ?? [];
      run.check("four signs: A 구역, B 구역, C 구역, D 구역", JSON.stringify(z.map((s) => s.label)) === JSON.stringify(["A 구역", "B 구역", "C 구역", "D 구역"]), z);
      run.check("on banks A, C, B (north wall, west → east) and E (east wall)", JSON.stringify(z.map((s) => s.bank)) === JSON.stringify(["A", "C", "B", "E"]), z.map((s) => s.bank));
      run.check("A, B, C run west → east on the north wall, D is on the east wall", z.length === 4 && z[0].x < z[1].x && z[1].x < z[2].x && z[3].x > 306.5 && z[0].z < -5, z);
      // the card says the same letter
      await openCubby(A);
      await A.page.locator(".cv-cubby").waitFor({ timeout: 8000 });
      const c = await cardState(A);
      run.check("the sample cubby's card says A구역", (c?.where ?? "").startsWith("A구역"), c?.where);
      await openCubby(A, { bank: "E", row: 3, col: 2 });
      await sleep(600);
      const e = await cardState(A);
      run.check("an east-wall cubby's card says D구역", (e?.where ?? "").startsWith("D구역"), e?.where);
      await openCubby(A, { bank: "C", row: 3, col: 2 });
      await sleep(600);
      const cc = await cardState(A);
      run.check("a middle-bank cubby's card says B구역", (cc?.where ?? "").startsWith("B구역"), cc?.where);
      await A.page.keyboard.press("Escape");
    });

    await run.step("2. the lounge painting", async () => {
      await A.page.waitForFunction(() => window.__cvHall?.().painting?.loaded === true, null, { timeout: 15000 }).catch(() => {});
      const ph = await A.page.evaluate(() => window.__cvHall?.().painting);
      run.check("the painting is in (its image loaded)", ph?.loaded === true, ph);
      run.check("at its true aspect (2048 x 1630)", ph && Math.abs(ph.width / ph.height - 2048 / 1630) < 0.005, ph);
      run.check("PC loads the 2048 px file", /T_h_art_wheat_cypresses_met\.webp/.test(ph?.url ?? ""), ph?.url);
      const phB = await B.page.evaluate(() => window.__cvHall?.().painting);
      run.check("the phone loads the 1024 px file", /T_m_art_wheat_cypresses_1k\.webp/.test(phB?.url ?? ""), phB?.url);
    });

    await run.step("3. emoji in the hall: B sees A's", async () => {
      const bar = await A.page.locator(".cv-emoji-palette").isVisible().catch(() => false);
      run.check("A (PC) has the emoji bar in the hall", bar);
      const fan = await B.page.locator(".cv-emoji-toggle").isVisible().catch(() => false);
      run.check("B (phone) has the emoji button in the hall", fan);
      await A.page.locator(".cv-emoji-btn").nth(1).click();
      const seen = await B.page.waitForFunction(() => window.__cv.getEmojis().length > 0, null, { timeout: 5000 }).then(() => true, () => false);
      run.check("B sees A's reaction", seen, await B.page.evaluate(() => window.__cv.getEmojis()));
      await sleep(400);
      await run.shot(B, "check-emoji-seen-by-B.png");
      // and B sends one from the fan
      await press(B, B.page.locator(".cv-emoji-toggle"));
      await sleep(400);
      const fanBtn = B.page.locator(".cv-emoji-fan-btn").first();
      if (await fanBtn.isVisible().catch(() => false)) await press(B, fanBtn);
      const seenA = await A.page.waitForFunction(() => window.__cv.getEmojis().length > 0, null, { timeout: 5000 }).then(() => true, () => false);
      run.check("A sees B's reaction (from the phone's fan)", seenA);
      await sleep(300);
      await run.shot(A, "check-emoji-seen-by-A.png");
      await sleep(2500);
    });

    await run.step("4. candle on / off, in step between two visitors", async () => {
      await openCubby(A);
      await openCubby(B);
      await A.page.locator(".cv-cubby").waitFor({ timeout: 8000 });
      await B.page.locator(".cv-cubby").waitFor({ timeout: 8000 });
      await sleep(800);
      let a = await cardState(A);
      if (a?.button === "촛불 끄기") {
        await A.page.getByRole("button", { name: "촛불 끄기", exact: true }).click();
        await sleep(1500);
        a = await cardState(A);
      }
      run.check("A's button says 촛불 밝히기", a?.button === LIGHT, a);
      await A.page.getByRole("button", { name: LIGHT, exact: true }).click();
      const litB = await B.page.waitForFunction((id) => (window.__cvHall?.().candles ?? []).includes(id), SAMPLE.id, { timeout: 6000 }).then(() => true, () => false);
      run.check("B's hall shows the candle lit", litB);
      await sleep(600);
      a = await cardState(A);
      const b = await cardState(B);
      run.check("A (the lighter): 촛불 끄기, '내가 방금 켜 두었어요'", a?.button === "촛불 끄기" && a?.by === "내가 방금 켜 두었어요" && a?.disabled === false, a);
      run.check(
        "B (another visitor): 촛불이 켜져 있어요 (disabled), who lit it, and why it cannot put it out",
        b?.button === "촛불이 켜져 있어요" && b?.disabled === true && b?.by === `${A.nick}님이 방금 켜 주셨어요` && b?.hint === "켜 주신 분과 가족만 끌 수 있어요",
        b,
      );
      await run.shot(B, "check-B-card-lit-by-A.png");
      // B tries anyway through the wire: the server refuses (A's candle stays lit)
      await B.page.evaluate(async (id) => (await window.__imp("/src/net/connection.ts")).sendPutOutCandle(id), SAMPLE.id);
      await sleep(1200);
      run.check("a put-out from B is refused by the server (still lit on both)", (await candles(A)).includes(SAMPLE.id) && (await candles(B)).includes(SAMPLE.id));
      await A.page.getByRole("button", { name: "촛불 끄기", exact: true }).click();
      const outB = await B.page.waitForFunction((id) => !(window.__cvHall?.().candles ?? []).includes(id), SAMPLE.id, { timeout: 6000 }).then(() => true, () => false);
      run.check("A put it out: B's hall shows it out", outB);
      await sleep(600);
      const b2 = await cardState(B);
      run.check("B's card is back to 촛불 밝히기", b2?.button === LIGHT && b2?.disabled === false, b2);
      // now B lights it, A sees it and cannot put it out
      await B.page.getByRole("button", { name: LIGHT, exact: true }).click();
      const litA = await A.page.waitForFunction((id) => (window.__cvHall?.().candles ?? []).includes(id), SAMPLE.id, { timeout: 6000 }).then(() => true, () => false);
      await sleep(600);
      const a3 = await cardState(A);
      run.check("B lit it: A sees it and B's name, without 촛불 끄기", litA && a3?.button === "촛불이 켜져 있어요" && (a3?.by ?? "").startsWith(B.nick), a3);
      // a reload of B (same device key): B is still the lighter
      await B.page.getByRole("button", { name: "촛불 끄기", exact: true }).click().catch(() => {});
      const outA = await A.page.waitForFunction((id) => !(window.__cvHall?.().candles ?? []).includes(id), SAMPLE.id, { timeout: 6000 }).then(() => true, () => false);
      run.check("B put its own candle out (A sees it out)", outA);
    });

    await run.step("5. the card folds and unfolds (and stays folded for the session)", async () => {
      const before = await cardState(A);
      await A.page.locator(".cv-cubby-fold").click();
      await sleep(500);
      const f = await cardState(A);
      run.check("folded: a slim bar with the name", f?.folded === "1" && f?.barName === "호두" && f.panelH !== null && f.panelH < 80, { before: before?.panelH, f });
      await run.shot(A, "check-A-card-folded.png");
      await A.page.keyboard.press("Escape");
      await A.page.waitForFunction(() => !document.querySelector(".cv-cubby"), null, { timeout: 4000 });
      await openCubby(A);
      await A.page.locator(".cv-cubby").waitFor({ timeout: 8000 });
      const again = await cardState(A);
      run.check("opened again: still folded (the choice holds for the session)", again?.folded === "1", again);
      await A.page.locator(".cv-cubby-fold").click();
      await sleep(500);
      const u = await cardState(A);
      run.check("unfolded: the full card again", u?.folded === "0" && u.panelH > 200, u);
      // the phone: the toggle and the bar's buttons are easy to tap (>= 44 px)
      await B.page.locator(".cv-cubby-fold").tap();
      await sleep(500);
      const sizes = await B.page.evaluate(() =>
        [...document.querySelectorAll(".cv-cubby button")].map((b) => {
          const r = b.getBoundingClientRect();
          return { t: b.textContent, h: Math.round(r.height), w: Math.round(r.width), inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
        }),
      );
      run.check("phone, folded: every button >= 44 px and on screen", sizes.length >= 2 && sizes.every((s) => s.h >= 44 && s.w >= 44 && s.inside), sizes);
      await run.shot(B, "check-B-card-folded.png");
      await B.page.locator(".cv-cubby-fold").tap();
      await sleep(400);
      run.check("phone: unfolded again", (await cardState(B))?.folded === "0");
    });
    await A.ctx.close();
    await B.ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(run.finish());
