import { useEffect, useState, useSyncExternalStore } from "react";
import { isTouchDevice } from "../device";
import { getRoom, sendRideBoard, sendRideLeave } from "../net/connection";
import { VillageServerMsg, type RideNoticePayload } from "@caysonverse/shared/village/messages";
import { COASTER_DWELL_MS, COASTER_SEATS } from "@caysonverse/shared/land/coaster";
import { coasterNow, rideComfort, rideNotice, selfRide, setRideComfort, subscribeRideComfort, type RideComfort } from "./coasterRide";
import { rideMuted, setRideMuted, startRideAudio } from "./coasterAudio";

const NOTICE_TEXT = {
  closed: "지금은 탈 수 없어요. 다음 출발을 기다려 주세요.",
  full: `자리가 가득 찼어요 (${COASTER_SEATS}석). 다음 번에 타요.`,
  busy: "앉아 있거나 버스·낚시 중에는 탈 수 없어요.",
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
  useTick();
  useEffect(() => {
    const r = getRoom();
    if (!r) return undefined;
    return r.onMessage(VillageServerMsg.RideNotice, (m: RideNoticePayload) => {
      rideNotice.reason = m.reason;
      rideNotice.at = performance.now();
    });
  }, []);
  const comfort = useSyncExternalStore(subscribeRideComfort, rideComfort, rideComfort);
  const [muted, setMuted] = useState(rideMuted());
  const now = coasterNow();
  const riding = selfRide.slot >= 0;
  const secs = Math.max(0, Math.ceil(now.departsInMs / 1000));
  const noticeFresh = rideNotice.reason !== null && performance.now() - rideNotice.at < 4500;
  if (!riding) {
    const boarding = now.status === "boarding";
    return (
      <div style={box} data-testid="coaster-hud">
        <div>🎢 별똥별 급행 (시험 운행)</div>
        <div style={{ opacity: 0.8 }}>
          {now.status === "unloading" && `손님이 내리는 중 · ${secs}초 뒤 출발`}
          {now.status === "boarding" && `탑승 중 · ${secs}초 뒤 출발`}
          {now.status === "gate" && `곧 출발해요 (${secs}초)`}
          {now.status === "riding" && `운행 중 · 다음 출발까지 ${secs}초`}
        </div>
        {noticeFresh ? (
          <div role="alert" data-testid="coaster-notice" style={{ marginTop: 5, background: "rgba(255,196,64,0.28)", borderRadius: 8, padding: "5px 8px" }}>
            {NOTICE_TEXT[rideNotice.reason!]}
          </div>
        ) : null}
        <button
          type="button"
          data-testid="coaster-board"
          style={{ ...btn, marginTop: 6, width: "100%", opacity: boarding ? 1 : 0.6 }}
          onClick={() => {
            startRideAudio(); // inside the press: the browser lets the sound start
            sendRideBoard();
          }}
        >
          탑승하기
        </button>
      </div>
    );
  }
  return (
    <div style={box} data-testid="coaster-ride-hud">
      <div>🎢 별똥별 급행 탑승 중</div>
      {/* a phone keeps the panel small: the ride is the view */}
      {isTouchDevice ? null : (
        <>
          <div style={{ opacity: 0.8 }}>
            {now.status === "riding" ? `${Math.max(0, Math.round((now.phase - COASTER_DWELL_MS) / 1000))}초 · 안전바를 잡고 있어요` : now.status === "gate" ? `곧 출발해요 (${secs}초)` : "출발을 기다리는 중이에요"}
          </div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>화면을 끌면 둘러볼 수 있어요</div>
        </>
      )}
      <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        <button type="button" data-testid="coaster-comfort" style={{ ...btn, fontSize: 12 }} onClick={() => setRideComfort(((comfort + 1) % 3) as RideComfort)}>
          {isTouchDevice ? COMFORT_SHORT[comfort] : COMFORT_LABEL[comfort]}
        </button>
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
      <button type="button" data-testid="coaster-leave" style={{ ...btn, marginTop: 6, width: "100%", background: "#ffd9d2" }} onClick={() => sendRideLeave()}>
        {now.status === "riding" ? "비상 내리기" : "내리기"}
      </button>
    </div>
  );
}
