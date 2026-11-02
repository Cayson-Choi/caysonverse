import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { CLASS_CODE_LENGTH, type TextLevel } from "@caysonverse/shared/escape/constants";
import { normalizeClassCode, sanitizeCodeInput } from "@caysonverse/shared/escape/classCode";
import { isTouchDevice } from "../device";
import { trackKbdInset } from "./kbdInset";
import { BuilderIcon } from "./BuilderIcons";
import { BUILDER_COPY } from "./builderOptions";
import {
  CLASS_CODE_ERROR,
  ENTRY_COPY,
  TEACHER_KEY_ERROR,
  TEXT_LEVEL_OPTIONS,
  type Destination,
  type DestinationId,
} from "./entryForm";

/** The two ways into AI 학교 탈출 (EntryMode without "legacy"). */
export type SchoolRole = "student" | "teacher";

/** A message in the sheet, shown in the card it belongs to. */
export interface DestinationError {
  dest: DestinationId;
  text: string;
}

export interface DestinationSheetProps {
  destinations: readonly Destination[];
  /** Phones get a bottom sheet; wide screens and tablets a centred glass dialog. */
  phone: boolean;
  role: SchoolRole;
  onRole: (role: SchoolRole) => void;
  /** The nickname typed on the builder's plate (shown, changed there). */
  nickname: string;
  classCode: string;
  onClassCode: (code: string) => void;
  teacherKey: string;
  onTeacherKey: (key: string) => void;
  textLevel: TextLevel;
  onTextLevel: (level: TextLevel) => void;
  error: DestinationError | null;
  /** Bumped on every refused try: re-focuses (and shakes) the field at fault even when the words repeat. */
  errorSeq: number;
  /** The card whose join is running (everything waits), or null. */
  pending: DestinationId | null;
  onEnterClass: () => void;
  onEnterWorld: () => void;
  /** Close the sheet and put the caret in the nameplate. */
  onChangeNickname: () => void;
  onClose: () => void;
}

/** Card emblems and small marks (decorative; same stroke style as BuilderIcons). */
const MARKS = {
  escape: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V10.5L12 5.5l7 5V21" />
      <path d="M10 21v-4.5h4V21" />
      <circle cx="12" cy="11" r="1.7" />
      <path d="M12 5.5V2.5l3 1.2-3 1.2" />
    </>
  ),
  world: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  shield: (
    <>
      <path d="M12 3l7 2.8v5.4c0 4.4-2.9 8.1-7 9.8-4.1-1.7-7-5.4-7-9.8V5.8z" />
      <path d="M8.8 12.2l2.2 2.2 4.2-4.4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

function Mark({ name }: { name: keyof typeof MARKS }) {
  return (
    <svg className="cv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {MARKS[name]}
    </svg>
  );
}

function GoButton({ label, busyLabel, busy, disabled, onClick, buttonRef }: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onClick?: () => void;
  buttonRef?: { current: HTMLButtonElement | null };
}) {
  return (
    <button className="cv-dest-go" type={onClick ? "button" : "submit"} disabled={disabled} onClick={onClick} ref={buttonRef}>
      {busy ? busyLabel : label}
      <span className="cv-dest-go-icon" aria-hidden="true">
        {busy ? <span className="cv-spinner" /> : <BuilderIcon name="go" />}
      </span>
    </button>
  );
}

/**
 * "어디로 갈까요?" — the step after the builder's 입장하기 (Task 14): a native modal <dialog> (the
 * builder behind it is inert; Tab stays inside; Esc, ✕ or a press on the veil closes it — not while a
 * join runs) in the builder's look — glass, indigo → violet, Jua titles, 44 px targets; a bottom
 * sheet on phones. It lists the experiences
 * (`entryDestinations`); AI 학교 탈출's card holds the student entry (반 코드) and, behind
 * "선생님이신가요?", the teacher's 반 열기. Mounted only while open: the dialog opens on mount and
 * closes on unmount. The values live in EntryScreen, so closing and re-opening keeps what was typed
 * (never the teacher key beyond the entry screen itself).
 */
export function DestinationSheet(p: DestinationSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);
  /** The current press started on the veil (outside the sheet). */
  const pressOnVeil = useRef(false);
  const busy = p.pending !== null;
  const student = p.role === "student";

  // Open as a modal on mount; close on unmount (StrictMode's re-mount re-opens it).
  // First focus: the field to fill, or 입장하기 when the remembered code is already whole. Touch
  // screens focus the title instead, so the keyboard does not cover the sheet before it is read.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    if (isTouchDevice) titleRef.current?.focus();
    else if (!student) keyRef.current?.focus();
    else if (normalizeClassCode(p.classCode) !== null) goRef.current?.focus();
    else codeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
    // Mount only: later focus moves follow the person (role switch, errors).
  }, []);

  // Phones: lift the bottom sheet above the on-screen keyboard (--cv-kbd-inset).
  useEffect(() => (isTouchDevice ? trackKbdInset() : undefined), []);

  // A refused try puts the caret where the fix goes.
  useEffect(() => {
    if (p.errorSeq === 0 || !p.error) return;
    if (p.error.text === CLASS_CODE_ERROR) codeRef.current?.focus();
    else if (p.error.text === TEACHER_KEY_ERROR) keyRef.current?.focus();
    // Only a new refusal moves focus.
  }, [p.errorSeq]);

  const codeInvalid = p.error?.dest === "escape" && p.error.text === CLASS_CODE_ERROR;
  const keyInvalid = p.error?.dest === "escape" && p.error.text === TEACHER_KEY_ERROR;
  const shake = p.errorSeq % 2;

  function errorFor(dest: DestinationId) {
    if (p.error?.dest !== dest) return null;
    return (
      <p className="cv-dest-error" role="alert" id={`cv-dest-error-${dest}`} key={p.errorSeq}>
        {p.error.text}
      </p>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className={"cv-dest" + (p.phone ? " is-phone" : "")}
      aria-labelledby="cv-dest-title"
      // Esc: close ourselves (unmount) — unless a join is running. A browser may still force the
      // close (a second Esc): then follow it.
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) p.onClose();
      }}
      onClose={() => {
        if (!dialogRef.current?.open) p.onClose();
      }}
      // A press on the veil around the sheet (the dialog box itself; the sheet fills it) closes it too —
      // only when it also started there (a text selection dragged out of a field must not close it).
      onPointerDown={(e) => {
        pressOnVeil.current = e.target === dialogRef.current;
      }}
      onClick={(e) => {
        const onVeil = pressOnVeil.current && e.target === dialogRef.current;
        pressOnVeil.current = false;
        if (onVeil && !busy) p.onClose();
      }}
    >
      <div className="cv-dest-sheet">
        {p.phone && <span className="cv-dest-grabber" aria-hidden="true" />}
        <header className="cv-dest-head">
          <h2 className="cv-dest-title" id="cv-dest-title" tabIndex={-1} ref={titleRef}>
            {ENTRY_COPY.sheetTitle}
          </h2>
          <button type="button" className="cv-dest-close" aria-label={ENTRY_COPY.close} onClick={p.onClose} disabled={busy}>
            <Mark name="close" />
          </button>
        </header>

        <ul className="cv-dest-list">
          {p.destinations.map((d) => (
            <li key={d.id} className="cv-dest-card" data-dest={d.id} data-role={d.id === "escape" ? p.role : undefined}>
              <div className="cv-dest-card-head">
                <span className="cv-dest-emblem" aria-hidden="true">
                  <Mark name={d.id} />
                </span>
                <div className="cv-dest-card-text">
                  <h3 className="cv-dest-name" id={`cv-dest-${d.id}`}>
                    {d.title}
                  </h3>
                  <p className="cv-dest-line">{d.line}</p>
                </div>
              </div>

              {d.id === "world" ? (
                <>
                  {errorFor("world")}
                  <GoButton
                    label={ENTRY_COPY.enter}
                    busyLabel={ENTRY_COPY.entering}
                    busy={p.pending === "world"}
                    disabled={busy}
                    onClick={p.onEnterWorld}
                  />
                </>
              ) : (
                <form
                  className="cv-dest-form"
                  aria-labelledby="cv-dest-escape"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    p.onEnterClass();
                  }}
                >
                  {student ? (
                    <label className="cv-dest-field">
                      <span className="cv-dest-label">{ENTRY_COPY.classCode}</span>
                      <span className="cv-dest-input-wrap" data-shake={codeInvalid ? shake : undefined}>
                        <input
                          ref={codeRef}
                          className="cv-dest-input cv-dest-code-input"
                          type="text"
                          name="classCode"
                          value={p.classCode}
                          placeholder={ENTRY_COPY.classCodePlaceholder}
                          autoComplete="off"
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="go"
                          readOnly={busy}
                          aria-invalid={codeInvalid || undefined}
                          aria-describedby={codeInvalid ? "cv-dest-error-escape" : undefined}
                          onChange={(e) => p.onClassCode(sanitizeCodeInput(e.target.value))}
                        />
                        <span
                          className={"cv-dest-count" + (p.classCode.length === CLASS_CODE_LENGTH ? " is-full" : "")}
                          aria-hidden="true"
                        >
                          {p.classCode.length}/{CLASS_CODE_LENGTH}
                        </span>
                      </span>
                    </label>
                  ) : (
                    <>
                      <label className="cv-dest-field">
                        <span className="cv-dest-label">{ENTRY_COPY.teacherKey}</span>
                        <span className="cv-dest-input-wrap" data-shake={keyInvalid ? shake : undefined}>
                          <input
                            ref={keyRef}
                            className="cv-dest-input cv-dest-key-input"
                            // A credential: masked, never autofilled, never saved (state of this screen only).
                            type="password"
                            name="teacherKey"
                            value={p.teacherKey}
                            autoComplete="off"
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck={false}
                            enterKeyHint="go"
                            readOnly={busy}
                            aria-invalid={keyInvalid || undefined}
                            aria-describedby={keyInvalid ? "cv-dest-error-escape" : undefined}
                            onChange={(e) => p.onTeacherKey(e.target.value)}
                          />
                        </span>
                      </label>
                      <fieldset className="cv-dest-field cv-dest-levels" disabled={busy}>
                        <legend className="cv-dest-label">{ENTRY_COPY.textLevel}</legend>
                        <div className="cv-dest-level-row">
                          {TEXT_LEVEL_OPTIONS.map((option) => (
                            <label className="cv-dest-level" key={option.value}>
                              <input
                                type="radio"
                                name="textLevel"
                                value={option.value}
                                checked={p.textLevel === option.value}
                                onChange={() => p.onTextLevel(option.value)}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </>
                  )}

                  <div className="cv-dest-who">
                    <span className="cv-dest-who-tag">{BUILDER_COPY.nickname}</span>
                    <span className="cv-dest-who-name">{p.nickname.trim()}</span>
                    <button
                      type="button"
                      className="cv-dest-who-edit"
                      aria-label={ENTRY_COPY.changeNicknameLabel}
                      onClick={p.onChangeNickname}
                      disabled={busy}
                    >
                      {ENTRY_COPY.changeNickname}
                      <BuilderIcon name="pencil" />
                    </button>
                  </div>
                  {student && (
                    <p className="cv-dest-note">
                      <Mark name="shield" />
                      {ENTRY_COPY.nicknameNote}
                    </p>
                  )}

                  {errorFor("escape")}

                  <GoButton
                    label={student ? ENTRY_COPY.enter : ENTRY_COPY.openClass}
                    busyLabel={student ? ENTRY_COPY.entering : ENTRY_COPY.opening}
                    busy={p.pending === "escape"}
                    disabled={busy}
                    buttonRef={goRef}
                  />
                  <button
                    type="button"
                    className="cv-dest-role"
                    onClick={() => p.onRole(student ? "teacher" : "student")}
                    disabled={busy}
                  >
                    <BuilderIcon name={student ? "key" : "swap"} />
                    {student ? ENTRY_COPY.teacherAsk : ENTRY_COPY.studentAsk}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
