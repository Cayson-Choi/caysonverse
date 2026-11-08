/**
 * e2e/village-builder.mjs — 캐릭터 꾸미기(입장 화면) 회귀 검사 (케이슨 마을 1단계 최종 수정, 최종 리뷰 m5).
 *
 * 꾸미기는 방탈출과 케이슨 마을이 함께 쓰는 입구라서 바뀌면 안 된다. T11에서 옛 시트 흐름을 가정하던 e2e/task-char-builder.mjs를
 * 지우면서 꾸미기 전용 검사가 사라졌으므로, 그 스크립트의 1~5단계(기본 외형 7부품, 프리셋 기사, 머리카락·모자 변형, 웃옷 색 견본,
 * 왕관·티아라 금색 기본값)를 지금 입구(`/`, 마을) 위에 그대로 옮겼다. 판정은 미리보기의 lookKey와 실제로 그려진 부품
 * (`__cvPreview`, `__cvAvatars`, DEV 전용)을 소스 모듈의 계산(characterLook.visibleParts)과 비교한다.
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-builder.mjs [--out=<폴더>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, sleep } from "./lib/escape.mjs";

const run = createRun("village-builder");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

const DEFAULT_PARTS = ["body__hands", "body__head", "bottom__pants", "face__smile", "hair__short", "shoes__sneakers", "top__tee"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function pollUntil(read, pred, timeoutMs = 8000, stepMs = 40) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!pred(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

const presetBtn = (page, label) => page.locator(".cv-preset", { hasText: new RegExp(`^${label}$`) });
const tabBtn = (page, label) => page.getByRole("tab", { name: label, exact: true });
const chipBtn = (page, label) => page.locator(".cv-chips").getByRole("button", { name: label, exact: true });
const swatchBtn = (page, label) => page.locator(`.cv-swatch[aria-label="${label}"]`);
const pressedOf = (loc) => loc.getAttribute("aria-pressed");
const lookKeyOf = (page) => page.evaluate(() => window.__cvPreview().lookKey);

/** The source modules' own answer for a look key: which parts must be drawn, and the default look. */
async function ensureMods(page) {
  await page.evaluate(async () => {
    if (window.__vb) return;
    const CL = await window.__imp("/src/game/characterLook.ts");
    const AP = await window.__imp("/appearance.ts");
    const CM = await window.__imp("/characterManifest.ts");
    const slots = CM.CHARACTER_SLOTS;
    const partsFromKey = (key) => {
      const ids = key.split("|")[0].split(",");
      const parts = {};
      slots.forEach((s, i) => (parts[s] = ids[i] === "-" ? null : ids[i]));
      return parts;
    };
    window.__vb = {
      visibleForKey: (key) => CL.visibleParts(partsFromKey(key)),
      defaultVisible: CL.visibleParts(CL.lookFromAppearance(AP.DEFAULT_APPEARANCE).parts),
      defaultKey: CL.lookKey(CL.lookFromAppearance(AP.DEFAULT_APPEARANCE)),
    };
  });
}

/** The preview figure shows the current look: { key, parts }. */
async function settle(page) {
  const v = await pollUntil(
    () =>
      page.evaluate(() => {
        const p = window.__cvPreview?.();
        const e = window.__cvAvatars?.().preview;
        if (!p?.lookKey || !e) return null;
        const want = window.__vb.visibleForKey(p.lookKey);
        if (e.clip === null || JSON.stringify(e.parts) !== JSON.stringify(want)) return null;
        return { key: p.lookKey, parts: e.parts };
      }),
    (x) => x !== null,
    15000,
    30,
  );
  if (!v) throw new Error("the preview figure did not settle on the current look");
  return v;
}

async function change(page, act, { expectChange = true } = {}) {
  const before = await lookKeyOf(page);
  await act();
  if (expectChange) await pollUntil(() => lookKeyOf(page), (k) => k !== before, 4000, 25);
  return settle(page);
}
async function openTab(page, label) {
  const t = tabBtn(page, label);
  if ((await t.getAttribute("aria-selected")) !== "true") await t.click();
  await pollUntil(() => t.getAttribute("aria-selected"), (v) => v === "true", 3000, 25);
}
async function clickChip(page, label) {
  const c = chipBtn(page, label);
  const pressed = (await c.getAttribute("aria-pressed")) === "true";
  return change(page, () => c.click(), { expectChange: !pressed });
}

const browser = await launchBrowser();
try {
  const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "high" } });
  const pa = A.page;
  await pa.goto(CLIENT_URL + "/", { waitUntil: "domcontentloaded" });
  await entryReady(A);
  await pa.waitForFunction(() => window.__cvPreview && window.__cvPreview().shown && window.__cvAvatars?.().preview, null, { timeout: 120000 });
  await ensureMods(pa);

  await run.step("1 the entry screen: preview canvas, the default look's 7 parts", async () => {
    run.check(".cv-builder-preview canvas is visible", await pa.locator(".cv-builder-preview canvas").isVisible());
    const s = await settle(pa);
    const meta = await pa.evaluate(() => ({ defaultVisible: window.__vb.defaultVisible, defaultKey: window.__vb.defaultKey }));
    run.check("preview.parts == the default look's 7 parts", eq(s.parts, DEFAULT_PARTS) && eq(meta.defaultVisible, DEFAULT_PARTS), s.parts);
    run.check("the preview starts on the default look (lookKey)", s.key === meta.defaultKey, s.key);
    await run.shot(A, "builder-01-entry.png");
  });

  await run.step("2 preset 기사", async () => {
    const s = await change(pa, () => presetBtn(pa, "기사").click());
    const want = ["hat__knight_helmet", "top__armor", "shoes__tall_boots", "item__wooden_sword"];
    run.check("parts have the helmet, armour, tall boots and the wooden sword", want.every((p) => s.parts.includes(p)), s.parts);
    run.check("no hair__* part (the helmet hides hair)", s.parts.length > 0 && !s.parts.some((p) => p.startsWith("hair__")), s.parts);
    run.check("the 기사 card is aria-pressed", (await pressedOf(presetBtn(pa, "기사"))) === "true");
  });

  await run.step("3 hair 포니테일 -> hat 캡모자 -> hat 없음", async () => {
    await openTab(pa, "머리카락");
    let s = await clickChip(pa, "포니테일");
    run.check("포니테일 pressed, the look wears ponytail", (await pressedOf(chipBtn(pa, "포니테일"))) === "true" && s.key.split("|")[0].split(",")[1] === "ponytail", s.key);
    run.check("under the knight helmet still no hair__* mesh", s.parts.includes("hat__knight_helmet") && !s.parts.some((p) => p.startsWith("hair__")), s.parts);
    await openTab(pa, "모자");
    s = await clickChip(pa, "캡모자");
    run.check("캡모자 -> hair__ponytail__hat with hat__cap", s.parts.includes("hair__ponytail__hat") && s.parts.includes("hat__cap") && !s.parts.includes("hair__ponytail"), s.parts);
    s = await clickChip(pa, "없음");
    run.check("모자 없음 -> hair__ponytail, no hat__*", s.parts.includes("hair__ponytail") && !s.parts.includes("hair__ponytail__hat") && !s.parts.some((p) => p.startsWith("hat__")), s.parts);
  });

  await run.step("4 top swatch 흰색 -> 남색", async () => {
    await openTab(pa, "웃옷");
    const before = await settle(pa);
    const s1 = await change(pa, () => swatchBtn(pa, "흰색").click());
    run.check("흰색 pressed; parts unchanged, top colour #F7F7F2", (await pressedOf(swatchBtn(pa, "흰색"))) === "true" && eq(s1.parts, before.parts) && s1.key.split("|")[1].split(",")[3] === "#F7F7F2", s1.key);
    const s2 = await change(pa, () => swatchBtn(pa, "남색").click());
    run.check("남색 pressed, 흰색 not; top colour #2D3A75", (await pressedOf(swatchBtn(pa, "남색"))) === "true" && (await pressedOf(swatchBtn(pa, "흰색"))) === "false" && s2.key.split("|")[1].split(",")[3] === "#2D3A75", s2.key);
  });

  await run.step("5 hat 왕관 / 티아라 -> the gold swatch", async () => {
    await openTab(pa, "모자");
    const hatHex = (k) => k.split("|")[1].split(",")[2];
    let s = await clickChip(pa, "왕관");
    run.check("왕관 -> 금색 pressed (crown default gold)", (await pressedOf(swatchBtn(pa, "금색"))) === "true" && hatHex(s.key) === "#D4A93A" && s.parts.includes("hat__crown"), s.key);
    await change(pa, () => swatchBtn(pa, "빨강").click());
    run.check("setup: 빨강 picked, 금색 no longer pressed", (await pressedOf(swatchBtn(pa, "금색"))) === "false" && (await pressedOf(swatchBtn(pa, "빨강"))) === "true");
    s = await clickChip(pa, "티아라");
    run.check("티아라 -> 금색 pressed (tiara default gold)", (await pressedOf(swatchBtn(pa, "금색"))) === "true" && hatHex(s.key) === "#D4A93A" && s.parts.includes("hat__tiara"), s.key);
    await run.shot(A, "builder-05-tiara.png");
  });
  await A.ctx.close();
} catch (e) {
  run.check("the builder scenario ran to the end", false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
process.exit(run.finish({}));
