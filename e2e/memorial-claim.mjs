/**
 * e2e/memorial-claim.mjs — 추모관 B단계(모시기): PC(1280×800)와 iPhone 13(375×812, 터치)에서 처음 온 사람처럼
 *   1. PC가 빈 칸을 열고 [우리 아이 모시기] → 이름·종류·날짜·한 줄 → 사진(GPS가 든 JPEG) → 확인 → 복구 코드
 *   2. 카드: "우리 가족 칸", 사진 "검토 중이에요", 고치기·사진 바꾸기·가족 기기 / 폰(다른 사람): 이름만, 사진 없음
 *   3. 운영자 승인(API, X-Admin-Key) → 폰 카드에 공개 사진이 뜸(ClaimUpdated → 다시 받기)
 *   4. 가족 링크 → 새 폰이 링크로 들어와 "가족 기기로 연결했어요", 같은 칸에서 고치기 버튼이 보임
 *   5. PC를 새로고침(새 접속, 같은 기기 키) → 여전히 우리 가족 칸 / 폰이 한 칸 모신 뒤 다른 빈 칸 → "한 가족에 한 칸"
 *   6. 밤(21:30) PC·폰 가까이 보기 화면
 *
 *   서버: CV_DATA_DIR=<새 폴더> CV_ADMIN_KEY_SHA256=<sha256(e2e 키)> PORT=3171 npx tsx src/index.ts
 *   클라: VITE_SERVER_URL=http://localhost:3171 npx vite --port 5771 --strictPort
 *   node e2e/memorial-claim.mjs --out=<폴더> --photo=<jpg> --server=http://localhost:3171 --admin=<e2e 키>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { act, enterHall, joinVillage } from "./lib/village.mjs";

const run = createRun("memorial-claim");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const PHOTO = opt("photo", "");
const SERVER = opt("server", "http://localhost:3171");
const ADMIN = opt("admin", "");
const SLOT = { bank: "A", col: 10, row: 3, id: "M1-A-r3-c10" }; // beside the sample, eye height
const SLOT_B = { bank: "B", col: 3, row: 2, id: "M1-B-r2-c03" };
const NIGHT = "2026-11-03T21:30";
const summary = {};

const openCubby = (p, s) => p.page.evaluate(async (s) => (await window.__imp("/src/village/cubbyCard.ts")).openCubbyAt(s), s);
const card = (p) =>
  p.page.evaluate(() => {
    const el = document.querySelector(".cv-cubby");
    if (!el) return null;
    const ph = el.querySelector(".cv-cubby-photo");
    return {
      id: el.getAttribute("data-cubby"),
      text: el.textContent,
      name: el.querySelector(".cv-cubby-name")?.textContent ?? "",
      claimed: el.querySelector("[data-claimed]")?.getAttribute("data-claimed") ?? null,
      photo: ph ? getComputedStyle(ph).backgroundImage : "",
      buttons: [...el.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => b.textContent),
    };
  });
const claimsState = (p) =>
  p.page.evaluate(async () => {
    const s = (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot();
    return { status: s.status, claims: [...s.claims.keys()], mine: [...s.mine.keys()], freeLeft: s.freeLeft };
  });
/** Every visible button / input in a container at least 44 px tall, inside the viewport (UX P5). */
const touchTargets = (p, sel) =>
  p.page.evaluate((sel) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const bad = [];
    for (const el of document.querySelectorAll(`${sel} button, ${sel} input:not([type=file]):not([type=checkbox])`)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      if (r.height < 43.5 || r.left < -1 || r.right > vw + 1) bad.push({ t: el.textContent || el.getAttribute("name"), h: Math.round(r.height), l: Math.round(r.left), r: Math.round(r.right), vh });
    }
    return bad;
  }, sel);
const fontsOk = (p, sel) =>
  p.page.evaluate((sel) => {
    const small = [];
    for (const el of document.querySelectorAll(`${sel} *`)) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) small.push({ t: el.textContent.slice(0, 20), fs });
    }
    return small;
  }, sel);

async function inHall(p, prefix, time) {
  await joinVillage(p, prefix, time);
  await enterHall(p);
  await p.page.waitForFunction(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot().status === "ready", null, { timeout: 15000 });
}

const browser = await launchBrowser();
// the server's memorial clock is real time; the client's ?time= pin only moves the sun
try {
  const A = await openPlayer(browser, run, { tag: "PC", device: DESKTOP, settings: { graphics: "high" } });
  const B = await openPlayer(browser, run, { tag: "phone", device: PHONE, settings: { graphics: "low" } });

  await run.step("PC and phone visitors come into the hall", async () => {
    await inHall(A, "가족");
    await inHall(B, "손님");
    run.check("PC sees the memorial store ready, no claims yet", (await claimsState(A)).claims.length === 0, await claimsState(A));
  });

  await run.step("PC: an empty cubby offers 우리 아이 모시기", async () => {
    await openCubby(A, SLOT);
    await A.page.locator(".cv-cubby-claim").waitFor({ timeout: 5000 });
    await sleep(900);
    const c = await card(A);
    run.check("the empty card offers the claim button and the code link", c.buttons.includes("우리 아이 모시기") && c.text.includes("코드로 연결하기"), c);
    await run.shot(A, "01-pc-empty-cubby.png");
  });

  await run.step("PC: the claim form, step by step", async () => {
    await A.page.locator(".cv-cubby-claim").click();
    await A.page.locator(".cv-mem-sheet[data-step=info]").waitFor({ timeout: 5000 });
    await run.shot(A, "02-pc-form-empty.png");
    // the form refuses an empty name
    await A.page.locator(".cv-mem-primary").click();
    run.check("an empty name is refused with a gentle line", /이름은/.test(await A.page.locator(".cv-mem-error").textContent()), await A.page.locator(".cv-mem-error").textContent());
    await A.page.locator("input[name=petName]").fill("콩이");
    await A.page.locator(".cv-mem-chips button", { hasText: "강아지" }).click();
    await A.page.locator(".cv-mem-check input").first().uncheck();
    await A.page.locator("input[name=born]").fill("2014-05-17");
    await A.page.locator(".cv-mem-check input").nth(1).uncheck();
    await A.page.locator("input[name=passed]").fill("2026-11-01");
    await A.page.locator("input[name=line]").fill("늘 곁에 있어 줘서 고마웠어요");
    await run.shot(A, "03-pc-form-filled.png");
    run.check("PC form: every control ≥ 44 px, inside the window", (await touchTargets(A, ".cv-mem-sheet")).length === 0, await touchTargets(A, ".cv-mem-sheet"));
    await A.page.locator(".cv-mem-primary").click();
    await A.page.locator(".cv-mem-sheet[data-step=photo]").waitFor({ timeout: 5000 });
    await A.page.setInputFiles(".cv-mem-sheet input[type=file]", PHOTO);
    // what the device would send: the same resize the form runs, on the same picked file (a Blob body is not visible to Playwright)
    const prepared = await A.page.evaluate(async () => {
      const f = document.querySelector(".cv-mem-sheet input[type=file]").files[0];
      const out = await (await window.__imp("/src/village/memorial/imageResize.ts")).prepareUpload(f);
      if (typeof out === "string") return { fail: out };
      const b = new Uint8Array(await out.arrayBuffer());
      const text = new TextDecoder("latin1").decode(b);
      const bmp = await createImageBitmap(out);
      return { srcBytes: f.size, bytes: b.length, jpeg: b[0] === 0xff && b[1] === 0xd8, exif: text.includes("Exif"), maker: text.includes("TestPhone"), w: bmp.width, h: bmp.height };
    });
    summary.prepared = prepared;
    run.check("the device shrinks the photo to a 4:5 JPEG ≤ 1600 px, ≤ 2 MB, with no EXIF (GPS) left", prepared.jpeg && !prepared.exif && !prepared.maker && prepared.bytes <= 2 * 1024 * 1024 && Math.max(prepared.w, prepared.h) <= 1600 && Math.abs(prepared.w / prepared.h - 0.8) < 0.01, prepared);
    await A.page.waitForFunction(() => getComputedStyle(document.querySelector(".cv-mem-preview")).backgroundImage.startsWith('url("blob:'), null, { timeout: 15000 });
    await run.shot(A, "04-pc-form-photo.png");
    await A.page.locator(".cv-mem-primary").click();
    await A.page.locator(".cv-mem-sheet[data-step=check]").waitFor({ timeout: 5000 });
    await run.shot(A, "05-pc-form-check.png");
    const resp = A.page.waitForResponse((r) => r.url().includes("/photos") && r.request().method() === "POST", { timeout: 20000 });
    await A.page.locator(".cv-mem-primary").click();
    run.check("the photo upload was accepted (201)", (await resp).status() === 201, (await resp).status());
    await A.page.locator(".cv-mem-sheet[data-step=recovery]").waitFor({ timeout: 20000 });
    const code = (await A.page.locator("[data-testid=recovery-code]").textContent()).trim();
    summary.recoveryShown = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code);
    run.check("the recovery code is shown once, grouped by four", summary.recoveryShown, code.replace(/[0-9A-Z]/g, "•"));
    await run.shot(A, "06-pc-recovery-code.png");
    await A.page.locator(".cv-mem-primary").click();
    await A.page.locator(".cv-mem-sheet").waitFor({ state: "detached", timeout: 5000 });
  });

  await run.step("PC: the family's card — 우리 가족 칸, photo in review, family buttons", async () => {
    await sleep(1200);
    const c = await card(A);
    summary.pcCard = c;
    run.check("my card: name, mine badge, pending badge", c.claimed === "mine" && c.name === "콩이" && c.text.includes("우리 가족 칸") && c.text.includes("검토 중이에요"), c);
    run.check("the family sees its own photo through a signed link", /\/media\/s\/.+sig=/.test(c.photo), c.photo.slice(0, 80));
    run.check("family buttons: 고치기 / 사진 바꾸기 / 가족 기기, plus 촛불 켜기", ["고치기", "사진 바꾸기", "가족 기기", "촛불 켜기"].every((b) => c.buttons.includes(b)), c.buttons);
    run.check("no '!' anywhere on the card", !c.text.includes("!"));
    await run.shot(A, "07-pc-my-card-pending.png");
  });

  await run.step("phone (another person): the claimed cubby shows the name, not the photo in review", async () => {
    await B.page.waitForFunction(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot().claims.has("M1-A-r3-c10"), null, { timeout: 10000 });
    await openCubby(B, SLOT);
    await B.page.locator(".cv-cubby [data-claimed]").waitFor({ timeout: 5000 });
    await sleep(1200);
    const c = await card(B);
    summary.phoneCardBefore = c;
    run.check("public card: name and line, not mine, no photo yet, no family buttons", c.claimed === "public" && c.name === "콩이" && !c.photo.includes("/media/") && !c.buttons.includes("고치기"), c);
    await run.shot(B, "08-phone-public-card-pending.png");
  });

  await run.step("operator approves the photo → the phone's card shows it (ClaimUpdated)", async () => {
    const q = await (await fetch(`${SERVER}/api/memorial/admin/review`, { headers: { "X-Admin-Key": ADMIN } })).json();
    run.check("the review queue holds the one photo", q.items?.length === 1, q.items?.length);
    const r = await fetch(`${SERVER}/api/memorial/admin/photos/${q.items[0].photoId}`, { method: "POST", headers: { "X-Admin-Key": ADMIN, "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
    run.check("approved", r.status === 200, r.status);
    const shown = await B.page
      .waitForFunction(() => /\/media\/p\//.test(getComputedStyle(document.querySelector(".cv-cubby-photo")).backgroundImage), null, { timeout: 10000 })
      .then(() => true, () => false);
    run.check("the phone's open card now shows the public photo", shown, (await card(B))?.photo.slice(0, 80));
    await sleep(1500);
    await run.shot(B, "09-phone-public-card-approved.png");
    run.check("phone card: every button ≥ 44 px, inside the screen", (await touchTargets(B, ".cv-cubby")).length === 0, await touchTargets(B, ".cv-cubby"));
    run.check("phone card: no text under 12 px", (await fontsOk(B, ".cv-cubby")).length === 0, await fontsOk(B, ".cv-cubby"));
  });

  await run.step("PC: the 3D cubby shows the photo in its frame (close-up, HUD hidden)", async () => {
    await A.page.evaluate(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).refreshHall());
    await sleep(2500);
    await A.page.evaluate(() => {
      window.__hid = [...document.querySelectorAll(".cv-cubby")];
      for (const e of window.__hid) e.style.visibility = "hidden";
    });
    await sleep(400);
    await run.shot(A, "10-pc-3d-cubby-day.png");
    await A.page.evaluate(() => window.__hid.forEach((e) => (e.style.visibility = "")));
  });

  await run.step("PC: family link → a new phone joins the family", async () => {
    await A.page.locator(".cv-cubby-family button", { hasText: "가족 기기" }).click();
    await A.page.locator(".cv-mem-sheet .cv-mem-secondary", { hasText: "가족 링크 만들기" }).click();
    await A.page.locator("[data-testid=invite-link]").waitFor({ timeout: 5000 });
    const link = (await A.page.locator("[data-testid=invite-link]").textContent()).trim();
    run.check("the link is <site>/?f=<12 chars>", /\/\?f=[0-9A-Z]{12}$/.test(link), link.replace(/f=.*/, "f=…"));
    await run.shot(A, "11-pc-family-sheet.png");
    await A.page.locator(".cv-mem-sheet .cv-mem-primary").click();
    const C = await openPlayer(browser, run, { tag: "phone2", device: PHONE, settings: { graphics: "low" } });
    const url = new URL(link);
    await C.page.goto(`${url.origin}/?f=${url.searchParams.get("f")}&time=${encodeURIComponent("2026-11-03T12:30")}`);
    await sleep(500);
    run.check("the family code left the address bar at once", !C.page.url().includes("f="), C.page.url().replace(/time=.*/, ""));
    await joinVillage(C, "엄마");
    const n = await C.page.locator(".cv-mem-notice").textContent({ timeout: 8000 }).catch(() => "");
    run.check("the new phone was told it joined the family", (n ?? "").includes("가족 기기로 연결했어요"), n);
    await run.shot(C, "12a-phone2-joined-notice.png");
    await enterHall(C);
    await C.page.waitForFunction(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot().status === "ready", null, { timeout: 15000 });
    await openCubby(C, SLOT);
    await C.page.locator(".cv-cubby [data-claimed=mine]").waitFor({ timeout: 8000 });
    await sleep(1200);
    const c = await card(C);
    run.check("the family's second device sees 우리 가족 칸 with 고치기", c.claimed === "mine" && c.buttons.includes("고치기"), c.buttons);
    await run.shot(C, "12-phone2-family-device-card.png");
    // edit from the second device
    await C.page.locator(".cv-cubby-family button", { hasText: "고치기" }).tap();
    await C.page.locator(".cv-mem-sheet[data-step=info]").waitFor({ timeout: 5000 });
    await C.page.locator("input[name=line]").fill("엄마도 보러 왔어요");
    await run.shot(C, "13-phone2-edit-form.png");
    run.check("phone form: every control ≥ 44 px, inside the screen", (await touchTargets(C, ".cv-mem-sheet")).length === 0, await touchTargets(C, ".cv-mem-sheet"));
    await C.page.locator(".cv-mem-primary").tap();
    await C.page.locator(".cv-mem-sheet").waitFor({ state: "detached", timeout: 8000 });
    const edited = await A.page
      .waitForFunction(() => document.querySelector(".cv-cubby-line")?.textContent === "엄마도 보러 왔어요", null, { timeout: 10000 })
      .then(() => true, () => false);
    run.check("the PC's open card updated by itself", edited, (await card(A))?.text);
    await C.ctx.close();
  });

  await run.step("PC reloads (a new connection, the same device): still the family's cubby", async () => {
    await A.page.reload();
    await inHall(A, "가족");
    run.check("mine after reload", (await claimsState(A)).mine.includes(SLOT.id), await claimsState(A));
    await openCubby(A, SLOT);
    await A.page.locator(".cv-cubby [data-claimed=mine]").waitFor({ timeout: 8000 });
    run.check("card says 우리 가족 칸 again", (await card(A)).text.includes("우리 가족 칸"));
  });

  await run.step("phone: claims its own cubby, then an empty one says one per family", async () => {
    await openCubby(B, SLOT_B);
    await B.page.locator(".cv-cubby-claim").tap();
    await B.page.locator("input[name=petName]").fill("나비");
    await B.page.locator(".cv-mem-chips button", { hasText: "고양이" }).tap();
    await run.shot(B, "14-phone-form.png");
    await B.page.locator(".cv-mem-primary").tap();
    await B.page.locator(".cv-mem-sheet[data-step=photo]").waitFor({ timeout: 5000 });
    await run.shot(B, "15-phone-form-photo-step.png");
    await B.page.locator(".cv-mem-primary").tap(); // no photo now ("나중에 올려도 돼요")
    await B.page.locator(".cv-mem-primary").tap();
    await B.page.locator(".cv-mem-sheet[data-step=recovery]").waitFor({ timeout: 20000 });
    await run.shot(B, "16-phone-recovery.png");
    await B.page.locator(".cv-mem-primary").tap();
    await sleep(1000);
    const mine = await card(B);
    run.check("phone's own card: 사진 올리기 offered, 사진을 기다리고 있어요", mine.buttons.includes("사진 올리기") && mine.text.includes("사진을 기다리고 있어요"), mine);
    await run.shot(B, "17-phone-my-card-no-photo.png");
    await openCubby(B, { bank: "B", col: 5, row: 2 });
    await sleep(800);
    const c = await card(B);
    run.check("another empty cubby: one per family + 우리 아이 칸 보기", c.text.includes("한 가족에 한 칸까지") && c.buttons.includes("우리 아이 칸 보기"), c);
    await run.shot(B, "18-phone-one-per-family.png");
    await B.page.locator(".cv-cubby-claim", { hasText: "우리 아이 칸 보기" }).tap();
    await sleep(800);
    run.check("…which takes the card to the family's cubby", (await card(B)).id === SLOT_B.id);
  });

  await run.step("night: the claimed cubby close-up, PC and phone", async () => {
    for (const [p, tag] of [
      [A, "pc"],
      [B, "phone"],
    ]) {
      try {
        await inHall(p, tag === "pc" ? "가족" : "손님", NIGHT);
      } catch (err) {
        await run.shot(p, `19-${tag}-night-debug.png`);
        summary[`night_${tag}`] = await p.page.evaluate(async () => ({ pos: window.__cv?.getPos?.(), area: (await window.__imp("/src/village/villageArea.ts")).localArea(), hall: !!window.__cvHall }));
        throw err;
      }
      await openCubby(p, SLOT);
      await p.page.locator(".cv-cubby [data-claimed]").waitFor({ timeout: 8000 });
      await sleep(2500);
      await run.shot(p, `19-${tag}-night-card.png`);
    }
  });
} finally {
  await browser.close();
}
writeFileSync(`${run.evidence}/summary.json`, JSON.stringify(summary, null, 2));
process.exit(run.finish(summary));
