import { useEffect } from "react";
import { useChatStore } from "../stores/chatStore";
import { sendUseDoor } from "../net/connection";
import { HOUSE_ENTRY_TIMEOUT_MS, houseEntryFailed, resetHouseEntry, useHouseEntry } from "./houseEntry";
import { useLocalArea } from "./villageArea";
import { isHouseArea } from "@caysonverse/shared/village/villageLayout";
import "./villageKeypad.css";

/** The words under the cover while the house loads / after it gave up. */
export const HOUSE_ENTRY_TEXT = "집에 들어가는 중…";
export const HOUSE_ENTRY_FAILED_TEXT = "집 안을 불러오지 못했어요. 다시 시도해 주세요.";

/**
 * The dark cover over the screen while a house loads (houseEntry.ts): "집에 들어가는 중…" until the floor is drawn, at most 8 s, then the
 * player is sent back to the porch ("다시 시도해 주세요"). It takes no press (pointer-events none), like the door's curtain.
 */
export function HouseEntryCover() {
  const entry = useHouseEntry();
  const area = useLocalArea();
  const inHouse = isHouseArea(area);
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
    }, HOUSE_ENTRY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading, inHouse]);
  // Given up while inside the house: the way out from the arrival spot (the server accepts it there), with the usual curtain.
  useEffect(() => {
    if (entry.phase !== "failed") return;
    if (inHouse) {
      useChatStore.getState().pushSystem(HOUSE_ENTRY_FAILED_TEXT);
      sendUseDoor();
    }
    const t = setTimeout(resetHouseEntry, 1600);
    return () => clearTimeout(t);
  }, [entry.phase, inHouse]);
  // Back in the village (or somewhere else): nothing left to wait for.
  useEffect(() => {
    if (!inHouse && entry.phase !== "idle" && entry.phase !== "loading") resetHouseEntry();
  }, [inHouse, entry.phase]);

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
          <div>{entry.phase === "failed" ? HOUSE_ENTRY_FAILED_TEXT : HOUSE_ENTRY_TEXT}</div>
          {entry.phase === "loading" ? <div className="cv-house-cover-bar" /> : null}
        </div>
      ) : null}
    </div>
  );
}
