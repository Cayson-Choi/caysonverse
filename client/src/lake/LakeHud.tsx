import { useCallback, useEffect, useRef, useState } from "react";
import type { Orbit, Pose, SeatState } from "../game/types";
import { onHotkey } from "../game/hotkeys";
import { isUiCaptured } from "../game/uiCapture";
import { isTouchDevice } from "../device";
import { rectStyle, useTouchHudLayout, useTouchViewport } from "../ui/useTouchHudLayout";
import type { Rect } from "../game/hud";
import { sendStand as sendSeatStand } from "../net/connection";
import { setClickTarget } from "../game/clickMove";
import { LAKE_RENTAL_PAD, LAKE_FISHING_SPOTS } from "@caysonverse/shared/village/lakeLayout";
import { coachSeen } from "./lakeDex";
import { lakeButton, lakeCaption, showReturnButton, showStandButton, type LakeAction, type LakeButtonSpec, type LakeContext } from "./lakeHudModel";
import { elapsedSince, listenLake, readFishView, selfId, sendCast, sendFishSit, sendHold, sendRentRod, sendReturnRod, sendStand as sendFishStand, sendStrike, forEachAngler } from "./lakeNet";
import { chairSpotOfSeat, inLakeZone, nearestFreeChair, onRentalPad } from "./lakeNearby";
import { FISH_PHASE, emptyFishView, sigName, species, type FishView } from "./lakeProtocol";
import { biteWindowMs } from "@caysonverse/shared/village/fishing";
import { expireLakeUi, useLakeStore } from "./lakeStore";
import { LakeCards } from "./LakeCards";
import { LakePierCue } from "./LakePierCue";
import { FIGHT_HINT, fightPromptOf, tensionLevel, type FightPrompt } from "./fishFightView";
import { playFightCue } from "./fightSfx";
import { carriesHandItem } from "./fishingRig";
import { backToFishing, catchCamera, fishingCamera, liftCamera, restoreCamera } from "./lakeCamera";
import "./lake.css";

/** The last cast recorded in the dex (session:seq): module-wide, so a remount of the HUD never records a catch twice. */
let recordedCast = "";

/** The HUD reads the schema this often (ms): a bite must turn the button red at once. */
const POLL_MS = 80;

/** The fight prompt changed on screen (the command, its grace, the meters to 2 %): a re-render. */
function sameFight(a: LakeContext["fight"], b: LakeContext["fight"]): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.inGrace === b.inGrace && a.index === b.index && a.held === b.held && Math.round(a.tension * 50) === Math.round(b.tension * 50) && Math.round(a.progress * 50) === Math.round(b.progress * 50);
}

function sameCtx(a: LakeContext | null, b: LakeContext): boolean {
  if (!a) return false;
  const x = a.view;
  const y = b.view;
  return (
    a.nearRental === b.nearRental &&
    a.nearChair === b.nearChair &&
    a.seatedAtSpot === b.seatedAtSpot &&
    a.seatedNoRod === b.seatedNoRod &&
    a.onChair === b.onChair &&
    x.rod === y.rod &&
    x.spot === y.spot &&
    x.phase === y.phase &&
    x.sig === y.sig &&
    x.seq === y.seq &&
    x.kind === y.kind &&
    x.cm === y.cm &&
    sameFight(a.fight ?? null, b.fight ?? null) &&
    a.lostWhy === b.lostWhy
  );
}

/**
 * The lake's HUD (design 7): ONE big button for the whole fishing flow (rent, sit, cast, wait, pull, hold, again), the small
 * stand button, the line of words under the top bar, notices, the catch card and the dex. It only shows what the room says:
 * the phase is the schema's `fishPhase`, never predicted. While it has a button, the village's own context button and its E key
 * step aside (`ownsAction`), so there is never a second button for the same thing.
 */
export function LakeHud({ pose, seat, orbit }: { pose: Pose; seat: SeatState; orbit: Orbit }) {
  const [ctx, setCtx] = useState<LakeContext | null>(null);
  const ctxRef = useRef<LakeContext | null>(null);
  const store = useLakeStore;
  const layout = useTouchHudLayout();
  const vp = useTouchViewport();
  const holdingRef = useRef(false);
  /** The key / pointer is physically down (even while it was not yet the hold button: pressed to strike and never let go, owner 2026-11-19). */
  const keyDownRef = useRef(false);
  const pointerDownRef = useRef(false);
  const [shake, setShake] = useState(0);
  const lastRod = useRef(0);
  const lastPhase = useRef(0);
  const lastSpot = useRef(-1);
  const seatRef = useRef(seat);
  seatRef.current = seat;
  const coachShownRef = useRef(false);

  // personal messages and the room's trophy
  useEffect(
    () =>
      listenLake({
        state: (s) => store.getState().setPersonal(s),
        rejected: (t) => store.getState().say(t),
        trophy: (t) => store.getState().trophy(t),
        board: (b) => store.setState({ board: b }),
      }),
    [store],
  );

  const scan = useCallback((): void => {
    const view = emptyFishView();
    readFishView(selfId(), view);
    const occupied = new Set<number>();
    forEachAnglerSpots(selfId(), occupied);
    const chairSpot = chairSpotOfSeat(seatRef.current.index);
    const seatedAtSpot = view.spot >= 0;
    const next: LakeContext = {
      view,
      nearRental: onRentalPad(pose.x, pose.z),
      nearChair: view.rod > 0 && !seatedAtSpot ? (chairSpot >= 0 ? chairSpot : seatRef.current.index < 0 ? nearestFreeChair(pose.x, pose.z, occupied) : -1) : -1,
      onChair: view.rod > 0 && !seatedAtSpot && chairSpot >= 0,
      seatedAtSpot,
      seatedNoRod: view.rod === 0 && chairSpot >= 0,
      fight: fightPromptOf(view, elapsedSince(view.at)),
      lostWhy: view.phase === FISH_PHASE.missed ? store.getState().personal.lostWhy : undefined,
    };
    // rod rented / returned: a line of words
    // the held item (손에 드는 것) is left with the shop while the rod is out, and given back with the rod (fishingRig.stowHandItem)
    const item = carriesHandItem(selfId());
    // (ux1's words for a first-timer: "낚싯대", not the rod's length; lake-v2's note about the held item)
    if (view.rod > 0 && lastRod.current === 0) store.getState().say(item ? "낚싯대를 빌렸어요. 들고 있던 물건은 가게에 맡겼어요. 잔교의 빈 의자에 앉아서 던져요!" : "낚싯대를 빌렸어요. 잔교의 빈 의자에 앉아서 던져요!", 4200);
    if (view.rod === 0 && lastRod.current > 0) store.getState().say(item ? "낚싯대를 반납하고 맡긴 물건을 돌려받았어요." : "낚싯대를 반납했어요.");
    lastRod.current = view.rod;
    // the fish is landed: the card and the dex of this device
    // Recorded once per CAST (its seq), from `landed` or, if the screen never saw `landed` (a slow phone, a hidden tab, a state
    // patch that jumped it), from `releasing`: the edge alone lost catches (owner 2026-11-16: 4 species caught, 1 in the dex).
    const caughtNow = (view.phase === FISH_PHASE.landed || view.phase === FISH_PHASE.releasing) && species(view.kind) !== null;
    const castKey = `${selfId()}:${view.seq}`;
    if (caughtNow && recordedCast !== castKey) {
      recordedCast = castKey;
      store.getState().landed(view.kind, view.cm, Date.now());
      // the camera comes round to see the fish held up, and goes back over the shoulder for the next cast
      const spot = LAKE_FISHING_SPOTS[view.spot];
      if (spot) catchCamera(spot.yaw);
    }
    // the fish coming in: the camera goes round to the side to see the rod, the line and the fish come out of the water
    if ((view.phase === FISH_PHASE.lifting || view.phase === FISH_PHASE.fighting) && lastPhase.current !== view.phase) {
      const spot = LAKE_FISHING_SPOTS[view.spot];
      if (spot) liftCamera(spot.yaw);
    }
    if (view.phase === FISH_PHASE.ready && lastPhase.current === FISH_PHASE.releasing) {
      const spot = LAKE_FISHING_SPOTS[view.spot];
      if (spot) backToFishing(spot.yaw);
    }
    if (lastPhase.current === FISH_PHASE.fighting && view.phase !== FISH_PHASE.fighting) markFightCoach();
    if (view.phase === FISH_PHASE.missed && lastPhase.current === FISH_PHASE.fighting && store.getState().personal.lostWhy === "snap") playFightCue("snap");
    lastPhase.current = view.phase;
    // the fishing camera: seated at a spot -> over the shoulder toward the float; standing up -> where it was
    if (view.spot >= 0 && lastSpot.current < 0) {
      const spot = LAKE_FISHING_SPOTS[view.spot];
      if (spot) fishingCamera(spot.yaw, orbit);
    } else if (view.spot < 0 && lastSpot.current >= 0) restoreCamera();
    lastSpot.current = view.spot;
    // the first-time words under a waiting float (this device, once)
    if (view.phase === FISH_PHASE.waiting && !coachShownRef.current && !coachSeen()) {
      coachShownRef.current = true;
      store.getState().coachDone();
      firstTimeRef.current = true;
    }
    if (!sameCtx(ctxRef.current, next)) {
      ctxRef.current = next;
      setCtx(next);
    }
    const inZone = inLakeZone(pose.x, pose.z);
    const owns = (view.rod > 0 || next.nearRental || next.seatedNoRod) && (inZone || view.rod > 0) && lakeButton(next) !== null;
    if (store.getState().ownsAction !== owns) store.setState({ ownsAction: owns });
    expireLakeUi();
  }, [pose, orbit, store]);
  const firstTimeRef = useRef(false);

  useEffect(() => {
    scan();
    const id = window.setInterval(scan, POLL_MS);
    return () => {
      window.clearInterval(id);
      store.setState({ ownsAction: false });
    };
  }, [scan, store]);

  // a poll of the store's timed items
  const notice = store((s) => s.notice);
  const card = store((s) => s.card);
  const toasts = store((s) => s.toasts);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  /** Get up: the fishing chair's own message (FishingStand) when seated at a spot, the ordinary Stand on any other lake seat. */
  const standUp = useCallback((): void => {
    if (ctxRef.current?.seatedAtSpot) sendFishStand();
    else sendSeatStand();
  }, []);

  const perform = useCallback(
    (a: LakeAction): void => {
      const s = store.getState();
      switch (a.kind) {
        case "rent":
          sendRentRod();
          break;
        case "return":
          sendReturnRod();
          break;
        case "sit":
          sendFishSit(a.spot);
          break;
        case "cast":
          sendCast();
          break;
        case "strike":
        case "tooEarly": {
          // the button shows the phase of the last poll: the press goes by the phase the server set NOW (a bite that
          // began a moment ago is pulled, never turned away as "아직")
          const live = emptyFishView();
          readFishView(selfId(), live);
          if (live.phase === FISH_PHASE.bite) {
            // a 찌올림 opens its window a moment after it starts rising (shared biteWindowMs): a press before that is kept and
            // sent when it opens, so the red button never turns a press away
            const sig = sigName(live.sig);
            const opens = sig === "none" ? 0 : biteWindowMs(sig)[0];
            const early = opens - elapsedSince(live.at);
            if (early > 0) {
              const seq = live.seq;
              window.setTimeout(() => {
                const now = emptyFishView();
                readFishView(selfId(), now);
                if (now.phase === FISH_PHASE.bite && now.seq === seq) sendStrike();
              }, early + 90);
            } else sendStrike();
            break;
          }
          if (a.kind === "strike") {
            sendStrike(); // the server judges it (the bite's grace)
            break;
          }
          setShake((n) => n + 1);
          s.say("아직이에요! 찌가 크게 움직일 때까지 기다려요.");
          break;
        }
        case "goRental":
          // get up, then walk to the yellow circle
          standUp();
          setClickTarget(LAKE_RENTAL_PAD.x, LAKE_RENTAL_PAD.z + 2.2);
          s.say("관리소 앞으로 가요.");
          break;
        default:
          break;
      }
    },
    [store, standUp],
  );

  const spec = ctx ? lakeButton(ctx) : null;
  const specRef = useRef<LakeButtonSpec | null>(null);
  specRef.current = spec;

  // keys: E rents / sits / goes to the rental; Space (and E) is the big button while seated (held while fighting). The rod goes
  // back only by the 반납하기 button on the pad or by itself on leaving the lake, never by a key.
  useEffect(() => {
    const offE = onHotkey((action) => {
      if (action.type !== "interact") return;
      const sp = specRef.current;
      if (sp && sp.key === "E" && sp.enabled) perform(sp.action);
    });
    // seated at a spot, E does what Space does (cast, pull, hold: UX 2026-11-16) — one key for every fishing step
    const isFishKey = (code: string) => code === "Space" || code === "KeyE";
    const onDown = (e: KeyboardEvent): void => {
      if (!isFishKey(e.code) || isUiCaptured()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      keyDownRef.current = true;
      if (e.repeat) return;
      const sp = specRef.current;
      if (!sp || sp.key !== "Space" || !sp.enabled) return;
      e.preventDefault();
      if (sp.hold) {
        if (!holdingRef.current) {
          holdingRef.current = true;
          sendHold(true);
        }
      } else perform(sp.action);
    };
    const onUp = (e: KeyboardEvent): void => {
      if (isFishKey(e.code)) keyDownRef.current = false;
      if (isFishKey(e.code) && holdingRef.current) {
        holdingRef.current = false;
        sendHold(false);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      offE();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      if (holdingRef.current) {
        holdingRef.current = false;
        sendHold(false);
      }
    };
  }, [perform]);

  // the pointer (finger / mouse) is down anywhere: tracked so a press that began before the fight counts when the fight starts
  useEffect(() => {
    const up = (): void => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // a hold that is no longer the button (the fish was landed, the phase moved on) is let go of; and a key / finger that is ALREADY down
  // when the hold button appears (pressed to strike, never let go: owner 2026-11-19, "누르고 있어도 항상 놓치기만") is a hold from that moment
  const holdButton = !!(spec && spec.hold && spec.enabled);
  useEffect(() => {
    if (holdingRef.current && !(spec && spec.hold)) {
      holdingRef.current = false;
      sendHold(false);
    } else if (holdButton && !holdingRef.current && (keyDownRef.current || pointerDownRef.current)) {
      holdingRef.current = true;
      sendHold(true);
    }
  }, [spec, holdButton]);

  // the fight's cues (sound; a short buzz on a phone) at every switch and when the line goes tight: the big button is the only guide
  const fightKind = ctx?.fight?.kind ?? null;
  const fightLevel = ctx?.fight ? tensionLevel(ctx.fight.tension) : "calm";
  const lastFightKindRef = useRef<string | null>(null);
  const lastFightLevelRef = useRef("calm");
  useEffect(() => {
    if (fightKind && lastFightKindRef.current && lastFightKindRef.current !== fightKind) {
      playFightCue(fightKind);
      if (isTouchDevice) navigator.vibrate?.(fightKind === "run" ? [70, 40, 70] : [35]);
    }
    lastFightKindRef.current = fightKind;
  }, [fightKind]);
  useEffect(() => {
    if (fightLevel === "danger" && lastFightLevelRef.current !== "danger") {
      playFightCue("danger");
      if (isTouchDevice) navigator.vibrate?.([25, 25, 25]);
    }
    lastFightLevelRef.current = fightLevel;
  }, [fightLevel]);

  if (!ctx) return null;
  const inZone = inLakeZone(pose.x, pose.z);
  if (!inZone && ctx.view.rod === 0 && !ctx.seatedNoRod) return null;
  // at the lake without a rod, away from the pad: where to get one (a first-time player has been told nothing)
  const caption = lakeCaption(ctx, firstTimeRef.current) || (ctx.view.rod === 0 && !ctx.nearRental && inZone ? "낚싯대는 관리소 앞에서 빌려요." : "");
  const rect = isTouchDevice ? bigRect(layout, vp.w) : null;
  return (
    <>
      <div className="cv-lake-top" role="status" aria-live="polite">
        {showStandButton(ctx) && (
          <button type="button" className="cv-lake-stand" onClick={standUp} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
            ↑ 일어나기
          </button>
        )}
        {showReturnButton(ctx) && (
          <button type="button" className="cv-lake-stand" data-lake-return onClick={() => perform({ kind: "return" })} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
            ↩ 반납하기
          </button>
        )}
        <button type="button" className="cv-lake-dexbtn" onClick={() => store.getState().setDexOpen(true)} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}>
          📖 도감
        </button>
        {caption && <div className="cv-lake-caption">{caption}</div>}
        {notice && <div className="cv-lake-notice">{notice.text}</div>}
        {toasts.map((t) => (
          <div key={t.id} className="cv-lake-toast">
            🐟 {t.text}
          </div>
        ))}
      </div>
      {ctx.view.rod > 0 && !ctx.seatedAtSpot && !ctx.onChair && ctx.nearChair < 0 && !ctx.nearRental && <LakePierCue pose={pose} orbit={orbit} />}
      {spec && (
        <LakeButton
          spec={spec}
          rect={rect}
          shake={shake}
          progress={store.getState().personal.progress}
          fight={ctx.fight ?? null}
          onPress={() => perform(spec.action)}
          onPointer={(down) => {
            pointerDownRef.current = down;
          }}
          onHold={(down) => {
            if (down === holdingRef.current) return;
            holdingRef.current = down;
            sendHold(down);
          }}
        />
      )}
      {ctx.fight && !coachSeenFight() && (
        <div className="cv-lake-btnhint" style={rect ? { right: Math.max(8, window.innerWidth - (rect.x + rect.w)), bottom: window.innerHeight - rect.y + 8 } : undefined}>
          {FIGHT_HINT}
        </div>
      )}
      <LakeCards card={card} />
    </>
  );
}

/** The fight's one-line tutorial is shown until the first fight is over (this device, once). */
const FIGHT_COACH_KEY = "cv-lake-fight-coach";
let fightCoachSeen = false;
function coachSeenFight(): boolean {
  if (fightCoachSeen) return true;
  try {
    return localStorage.getItem(FIGHT_COACH_KEY) === "1";
  } catch {
    return false;
  }
}
function markFightCoach(): void {
  fightCoachSeen = true;
  try {
    localStorage.setItem(FIGHT_COACH_KEY, "1");
  } catch {
    // private mode: the tutorial shows again next page load
  }
}

function forEachAnglerSpots(me: string, out: Set<number>): void {
  forEachAngler((sid, v: FishView) => {
    if (sid !== me && v.spot >= 0) out.add(v.spot);
  });
}

/**
 * The big button's rectangle on a phone: 84 px, centred over the jump button, its bottom where the 60 px action circle's is (12 px
 * above the jump button) — or, on a narrow screen where the emoji button sits beside the action circle on a row of its own, above
 * that button (8 px clear of it), so the thumb targets never touch.
 */
export function bigRect(
  layout: { action: Rect; jump: Rect; emoji: Rect; narrow: boolean },
  vw: number,
): Rect {
  const size = 84;
  const bottom = layout.narrow ? Math.min(layout.action.y + layout.action.h, layout.emoji.y - 8) : layout.action.y + layout.action.h;
  const cx = layout.jump.x + layout.jump.w / 2;
  const x = Math.max(8, Math.min(vw - 8 - size, cx - size / 2));
  return { x, y: bottom - size, w: size, h: size };
}

function LakeButton({
  spec,
  rect,
  shake,
  progress,
  fight,
  onPress,
  onHold,
  onPointer,
}: {
  spec: LakeButtonSpec;
  rect: { x: number; y: number; w: number; h: number } | null;
  shake: number;
  progress: number | undefined;
  /** The fight prompt: the button alone guides the fight (gold "당기세요", blue "놓아주세요", the line's tension inside, a pulse at every switch). */
  fight: FightPrompt | null;
  onPress: () => void;
  onHold: (down: boolean) => void;
  onPointer: (down: boolean) => void;
}) {
  const ring = spec.hold ? Math.round((fight ? fight.progress : progress ?? 0) * 100) : 0;
  const tension = fight ? Math.round(fight.tension * 100) : 0;
  const level = fight ? tensionLevel(fight.tension) : "calm";
  const fightAttrs = fight
    ? { "data-fight-cmd": fight.kind, "data-fight-tension": tension, "data-fight-progress": Math.round(fight.progress * 100), "data-fight-stage": `${fight.index + 1}/${fight.stages}` }
    : {};
  return (
    <button
      key={spec.id}
      type="button"
      data-lake-btn={spec.id}
      data-lake-tone={spec.tone}
      {...fightAttrs}
      className={`cv-lake-btn tone-${spec.tone}${isTouchDevice ? " is-touch" : ""}${spec.enabled ? "" : " is-off"}${spec.hold ? " is-hold" : ""}${shake ? ` shake-${shake % 2}` : ""}${fight ? ` is-fight tension-${level} sw-${fight.index % 2}${fight.inGrace ? " is-grace" : ""}` : ""}`}
      style={{ ...(rect ? rectStyle({ ...rect }) : {}), ["--cv-lake-ring" as string]: `${ring}%`, ["--cv-fight-tension" as string]: `${tension}%` }}
      aria-disabled={!spec.enabled}
      aria-label={spec.label}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        onPointer(true);
        if (!spec.enabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (spec.hold) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // a pointer that is already gone: the up / cancel below ends the hold
          }
          onHold(true);
        }
      }}
      onPointerUp={() => spec.hold && onHold(false)}
      onPointerCancel={() => spec.hold && onHold(false)}
      onLostPointerCapture={() => spec.hold && onHold(false)}
      onClick={() => {
        if (spec.enabled && !spec.hold) onPress();
      }}
    >
      <span className="cv-lake-icon" aria-hidden="true">
        {spec.icon}
      </span>
      <span className="cv-lake-text">{spec.label}</span>
      {!isTouchDevice && <kbd>{spec.key === "Space" ? "E · Space" : spec.key}</kbd>}
    </button>
  );
}
