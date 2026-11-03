import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { getActiveMap } from "../game/activeMap";
import { openMenu } from "../game/escape";
import { isTouchDevice } from "../device";
import { useUiStore } from "../stores/uiStore";
import type { Pose } from "../game/types";
import { HudButton } from "./HudButton";
import { RosterPanel, useRosterCount, useRosterHotkey } from "./RosterPanel";
import { ViewToggle } from "./ViewToggle";
import { OverviewToggle } from "./OverviewToggle";
import { SoundToggle } from "./SoundToggle";
import { useTouchHudLayout } from "./useTouchHudLayout";

/** How often the room name is re-read from the pose (ms) — off the frame path. */
const ZONE_POLL_MS = 250;

/** The name of the room the local player stands in (on the ACTIVE map), "" outside every room. */
function useZoneLabel(pose: Pose): string {
  const [label, setLabel] = useState(() => getActiveMap().zoneLabel(pose.x, pose.z));
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = getActiveMap().zoneLabel(pose.x, pose.z);
      setLabel((prev) => (prev === next ? prev : next));
    }, ZONE_POLL_MS);
    return () => window.clearInterval(id);
  }, [pose]);
  return label;
}

/** Room name chip + the 👥 button with the player count (it opens the roster list). */
function HudInfo({ pose }: { pose: Pose }) {
  const zone = useZoneLabel(pose);
  const count = useRosterCount();
  const rosterOpen = useUiStore((s) => s.rosterOpen);
  return (
    <div className="cv-hud-info">
      {zone && <span className="cv-hud-zone">{zone}</span>}
      <HudButton
        label={rosterOpen ? "접속자 목록 닫기" : `접속자 ${count}명 보기`}
        pressed={rosterOpen}
        className="cv-hud-people"
        onClick={() => useUiStore.getState().setRosterOpen(!rosterOpen)}
      >
        <span className="cv-hud-people-icon">👥</span>
        <span className="cv-hud-people-count">{count}</span>
      </HudButton>
    </div>
  );
}

/** ☰ — opens the menu (Esc does too). Closing is the menu's own 닫기 / Esc / backdrop. */
function MenuButton() {
  return (
    <HudButton label="메뉴 열기" onClick={openMenu}>
      ☰
    </HudButton>
  );
}

interface HudTopProps {
  /** The live local pose (read ~4×/s for the room name; never subscribed per frame). */
  pose: Pose;
  /** 👁 — first-person / third-person. */
  onToggleView: () => void;
  /** 🗺 — the overview map. */
  onToggleOverview: () => void;
  /** The overview is not available here (inside a building): the 🗺 chip is dimmed and does nothing. */
  overviewDisabled?: boolean;
  /** Rows under the 👥 / roster, in order: the touch chat-log toggle, the admin panel. */
  children?: ReactNode;
}

/**
 * The top of the screen (controls-ux Task 16).
 *  - Top-left column: room name + 👥 player count, the roster list when open, then whatever
 *    the world hangs under it (touch: the chat-log toggle; teachers: the admin panel).
 *  - Top-right: 👁 🗺 🔊 ☰ in one row, 8 px apart.
 * The announcement banner stays top-centre (banner.css).
 *
 * A PC lays both out in hud.css. A phone gets the numbers from game/hud.ts
 * `touchHudLayout` (the ones hud.test.ts checks): where the top group sits, which corner
 * the column hangs from (swapped when left-handed) and the button size. Also owns the Tab
 * key for the roster.
 */
export function HudTop({ pose, onToggleView, onToggleOverview, overviewDisabled, children }: HudTopProps) {
  useRosterHotkey();
  const layout = useTouchHudLayout();

  // The banner (top-centre) steps below the top row on a phone; it reads where that ends.
  const topEnd = layout.topGroup.y + layout.topGroup.h;
  useEffect(() => {
    if (!isTouchDevice) return;
    const root = document.documentElement;
    root.style.setProperty("--cv-hud-top-end", `${topEnd}px`);
    return () => {
      root.style.removeProperty("--cv-hud-top-end");
    };
  }, [topEnd]);

  const sizeVar = { "--cv-hud-btn": `${layout.topPx}px` } as CSSProperties;
  const columnStyle: CSSProperties | undefined = isTouchDevice
    ? {
        ...sizeVar,
        top: layout.column.top,
        maxHeight: layout.column.maxHeight,
        ...(layout.column.side === "left"
          ? { left: layout.column.inset, right: "auto" }
          : { right: layout.column.inset, left: "auto" }),
      }
    : undefined;
  const groupStyle: CSSProperties | undefined = isTouchDevice
    ? { ...sizeVar, left: layout.topGroup.x, top: layout.topGroup.y, right: "auto" }
    : undefined;

  return (
    <>
      <div
        className={"cv-hud-left" + (layout.column.side === "right" && isTouchDevice ? " is-right" : "")}
        style={columnStyle}
      >
        <HudInfo pose={pose} />
        <RosterPanel />
        {children}
      </div>
      <div
        className={"cv-hud-right" + (layout.column.side === "right" && isTouchDevice ? " is-mirrored" : "")}
        style={groupStyle}
      >
        <ViewToggle onToggle={onToggleView} />
        <OverviewToggle onToggle={onToggleOverview} disabled={overviewDisabled} />
        <SoundToggle />
        <MenuButton />
      </div>
    </>
  );
}
