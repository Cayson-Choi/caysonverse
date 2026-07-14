import { useEffect, useState, useSyncExternalStore } from "react";
import { ANNOUNCE_MAX_LENGTH } from "@caysonverse/shared/constants";
import { sendAnnounce, sendKick } from "../net/connection";
import { getRoster, subscribeRoster, getRemoteRecord } from "../game/remoteStore";
import { setUiCaptured, captureReleaseEffect } from "../game/uiCapture";
import { useAppStore } from "../stores/appStore";
import "./admin.css";

interface Row {
  sid: string;
  nickname: string;
  isSelf: boolean;
}

/**
 * Instructor admin panel (top-left, collapsible). Rendered ONLY for the admin
 * (WorldScene gates on `isAdmin`), so no admin-only wiring runs for guests.
 *
 * Two tools:
 *  - Announce: a 300-char textarea (+counter) with [공지 보내기] / [공지 지우기].
 *    Sending schema state (not a broadcast) means late joiners see the banner.
 *  - Kick: the live roster (self + remotes). Each remote row has a [강퇴] button
 *    with an inline confirm step; the self row shows "(나)" and no kick button.
 *
 * Focus guard: any focus inside the panel sets the same UI-capture flag the chat
 * input uses (uiCapture.ts), so typing an announcement never walks the avatar.
 * On focus leaving the panel entirely the flag is released.
 */
export function AdminPanel() {
  const identity = useAppStore((s) => s.identity);
  const roster = useSyncExternalStore(subscribeRoster, getRoster, getRoster);

  const [open, setOpen] = useState(true);
  const [text, setText] = useState("");
  const [confirmSid, setConfirmSid] = useState<string | null>(null);

  // Release the UI-capture flag if the panel unmounts while a field is focused
  // (a reconnect epoch bump remounts the scene, or the instructor loses admin) —
  // browsers fire no focusout for a removed element, so handleBlur never runs.
  useEffect(captureReleaseEffect, []);

  if (!identity) return null;

  const rows: Row[] = [
    { sid: identity.sessionId, nickname: identity.nickname, isSelf: true },
    ...roster.map((sid) => ({
      sid,
      nickname: getRemoteRecord(sid)?.nickname ?? sid,
      isSelf: false,
    })),
  ];

  function handleFocus() {
    setUiCaptured(true);
  }
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Only release when focus leaves the panel entirely (not between children).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setUiCaptured(false);
  }

  function kick(sid: string) {
    sendKick(sid);
    setConfirmSid(null);
  }

  return (
    <div className="cv-admin" onFocus={handleFocus} onBlur={handleBlur}>
      <button
        type="button"
        className="cv-admin-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>관리자</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="cv-admin-body">
          <section className="cv-admin-section">
            <span className="cv-admin-title">공지</span>
            <textarea
              className="cv-admin-textarea"
              value={text}
              placeholder="모두에게 보여줄 공지를 입력하세요"
              maxLength={ANNOUNCE_MAX_LENGTH}
              rows={3}
              aria-label="공지 내용"
              onChange={(e) => setText(e.target.value.slice(0, ANNOUNCE_MAX_LENGTH))}
            />
            <div className="cv-admin-row-between">
              <span className="cv-admin-counter">
                {text.length}/{ANNOUNCE_MAX_LENGTH}
              </span>
              <div className="cv-admin-actions">
                <button
                  type="button"
                  className="cv-admin-btn is-primary"
                  disabled={text.trim().length === 0}
                  onClick={() => sendAnnounce(text)}
                >
                  공지 보내기
                </button>
                <button
                  type="button"
                  className="cv-admin-btn"
                  onClick={() => {
                    sendAnnounce("");
                    setText("");
                  }}
                >
                  공지 지우기
                </button>
              </div>
            </div>
          </section>

          <section className="cv-admin-section">
            <span className="cv-admin-title">참가자 ({rows.length})</span>
            <ul className="cv-admin-users">
              {rows.map((row) => (
                <li key={row.sid} className="cv-admin-user">
                  <span className="cv-admin-nick">
                    {row.nickname}
                    {row.isSelf && <span className="cv-admin-me"> (나)</span>}
                  </span>
                  {!row.isSelf &&
                    (confirmSid === row.sid ? (
                      <span className="cv-admin-confirm">
                        <button
                          type="button"
                          className="cv-admin-btn is-danger"
                          onClick={() => kick(row.sid)}
                        >
                          확인
                        </button>
                        <button
                          type="button"
                          className="cv-admin-btn"
                          onClick={() => setConfirmSid(null)}
                        >
                          취소
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="cv-admin-btn is-danger-outline"
                        onClick={() => setConfirmSid(row.sid)}
                      >
                        강퇴
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
