import { useEffect, useRef, useState, type CSSProperties } from "react";
import { APP_NAME, NICKNAME_MAX } from "@caysonverse/shared/constants";
import type { Appearance } from "@caysonverse/shared/appearance";
import type { TextLevel } from "@caysonverse/shared/escape/constants";
import { sanitizeCodeInput } from "@caysonverse/shared/escape/classCode";
import { primeChatAudio } from "../game/chatVoice";
import { preloadCharacterAssets } from "../game/useAvatar";
import { characterModel } from "../game/characterModel";
import { isTouchDevice } from "../device";
import { NICKNAME_ERROR, validateEntry, validateNickname, type EntryInput } from "./validation";
import { BuilderPreview } from "./BuilderPreview";
import { BuilderPanel } from "./BuilderPanel";
import { BuilderIcon } from "./BuilderIcons";
import { BUILDER_COPY } from "./builderOptions";
import { ENTRY_ART, stageLayout, type StageLayout } from "./stageLayout";
import {
  CLASS_CODE_ERROR,
  ENTRY_COPY,
  TEACHER_KEY_ERROR,
  entryDestinations,
  entryModeFromUrl,
  enterClassAsStudent,
  enterClassAsTeacher,
  validateStudentEntry,
  validateTeacherEntry,
  refusalField,
  teacherFieldsAfter,
  type ClassEntryDeps,
  type DestinationId,
  type TeacherFields,
} from "./entryForm";
import { DestinationSheet, type DestinationError } from "./DestinationSheet";
import { joinClass, joinWorld, requestTeacherPass } from "../net/connection";
import { clearKicked } from "../net/kickSeam";
import { rememberAdminCode, forgetAdminCode } from "../net/adminSession";
import { forgetTeacher, rememberTeacher } from "../net/teacherSession";
import { loadIdentity, saveIdentity } from "../net/identityCache";
import { useAppStore } from "../stores/appStore";
import "./entry.css";
import "./builder.css";

/** The real app behind the class entry flows (entryForm.ts; its tests pass fakes). */
const CLASS_DEPS: ClassEntryDeps = {
  joinClass,
  requestTeacherPass,
  rememberTeacher,
  forgetTeacher,
  saveIdentity,
  clearKicked,
  enterHub: (identity, isTeacher) => useAppStore.getState().enterHub(identity, isTeacher),
};

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

function viewportLayout(): StageLayout {
  return stageLayout(window.innerWidth, window.innerHeight);
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
 * → builder → admin → message → submit) and every Task 7 class/role/aria/text are unchanged; positions come from
 * stageLayout() via CSS variables. The last look (localStorage "cv.entry") is loaded on open and saved only on
 * 입장 — never on every edit. Entering the world unmounts this screen, and with it the preview's WebGL canvas.
 *
 * AI 학교 탈출 (Task 14): the builder is Caysonverse's shared entrance, with no school chrome. By default its
 * 입장하기 checks the nickname and look, then opens "어디로 갈까요?" (DestinationSheet) — the experiences, today
 * AI 학교 탈출: a student's 반 코드 entry, or a teacher's 반 열기 — and a class join lands in the hall (`hub`).
 * The admin pill belongs to the world and is not shown there. `?world=legacy` keeps the old entry exactly:
 * builder → 입장하기 → the world, admin pill included (entryModeFromUrl).
 */
export function EntryScreen() {
  const enterWorld = useAppStore((s) => s.enterWorld);
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);

  const [entryMode] = useState(() => entryModeFromUrl(window.location.search));
  const legacy = entryMode === "legacy";
  const [saved] = useState(loadIdentity);
  const [nickname, setNickname] = useState(saved.nickname);
  // The look being built: starts from the cached one, or DEFAULT_APPEARANCE
  // (loadIdentity migrates a pre-builder or corrupt cache).
  const [appearance, setAppearance] = useState(saved.appearance);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── "어디로 갈까요?" (school entry only) ──
  const [destOpen, setDestOpen] = useState(false);
  /**
   * The sheet's role and the teacher key — a credential: in this screen's state only, never stored or
   * prefilled, and forgotten whenever the sheet closes or switches back to 학생 (teacherFieldsAfter).
   */
  const [teacherFields, setTeacherFields] = useState<TeacherFields>(() => ({
    role: entryMode === "teacher" ? "teacher" : "student",
    teacherKey: "",
  }));
  const { role, teacherKey } = teacherFields;
  /** The last class code entered is prefilled (identity cache); the teacher key never is. */
  const [classCode, setClassCode] = useState(() => sanitizeCodeInput(saved.classCode ?? ""));
  const [textLevel, setTextLevel] = useState<TextLevel>("easy");
  const [destError, setDestError] = useState<DestinationError | null>(null);
  /** Bumped by every refused try in the sheet (re-focus + shake the field at fault). */
  const [destErrorSeq, setDestErrorSeq] = useState(0);
  /** The destination whose join is running. */
  const [pending, setPending] = useState<DestinationId | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  /** Where focus goes once the sheet has closed (the sheet's modal dialog makes the rest inert until then). */
  const refocusRef = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState(viewportLayout);
  /** Bumped by a preset / 🎲 press: the preview figure spins once. */
  const [spin, setSpin] = useState(0);
  /** Bumped by every rejected nickname: restarts the nameplate shake. */
  const [shakes, setShakes] = useState(0);
  /** Bumped whenever 입장 re-downloads a failed character model: a broken preview tries again too. */
  const [modelReloads, setModelReloads] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const motesRef = useRef<HTMLDivElement>(null);
  const adminRef = useRef<HTMLDivElement>(null);
  const adminButtonRef = useRef<HTMLButtonElement>(null);
  usePointerParallax(motesRef);

  // Warm the model cache as soon as the builder opens (the preview and then the world both use character.glb).
  useEffect(() => {
    preloadCharacterAssets();
  }, []);

  useEffect(() => {
    const onResize = () => setLayout(viewportLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The admin code popover closes on Esc / the toggle (focus back to the toggle) and on any press outside it.
  // A typed code is kept while it is closed (the toggle shows a dot) and is still sent with 입장.
  function closeAdmin(returnFocus: boolean) {
    setShowAdmin(false);
    if (returnFocus) adminButtonRef.current?.focus();
  }
  useEffect(() => {
    if (!showAdmin) return;
    const onDown = (e: PointerEvent) => {
      if (!adminRef.current?.contains(e.target as Node)) setShowAdmin(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showAdmin]);

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
   * Join the current world with a checked look (the `?world=legacy` entry, or its card when
   * SHOW_WORLD_ON_ENTRY). Resolves with the words to show, or null once in (this screen unmounts then).
   */
  async function joinTheWorld(value: EntryInput, typedAdminCode: string): Promise<string | null> {
    if (!(await characterModelReady())) return BUILDER_COPY.modelRetry;

    // Remember the last look for the next visit (spec §4 "마지막 외형 기억") — saved
    // here on 입장 only, not on every builder edit.
    saveIdentity(value);

    // A deliberate manual entry clears any prior kick block (Task 11 seam).
    clearKicked();

    // Only supply a code when the admin field has one; a successful join with a
    // code proves it was correct (a wrong code is rejected server-side), so we
    // can infer admin status locally without the server leaking it.
    const trimmedCode = typedAdminCode.trim();
    const asAdmin = trimmedCode.length > 0;
    const params = asAdmin ? { ...value, adminCode: trimmedCode } : value;

    try {
      const room = await joinWorld(params);
      // A join that supplied a code AND succeeded proves the code was correct, so
      // remember it (module memory only) to re-authenticate on a Phase-2 fresh
      // rejoin after a server restart; a non-admin join clears any stale code.
      if (asAdmin) rememberAdminCode(trimmedCode);
      else forgetAdminCode();
      enterWorld({ ...value, sessionId: room.sessionId }, asAdmin);
      // On success this component unmounts; do not touch state afterwards.
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : ENTRY_COPY.failed;
    }
  }

  /** The builder's 입장하기: the world (`?world=legacy`), else the destination step. */
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

    if (!legacy) {
      setDestError(null);
      setDestOpen(true);
      return;
    }

    setSubmitting(true);
    const failed = await joinTheWorld(result.value, adminCode);
    if (failed !== null) {
      setError(failed);
      setSubmitting(false);
    }
  }

  /** Show words in the sheet's card (and re-focus / shake the field at fault). */
  function refuseInSheet(dest: DestinationId, text: string, field?: "code" | "key") {
    setDestError(field ? { dest, text, field } : { dest, text });
    setDestErrorSeq((n) => n + 1);
  }

  /** AI 학교 탈출's 입장하기 (student, 반 코드) / 반 열기 (teacher, 선생님 키). */
  async function enterSchool() {
    if (submitting) return;
    primeChatAudio(); // inside the press's user gesture (see handleSubmit)

    const check =
      role === "student" ? validateStudentEntry({ classCode, nickname }) : validateTeacherEntry({ teacherKey, nickname });
    if (!check.ok) {
      const field = check.error === CLASS_CODE_ERROR ? "code" : check.error === TEACHER_KEY_ERROR ? "key" : undefined;
      return refuseInSheet("escape", check.error, field);
    }
    const look = validateEntry({ nickname, appearance });
    if (!look.ok) return refuseInSheet("escape", look.error);

    setDestError(null);
    setSubmitting(true);
    setPending("escape");
    try {
      if (!(await characterModelReady())) throw new Error(BUILDER_COPY.modelRetry);
      if (role === "student") await enterClassAsStudent(CLASS_DEPS, { ...look.value, classCode });
      else await enterClassAsTeacher(CLASS_DEPS, { ...look.value, teacherKey, textLevel });
      // In the hall now: this screen unmounts; do not touch state afterwards.
    } catch (err) {
      // The server's / connection layer's Korean words, as they come.
      refuseInSheet(
        "escape",
        err instanceof Error && err.message ? err.message : ENTRY_COPY.failed,
        refusalField(role, err) ?? undefined,
      );
      setSubmitting(false);
      setPending(null);
    }
  }

  /** The current world's card (only listed when SHOW_WORLD_ON_ENTRY): a plain world join. */
  async function enterWorldFromSheet() {
    if (submitting) return;
    primeChatAudio();
    const look = validateEntry({ nickname, appearance });
    if (!look.ok) return refuseInSheet("world", look.error);
    setDestError(null);
    setSubmitting(true);
    setPending("world");
    const failed = await joinTheWorld(look.value, "");
    if (failed !== null) {
      refuseInSheet("world", failed);
      setSubmitting(false);
      setPending(null);
    }
  }

  /** Close the sheet; focus returns to 입장하기 (or the nameplate, to change the nickname). */
  function closeDestinations(focus: "submit" | "nickname" = "submit") {
    refocusRef.current = focus === "nickname" ? nicknameRef.current : submitRef.current;
    setDestOpen(false);
    setTeacherFields((f) => teacherFieldsAfter(f, "close"));
  }
  useEffect(() => {
    if (destOpen) return;
    const el = refocusRef.current;
    refocusRef.current = null;
    el?.focus();
  }, [destOpen]);

  const message = error ?? notice;
  const nicknameInvalid = error === NICKNAME_ERROR;
  const art = ENTRY_ART[layout.art];

  return (
    <div
      // CSS uses the classes (is-wide | is-side | is-phone, and is-sheet for both sheet layouts: short selectors);
      // data-layout stays for tests.
      className={`cv-entry is-${layout.mode}${layout.mode === "wide" ? "" : " is-sheet"}`}
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
            ref={nicknameRef}
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

        {/* The admin pill belongs to the world: only the `?world=legacy` entry shows it. */}
        {legacy && (
          <div
            className="cv-admin-toggle"
            ref={adminRef}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || !showAdmin) return;
              e.stopPropagation();
              closeAdmin(true);
            }}
          >
            <button
              type="button"
              className="cv-admin-link"
              ref={adminButtonRef}
              aria-expanded={showAdmin}
              aria-controls={showAdmin ? "cv-admin-pop" : undefined}
              data-has-code={adminCode.trim() ? "" : undefined}
              onClick={() => (showAdmin ? closeAdmin(true) : setShowAdmin(true))}
            >
              <BuilderIcon name="key" />
              <span className="cv-admin-text">{BUILDER_COPY.admin}</span>
            </button>
            {showAdmin && (
              <label className="cv-field cv-admin-pop" id="cv-admin-pop">
                <span className="cv-label">{BUILDER_COPY.adminCode}</span>
                <input
                  className="cv-input"
                  type="password"
                  value={adminCode}
                  placeholder={BUILDER_COPY.adminPlaceholder}
                  autoComplete="off"
                  aria-label="관리자 코드"
                  // Opened from the toggle: type right away.
                  autoFocus
                  onChange={(e) => {
                    setAdminCode(e.target.value);
                    dismissMessages();
                  }}
                />
              </label>
            )}
          </div>
        )}

        {message && (
          <p className="cv-message" role="alert">
            {message}
          </p>
        )}

        {/* Phones: a fade under the sticky 입장 so the sheet content scrolling beneath it stays readable. */}
        <div className="cv-cta-fade" aria-hidden="true" />
        <button
          ref={submitRef}
          className={"cv-submit" + (validateNickname(nickname) === null ? " is-ready" : "")}
          type="submit"
          disabled={submitting}
          // School entry: it opens the destination step (a dialog).
          aria-haspopup={legacy ? undefined : "dialog"}
        >
          {submitting ? BUILDER_COPY.submitting : BUILDER_COPY.submit}
          {/* Hover brightening and the press flash: an opacity layer (no filter animation). */}
          <span className="cv-submit-shine" aria-hidden="true" />
          <span className="cv-submit-go" aria-hidden="true">
            {submitting ? <span className="cv-spinner" /> : <BuilderIcon name="go" />}
          </span>
        </button>
      </form>

      {!legacy && destOpen && (
        <DestinationSheet
          destinations={entryDestinations()}
          phone={layout.mode === "phone"}
          role={role}
          onRole={(next) => {
            setTeacherFields((f) => teacherFieldsAfter(f, next));
            setDestError(null);
          }}
          nickname={nickname}
          classCode={classCode}
          onClassCode={(code) => {
            setClassCode(code);
            if (destError) setDestError(null);
          }}
          teacherKey={teacherKey}
          onTeacherKey={(key) => {
            setTeacherFields((f) => ({ ...f, teacherKey: key }));
            if (destError) setDestError(null);
          }}
          textLevel={textLevel}
          onTextLevel={setTextLevel}
          error={destError}
          errorSeq={destErrorSeq}
          pending={pending}
          onEnterClass={() => void enterSchool()}
          onEnterWorld={() => void enterWorldFromSheet()}
          onChangeNickname={() => closeDestinations("nickname")}
          onClose={() => closeDestinations()}
        />
      )}
    </div>
  );
}
