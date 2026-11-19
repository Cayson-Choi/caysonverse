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

// --- robust variants (owner 2026-11-19: the big fish's landing check failed in 2 of 3 runs on a loaded machine) ------------------------
// The outside angler above talks to the page through Playwright: on a loaded (or CPU-throttled) machine every round trip takes
// hundreds of ms, the prompt is answered late and a 1 s grace is spent on the wire, and a phase that lasts a second (the fish
// out of the water, the card) can pass between two polls. Two helpers that wait on STATE, inside the page:
//   - `installPhaseLog`: the page records every phase the server's fields go through (name, cast, time); `waitSeen` looks the log up
//     (no phase is ever skipped, however slow the polling is);
//   - `startFightAnglerInPage`: the angler runs in the page itself (timers there are the page's own, so a throttled phone is a slow
//     player, not a slow test): it reads the same `[data-fight-cmd]` the HUD shows and sends the Hold the button would send.
/** Start recording the phases of this page's own cast (idempotent). */
export async function installPhaseLog(p) {
  await p.page.evaluate(async () => {
    if (window.__cvPhaseLog) return;
    const net = await window.__imp("/src/lake/lakeNet.ts");
    const proto = await window.__imp("/src/lake/lakeProtocol.ts");
    const log = (window.__cvPhaseLog = []);
    let last = -1;
    let lastSeq = -1;
    const v = proto.emptyFishView();
    setInterval(() => {
      if (!net.readFishView(net.selfId(), v)) return;
      if (v.phase !== last || v.seq !== lastSeq) {
        last = v.phase;
        lastSeq = v.seq;
        log.push({ name: proto.phaseName(v.phase), seq: v.seq, kind: v.kind, cm: v.cm, at: Date.now() });
      }
    }, 25);
  });
}

/** The log's length now: pass it to `waitSeen` as `from` to look only at what happens after this point. */
export const phaseMark = (p) => p.page.evaluate(() => window.__cvPhaseLog?.length ?? 0);

/** The first logged phase (from index `from`) whose name is in `names`, waiting up to `ms`; null when none came. */
export async function waitSeen(p, names, ms, from = 0) {
  const t0 = Date.now();
  for (;;) {
    const hit = await p.page.evaluate(([names, from]) => (window.__cvPhaseLog ?? []).slice(from).find((e) => names.includes(e.name)) ?? null, [names, from]).catch(() => null);
    if (hit || Date.now() - t0 > ms) return hit;
    await sleep(100);
  }
}

/** The scripted angler inside the page: `mode` "follow" | "hold" | "none", `reactMs` a human's reaction after each new command. */
export async function startFightAnglerInPage(p, { mode = "follow", reactMs = 140 } = {}) {
  await p.page.evaluate(
    async ([mode, reactMs]) => {
      window.__cvAngler?.stop();
      const net = await window.__imp("/src/lake/lakeNet.ts");
      const ff = await window.__imp("/shared/src/village/fishFight.ts");
      const fi = await window.__imp("/shared/src/village/fishing.ts");
      const fv = net.readFishView ? await window.__imp("/src/lake/lakeProtocol.ts") : null;
      const log = [];
      let held = false;
      let last = null;
      let pending = 0;
      const set = (want) => {
        if (want === held) return;
        held = want;
        // how late after the schedule's switch the Hold goes out (ms): the human + the slow page, in the server's own clock
        try {
          const v = fv.emptyFishView();
          net.readFishView(net.selfId(), v);
          const sched = ff.fightSchedule(v.cm, fi.fishSeed(v.spot, v.seq));
          const since = net.elapsedSince(v.at);
          const at = ff.fightSegAt(sched, since);
          log.push({ want, kind: at.seg.kind, lagMs: Math.round(since - at.seg.startMs), idx: at.index });
        } catch {}
        net.sendHold(want);
      };
      const id = setInterval(() => {
        const el = document.querySelector("[data-fight-cmd]");
        if (!el) {
          if (held) set(false);
          last = null;
          return;
        }
        const cmd = el.getAttribute("data-fight-cmd");
        if (mode === "hold") return set(true);
        if (mode === "none") return;
        if (cmd !== last) {
          last = cmd;
          clearTimeout(pending);
          pending = setTimeout(() => set(cmd === "pull"), reactMs);
        }
      }, 20);
      window.__cvAngler = {
        log,
        stop() {
          clearInterval(id);
          clearTimeout(pending);
          if (held) set(false);
          window.__cvAngler = null;
        },
      };
    },
    [mode, reactMs],
  );
  return {
    log: () => p.page.evaluate(() => window.__cvAngler?.log ?? []).catch(() => []),
    stop: () => p.page.evaluate(() => window.__cvAngler?.stop()).catch(() => {}),
  };
}
