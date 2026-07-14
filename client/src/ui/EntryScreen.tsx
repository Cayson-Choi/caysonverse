import { useState } from "react";
import { useGLTF } from "@react-three/drei";
import { APP_NAME, TINT_COLORS } from "@caysonverse/shared/constants";
import { CHARACTERS } from "../game/constants";
import { validateEntry } from "./validation";
import { joinWorld } from "../net/connection";
import { useAppStore } from "../stores/appStore";
import "./entry.css";

const STORAGE_KEY = "cv.entry";

interface SavedEntry {
  nickname: string;
  character: number;
  tint: number;
}

/** Load the last-used selection for prefill (best-effort; never throws). */
function loadSaved(): SavedEntry {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedEntry>;
      return {
        nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
        character: Number.isInteger(parsed.character) ? (parsed.character as number) : 0,
        tint: Number.isInteger(parsed.tint) ? (parsed.tint as number) : 0,
      };
    }
  } catch {
    // ignore malformed/absent storage
  }
  return { nickname: "", character: 0, tint: 0 };
}

function persist(entry: SavedEntry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // storage may be unavailable (private mode); non-fatal
  }
}

export function EntryScreen() {
  const enterWorld = useAppStore((s) => s.enterWorld);
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);

  const [saved] = useState(loadSaved);
  const [nickname, setNickname] = useState(saved.nickname);
  const [character, setCharacter] = useState(saved.character);
  const [tint, setTint] = useState(saved.tint);
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
    persist(result.value);

    try {
      // Warm the model cache so the world scene has no load stall.
      useGLTF.preload(CHARACTERS[character].model);
      const room = await joinWorld(result.value);
      enterWorld({ ...result.value, sessionId: room.sessionId });
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
