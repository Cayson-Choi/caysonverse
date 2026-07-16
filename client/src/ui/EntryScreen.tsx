import { useState } from "react";
import { useGLTF } from "@react-three/drei";
import { APP_NAME, TINT_COLORS } from "@caysonverse/shared/constants";
import { CHARACTERS, CROWN_MODEL } from "../game/constants";
import { validateEntry } from "./validation";
import { joinWorld } from "../net/connection";
import { clearKicked } from "../net/kickSeam";
import { rememberAdminCode, forgetAdminCode } from "../net/adminSession";
import { loadIdentity, saveIdentity } from "../net/identityCache";
import { useAppStore } from "../stores/appStore";
import "./entry.css";

export function EntryScreen() {
  const enterWorld = useAppStore((s) => s.enterWorld);
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);

  const [saved] = useState(loadIdentity);
  const [nickname, setNickname] = useState(saved.nickname);
  const [character, setCharacter] = useState(saved.character);
  const [tint, setTint] = useState(saved.tint);
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

    const result = validateEntry({ nickname, character, tint });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    clearNotice();
    setSubmitting(true);
    // Cache the identity so a reconnect after a server restart can silently
    // re-join with the same nickname/character/tint.
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
      // Warm the model cache so the world scene has no load stall. Royals also
      // need the crown GLB (attached to the head bone); it is tiny and cached once.
      useGLTF.preload(CHARACTERS[character].model);
      if (CHARACTERS[character].crown) useGLTF.preload(CROWN_MODEL);
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

        <fieldset className="cv-field cv-fieldset">
          <legend className="cv-label">캐릭터</legend>
          <div className="cv-characters">
            {CHARACTERS.map((preset, index) => (
              <button
                type="button"
                key={preset.id}
                className={"cv-character" + (index === character ? " is-selected" : "")}
                aria-pressed={index === character}
                onClick={() => {
                  setCharacter(index);
                  dismissMessages();
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="cv-field cv-fieldset">
          <legend className="cv-label">색상</legend>
          <div className="cv-swatches">
            {TINT_COLORS.map((color, index) => (
              <button
                type="button"
                key={color}
                className={"cv-swatch" + (index === tint ? " is-selected" : "")}
                style={{ background: color }}
                aria-label={`색상 ${index + 1}`}
                aria-pressed={index === tint}
                onClick={() => {
                  setTint(index);
                  dismissMessages();
                }}
              />
            ))}
          </div>
        </fieldset>

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
