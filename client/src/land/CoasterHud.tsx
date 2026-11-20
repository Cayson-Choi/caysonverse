import { useEffect, useState, useSyncExternalStore } from "react";
import { isTouchDevice } from "../device";
import { getRoom, sendRideLeave } from "../net/connection";
import { VillageServerMsg, type RideNoticePayload } from "@caysonverse/shared/village/messages";
import { COASTER_DWELL_MS } from "@caysonverse/shared/land/coaster";
import { CAROUSEL_DWELL_MS } from "@caysonverse/shared/land/carousel";
import { MOON_DWELL_MS } from "@caysonverse/shared/land/moonBoat";
import { DROP_DWELL_MS } from "@caysonverse/shared/land/dropTower";
import { coasterNow, landPose, rideComfort, rideNotice, rideReserved, selfRide, setRideComfort, subscribeRideComfort, type RideComfort } from "./coasterRide";
import { rideMuted, setRideMuted } from "./coasterAudio";
import { useSoundStore } from "../stores/soundStore";
import { useLocalArea } from "../village/villageArea";
import { RIDES, msUntilBoarding, rideById, type RideDef } from "@caysonverse/shared/land/rides";
import { villageClock } from "../village/villageClock";
import { boardRide } from "./rideBoardWalk";
import { rideSchedule } from "./rideSchedule";
import { wheelSeatPose } from "@caysonverse/shared/land/wheel";
import "./ridePanel.css";

/** What a refused board says: one short line, shown once in the panel's toast (a reservation is shown by the status line, never repeated here). */
const NOTICE_TEXT: Record<Exclude<RideNoticePayload["reason"], "reserved">, string> = {
  closed: "지금은 탈 수 없어요. 다음 출발을 기다려요.",
  full: "자리가 가득 찼어요. 다음 번에 타요.",
  busy: "앉아 있거나 버스·낚시 중에는 탈 수 없어요.",
  aloft: "높이 떠 있을 땐 내릴 수 없어요.",
  far: "탑승 위치로 가까이 가 주세요.",
};

/** The ride's icon (a ride added later falls back to the coaster's). */
const RIDE_ICON: Record<string, string> = { coaster: "🎢", carousel: "🎠", wheel: "🎡", moonboat: "🌙", droptower: "☁️" };
export const rideIcon = (key: string): string => RIDE_ICON[key] ?? "🎢";

/** Re-render ~4 times a second (the countdown). */
function useTick(ms = 250): void {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

const COMFORT_LABEL: Record<RideComfort, string> = { 0: "움직임 끔", 1: "움직임 약하게", 2: "움직임 실감나게" };
const COMFORT_SHORT: Record<RideComfort, string> = { 0: "흔들 끔", 1: "흔들 약", 2: "흔들 강" };

/** The longest a wait has been seen to be (per ride): the bar fills as the wait runs down. */
const waitSeen = { key: "", max: 1 };

/** How far (m) a ride's pad may be and its button still reads as "타기" (past it: the walk). */
const NEAR_M = 45;

/**
 * The park's ride panel in the HUD column: the ride in question (the one I sit on, else the nearest) as a card: its icon and name, ONE status line (the
 * countdown, or the reservation, with a bar), one primary button that says what the press does (타기 / 자리 맡기 / 자리 취소 / 걸어가서 타기), one hint line,
 * and the other rides as compact rows (icon and name left, distance right). Riding: the way off (always there), the comfort setting and the sound switch.
 * Styles: ridePanel.css (no text selection, no wrapping, nothing clipped).
 */
export function CoasterHud() {
  const pose = landPose;
  const area = useLocalArea();
  useTick();
  useEffect(() => {
    const r = getRoom();
    if (!r) return undefined;
    return r.onMessage(VillageServerMsg.RideNotice, (m: RideNoticePayload) => {
      rideNotice.reason = m.reason;
      rideNotice.at = performance.now();
      if (m.reason === "reserved") {
        // the ride I stand at: the nearest boarding pad
        let best = Infinity;
        for (const ride of RIDES) {
          const d = Math.hypot(landPose.x - ride.pad.x, landPose.z - ride.pad.z);
          if (ride.seats > 0 && d < best) {
            best = d;
            rideReserved.key = ride.key;
            rideReserved.at = performance.now();
          }
        }
      }
    });
  }, []);
  const comfort = useSyncExternalStore(subscribeRideComfort, rideComfort, rideComfort);
  const [rideOnlyMuted, setMuted] = useState(rideMuted());
  // the menu's master 소리 switch silences the rides too; the panel's button then shows (and undoes) that
  const masterMuted = useSoundStore((s) => s.muted);
  const muted = rideOnlyMuted || masterMuted;
  // a phone keeps the card small (it lies over the ground a thumb taps): the whole card folds to its title and status, and the other rides sit behind one row
  const [more, setMore] = useState(false);
  const [folded, setFolded] = useState(false);
  const riding = selfRide.slot >= 0;
  // the ride in question: the one I sit on, else the nearest whose boarding pad is within sight (the whole park: the nearest ride is always shown, with the way to it)
  const wall = villageClock.liveMs();
  let def: RideDef | null = riding ? (rideById(selfRide.ride) ?? RIDES[0]!) : null;
  if (!def && area === "park") {
    let best = 400;
    for (const r of RIDES) {
      if (r.seats <= 0) continue;
      const d = Math.hypot(pose.x - r.pad.x, pose.z - r.pad.z);
      if (d < best) {
        best = d;
        def = r;
      }
    }
  }
  // a reservation ends when I sit, walk away from its pad, or after 8 minutes
  if (rideReserved.key !== null) {
    const rd = rideById(RIDES.find((r) => r.key === rideReserved.key)?.id ?? 0);
    if (selfRide.slot >= 0 || !rd || Math.hypot(landPose.x - rd.pad.x, landPose.z - rd.pad.z) > rd.pad.radius + rd.reach + 5 || performance.now() - rideReserved.at > 480_000) rideReserved.key = null;
  }
  const now = def ? def.statusAt(wall) : coasterNow();
  const secs = Math.max(0, Math.ceil(now.departsInMs / 1000));
  const isCoaster = !def || def.key === "coaster";
  const isWheel = def?.key === "wheel";
  const aloft = riding && !!def?.canLeave && !def.canLeave(selfRide.slot, wall);

  if (!riding) {
    if (!def) return null;
    const padDist = Math.hypot(landPose.x - def.pad.x, landPose.z - def.pad.z);
    const near = padDist <= NEAR_M;
    const boarding = now.status === "boarding";
    const reserved = rideReserved.key === def.key;
    const waitMs = !boarding ? msUntilBoarding(def, wall) : null;
    const waitSecs = waitMs === null ? null : Math.max(1, Math.ceil(waitMs / 1000));
    // the bar: how far the boarding window has run (open), or how far the wait has run down
    let frac = 0;
    if (boarding) frac = now.phase / Math.max(1, now.phase + now.departsInMs);
    else if (waitMs !== null) {
      if (waitSeen.key !== def.key || waitMs > waitSeen.max) {
        waitSeen.key = def.key;
        waitSeen.max = Math.max(waitMs, 1);
      }
      frac = 1 - waitMs / waitSeen.max;
    }
    let line: string;
    // a reserved seat is NOT a seat: the rider waits on the pad until the vehicle stands in its station and the loading begins (the server seats then)
    const vehicle = def.key === "coaster" ? "열차가" : def.key === "carousel" ? "회전목마가" : def.key === "wheel" ? "곤돌라가" : def.key === "moonboat" ? "달배가" : "낙하탑이";
    if (rideSchedule.skew) line = "놀이기구 시간표가 서버와 달라요";
    else if (reserved) line = now.status === "unloading" ? `자리 맡음 · 내리는 중이에요 · 곧 타요` : waitSecs !== null ? `자리 맡음 · ${vehicle} 도착하면 타요 · ${waitSecs}초 뒤` : "자리 맡음 · 곧 탑승해요";
    else if (boarding) line = `탑승 중 · ${secs}초 뒤 출발`;
    else line = waitSecs !== null ? `다음 탑승까지 ${waitSecs}초` : "잠시 쉬는 중이에요";
    const label = reserved ? "자리 취소" : !near ? "걸어가서 타기" : boarding ? "타기" : "자리 맡기";
    const ddx = def.pad.x - landPose.x;
    const ddz = def.pad.z - landPose.z;
    // the compass's words: north is -z, east +x
    const dirWord = `${Math.abs(ddz) > Math.abs(ddx) * 0.45 ? (ddz < 0 ? "북" : "남") : ""}${Math.abs(ddx) > Math.abs(ddz) * 0.45 ? (ddx > 0 ? "동" : "서") : ""}`;
    const hint = rideSchedule.skew
      ? "새로고침하거나 잠시 뒤 다시 와 주세요"
      : reserved
      ? "탑승 위치에서 기다려요"
      : !near
        ? `${dirWord}쪽 ${Math.round(padDist)}m · 놀이기구를 눌러도 가요`
        : !boarding
          ? "자리를 맡으면 열릴 때 자동으로 타요"
          : isTouchDevice
            ? "놀이기구나 타기 버튼을 눌러요"
            : "놀이기구를 누르거나 E 키를 눌러요";
    // a refused board: one toast, once (a reservation is the status line's business)
    const fresh = rideNotice.reason !== null && rideNotice.reason !== "reserved" && performance.now() - rideNotice.at < 4500;
    const others = RIDES.filter((r) => r.seats > 0 && r.key !== def!.key);
    const showList = !folded && (!isTouchDevice || more);
    return (
      <section className="cv-ride" data-testid="coaster-hud" aria-label={`${def.name} 탑승`}>
        <header className="cv-ride-head">
          <span className="cv-ride-ic" aria-hidden="true">{rideIcon(def.key)}</span>
          <strong className="cv-ride-name">{def.name}</strong>
          {isTouchDevice ? (
            <button type="button" className="cv-ride-fold" data-testid="ride-fold" aria-expanded={!folded} aria-label={folded ? "펼치기" : "접기"} onClick={() => setFolded(!folded)}>
              {folded ? "▾" : "▴"}
            </button>
          ) : null}
        </header>
        <div className="cv-ride-status">
          <div className="cv-ride-line" data-testid="ride-countdown">{line}</div>
          <div className={"cv-ride-bar" + (reserved ? " is-reserved" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
            <i style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
          </div>
        </div>
        {folded ? null : (
          <>
            <button
              type="button"
              data-testid={`ride-go-${def.key}`}
              disabled={rideSchedule.skew}
              className={"cv-ride-primary" + (reserved ? " is-quiet" : "")}
              onClick={() => {
                if (reserved) {
                  sendRideLeave();
                  rideReserved.key = null;
                } else boardRide(def!.key, landPose.x, landPose.z);
              }}
            >
              {label}
            </button>
            <p className="cv-ride-hint">{hint}</p>
            {isTouchDevice ? (
              <button type="button" className="cv-ride-more" data-testid="ride-more" aria-expanded={more} onClick={() => setMore(!more)}>
                {more ? "다른 놀이기구 접기 ▴" : "다른 놀이기구 ▾"}
              </button>
            ) : null}
            {showList ? (
              <ul className="cv-ride-list">
                {others.map((r) => {
                  const od = Math.hypot(landPose.x - r.pad.x, landPose.z - r.pad.z);
                  return (
                    <li key={r.key}>
                      <button type="button" className="cv-ride-row" data-testid={`ride-go-${r.key}`} disabled={rideSchedule.skew} onClick={() => boardRide(r.key, landPose.x, landPose.z)}>
                        <span className="cv-ride-ic" aria-hidden="true">{rideIcon(r.key)}</span>
                        <span className="cv-ride-rname">{r.name}</span>
                        <span className="cv-ride-dist">{Math.round(od)}m</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
        {fresh ? (
          <p role="alert" className="cv-ride-toast" data-testid="coaster-notice">
            {NOTICE_TEXT[rideNotice.reason as Exclude<RideNoticePayload["reason"], "reserved">]}
          </p>
        ) : null}
      </section>
    );
  }
  // riding: the way off (always there), the comfort setting, the sound switch, and what the ride is doing
  const state = isWheel
    ? aloft
      ? `${Math.round(wheelSeatPose(selfRide.slot, wall).y)}m 높이 · 한 바퀴 돌면 내려요`
      : "승강장이에요 · 내릴 수 있어요"
    : now.status === "riding"
      ? `${Math.max(0, Math.round((now.phase - (isCoaster ? COASTER_DWELL_MS : def?.key === "moonboat" ? MOON_DWELL_MS : def?.key === "droptower" ? DROP_DWELL_MS : CAROUSEL_DWELL_MS)) / 1000))}초 · ${isCoaster ? "안전바를 잡고 있어요" : def?.key === "moonboat" ? "배가 점점 크게 흔들려요" : def?.key === "droptower" ? "어깨 안전바를 잡고 있어요" : "말이 오르내려요"}`
      : now.status === "gate"
        ? `곧 출발해요 · ${secs}초`
        : "출발을 기다리는 중이에요";
  return (
    <section className="cv-ride" data-testid="coaster-ride-hud" aria-label={`${def?.name ?? ""} 탑승 중`}>
      <header className="cv-ride-head">
        <span className="cv-ride-ic" aria-hidden="true">{rideIcon(def?.key ?? "coaster")}</span>
        <strong className="cv-ride-name">{def?.name}</strong>
        <span className="cv-ride-badge">탑승 중</span>
      </header>
      {/* a phone keeps the card small: the ride is the view */}
      {isTouchDevice ? null : (
        <div className="cv-ride-status">
          <div className="cv-ride-line">{state}</div>
          <p className="cv-ride-hint">화면을 끌면 둘러볼 수 있어요</p>
        </div>
      )}
      <div className="cv-ride-tools">
        {isCoaster ? (
          <button type="button" className="cv-ride-tool" data-testid="coaster-comfort" onClick={() => setRideComfort(((comfort + 1) % 3) as RideComfort)}>
            {isTouchDevice ? COMFORT_SHORT[comfort] : COMFORT_LABEL[comfort]}
          </button>
        ) : null}
        <button
          type="button"
          className="cv-ride-tool"
          onClick={() => {
            if (masterMuted) useSoundStore.getState().toggleMuted();
            setRideMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? "소리 켜기" : "소리 끄기"}
        </button>
      </div>
      <button type="button" data-testid="coaster-leave" disabled={aloft} className={"cv-ride-primary" + (aloft ? "" : " is-danger")} onClick={() => sendRideLeave()}>
        {aloft ? "높이 떠 있어요" : isWheel ? "내리기" : now.status === "riding" ? "비상 내리기" : "내리기"}
      </button>
    </section>
  );
}
