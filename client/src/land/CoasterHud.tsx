import { useEffect, useState, useSyncExternalStore } from "react";
import { isTouchDevice } from "../device";
import { getRoom, sendRideLeave } from "../net/connection";
import { VillageServerMsg, type RideNoticePayload } from "@caysonverse/shared/village/messages";
import { COASTER_DWELL_MS, COASTER_SEATS } from "@caysonverse/shared/land/coaster";
import { CAROUSEL_DWELL_MS } from "@caysonverse/shared/land/carousel";
import { coasterNow, landPose, rideComfort, rideNotice, rideReserved, selfRide, setRideComfort, subscribeRideComfort, type RideComfort } from "./coasterRide";
import { rideMuted, setRideMuted } from "./coasterAudio";
import { useLocalArea } from "../village/villageArea";
import { RIDES, msUntilBoarding, rideById } from "@caysonverse/shared/land/rides";
import { villageClock } from "../village/villageClock";
import { boardRide } from "./rideBoardWalk";
import { useParkReady } from "./parkReady";
import { wheelSeatPose } from "@caysonverse/shared/land/wheel";
import { MOON_DWELL_MS } from "@caysonverse/shared/land/moonBoat";

const NOTICE_TEXT = {
  closed: "지금은 탈 수 없어요. 다음 출발을 기다려 주세요.",
  full: `자리가 가득 찼어요. 다음 번에 타요. (${COASTER_SEATS}석 이하)`,
  busy: "앉아 있거나 버스·낚시 중에는 탈 수 없어요.",
  aloft: "높이 떠 있을 땐 내릴 수 없어요. 바닥에 닿으면 내릴 수 있어요.",
  reserved: "자리를 맡아뒀어요. 다음 탑승 때 자동으로 타요.",
  far: "탑승 위치로 가까이 가 주세요.",
} as const;

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

const box = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(20, 28, 52, 0.84)",
  color: "#fff",
  fontSize: isTouchDevice ? 12 : 12.5,
  lineHeight: 1.35,
  pointerEvents: "auto" as const,
  maxWidth: isTouchDevice ? 200 : 240,
};
const btn = {
  border: 0,
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: isTouchDevice ? 14 : 13,
  background: "rgba(255,255,255,0.93)",
  color: "#1b2147",
  minHeight: isTouchDevice ? 48 : 34,
} as const;

/**
 * The coaster's panel in the HUD column. TEMPORARY TEST ENTRY (DESIGN.md section 9): mounted only with `?land=coaster` in the address;
 * shows the next departure and a boarding button wherever you stand (phase 2 puts boarding at the park's queue gate, by walking in).
 * Riding: the way off (always there), the comfort setting, the sound switch, and what the ride is doing.
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
  const [muted, setMuted] = useState(rideMuted());
  // a phone keeps the panel small (it lies over the ground a thumb taps): the other rides are behind one button
  const [more, setMore] = useState(false);
  const riding = selfRide.slot >= 0;
  // the ride in question: the one I sit on, else the nearest whose boarding pad is within sight (70 m)
  const wall = villageClock.liveMs();
  let def = riding ? (rideById(selfRide.ride) ?? RIDES[0]!) : null;
  if (!def && area === "park") {
    let best = 400; // the whole park: the nearest ride is always shown, with the way to it
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
  const noticeFresh = rideNotice.reason !== null && performance.now() - rideNotice.at < 4500;
  const icon = def?.key === "carousel" ? "🎠" : def?.key === "wheel" ? "🎡" : def?.key === "moonboat" ? "🌙" : "🎢";
  const isCoaster = !def || def.key === "coaster";
  const waitMs = def && now.status !== "boarding" ? msUntilBoarding(def, wall) : null;
  const waitSecs = waitMs === null ? null : Math.max(1, Math.ceil(waitMs / 1000));
  const isWheel = def?.key === "wheel";
  const padDist = def ? Math.hypot(landPose.x - def.pad.x, landPose.z - def.pad.z) : 0;
  const ddx = def ? def.pad.x - landPose.x : 0;
  const ddz = def ? def.pad.z - landPose.z : 0;
  // the compass's words: north is -z, east +x
  const dirWord = `${Math.abs(ddz) > Math.abs(ddx) * 0.45 ? (ddz < 0 ? "북" : "남") : ""}${Math.abs(ddx) > Math.abs(ddz) * 0.45 ? (ddx > 0 ? "동" : "서") : ""}`;
  const aloft = riding && !!def?.canLeave && !def.canLeave(selfRide.slot, wall);
  if (!riding) {
    if (!def) return null;
    return (
      <div style={box} data-testid="coaster-hud">
        <div>
          {icon} {def.name}
        </div>
        <div style={{ opacity: 0.8 }}>
          {now.status === "boarding" && `탑승 중 · ${secs}초 뒤 출발`}
          {now.status === "gate" && `곧 출발해요 (${secs}초) · 다음 탑승을 기다려요`}
          {(now.status === "unloading" || now.status === "riding" || now.status === "gate") && waitSecs !== null && (
            <div data-testid="ride-countdown">{rideReserved.key === def.key ? `자리를 맡았어요 · ${waitSecs}초 뒤 자동 탑승` : `다음 탑승까지 ${waitSecs}초`}</div>
          )}
        </div>
        <div style={{ opacity: 0.7 }}>
          {padDist > 45 ? `${dirWord} 쪽으로 ${Math.round(padDist)}m · 놀이기구를 눌러도 걸어가요` : isTouchDevice ? "놀이기구를 누르거나 타기 버튼을 눌러요" : "놀이기구를 누르거나 E 키를 눌러요"}
        </div>
        <button type="button" data-testid={`ride-go-${def.key}`} style={{ ...btn, marginTop: 6, width: "100%", fontSize: 13 }} onClick={() => boardRide(def!.key, landPose.x, landPose.z)}>
          {padDist > 45 ? "걸어가서 타기" : "타기"}
        </button>
        {isTouchDevice ? (
          <button type="button" data-testid="ride-more" style={{ ...btn, marginTop: 4, width: "100%", fontSize: 12, background: "rgba(255,255,255,0.2)", color: "#fff" }} onClick={() => setMore(!more)}>
            {more ? "다른 놀이기구 접기 ▲" : "다른 놀이기구 ▼"}
          </button>
        ) : null}
        {(!isTouchDevice || more ? RIDES.filter((r) => r.seats > 0 && r.key !== def!.key) : []).map((r) => {
          const od = Math.hypot(landPose.x - r.pad.x, landPose.z - r.pad.z);
          return (
            <button key={r.key} type="button" data-testid={`ride-go-${r.key}`} style={{ ...btn, marginTop: 4, width: "100%", fontSize: 12, textAlign: "left" }} onClick={() => boardRide(r.key, landPose.x, landPose.z)}>
              {r.key === "carousel" ? "🎠" : r.key === "wheel" ? "🎡" : r.key === "moonboat" ? "🌙" : "🎢"} {r.name} · {Math.round(od)}m · {od > 45 ? "걸어가서 타기" : "타기"}
            </button>
          );
        })}
        {noticeFresh ? (
          <div role="alert" data-testid="coaster-notice" style={{ marginTop: 5, background: "rgba(255,196,64,0.28)", borderRadius: 8, padding: "5px 8px" }}>
            {NOTICE_TEXT[rideNotice.reason!]}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={box} data-testid="coaster-ride-hud">
      <div>
        {icon} {def?.name} 탑승 중
      </div>
      {/* a phone keeps the panel small: the ride is the view */}
      {isTouchDevice ? null : (
        <>
          <div style={{ opacity: 0.8 }}>
            {isWheel
              ? aloft
                ? `${Math.round(wheelSeatPose(selfRide.slot, wall).y)}m 높이 · 한 바퀴 돌면 내려요`
                : "승강장이에요 · 내릴 수 있어요"
              : now.status === "riding"
                ? `${Math.max(0, Math.round((now.phase - (isCoaster ? COASTER_DWELL_MS : def?.key === "moonboat" ? MOON_DWELL_MS : CAROUSEL_DWELL_MS)) / 1000))}초 · ${isCoaster ? "안전바를 잡고 있어요" : def?.key === "moonboat" ? "배가 점점 크게 흔들려요" : "말이 오르내려요"}`
                : now.status === "gate"
                  ? `곧 출발해요 (${secs}초)`
                  : "출발을 기다리는 중이에요"}
          </div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>화면을 끌면 둘러볼 수 있어요</div>
        </>
      )}
      <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: isCoaster ? "1fr 1fr" : "1fr", gap: 4 }}>
        {isCoaster ? <button type="button" data-testid="coaster-comfort" style={{ ...btn, fontSize: 12 }} onClick={() => setRideComfort(((comfort + 1) % 3) as RideComfort)}>
          {isTouchDevice ? COMFORT_SHORT[comfort] : COMFORT_LABEL[comfort]}
        </button> : null}
        <button
          type="button"
          style={{ ...btn, fontSize: 12 }}
          onClick={() => {
            setRideMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? "소리 켜기" : "소리 끄기"}
        </button>
      </div>
      <button type="button" data-testid="coaster-leave" disabled={aloft} style={{ ...btn, marginTop: 6, width: "100%", background: aloft ? "#e6e1dc" : "#ffd9d2", opacity: aloft ? 0.6 : 1 }} onClick={() => sendRideLeave()}>
        {aloft ? "높이 떠 있어요" : isWheel ? "내리기" : now.status === "riding" ? "비상 내리기" : "내리기"}
      </button>
    </div>
  );
}

/** Until the park's world has loaded: a veil with a short line (so the void is not mistaken for a broken park). */
export function ParkLoadingVeil() {
  const area = useLocalArea();
  const ready = useParkReady();
  if (area !== "park" || ready) return null;
  return (
    <div
      data-testid="park-loading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(#b8c8e8, #e9eef8)",
        color: "#26305e",
        fontSize: 18,
        fontWeight: 600,
        pointerEvents: "none",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 38 }}>🎡</div>
        <div>케이슨랜드를 불러오는 중이에요…</div>
        <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.75, marginTop: 6 }}>놀이기구와 꽃밭을 준비하고 있어요</div>
      </div>
    </div>
  );
}
