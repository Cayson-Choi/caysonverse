// A scripted angler for the big fish's fight (owner 2026-11-19: pull / release rhythm): reads the prompt on the screen (the HUD's
// [data-fight-cmd] = "pull" | "run") and holds the big button on "pull", lets go on "run", with a human's reaction time. Used by lake-catch,
// lake-fishing and lake-fight. `mode`: "follow" (does what it says), "hold" (holds all the time), "none" (never pulls).
import { sleep, touchDown, touchUp } from "./common.mjs";
import { bigButton } from "./lakeMock.mjs";

export function startFightAngler(p, { touch, mode = "follow", reactMs = 140, input = touch ? "touch" : "mouse" } = {}) {
  let stopped = false;
  let held = false;
  const log = [];
  const setHold = async (want) => {
    if (want === held) return;
    if (input === "key") {
      if (want) await p.page.keyboard.down("Space");
      else await p.page.keyboard.up("Space");
    } else {
      const b = await bigButton(p);
      if (want && !b) return;
      const cx = b ? b.x + b.w / 2 : 0;
      const cy = b ? b.y + b.h / 2 : 0;
      if (input === "touch") {
        if (want) await touchDown(p, cx, cy);
        else await touchUp(p);
      } else if (want) {
        await p.page.mouse.move(cx, cy);
        await p.page.mouse.down();
      } else await p.page.mouse.up();
    }
    held = want;
  };
  const promptNow = () =>
    p.page
      .evaluate(() => {
        const el = document.querySelector("[data-fight-cmd]");
        return el ? { cmd: el.getAttribute("data-fight-cmd"), tension: Number(el.getAttribute("data-fight-tension")), progress: Number(el.getAttribute("data-fight-progress")) } : null;
      })
      .catch(() => null);
  const loop = (async () => {
    let last = null;
    while (!stopped) {
      const pr = await promptNow();
      if (pr) {
        if (pr.cmd !== last) {
          log.push(pr.cmd);
          last = pr.cmd;
          if (mode === "follow") await sleep(reactMs);
        }
        if (mode === "follow") await setHold(pr.cmd === "pull");
        else if (mode === "hold") await setHold(true);
        else await setHold(false);
      } else if (held) await setHold(false);
      await sleep(50);
    }
    await setHold(false);
  })();
  return {
    log,
    async stop() {
      stopped = true;
      await loop;
    },
  };
}
