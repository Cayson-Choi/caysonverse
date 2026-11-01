import { useState } from "react";
import { APP_NAME } from "@caysonverse/shared/constants";
import { primeChatAudio } from "../game/chatVoice";
import { preloadCharacterAssets } from "../game/useAvatar";
import { validateEntry } from "./validation";
import { joinWorld } from "../net/connection";
import { clearKicked } from "../net/kickSeam";
import { rememberAdminCode, forgetAdminCode } from "../net/adminSession";
import { loadIdentity, saveIdentity } from "../net/identityCache";
import { useAppStore } from "../stores/appStore";
import "./entry.css";

/**
 * Entry screen. TEMPORARY state (character stage 3, Task 6): the saved appearance
 * (or the default look) is sent as-is — the character builder replaces this form's
 * body in Task 7. The old preset grid, tint swatches and royal notice are gone.
 */
export function EntryScreen() {
  const enterWorld = useAppStore((s) => s.enterWorld);
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);

  const [saved] = useState(loadIdentity);
  const [nickname, setNickname] = useState(saved.nickname);
  // The look this entry sends: the cached one, or DEFAULT_APPEARANCE (loadIdentity
  // migrates a pre-builder or corrupt cache). Task 7's builder edits it.
  const [appearance] = useState(saved.appearance);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Editing the form dismisses any leftover kick/disconnect notice.
  function dismissMessages() {
    if (error) setError(null);
    if (notice) clearNotice();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Mobile autoplay policy: prime the speech engine (one silent utterance,
    // design 23) HERE, synchronously inside the click's user gesture — after an
    // await the gesture may no longer count. Safe no-op where SpeechSynthesis
    // is absent, and idempotent across repeated (e.g. failed-validation) clicks.
    primeChatAudio();

    const result = validateEntry({ nickname, appearance });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    clearNotice();
    setSubmitting(true);
    // Cache the identity so a reconnect after a server restart can silently
    // re-join with the same nickname and appearance.
    saveIdentity(result.value);

    // A deliberate manual entry clears any prior kick block (Task 11 seam).
    clearKicked();

    // Only supply a code when the admin field has one; a successful join with a
    // code proves it was correct (a wrong code is rejected server-side), so we
    // can infer admin status locally without the server leaking it.
    const trimmedCode = adminCode.trim();
    const asAdmin = trimmedCode.length > 0;
    const params = asAdmin ? { ...result.value, adminCode: trimmedCode } : result.value;

    try {
      // Warm the model cache so the world scene has no load stall: one character.glb
      // assembles every look (own and remote).
      preloadCharacterAssets();
      const room = await joinWorld(params);
      // A join that supplied a code AND succeeded proves the code was correct, so
      // remember it (module memory only) to re-authenticate on a Phase-2 fresh
      // rejoin after a server restart; a non-admin join clears any stale code.
      if (asAdmin) rememberAdminCode(trimmedCode);
      else forgetAdminCode();
      enterWorld({ ...result.value, sessionId: room.sessionId }, asAdmin);
      // On success this component unmounts; do not touch state afterwards.
    } catch (err) {
      setError(err instanceof Error ? err.message : "입장에 실패했습니다. 다시 시도해주세요.");
      setSubmitting(false);
    }
  }

  const message = error ?? notice;

  return (
    <div className="cv-entry">
      <form className="cv-card" onSubmit={handleSubmit}>
        <header className="cv-head">
          <h1 className="cv-title">{APP_NAME}</h1>
          <p className="cv-subtitle">함께 걷는 3D 메타버스에 입장하세요</p>
        </header>

        <label className="cv-field">
          <span className="cv-label">닉네임</span>
          <input
            className="cv-input"
            type="text"
            value={nickname}
            placeholder="2~12자"
            maxLength={12}
            autoFocus
            onChange={(e) => {
              setNickname(e.target.value);
              dismissMessages();
            }}
          />
        </label>

        <div className="cv-admin-toggle">
          {showAdmin ? (
            <label className="cv-field">
              <span className="cv-label">관리자 코드</span>
              <input
                className="cv-input"
                type="password"
                value={adminCode}
                placeholder="강사 전용"
                autoComplete="off"
                aria-label="관리자 코드"
                onChange={(e) => {
                  setAdminCode(e.target.value);
                  dismissMessages();
                }}
              />
            </label>
          ) : (
            <button
              type="button"
              className="cv-admin-link"
              onClick={() => setShowAdmin(true)}
            >
              관리자이신가요?
            </button>
          )}
        </div>

        {message && (
          <p className="cv-message" role="alert">
            {message}
          </p>
        )}

        <button className="cv-submit" type="submit" disabled={submitting}>
          {submitting ? "입장 중…" : "입장하기"}
        </button>
      </form>
    </div>
  );
}
