import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TEAM_MAX, type ClassCommand } from "@caysonverse/shared/escape/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { sendClass } from "../../net/connection";
import { acquireUiCapture, captureReleaseEffect, releaseUiCapture } from "../../game/uiCapture";
import { isTouchDevice } from "../../device";
import { useClassStore } from "../../stores/classStore";
import { AdminPanel } from "../AdminPanel";
import {
  ALL_TEAMS,
  mirrorLines,
  mirrorTabs,
  mirrorText,
  phaseButtons,
  phaseLabel,
  teamLocation,
  teamStarTotal,
} from "./teacherPanel";
import "./hub.css";

/** The keyboard owner name while focus is inside the panel (typing never walks the avatar). */
const CAPTURE_OWNER = "teacher";

type TabId = "run" | "teams" | "chat" | "results";
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "run", label: "진행" },
  { id: "teams", label: "팀" },
  { id: "chat", label: "채팅" },
  { id: "results", label: "결과" },
];

function command(cmd: ClassCommand): void {
  sendClass(ClassMsg.Command, { cmd });
}

function requestResults(): void {
  sendClass(ClassMsg.ResultsRequest, {});
}

/** Copy `text` to the clipboard (the async API where the page may use it, else the old way). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-1000px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ───────────────────────────────────── 진행 ─────────────────────────────────────

/** The end-of-class question: "결과 CSV를 먼저 받을까요?" — take the CSV first, end, or keep going. */
function EndConfirm({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    acquireUiCapture("teacher-end");
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== "Escape") return;
      e.preventDefault(); // consumed: Esc cancels this, it does not open the menu
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      releaseUiCapture("teacher-end");
      // The dialog's own focus must not leave the panel's hold behind: a focused element that is
      // removed fires no blur, so release it here — the teacher's WASD / E work again at once.
      releaseUiCapture(CAPTURE_OWNER);
    };
  }, [onClose]);

  // In the page body, not in the panel: the panel's glass (backdrop-filter) would make it the
  // containing block of a fixed overlay, so the veil would only cover the panel.
  return createPortal(
    <div
      className="cv-hub-veil cv-hubui"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // React bubbles a portal's focus events to the panel it was rendered from, which would
      // re-take the panel's keyboard hold every time focus moves inside the dialog.
      onFocus={(e) => e.stopPropagation()}
      onBlur={(e) => e.stopPropagation()}
    >
      <div className="cv-hub-sheet is-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cv-hub-end-title" ref={ref} tabIndex={-1}>
        <header className="cv-hub-head">
          <span className="cv-hub-badge is-warn" aria-hidden="true">
            🔔
          </span>
          <h2 className="cv-hub-title" id="cv-hub-end-title">
            수업을 끝낼까요?
          </h2>
        </header>
        <div className="cv-hub-body">
          <p className="cv-hub-lead">결과 CSV를 먼저 받을까요?</p>
          <p className="cv-hub-note">끝내면 학생들은 입장 화면으로 돌아가요.</p>
        </div>
        <footer className="cv-hub-foot is-split">
          <button type="button" className="cv-hub-btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cv-hub-btn" onClick={requestResults}>
            CSV 받기
          </button>
          <button
            type="button"
            className="cv-hub-btn is-danger"
            onClick={() => {
              command("end");
              onClose();
            }}
          >
            끝내기
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function RunTab() {
  const phase = useClassStore((s) => s.phase);
  const classCode = useClassStore((s) => s.classCode);
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const buttons = phaseButtons(phase);
  const closeEnd = useCallback(() => setConfirmEnd(false), []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <div className="cv-hub-tabbody">
      <section className="cv-hub-code" aria-label="반 코드">
        <span className="cv-hub-code-label">반 코드</span>
        <span className="cv-hub-code-value" aria-label={classCode.split("").join(" ")}>
          {classCode || "······"}
        </span>
        <button
          type="button"
          className="cv-hub-btn is-small"
          disabled={!classCode}
          onClick={() => void copyText(classCode).then((ok) => setCopied(ok))}
        >
          {copied ? "복사했어요" : "복사"}
        </button>
      </section>

      <div className="cv-hub-phase-row">
        <span className={`cv-hub-pill is-${phase}`}>{phaseLabel(phase)}</span>
        <div className="cv-hub-actions">
          {buttons.start && (
            <button type="button" className="cv-hub-btn is-primary" onClick={() => command("start")}>
              시작
            </button>
          )}
          {buttons.pause && (
            <button type="button" className="cv-hub-btn" onClick={() => command("pause")}>
              일시정지
            </button>
          )}
          {buttons.resume && (
            <button type="button" className="cv-hub-btn is-primary" onClick={() => command("resume")}>
              다시 시작
            </button>
          )}
          {buttons.end && (
            <button type="button" className="cv-hub-btn is-danger-outline" onClick={() => setConfirmEnd(true)}>
              수업 끝내기
            </button>
          )}
        </div>
      </div>

      <div className="cv-hub-admin">
        <AdminPanel defaultOpen={false} />
      </div>
      {confirmEnd && <EndConfirm onClose={closeEnd} />}
    </div>
  );
}

// ───────────────────────────────────── 팀 ─────────────────────────────────────

function TeamsTab() {
  const teams = useClassStore((s) => s.teams);
  const phase = useClassStore((s) => s.phase);
  const over = phase === "ended";
  return (
    <div className="cv-hub-tabbody">
      <div className="cv-hub-actions">
        <button type="button" className="cv-hub-btn is-primary" disabled={over} onClick={() => sendClass(ClassMsg.TeamAuto, { mode: "fill" })}>
          자동 배정
        </button>
        <button type="button" className="cv-hub-btn" disabled={over} onClick={() => sendClass(ClassMsg.TeamAuto, { mode: "shuffle" })}>
          섞기
        </button>
      </div>
      <p className="cv-hub-note">자동 배정은 팀이 없는 학생을, 섞기는 교실에 들어가지 않은 팀을 새로 짜요.</p>
      {teams.length === 0 ? (
        <p className="cv-hub-note">아직 만든 팀이 없어요.</p>
      ) : (
        <ul className="cv-hub-teams">
          {teams.map((t) => (
            <li className="cv-hub-team" key={t.id}>
              <span className="cv-hub-dot" style={{ background: t.color }} aria-hidden="true" />
              <span className="cv-hub-team-main">
                <span className="cv-hub-team-name">{t.name}</span>
                <span className="cv-hub-team-members">
                  있는 곳: {teamLocation(t)}
                  {t.escaped.length > 0 && ` · 탈출 ${t.escaped.length}곳`}
                </span>
              </span>
              <span className="cv-hub-count" aria-label={`${t.members.length}명, 최대 ${TEAM_MAX}명`}>
                {t.members.length}/{TEAM_MAX}
              </span>
              <span className="cv-hub-stars" aria-label={`별 ${teamStarTotal(t)}개`}>
                ⭐{teamStarTotal(t)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────────────── 채팅 ─────────────────────────────────────

function ChatTab() {
  const mirror = useClassStore((s) => s.mirror);
  const teams = useClassStore((s) => s.teams);
  const [selected, setSelected] = useState<string>(ALL_TEAMS);
  const tabs = useMemo(() => mirrorTabs(mirror, teams), [mirror, teams]);
  const lines = useMemo(() => mirrorLines(mirror, selected), [mirror, selected]);
  const listRef = useRef<HTMLUListElement>(null);

  // Newest at the bottom: keep it in view as lines arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="cv-hub-tabbody">
      <div className="cv-hub-chips" role="group" aria-label="팀 고르기">
        <button type="button" className="cv-hub-chip" aria-pressed={selected === ALL_TEAMS} onClick={() => setSelected(ALL_TEAMS)}>
          전체
        </button>
        {tabs.map((t) => (
          <button key={t.id || "hall"} type="button" className="cv-hub-chip" aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}>
            {t.name}
            {t.count > 0 && <span className="cv-hub-chip-count">{t.count}</span>}
          </button>
        ))}
      </div>
      {lines.length === 0 ? (
        <p className="cv-hub-note">아직 오간 말이 없어요. 팀 채팅이 여기에 모여요.</p>
      ) : (
        <ul className="cv-hub-chat" ref={listRef}>
          {lines.map((m, i) => (
            <li key={`${m.at}-${i}`} className={"cv-hub-chat-line" + (m.filtered ? " is-filtered" : "")}>
              {selected === ALL_TEAMS && <span className="cv-hub-chat-team">{m.teamName}</span>}
              <span className="cv-hub-chat-name">{m.name}</span>
              <span className="cv-hub-chat-text">{mirrorText(m)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────────────── 결과 ─────────────────────────────────────

function ResultsTab() {
  const litRooms = useClassStore((s) => s.litRooms);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked) return;
    const id = window.setTimeout(() => setAsked(false), 1600);
    return () => window.clearTimeout(id);
  }, [asked]);
  return (
    <div className="cv-hub-tabbody">
      <p className="cv-hub-lead">지금까지의 결과를 엑셀로 열 수 있는 파일로 받아요.</p>
      <button
        type="button"
        className="cv-hub-btn is-primary is-wide"
        onClick={() => {
          requestResults();
          setAsked(true);
        }}
      >
        {asked ? "요청했어요" : "결과 CSV 받기"}
      </button>
      <p className="cv-hub-note">탈출에 성공한 교실: {litRooms.length}곳</p>
    </div>
  );
}

/**
 * The teacher's panel (AI 학교 탈출, Task 16) — top-left, foldable, four tabs:
 *  - 진행: the class code (big, with 복사), the phase buttons that apply now (시작 · 일시정지 · 다시 시작 ·
 *    수업 끝내기 — which asks "결과 CSV를 먼저 받을까요?" first) and the existing 공지·강퇴 panel;
 *  - 팀: every team with where it is (중앙 홀 / the room), its n/6 and stars, 자동 배정 and 섞기;
 *  - 채팅: the team-chat mirror, a chip per team; a held-back line reads "⚠ 걸러진 말: ●●";
 *  - 결과: 결과 CSV 받기 (the file is saved when the server's answer arrives — classSync.ts).
 * HubScene mounts it for the teacher only; the server refuses anyone else's command anyway.
 * (The file is TeacherPanelView.tsx, not TeacherPanel.tsx: next to teacherPanel.ts, the pure half, a
 * case-insensitive file system — Windows, macOS — would resolve "./TeacherPanel" to the .ts file.)
 *
 * Focus inside the panel holds the keyboard (the AdminPanel's rule), so typing never walks the avatar.
 */
export function TeacherPanel() {
  const [open, setOpen] = useState(!isTouchDevice);
  const [tab, setTab] = useState<TabId>("run");

  useEffect(() => captureReleaseEffect(CAPTURE_OWNER), []);

  return (
    <div
      className="cv-hub-teacher cv-hubui"
      onFocus={() => acquireUiCapture(CAPTURE_OWNER)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        releaseUiCapture(CAPTURE_OWNER);
      }}
    >
      <button type="button" className="cv-hub-teacher-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="cv-hub-badge is-small" aria-hidden="true">
          🍎
        </span>
        <span>선생님</span>
        <span className="cv-hub-fold" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <>
          <div className="cv-hub-tabs" role="tablist" aria-label="선생님 메뉴">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`cv-hub-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="cv-hub-tabpanel"
                className="cv-hub-tab"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="cv-hub-tabpanel" id="cv-hub-tabpanel" role="tabpanel" aria-labelledby={`cv-hub-tab-${tab}`}>
            {tab === "run" && <RunTab />}
            {tab === "teams" && <TeamsTab />}
            {tab === "chat" && <ChatTab />}
            {tab === "results" && <ResultsTab />}
          </div>
        </>
      )}
    </div>
  );
}
