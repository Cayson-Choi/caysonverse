import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { APP_NAME, NICKNAME_MAX } from "@caysonverse/shared/constants";
import type { Appearance } from "@caysonverse/shared/appearance";
import { preloadCharacterAssets } from "../game/useAvatar";
import { characterModel } from "../game/characterModel";
import { isTouchDevice } from "../device";
import { NICKNAME_ERROR, validateEntry, validateNickname, type EntryInput } from "./validation";
import { BuilderPreview } from "./BuilderPreview";
import { BuilderPanel } from "./BuilderPanel";
import { BuilderIcon } from "./BuilderIcons";
import { BUILDER_COPY } from "./builderOptions";
import { ENTRY_ART, stageLayout, type StageLayout } from "./stageLayout";
import { useEntryViewport } from "./entryViewport";
import { ENTRY_COPY, enterVillageDirectly, type VillageEntryDeps } from "./entryForm";
import { joinVillage } from "../net/connection";
import { clearKicked } from "../net/kickSeam";
import { saveIdentity, loadIdentity } from "../net/identityCache";
import { useAppStore } from "../stores/appStore";
import "./entry.css";
import "./builder.css";

/** The real app behind the village entry (entryForm.ts `enterVillageDirectly`; its tests pass fakes). */
const VILLAGE_DEPS: VillageEntryDeps = {
  joinVillage,
  saveIdentity,
  clearKicked,
  enterVillage: (identity) => useAppStore.getState().enterVillage(identity),
};

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/**
 * 배치(stageLayout) → .cv-entry의 CSS 변수. 무대 안 요소는 무대 상자(.cv-builder-preview) 기준 좌표를 쓴다.
 * --cv-vh는 배치를 잡은 화면 높이: 키보드가 화면을 줄여도 .cv-entry는 이 높이를 지킨다(entryViewport.ts).
 */
function layoutStyle(L: StageLayout, height: number): CSSProperties {
  const vars: Record<string, string> = {
    "--cv-vh": px(height),
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
    "--cv-toast-x": px(L.toast.x),
    "--cv-toast-y": px(L.toast.y),
    "--cv-toast-w": px(L.toast.maxWidth),
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

/** 포인터 시차의 값(−0.5~0.5를 40칸으로): 미리 만든 문자열이라 움직일 때마다 새 문자열을 만들지 않는다. */
const PARALLAX_STEPS = 40;
const PARALLAX_VALUES = Array.from({ length: PARALLAX_STEPS + 1 }, (_, i) => String(i / PARALLAX_STEPS - 0.5));
/** 빛 알갱이 8개: 왼쪽·위(%), 크기(px), 한 번 오르는 시간(s), 미리 지난 시간(s — 처음부터 흩어져 보이게). */
const MOTES = [
  [37, 30, 9, 9, 0],
  [61, 22, 7, 12, 4],
  [43, 55, 6, 10, 7],
  [58, 47, 9, 13, 2],
  [52, 15, 6, 14, 9],
  [39, 42, 7, 8, 5],
  [66, 36, 5, 11, 1],
  [47, 26, 5, 12.5, 6],
] as const;

const parallaxValue = (t: number) => PARALLAX_VALUES[Math.round(Math.min(1, Math.max(0, t)) * PARALLAX_STEPS)];

/**
 * 데스크톱(정밀 포인터 + 호버)에서만: 포인터 위치를 빛 알갱이 층(.cv-motes) 자신의 --cv-px·--cv-py(−0.5~0.5)로 적어
 * 살짝 따라 움직이게 한다(CSS transform). 그 층에만 적으므로 조립실의 나머지 요소는 다시 스타일을 계산하지 않는다.
 * 포인터가 움직인 프레임에만, rAF 한 번으로 적는다. 움직임 줄이기 설정이면 켜지 않는다.
 */
function usePointerParallax(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof matchMedia !== "function") return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let x = 0.5;
    let y = 0.5;
    let raf = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty("--cv-px", parallaxValue(x));
      el.style.setProperty("--cv-py", parallaxValue(y));
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX / window.innerWidth;
      y = e.clientY / window.innerHeight;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

/**
 * Entry screen with the character builder ("캐릭터 조립실", character stage 3; Task 7b look): a bright sky-garden
 * stage — the background art's podium carries the 3D figure, glass panels (wide screens) or a bottom sheet
 * (phones) hold the builder, and the nickname plate + 입장 sit under the figure. The DOM order (title → nickname
 * → builder → message → submit) and every Task 7 class/role/aria/text are unchanged; positions come from
 * stageLayout() via CSS variables. The last look (localStorage "cv.entry") is loaded on open and saved only on
 * 입장 — never on every edit. Entering the world unmounts this screen, and with it the preview's WebGL canvas.
 *
 * 입장하기 checks the nickname and look and joins 케이슨 마을 at once — no code, no sheet. Every address opens the
 * village (the older `?experience=escape` and `?world=legacy` links included).
 */
export function EntryScreen() {
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);

  const [saved] = useState(loadIdentity);
  const [nickname, setNickname] = useState(saved.nickname);
  // The look being built: starts from the cached one, or DEFAULT_APPEARANCE
  // (loadIdentity migrates a pre-builder or corrupt cache).
  const [appearance, setAppearance] = useState(saved.appearance);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  /** The screen size the layout is built for: a phone keyboard that shrinks the viewport does not change it. */
  const view = useEntryViewport(rootRef);
  const layout = useMemo(() => stageLayout(view.width, view.height), [view.width, view.height]);
  /** Bumped by a preset / 🎲 press: the preview figure spins once. */
  const [spin, setSpin] = useState(0);
  /** Bumped by every rejected nickname: restarts the nameplate shake. */
  const [shakes, setShakes] = useState(0);
  /** Bumped whenever 입장 re-downloads a failed character model: a broken preview tries again too. */
  const [modelReloads, setModelReloads] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const motesRef = useRef<HTMLDivElement>(null);
  usePointerParallax(motesRef);

  // Warm the model cache as soon as the builder opens (the preview and then the world both use character.glb).
  useEffect(() => {
    preloadCharacterAssets();
  }, []);

  // Editing the form dismisses any leftover kick/disconnect notice.
  function dismissMessages() {
    if (error) setError(null);
    if (notice) clearNotice();
  }

  // Every builder edit (preset, 🎲, chip, swatch) replaces the whole look.
  function changeAppearance(next: Appearance) {
    setAppearance(next);
    dismissMessages();
  }

  /**
   * A failed character.glb download stays cached as that error: entering would make the scene's own avatar
   * rethrow it. So when the model is known to have failed, download it again first; false when that fails
   * too (stay here with a retry message). Still downloading → enter as before (the scene waits for it).
   */
  async function characterModelReady(): Promise<boolean> {
    if (characterModel.state() !== "failed") return true;
    const loaded = await characterModel.reload();
    setModelReloads((n) => n + 1);
    return loaded;
  }

  /**
   * Join 케이슨 마을 with a checked look (the default entry). Resolves with the words to show, or null once
   * in (this screen unmounts then). The flow itself (what is saved, in which order) is `enterVillageDirectly`.
   */
  async function joinTheVillage(value: EntryInput): Promise<string | null> {
    if (!(await characterModelReady())) return BUILDER_COPY.modelRetry;
    try {
      await enterVillageDirectly(VILLAGE_DEPS, value);
      // On success this component unmounts; do not touch state afterwards.
      return null;
    } catch (err) {
      return err instanceof Error && err.message ? err.message : ENTRY_COPY.failed;
    }
  }

  /** The builder's 입장하기: check the nickname and look, then join 케이슨 마을. */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const result = validateEntry({ nickname, appearance });
    if (!result.ok) {
      setError(result.error);
      if (result.error === NICKNAME_ERROR) setShakes((n) => n + 1);
      return;
    }
    setError(null);
    clearNotice();

    setSubmitting(true);
    const failed = await joinTheVillage(result.value);
    if (failed !== null) {
      setError(failed);
      setSubmitting(false);
    }
  }

  const message = error ?? notice;
  const nicknameInvalid = error === NICKNAME_ERROR;
  const art = ENTRY_ART[layout.art];

  return (
    <div
      ref={rootRef}
      // CSS uses the classes (is-wide | is-side | is-phone, and is-sheet for both sheet layouts: short selectors);
      // data-layout stays for tests.
      className={`cv-entry is-${layout.mode}${layout.mode === "wide" ? "" : " is-sheet"}`}
      data-layout={layout.mode}
      data-art={layout.art}
      data-compact-bar={layout.compactBar ? "" : undefined}
      style={layoutStyle(layout, view.height)}
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
        <div className="cv-motes" ref={motesRef}>
          {MOTES.map(([x, y, size, loop, ahead], i) => (
            <span
              key={i}
              style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, animationDuration: `${loop}s`, animationDelay: `-${ahead}s` }}
            />
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
            <BuilderPreview appearance={appearance} spin={spin} scrollerRef={scrollerRef} modelReloads={modelReloads} />
            <BuilderPanel
              appearance={appearance}
              onChange={changeAppearance}
              onPresetApplied={() => setSpin((n) => n + 1)}
              scrollerRef={scrollerRef}
              sheet={layout.mode === "phone" ? layout.sheet : null}
              orientation={layout.mode === "wide" ? "vertical" : "horizontal"}
            />
          </div>
        </section>

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
          {/* Hover brightening and the press flash: an opacity layer (no filter animation). */}
          <span className="cv-submit-shine" aria-hidden="true" />
          <span className="cv-submit-go" aria-hidden="true">
            {submitting ? <span className="cv-spinner" /> : <BuilderIcon name="go" />}
          </span>
        </button>
      </form>

    </div>
  );
}
