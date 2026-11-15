/**
 * e2e/village-hud.mjs — 마을 화면 조작(HUD) 전체 점검: 동서남북 나침반, 지도의 "내 위치" 표시, 메뉴의 모든 항목, 메뉴의 "소리" 칸(♪ 버튼 없음).
 *
 *   server:  PORT=2871 npx tsx src/index.ts                                          (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2871 npx vite --port 5471 --strictPort  (in client/)
 *   CV_CLIENT_URL=http://localhost:5471 node e2e/village-hud.mjs [--out=<증거 폴더>] [--only=pc|phone]
 *
 * PC 1280x800 (마우스) 과 폰 375x812 (터치 탭) 에서, 낮과 밤으로: 메뉴의 모든 항목을 눌러 효과를 확인하고, 방향(북·동·남·서)마다 나침반을 보고
 * (실제 카메라 방향과 비교), 지도를 열어 내 표시가 크게 보이고 깜빡이는지 확인한다. 콘솔 오류 0 이어야 한다.
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, press, sleep, visibleButtons, layoutReport } from "./lib/common.mjs";
import { NOON, dragView, joinVillage } from "./lib/village.mjs";

const NIGHT = "2026-11-03T23:30";
const args = process.argv.slice(2);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").slice(n.length + 3);
const run = createRun("village-hud");
if (opt("out")) run.evidence = opt("out");
mkdirSync(run.evidence, { recursive: true });
// Not from this change: the "화려하게" tier compiles a shader that the D3D11 compiler (real GPU, Windows) warns about (X3595, a texture
// gradient inside a loop). It shows up on the first join with graphics "high" too. Counted and printed as "allowed", never hidden.
run.allow("D3D shader warning X3595 (high tier)", /X3595/);
run.allow("THREE.WebGLProgram info log of that shader", /THREE.WebGLProgram: Program Info Log/);

const store = (p, key) => p.page.evaluate((k) => localStorage.getItem(k), key);
const bgm = (p) =>
  p.page.evaluate(() => {
    const b = window.__cvBgm;
    const e = b?.element?.();
    return b ? { paused: !!e?.paused, level: b.level(), enabled: b.isEnabled() } : null;
  });

/** Screenshot -> counts of strongly red / yellow pixels inside a square of half-size r (screen px) around (cx, cy). */
async function colourCount(p, cx, cy, r) {
  const b64 = (await p.page.screenshot()).toString("base64");
  return p.page.evaluate(
    async ([b64, cx, cy, r]) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      const d = g.getImageData(Math.max(0, (cx - r) * k), Math.max(0, (cy - r) * k), 2 * r * k, 2 * r * k).data;
      let red = 0;
      let yellow = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
        if (R > 200 && G < 150 && B < 160 && R - G > 90) red++;
        else if (R > 220 && G > 190 && B < 130) yellow++;
      }
      return { red: Math.round(red / (k * k)), yellow: Math.round(yellow / (k * k)) };
    },
    [b64, cx, cy, r],
  );
}

/** Where the player's feet are on screen (the camera's projection of its position). */
const playerScreen = (p) =>
  p.page.evaluate(() => {
    const { camera } = window.__cvThree();
    const pp = window.__cv.getPos();
    const v = camera.position.clone().set(pp.x, 0, pp.z).project(camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });

/** The heading (deg clockwise from north) the real camera looks along. */
const cameraHeading = (p) =>
  p.page.evaluate(() => {
    const { camera } = window.__cvThree();
    const d = camera.getWorldDirection(camera.position.clone());
    return (((Math.atan2(d.x, -d.z) * 180) / Math.PI) + 360) % 360;
  });

const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const LETTER = { 0: "북", 90: "동", 180: "남", 270: "서" };

/** The letter on the dial nearest the top of the dial (under the pointer). */
const topLetter = (p) =>
  p.page.evaluate(() => {
    const dial = document.querySelector(".cv-compass").getBoundingClientRect();
    let best = null;
    for (const el of document.querySelectorAll(".cv-compass-letter")) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.x + r.width / 2 - (dial.x + dial.width / 2), r.y + r.height / 2 - dial.y);
      if (!best || d < best.d) best = { d, t: el.textContent };
    }
    return best.t;
  });

async function setYaw(p, yaw, mode) {
  await p.page.evaluate(
    async ([yaw, mode]) => {
      const vs = (await window.__imp("/src/game/viewState.ts")).viewState;
      if (mode === "fp") {
        vs.fpYaw = yaw;
        vs.orbitGoal = null;
      } else vs.orbitGoal = { yaw };
    },
    [yaw, mode],
  );
  await sleep(mode === "fp" ? 500 : 1800);
}

const toggleView = (p, want) =>
  p.page.evaluate(async (want) => {
    const m = await window.__imp("/src/game/viewState.ts");
    if (m.viewState.mode !== want) m.toggleViewMode(window.__cv.getOrbit());
  }, want);

async function compassSweep(p, label, shots) {
  for (const mode of ["tp", "fp"]) {
    if (mode === "fp") {
      await toggleView(p, "fp");
      await sleep(1200);
    }
    for (const [yaw, heading] of [[0, 0], [-Math.PI / 2, 90], [Math.PI, 180], [Math.PI / 2, 270]]) {
      await setYaw(p, yaw, mode);
      const real = await cameraHeading(p);
      const shown = await p.page.evaluate(() => Number(document.querySelector(".cv-compass").dataset.heading));
      const letter = await topLetter(p);
      run.check(
        `${label} ${mode === "tp" ? "3인칭" : "1인칭"} ${LETTER[heading]}쪽: 나침반 ${shown}° = 실제 카메라 ${Math.round(real)}° (기대 ${heading}°), 위쪽 글자 ${letter}`,
        angDiff(real, heading) < 4 && angDiff(shown, real) < 3 && letter === LETTER[heading],
        { real: Math.round(real), shown, letter },
      );
      if (shots && mode === "tp") await run.shot(p, `${label}-compass-${LETTER[heading]}.png`);
    }
    if (mode === "fp") {
      await toggleView(p, "tp");
      await sleep(1200);
    }
  }
  await setYaw(p, 0, "tp");
}

const openMenu = async (p) => {
  await sleep(500); // a layout change (왼손잡이) moves the button: let it settle
  await press(p, p.page.locator('[aria-label="메뉴 열기"]'));
  if (!(await p.page.locator(".cv-menu").waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false))) await press(p, p.page.locator('[aria-label="메뉴 열기"]'));
  await p.page.locator(".cv-menu").waitFor({ state: "visible", timeout: 5000 });
  await sleep(400);
};
const closeMenu = async (p) => {
  await press(p, p.page.locator(".cv-menu-close"));
  await p.page.locator(".cv-menu").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await sleep(300);
};
const sw = (p, id) => p.page.locator(`[role=switch][aria-labelledby=${id}]`);
const seg = (p, group, name) => p.page.locator(`[aria-labelledby=${group}] button`, { hasText: name });
const checked = async (loc) => (await loc.getAttribute("aria-checked")) === "true";
async function tap(p, loc) {
  await loc.scrollIntoViewIfNeeded();
  await press(p, loc);
  await sleep(350);
}
const setRange = async (p, id, v) => {
  await p.page.locator("#" + id).scrollIntoViewIfNeeded();
  await p.page.locator("#" + id).fill(String(v));
  await sleep(400);
};
const settingsOf = (p) => p.page.evaluate(() => JSON.parse(localStorage.getItem("cv-settings-v1") || "{}"));
const lumaOf = async (p) => {
  const b64 = (await p.page.screenshot()).toString("base64");
  return p.page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 120;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 200, 120);
    const d = g.getImageData(0, 0, 200, 120).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, b64);
};

async function menuAudit(p, label) {
  const touch = p.touch;
  await openMenu(p);
  await run.shot(p, `${label}-menu-top.png`);
  const rows = await p.page.locator(".cv-menu-label").allTextContents();
  console.log("   menu rows:", rows.join(" | "));
  run.check(`${label} 메뉴에 "소리" 칸 (소리 켜기, 배경음악, 음악 크기)`, ["소리 켜기", "배경음악", "음악 크기"].every((t) => rows.some((r) => r.includes(t))), rows);
  run.check(
    `${label} 터치 전용 항목(버튼 크기, 왼손잡이)은 ${touch ? "폰에서 보임" : "PC에서 숨김"}`,
    touch ? rows.includes("버튼 크기") && rows.includes("왼손잡이 모드") : !rows.includes("버튼 크기") && !rows.includes("왼손잡이 모드"),
    rows,
  );

  // ── 소리 ──
  let b = await bgm(p);
  run.check(`${label} 처음: 음악이 켜져 있고 재생 중`, b && b.enabled && !b.paused, b);
  await tap(p, sw(p, "cv-menu-sound"));
  b = await bgm(p);
  run.check(
    `${label} 소리 끄기: 스위치 꺼짐, 저장 1, 음악 멈춤, 배경음악 스위치 잠김, 안내 문구`,
    !(await checked(sw(p, "cv-menu-sound"))) && (await store(p, "cv-tts-muted")) === "1" && b.paused && (await sw(p, "cv-menu-music").isDisabled()) && (await p.page.locator("#cv-menu-sound-note").count()) === 1,
    b,
  );
  await run.shot(p, `${label}-menu-sound-off.png`);
  await tap(p, sw(p, "cv-menu-sound"));
  await sleep(1800);
  b = await bgm(p);
  run.check(`${label} 소리 다시 켜기: 저장 0, 음악 다시 재생`, (await store(p, "cv-tts-muted")) === "0" && !b.paused, b);
  await tap(p, sw(p, "cv-menu-music"));
  b = await bgm(p);
  run.check(
    `${label} 배경음악 끄기: 저장 0, 멈춤, 음악 크기 막대 잠김`,
    !(await checked(sw(p, "cv-menu-music"))) && (await store(p, "cv-village-bgm")) === "0" && b.paused && (await p.page.locator("#cv-menu-music-volume").isDisabled()),
    b,
  );
  await tap(p, sw(p, "cv-menu-music"));
  await sleep(2400);
  b = await bgm(p);
  run.check(`${label} 배경음악 켜기: 저장 1, 재생, 소리 0.35`, (await store(p, "cv-village-bgm")) === "1" && !b.paused && Math.abs(b.level - 0.35) < 0.03, b);
  await setRange(p, "cv-menu-music-volume", 0.5);
  b = await bgm(p);
  run.check(
    `${label} 음악 크기 50%: 소리 0.35→0.175, 저장 0.5, 표시 50%`,
    Math.abs(b.level - 0.175) < 0.02 && (await store(p, "cv-music-volume")) === "0.5" && (await p.page.locator("#cv-menu-music-volume ~ .cv-menu-value").textContent()) === "50%",
    b,
  );
  await setRange(p, "cv-menu-music-volume", 0);
  b = await bgm(p);
  run.check(`${label} 음악 크기 0%: 들리지 않음`, b.level < 0.01, b);
  await setRange(p, "cv-menu-music-volume", 1);
  b = await bgm(p);
  run.check(`${label} 음악 크기 100%: 원래대로 0.35`, Math.abs(b.level - 0.35) < 0.03, b);
  run.check(`${label} 화면에 ♪ 버튼이나 소리 켜기/끄기 버튼이 없음`, (await p.page.locator('[aria-label="배경음악 켜기/끄기"], [aria-label="소리 켜기/끄기"]').count()) === 0);

  // ── 설정 ──
  if (touch) {
    const menuBtn = () => p.page.locator('[aria-label="메뉴 열기"]').boundingBox();
    await tap(p, seg(p, "cv-menu-btn-size", "크게"));
    await closeMenu(p);
    const big = await menuBtn();
    await openMenu(p);
    await tap(p, seg(p, "cv-menu-btn-size", "작게"));
    await closeMenu(p);
    const small = await menuBtn();
    await openMenu(p);
    await tap(p, seg(p, "cv-menu-btn-size", "보통"));
    run.check(`${label} 버튼 크기: 크게(${big.width}px) > 작게(${small.width}px), 저장됨`, big.width > small.width && (await settingsOf(p)).buttonSize === "medium", { big: big.width, small: small.width });
    const x0 = (await menuBtn()).x;
    await tap(p, sw(p, "cv-menu-left-handed"));
    await closeMenu(p);
    const x1 = (await menuBtn()).x;
    const cx = (await p.page.locator(".cv-compass").boundingBox()).x;
    run.check(`${label} 왼손잡이 모드: 위쪽 버튼과 나침반이 왼쪽으로`, x0 > 200 && x1 < 100 && cx < 100, { x0, x1, cx });
    await run.shot(p, `${label}-left-handed.png`);
    await openMenu(p);
    await tap(p, sw(p, "cv-menu-left-handed"));
    await closeMenu(p);
    await openMenu(p);
  }
  // 시점 감도: 같은 만큼 끌어서 돌아간 각도 비교
  const yawAfterDrag = async () => {
    const a = await p.page.evaluate(() => window.__cv.getOrbit().yaw);
    await dragView(p, 90, 0);
    const c = await p.page.evaluate(() => window.__cv.getOrbit().yaw);
    return Math.abs(Math.atan2(Math.sin(c - a), Math.cos(c - a)));
  };
  await setRange(p, "cv-menu-sensitivity", 0.5);
  await closeMenu(p);
  const slow = await yawAfterDrag();
  await openMenu(p);
  await setRange(p, "cv-menu-sensitivity", 2);
  await closeMenu(p);
  const fast = await yawAfterDrag();
  await openMenu(p);
  await setRange(p, "cv-menu-sensitivity", 1);
  run.check(`${label} 시점 감도: 2배로 끌면 0.5배보다 확실히 더 돈다 (0.5배 ${slow.toFixed(2)}rad, 2배 ${fast.toFixed(2)}rad)`, fast > slow * 2.5 && (await settingsOf(p)).lookSensitivity === 1, { slow, fast });

  // 이름표
  const tags = () =>
    p.page.evaluate(() => {
      const t = window.__cv.getNametags();
      const sid = window.__cv.getSessionId();
      return { mode: window.__cv.getNametagMode(), n: t.length, shown: t.filter((x) => x.selected && x.opacity > 0.3).length, own: t.filter((x) => x.id === sid).map((x) => ({ sel: x.selected, op: +x.opacity.toFixed(2) })), ids: t.map((x) => x.id).slice(0, 3) };
    });
  await tap(p, seg(p, "cv-menu-nametags", "모두"));
  await sleep(800);
  const tAll = await tags();
  await tap(p, seg(p, "cv-menu-nametags", "끄기"));
  await sleep(800);
  const tOff = await tags();
  run.check(
    `${label} 이름표 보기: 모두 → ${tAll.shown}개 보임, 끄기 → ${tOff.shown}개, 끄면 "내 이름표" 스위치 잠김`,
    tAll.mode === "all" && tOff.mode === "off" && tAll.shown >= 1 && tOff.shown === 0 && (await sw(p, "cv-menu-own-nametag").isDisabled()),
    { tAll, tOff },
  );
  await tap(p, seg(p, "cv-menu-nametags", "가까운 사람만"));
  await sleep(800);
  const tNear = await tags();
  run.check(`${label} 이름표 보기: 가까운 사람만 → 가까운 이름표 ${tNear.shown}개`, tNear.mode === "nearby" && tNear.shown >= 1, tNear);
  const ownOn = (await tags()).own;
  await tap(p, sw(p, "cv-menu-own-nametag"));
  await sleep(800);
  const ownOff = (await tags()).own;
  run.check(`${label} 내 이름표 보기 끄기가 내 이름표에 반영됨`, JSON.stringify(ownOn) !== JSON.stringify(ownOff) && (await settingsOf(p)).showOwnNametag === false, { ownOn, ownOff });
  await tap(p, sw(p, "cv-menu-own-nametag"));
  await sleep(500);
  run.check(`${label} 내 이름표 보기 다시 켜면 돌아옴`, (await settingsOf(p)).showOwnNametag !== false, (await tags()).own);

  // 1인칭
  await tap(p, sw(p, "cv-menu-first-person"));
  await sleep(1200);
  const fp = await p.page.evaluate(() => window.__cv.getView().mode);
  await tap(p, sw(p, "cv-menu-first-person"));
  await sleep(1200);
  const tp = await p.page.evaluate(() => window.__cv.getView().mode);
  run.check(`${label} 1인칭으로 보기: 켜면 fp, 끄면 tp`, fp === "fp" && tp === "tp", { fp, tp });

  // 그래픽 / 밝기
  const gfx = async (name) => {
    await tap(p, seg(p, "cv-menu-graphics", name));
    await sleep(1500);
    return p.page.evaluate(() => {
      const { gl } = window.__cvThree();
      return { dpr: +gl.getPixelRatio().toFixed(2), shadow: gl.shadowMap.enabled };
    });
  };
  const hi = await gfx("화려하게");
  const lo = await gfx("가볍게");
  await gfx("자동");
  await sleep(3500);
  run.check(`${label} 그래픽: 화려하게 ${JSON.stringify(hi)} / 가볍게 ${JSON.stringify(lo)}, 자동으로 저장`, JSON.stringify(hi) !== JSON.stringify(lo) && (await settingsOf(p)).graphics === "auto", { hi, lo });
  await closeMenu(p);
  await sleep(2500);
  const l10 = await lumaOf(p);
  await openMenu(p);
  await setRange(p, "cv-menu-brightness", 1.4);
  await closeMenu(p);
  await sleep(1200);
  const l14 = await lumaOf(p);
  await openMenu(p);
  await setRange(p, "cv-menu-brightness", 0.8);
  await closeMenu(p);
  await sleep(1200);
  const l08 = await lumaOf(p);
  await openMenu(p);
  await setRange(p, "cv-menu-brightness", 1);
  run.check(`${label} 밝기: 1.4 > 1.0 > 0.8 (화면 평균 밝기 ${l14.toFixed(1)} > ${l10.toFixed(1)} > ${l08.toFixed(1)})`, l14 > l10 && l10 > l08, { l14, l10, l08 });

  // 도움말
  await tap(p, p.page.locator(".cv-menu-link"));
  await sleep(900);
  const coach = await p.page.locator(".cv-coach").count();
  run.check(`${label} 조작 안내 다시 보기: 메뉴가 닫히고 안내가 나온다`, (await p.page.locator(".cv-menu").count()) === 0 && coach === 1, { coach, title: await p.page.locator(".cv-coach-title").first().textContent().catch(() => null) });
  await run.shot(p, `${label}-coach-again.png`);
  await press(p, p.page.locator(".cv-coach-skip").first()).catch(() => {});
  await sleep(500);

  // 닫기 / Esc / 바깥
  await openMenu(p);
  await closeMenu(p);
  run.check(`${label} 닫기 버튼으로 메뉴가 닫힘`, (await p.page.locator(".cv-menu").count()) === 0);
  if (!touch) {
    await openMenu(p);
    await p.page.keyboard.press("Escape");
    await sleep(400);
    run.check(`${label} Esc로 메뉴가 닫힘`, (await p.page.locator(".cv-menu").count()) === 0);
  }
  await openMenu(p);
  const vp = p.page.viewportSize();
  if (touch) await p.page.touchscreen.tap(4, vp.height - 4);
  else await p.page.mouse.click(4, vp.height - 4);
  await sleep(400);
  run.check(`${label} 바깥(어두운 곳)을 눌러도 메뉴가 닫힘`, (await p.page.locator(".cv-menu").count()) === 0);
  await openMenu(p);
  const reach = await p.page.evaluate(() => {
    const c = document.querySelector(".cv-menu");
    c.scrollTop = c.scrollHeight;
    const r = document.querySelector(".cv-menu-close").getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: innerHeight, scrollable: c.scrollHeight > c.clientHeight };
  });
  run.check(`${label} 메뉴 맨 아래 "닫기"까지 화면 안에서 닿는다${touch ? "" : " (PC는 스크롤 없이 한 화면)"}`, reach.bottom <= reach.vh + 1 && (touch || !reach.scrollable), reach);
  await run.shot(p, `${label}-menu-bottom.png`);
  await closeMenu(p);
}

async function mapCheck(p, label) {
  await press(p, p.page.locator('[aria-label="지도 보기"]'));
  await p.page.waitForFunction(() => window.__cv.getView().ovBlend > 0.99, null, { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const at = await playerScreen(p);
  const vp = p.page.viewportSize();
  const tag = await p.page.locator(".cv-map-me").first().boundingBox().catch(() => null);
  const shownTag = await p.page.evaluate(() => {
    const e = document.querySelector(".cv-map-me");
    return !!e && getComputedStyle(e).display !== "none";
  });
  const heading = await p.page.evaluate(() => Number(document.querySelector(".cv-compass").dataset.heading));
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await colourCount(p, at.x, at.y, 46));
    await sleep(110);
  }
  const reds = samples.map((s) => s.red);
  const maxRed = Math.max(...reds);
  const minRed = Math.min(...reds);
  run.check(
    `${label} 지도: 내 위치 표시가 크게 보임 (붉은 원 ${maxRed}px², 지름 약 ${Math.round(2 * Math.sqrt(maxRed / Math.PI))}px, 노란 고리 ${Math.max(...samples.map((s) => s.yellow))}px²)`,
    maxRed > 500 && samples.some((s) => s.yellow > 150),
    { at, samples: samples.slice(0, 3) },
  );
  run.check(`${label} 지도: "내 위치" 이름표가 화면 안에 보임`, shownTag && tag && tag.width > 40 && tag.y > 0 && tag.x > 0 && tag.x + tag.width < vp.width, { tag, shownTag });
  run.check(`${label} 지도: 표시가 깜빡임 (붉은 면적 ${minRed}~${maxRed})`, maxRed + Math.max(...samples.map((s) => s.yellow)) > 1.15 * (minRed + Math.min(...samples.map((s) => s.yellow))), reds);
  run.check(`${label} 지도: 나침반은 북쪽이 위 (${heading}°)`, angDiff(heading, 0) < 3 && (await topLetter(p)) === "북", heading);
  await run.shot(p, `${label}-map.png`);
  await sleep(450);
  await run.shot(p, `${label}-map-b.png`);
  await press(p, p.page.locator('[aria-label="지도 보기"]'));
  await p.page.waitForFunction(() => window.__cv.getView().mode !== "ov", null, { timeout: 8000 });
  await sleep(1500);
  const gone = await p.page.evaluate(() => {
    const e = document.querySelector(".cv-map-me");
    return !e || getComputedStyle(e).display === "none";
  });
  run.check(`${label} 지도를 닫으면 "내 위치" 이름표도 사라짐`, gone);
}

async function hudCheck(p, label) {
  const names = await p.page.evaluate(() => [...document.querySelectorAll(".cv-hud-right button")].map((b) => b.getAttribute("aria-label")));
  run.check(`${label} 오른쪽 위 버튼은 3개 (시점·지도·메뉴), ♪·소리 버튼 없음`, names.length === 3 && names.includes("메뉴 열기") && names.includes("지도 보기"), names);
  const box = await p.page.locator(".cv-compass").boundingBox();
  const vp = p.page.viewportSize();
  const others = await visibleButtons(p);
  const overlaps = others.filter((e) => !(box.x + box.width + 4 <= e.x || e.x + e.w + 4 <= box.x || box.y + box.height + 4 <= e.y || e.y + e.h + 4 <= box.y));
  run.check(
    `${label} 나침반(${Math.round(box.width)}px)이 화면 안, 다른 버튼과 4px 이상 떨어짐`,
    box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height && overlaps.length === 0,
    { box, overlaps: overlaps.map((o) => o.name) },
  );
  if (p.touch) {
    const rep = layoutReport(others, vp);
    run.check(`${label} 터치 버튼 규칙(48px 이상, 간격 8px, 화면 안)`, rep.ok, rep);
  }
  await run.shot(p, `${label}-hud.png`);
}

const browser = await launchBrowser();
try {
  for (const [dev, device] of [["pc", DESKTOP], ["phone", PHONE]]) {
    if (opt("only") && opt("only") !== dev) continue;
    const A = await openPlayer(browser, run, { tag: dev, device, settings: { graphics: "high" } });
    const B = await openPlayer(browser, run, { tag: dev + "-B", device: DESKTOP, settings: { graphics: "low" } });
    await run.step(`${dev}: 낮 — 입장`, async () => {
      await joinVillage(A, "허드", NOON);
      await joinVillage(B, "이웃", NOON);
      await sleep(5000);
      run.check("마을 화면", (await A.page.evaluate(() => window.__cv.getScreen())) === "village");
      // 첫 눌림: 브라우저 규칙상 음악은 첫 터치 뒤에 시작한다
      if (A.touch) await A.page.touchscreen.tap(device.viewport.width / 2, 300);
      else await A.page.mouse.click(device.viewport.width / 2, 300);
      await sleep(2500);
    });
    await run.step(`${dev}: 낮 — 화면 위쪽 버튼과 나침반`, async () => hudCheck(A, `${dev}-day`));
    await run.step(`${dev}: 낮 — 동서남북 나침반 (북·동·남·서, 3인칭과 1인칭)`, async () => compassSweep(A, `${dev}-day`, true));
    await run.step(`${dev}: 낮 — 지도와 내 위치`, async () => mapCheck(A, `${dev}-day`));
    await run.step(`${dev}: 낮 — 메뉴의 모든 항목`, async () => menuAudit(A, `${dev}-day`));
    await A.ctx.close();
    await B.ctx.close();

    const N = await openPlayer(browser, run, { tag: dev + "-night", device, settings: { graphics: "high" } });
    const NB = await openPlayer(browser, run, { tag: dev + "-night-B", device: DESKTOP, settings: { graphics: "low" } });
    await run.step(`${dev}: 밤 — 입장`, async () => {
      await joinVillage(N, "밤허드", NIGHT);
      await joinVillage(NB, "밤이웃", NIGHT);
      await sleep(5000);
    });
    await run.step(`${dev}: 밤 — 화면 위쪽 버튼과 나침반`, async () => hudCheck(N, `${dev}-night`));
    await run.step(`${dev}: 밤 — 동서남북 나침반`, async () => compassSweep(N, `${dev}-night`, true));
    await run.step(`${dev}: 밤 — 지도와 내 위치`, async () => mapCheck(N, `${dev}-night`));
    await run.step(`${dev}: 밤 — 메뉴`, async () => {
      await openMenu(N);
      await run.shot(N, `${dev}-night-menu.png`);
      await closeMenu(N);
    });
    await N.ctx.close();
    await NB.ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(run.finish());
