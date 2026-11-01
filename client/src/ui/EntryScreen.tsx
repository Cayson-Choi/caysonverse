import { useEffect, useRef, useState, type CSSProperties } from "react";
import { APP_NAME, NICKNAME_MAX } from "@caysonverse/shared/constants";
import type { Appearance } from "@caysonverse/shared/appearance";
import { primeChatAudio } from "../game/chatVoice";
import { preloadCharacterAssets } from "../game/useAvatar";
import { isTouchDevice } from "../device";
import { NICKNAME_ERROR, validateEntry, validateNickname } from "./validation";
import { BuilderPreview } from "./BuilderPreview";
import { BuilderPanel } from "./BuilderPanel";
import { BuilderIcon } from "./BuilderIcons";
import { BUILDER_COPY, ENTRY_ART, stageLayout, type StageLayout } from "./builderOptions";
import { joinWorld } from "../net/connection";
import { clearKicked } from "../net/kickSeam";
import { rememberAdminCode, forgetAdminCode } from "../net/adminSession";
import { loadIdentity, saveIdentity } from "../net/identityCache";
import { useAppStore } from "../stores/appStore";
import "./entry.css";
import "./builder.css";

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/** 배치(stageLayout) → .cv-entry의 CSS 변수. 무대 안 요소는 무대 상자(.cv-builder-preview) 기준 좌표를 쓴다. */
function layoutStyle(L: StageLayout): CSSProperties {
  const vars: Record<string, string> = {
    "--cv-topbar": px(L.topBar),
    "--cv-bg-x": px(L.bg.x),
    "--cv-bg-y": px(L.bg.y),
    "--cv-bg-w": px(L.bg.width),
    "--cv-bg-h": px(L.bg.height),
    "--cv-feet-x": px(L.feet.x),
    "--cv-feet-y": px(L.feet.y),
    "--cv-podium-w": px(L.podium.width),
    "--cv-podium-t": px(L.podium.thickness),
    "--cv-stage-x": px(L.stage.x),
    "--cv-stage-y": px(L.stage.y),
    "--cv-stage-w": px(L.stage.width),
    "--cv-stage-h": px(L.stage.height),
    "--cv-canvas-x": px(L.canvas.x - L.stage.x),
    "--cv-canvas-y": px(L.canvas.y - L.stage.y),
    "--cv-canvas-w": px(L.canvas.width),
    "--cv-canvas-h": px(L.canvas.height),
    "--cv-hint-x": px(L.hint.x - L.stage.x),
    "--cv-hint-y": px(L.hint.y - L.stage.y),
    "--cv-hint-h": px(L.hint.height),
    "--cv-name-y": px(L.nameRow.y),
    "--cv-name-h": px(L.nameRow.height),
    "--cv-plate-w": px(L.nameRow.plateWidth),
    "--cv-rot-size": px(L.nameRow.button),
    "--cv-rot-gap": px(L.nameRow.gap),
    "--cv-panel-w": px(L.panelWidth),
  };
  if (L.cta) {
    vars["--cv-cta-x"] = px(L.cta.x);
    vars["--cv-cta-y"] = px(L.cta.y);
    vars["--cv-cta-w"] = px(L.cta.width);
    vars["--cv-cta-h"] = px(L.cta.height);
  }
  if (L.sheet) {
    vars["--cv-sheet-w"] = px(L.sheet.width);
    vars["--cv-sheet-rest"] = px(L.sheet.rest);
    vars["--cv-sheet-open"] = px(L.sheet.open);
  }
  return vars as CSSProperties;
}

function viewportLayout(): StageLayout {
  return stageLayout(window.innerWidth, window.innerHeight);
}

/**
 * Entry screen with the character builder ("캐릭터 조립실", character stage 3; Task 7b look): a bright sky-garden
 * stage — the background art's podium carries the 3D figure, glass panels (wide screens) or a bottom sheet
 * (phones) hold the builder, and the nickname plate + 입장 sit under the figure. The DOM order (title → nickname
 * → builder → admin → message → submit) and every Task 7 class/role/aria/text are unchanged; positions come from
 * stageLayout() via CSS variables. The last look (localStorage "cv.entry") is loaded on open and saved only on
 * 입장 — never on every edit. Entering the world unmounts this screen, and with it the preview's WebGL canvas.
 */
export function EntryScreen() {
  const enterWorld = useAppStore((s) => s.enterWorld);
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);

  const [saved] = useState(loadIdentity);
  const [nickname, setNickname] = useState(saved.nickname);
  // The look being built: starts from the cached one, or DEFAULT_APPEARANCE
  // (loadIdentity migrates a pre-builder or corrupt cache).
  const [appearance, setAppearance] = useState(saved.appearance);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [layout, setLayout] = useState(viewportLayout);
  /** Bumped by a preset / 🎲 press: the preview figure spins once. */
  const [spin, setSpin] = useState(0);
  /** Bumped by every rejected nickname: restarts the nameplate shake. */
  const [shakes, setShakes] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Warm the model cache as soon as the builder opens (the preview and then the world both use character.glb).
  useEffect(() => {
    preloadCharacterAssets();
  }, []);

  useEffect(() => {
    const onResize = () => setLayout(viewportLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Editing the form dismisses any leftover kick/disconnect notice.
  function dismissMessages() {
    if (error) setError(null);
    if (notice) clearNotice();
  }

  // Every builder edit (preset, 🎲, chip, swatch, voice) replaces the whole look.
  function changeAppearance(next: Appearance) {
    setAppearance(next);
    dismissMessages();
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
      if (result.error === NICKNAME_ERROR) setShakes((n) => n + 1);
      return;
    }
    setError(null);
    clearNotice();
    setSubmitting(true);
    // Remember the last look for the next visit (spec §4 "마지막 외형 기억") — saved
    // here on 입장 only, not on every builder edit.
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
  const nicknameInvalid = error === NICKNAME_ERROR;
  const art = ENTRY_ART[layout.art];

  return (
    <div
      className="cv-entry"
      data-layout={layout.mode}
      data-art={layout.art}
      data-compact-bar={layout.compactBar ? "" : undefined}
      style={layoutStyle(layout)}
    >
      {/* The sky-garden stage: art (one image per device, AVIF first), its LQIP, the podium glow and light motes. */}
      <div className="cv-entry-bg" aria-hidden="true">
        <div className="cv-entry-lqip" style={{ backgroundImage: `url(${art.lqip})` }} />
        <picture key={layout.art}>
          <source type="image/avif" srcSet={art.avif} />
          <img className="cv-entry-art" src={art.webp} alt="" decoding="async" fetchPriority="high" draggable={false} />
        </picture>
        <div className="cv-stage-spot" />
        <div className="cv-stage-glow" />
        <div className="cv-motes">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>

      <form className="cv-card" onSubmit={handleSubmit}>
        <header className="cv-head">
          <h1 className="cv-title">{APP_NAME}</h1>
          <p className="cv-subtitle">함께 걷는 3D 메타버스에 입장하세요</p>
        </header>

        {/* The nameplate under the figure. */}
        <label
          className={"cv-field cv-nameplate" + (nicknameInvalid ? " is-invalid" : "")}
          data-shake={nicknameInvalid ? shakes % 2 : undefined}
        >
          <span className="cv-label">{BUILDER_COPY.nickname}</span>
          <input
            className="cv-input"
            type="text"
            value={nickname}
            placeholder={BUILDER_COPY.nicknamePlaceholder}
            maxLength={NICKNAME_MAX}
            // A phone keyboard would cover the stage; desktops start typing right away.
            autoFocus={!isTouchDevice}
            aria-invalid={nicknameInvalid || undefined}
            onChange={(e) => {
              setNickname(e.target.value);
              dismissMessages();
            }}
          />
          <span className="cv-nameplate-count" aria-hidden="true">
            {nickname.length}/{NICKNAME_MAX}
          </span>
          <BuilderIcon name="pencil" className="cv-nameplate-pencil" />
        </label>

        <section className="cv-builder-section" aria-labelledby="cv-builder-title">
          <h2 className="cv-builder-title" id="cv-builder-title">
            <span className="cv-brand-badge">
              <img src="/brand/cayson-logo-white.png" alt="Cayson" height="28" />
            </span>{" "}
            {BUILDER_COPY.title}
          </h2>
          <div className="cv-builder">
            <BuilderPreview appearance={appearance} spin={spin} scrollerRef={scrollerRef} />
            <BuilderPanel
              appearance={appearance}
              onChange={changeAppearance}
              onPresetApplied={() => setSpin((n) => n + 1)}
              scrollerRef={scrollerRef}
              sheet={layout.mode === "phone" ? layout.sheet : null}
            />
          </div>
        </section>

        <div className="cv-admin-toggle">
          {showAdmin ? (
            <label className="cv-field cv-admin-pop">
              <span className="cv-label">{BUILDER_COPY.adminCode}</span>
              <input
                className="cv-input"
                type="password"
                value={adminCode}
                placeholder={BUILDER_COPY.adminPlaceholder}
                autoComplete="off"
                aria-label="관리자 코드"
                // The link that opened this field is gone: keep the keyboard focus here.
                autoFocus
                onChange={(e) => {
                  setAdminCode(e.target.value);
                  dismissMessages();
                }}
              />
            </label>
          ) : (
            <button type="button" className="cv-admin-link" onClick={() => setShowAdmin(true)}>
              <BuilderIcon name="key" />
              <span className="cv-admin-text">{BUILDER_COPY.admin}</span>
            </button>
          )}
        </div>

        {message && (
          <p className="cv-message" role="alert">
            {message}
          </p>
        )}

        {/* Phones: a fade under the sticky 입장 so the sheet content scrolling beneath it stays readable. */}
        <div className="cv-cta-fade" aria-hidden="true" />
        <button
          className={"cv-submit" + (validateNickname(nickname) === null ? " is-ready" : "")}
          type="submit"
          disabled={submitting}
        >
          {submitting ? BUILDER_COPY.submitting : BUILDER_COPY.submit}
          <span className="cv-submit-go" aria-hidden="true">
            {submitting ? <span className="cv-spinner" /> : <BuilderIcon name="go" />}
          </span>
        </button>
      </form>
    </div>
  );
}
