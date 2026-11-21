import { useEffect, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { sendUseDoor } from "../net/connection";
import { HOUSE_ENTRY_TIMEOUT_MS, houseEntryFailed, resetHouseEntry, useHouseEntry } from "./houseEntry";
import { useLocalArea } from "./villageArea";
import { isHouseArea, isLotArea } from "@caysonverse/shared/village/villageLayout";
import { lotRoomOf } from "@caysonverse/shared/village/villageLots";
import "./villageKeypad.css";

/** The words under the cover while the house loads / after the wait ran out. */
export const HOUSE_ENTRY_TEXT = "집에 들어가는 중…";
export const HOUSE_ENTRY_FAILED_TEXT = "집 안을 불러오는 데 시간이 걸리고 있어요.";
export const LOT_ROOM_ENTRY_FAILED_TEXT = "건물 안을 불러오는 데 시간이 걸리고 있어요.";
export const ENTRY_WAIT_HINT = "조금 더 기다리거나, 아래 버튼으로 밖으로 나갈 수 있어요.";
export const ENTRY_LEAVE_LABEL = "밖으로 나가기";
/** A lot building's room may take this long (ms) to come in before the cover offers the way back out. */
export const LOT_ROOM_ENTRY_TIMEOUT_MS = 20_000;
/** After a press of the cover's way out that the server did not take (walked off the arrival spot meanwhile): the cover opens anyway (ms). */
const LEAVE_GIVE_UP_MS = 1800;

/**
 * The dark cover over the screen while a house loads (houseEntry.ts): "집에 들어가는 중…" until the floor is drawn. When that takes longer
 * than 8 s (a lot building's room: 20 s) or the model fails, the visitor is NOT sent back out by itself (owner 2026-11-21: "나가기버튼을
 * 누르지도 않았는데 나가버리고" — until then the cover gave up and used the door for them): the cover says so and shows a real "밖으로 나가기"
 * button, the only thing on it that takes a press. The room keeps loading meanwhile, and the cover opens the moment it is drawn.
 */
export function HouseEntryCover() {
  const entry = useHouseEntry();
  const area = useLocalArea();
  // a lot building's room (lots v2) has the houses' cover too: "<건물>에 들어가는 중…", a longer wait (its library sets are larger)
  const room = isLotArea(area) ? lotRoomOf(area) : null;
  const inHouse = isHouseArea(area) || room !== null;
  const loading = entry.phase === "loading";
  // The keypad's "ok" raised the cover but the server never moved us (nothing came of it): the cover must not stay.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      if (inHouse) {
        houseEntryFailed();
      } else {
        resetHouseEntry();
      }
    }, room ? LOT_ROOM_ENTRY_TIMEOUT_MS : HOUSE_ENTRY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading, inHouse, room]);
  // The wait ran out while inside: say so once (the chat keeps it); nothing is used on the visitor's behalf.
  useEffect(() => {
    if (entry.phase !== "failed") return;
    if (inHouse) useChatStore.getState().pushSystem(`${room ? LOT_ROOM_ENTRY_FAILED_TEXT : HOUSE_ENTRY_FAILED_TEXT} ${ENTRY_WAIT_HINT}`);
    else {
      const t = setTimeout(resetHouseEntry, 1600);
      return () => clearTimeout(t);
    }
  }, [entry.phase, inHouse]);
  // Back in the village (or somewhere else): nothing left to wait for.
  useEffect(() => {
    if (!inHouse && entry.phase !== "idle" && entry.phase !== "loading") resetHouseEntry();
  }, [inHouse, entry.phase]);
  // The cover's own way out (the visitor's press): the door from the arrival spot (the server accepts it there). Not taken (they walked
  // on under the cover): the cover opens on whatever is drawn, and the room's own 나가기 is at its door.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setLeaving(false);
      resetHouseEntry();
    }, LEAVE_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  useEffect(() => {
    if (entry.phase !== "failed") setLeaving(false);
  }, [entry.phase]);
  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    sendUseDoor({ loadFailed: true });
  };

  const shown = entry.phase === "loading" || entry.phase === "failed";
  return (
    <div
      className="cv-house-cover"
      role="status"
      aria-live="polite"
      aria-hidden={!shown}
      data-phase={entry.phase}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 46,
        display: "grid",
        placeItems: "center",
        background: "#0b0b14",
        color: "#f4f0ff",
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: ".02em",
        pointerEvents: "none",
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 120 : 320}ms ease-${shown ? "in" : "out"}`,
      }}
    >
      {shown ? (
        <div style={{ textAlign: "center" }}>
          <div>{entry.phase === "failed" ? (room ? LOT_ROOM_ENTRY_FAILED_TEXT : HOUSE_ENTRY_FAILED_TEXT) : room ? `${room.lot.name}에 들어가는 중…` : HOUSE_ENTRY_TEXT}</div>
          <div className="cv-house-cover-bar" />
          {entry.phase === "failed" && inHouse ? (
            <>
              <div style={{ marginTop: 14, fontSize: 13, fontWeight: 500, opacity: 0.85 }}>{ENTRY_WAIT_HINT}</div>
              <button
                type="button"
                className="cv-house-cover-leave"
                data-testid="house-cover-leave"
                disabled={leaving}
                onClick={leave}
                style={{ pointerEvents: "auto", marginTop: 16, minWidth: 148, minHeight: 48, padding: "0 20px", borderRadius: 14, border: "1px solid rgba(255,255,255,.35)", background: "#4b4fd8", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
              >
                {ENTRY_LEAVE_LABEL}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
