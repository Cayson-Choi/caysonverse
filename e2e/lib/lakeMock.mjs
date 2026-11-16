// A mocked fishing server for the lake e2e (chunk E): the server's rules (D2) are not in this branch, so the page plays the server's
// part through the DEV hooks window.__cvLake (the schema fields of every angler, the personal messages) and window.__cvSeat
// (the confirmed seat). The phase machine follows design 9.2 with short, configurable lengths. Nothing of it ships: the hooks exist
// only in DEV builds.
import { sleep } from "./common.mjs";

/** Install the mock server in a tab that is in the village. `cfg` (window.__cvMock) can be changed between casts. */
export async function installMock(p) {
  await p.page.evaluate(async () => {
    const L = window.__cvLake;
    const sid = window.__cv.getSessionId();
    const seats = (await window.__imp("/src/game/activeMap.ts")).VILLAGE_ACTIVE_MAP.seats;
    const chairs = (await window.__imp("/src/lake/lakeNearby.ts")).FISHING_CHAIRS;
    const K = { none: 0, carry: 1, ready: 2, casting: 3, settling: 4, waiting: 5, nibble: 6, bite: 7, hooked: 8, lifting: 9, fighting: 10, netting: 11, landed: 12, releasing: 13, missed: 14 };
    const cfg = (window.__cvMock = { kind: 0, cm: 24, sig: 1, waitMs: 9000, nibbleMs: 6000, biteMs: 15000, netted: false, holdNeedMs: 2500, log: [] });
    let state = { rod: 0, spot: -1, phase: 0, seq: 0, sig: 0, kind: 0, cm: 0, at: 0 };
    let timers = [];
    let hold = { down: false, since: 0, total: 0, last: 0 };
    let fight = null;
    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (fight) clearInterval(fight);
      fight = null;
    };
    const set = (phase, extra = {}) => {
      state = { ...state, phase, at: L.clock(), ...extra };
      L.setView(sid, state);
      cfg.log.push([Date.now(), phase]);
    };
    const after = (ms, fn) => timers.push(setTimeout(fn, ms));
    const toReady = () => set(K.ready);
    const land = () => {
      set(K.landed);
      L.personal({ phase: K.landed, catch: { kind: state.kind, cm: state.cm } });
      after(2500, () => {
        set(K.releasing);
        after(800, toReady);
      });
    };
    const startWait = () => {
      set(K.waiting);
      after(cfg.waitMs, () => {
        set(K.nibble);
        after(cfg.nibbleMs, () => {
          set(K.bite, { sig: cfg.sig });
          after(cfg.biteMs, () => {
            if (state.phase === K.bite) {
              set(K.missed);
              after(1000, toReady);
            }
          });
        });
      });
    };
    const seatIndexOf = (spot) => seats.findIndex((s) => s.kind === "fishing_chair" && s.spot === chairs[spot].spot);
    L.onSend((type, payload) => {
      switch (type) {
        case "FishingRentRod":
          state = { ...state, rod: 1, phase: K.carry, at: L.clock() };
          L.setView(sid, state);
          break;
        case "FishingReturnRod":
          clear();
          state = { rod: 0, spot: -1, phase: 0, seq: state.seq, sig: 0, kind: 0, cm: 0, at: L.clock() };
          L.setView(sid, state);
          break;
        case "FishingSit": {
          const idx = seatIndexOf(payload.spot);
          window.__cvSeat.index = idx;
          state = { ...state, spot: payload.spot, phase: K.ready, at: L.clock() };
          L.setView(sid, state);
          break;
        }
        case "FishingCast":
          if (state.phase !== K.ready) return L.reject("too_soon");
          clear();
          set(K.casting, { seq: state.seq + 1, sig: 0 });
          after(800, () => {
            set(K.settling);
            after(2000, startWait);
          });
          break;
        case "FishingStrike":
          if (state.phase === K.nibble) return L.reject("not_yet");
          if (state.phase !== K.bite) return;
          clear();
          set(K.hooked, { kind: cfg.kind, cm: cfg.cm });
          if (cfg.netted) {
            after(400, () => {
              set(K.fighting);
              hold = { down: false, since: 0, total: 0, last: Date.now() };
              fight = setInterval(() => {
                if (hold.down) hold.total += 100;
                L.personal({ phase: K.fighting, progress: Math.min(1, hold.total / cfg.holdNeedMs) });
                if (hold.total >= cfg.holdNeedMs) {
                  clearInterval(fight);
                  fight = null;
                  set(K.netting);
                  after(1200, land);
                }
              }, 100);
              after(6000 + cfg.holdNeedMs * 2, () => {
                if (state.phase === K.fighting) {
                  clear();
                  set(K.missed);
                  after(1000, toReady);
                }
              });
            });
          } else {
            after(400, () => {
              set(K.lifting);
              after(1000, land);
            });
          }
          break;
        case "FishingHold":
          hold.down = !!payload.down;
          break;
        case "FishingStand":
          clear();
          window.__cvSeat.index = -1;
          state = { ...state, spot: -1, phase: state.rod ? K.carry : 0, at: L.clock() };
          L.setView(sid, state);
          break;
        default:
          break;
      }
    });
    // the stand button sends the ordinary Stand message (net/connection.sendStand): the mock watches the seat state itself
    const origIndex = () => window.__cvSeat.index;
    setInterval(() => {
      if (state.spot >= 0 && origIndex() < 0) {
        clear();
        state = { ...state, spot: -1, phase: state.rod ? K.carry : 0, at: L.clock() };
        L.setView(sid, state);
      }
    }, 150);
  });
}

/** What the big button says and its tone, or null when there is none. */
export const bigButton = (p) =>
  p.page.evaluate(() => {
    const b = document.querySelector("[data-lake-btn]");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { id: b.getAttribute("data-lake-btn"), tone: b.getAttribute("data-lake-tone"), label: b.getAttribute("aria-label"), disabled: b.getAttribute("aria-disabled") === "true", w: r.width, h: r.height, x: r.x, y: r.y };
  });

export async function waitButton(p, label, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const b = await bigButton(p);
    if (b && b.label === label) return b;
    await sleep(100);
  }
  return null;
}

export const setMock = (p, patch) => p.page.evaluate((x) => Object.assign(window.__cvMock, x), patch);
