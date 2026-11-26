import { useCallback, useEffect, useState } from "react";
import { serverRefused } from "../game/sentMoves";
import { VillageServerMsg, type KeypadResultPayload } from "@caysonverse/shared/village/messages";
import { houseNumberOf } from "@caysonverse/shared/village/houseAreas";
import { getRoom, sendKeypad } from "../net/connection";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { useLocalArea } from "./villageArea";
import { closeKeypad, keypadPending, noteKeypadResult, useKeypad } from "./keypadStore";
import { beginHouseEntry } from "./houseEntry";
import { prefetchHouse } from "./houseRelease";
import { KEYPAD_TEXT, houseOpen, keypadTitle, lockoutText } from "./keypadText";
import "./villageKeypad.css";

export const KEYPAD_OVERLAY_ID = "keypad";

function reasonText(result: KeypadResultPayload): string {
  switch (result.reason) {
    case "locked_out": return lockoutText((result.retryAfterMs ?? 30_000) / 1000);
    case "rate_limited":
    case "wrong_code": return KEYPAD_TEXT.wrong;
    case "invalid_code": return "숫자 4자리를 입력해 주세요.";
    case "not_ready": return KEYPAD_TEXT.notReady;
    case "full": return KEYPAD_TEXT.full;
    case "too_far": return KEYPAD_TEXT.tooFar;
    case "busy": return KEYPAD_TEXT.busy;
    default: return KEYPAD_TEXT.invalid;
  }
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"] as const;

/**
 * The house door lock (집 실내 G, design 5.2): a 3 x 4 number pad with big touch cells, four dots, "확인". The code is entered again on
 * every entry (nothing is remembered), a wrong one shakes and clears, five wrong ones lock the pad for 30 s (the server counts; the
 * countdown here). A house with no interior yet says so and sends nothing. Opening the pad starts the house's model download
 * (`prefetchHouse`); a right code raises the "집에 들어가는 중…" cover (houseEntry.ts) over the server's move.
 */
export function VillageKeypad() {
  const area = useLocalArea();
  const keypad = useKeypad();
  const [code, setCode] = useState("");
  const [shake, setShake] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const open = keypad.buildingId !== null && area === "village";
  const buildingId = keypad.buildingId;
  const ready = buildingId !== null && houseOpen(buildingId);

  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return room.onMessage<KeypadResultPayload>(VillageServerMsg.KeypadResult, (result) => {
      if (!result || typeof result.buildingId !== "string") return;
      noteKeypadResult(result);
      if (result.ok) {
        beginHouseEntry(); // the cover stands over the server's move until the floor is drawn
        closeKeypad();
        return;
      }
      setCode("");
      // the server has me away from the door (fix/net-sync): the self-correction brings my position back in step
      if (result.reason === "too_far") serverRefused();
      if (result.reason === "wrong_code" || result.reason === "rate_limited") setShake((s) => s + 1);
      if (result.reason === "locked_out") {
        setNow(Date.now());
        setLockedUntil(Date.now() + (result.retryAfterMs ?? 30_000));
      }
    });
  }, []);
  useEffect(() => {
    if (!open) {
      closeKeypad();
      return;
    }
    setCode("");
    setLockedUntil(0);
    pushOverlay(KEYPAD_OVERLAY_ID, closeKeypad);
    return () => popOverlay(KEYPAD_OVERLAY_ID);
  }, [open, buildingId]);
  useEffect(() => {
    if (area !== "village") closeKeypad();
  }, [area]);
  // opening the pad starts the house's download (the model is usually in by the time the code is typed)
  useEffect(() => {
    if (!open || buildingId === null || !ready) return;
    const n = houseNumberOf(buildingId);
    if (n !== null) prefetchHouse(n);
  }, [open, buildingId, ready]);
  // the lockout countdown
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= lockedUntil) setLockedUntil(0);
    }, 250);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const locked = lockedUntil > now;
  const result = keypad.result;
  const submit = useCallback(() => {
    if (keypad.pending || code.length !== 4 || locked || buildingId === null) return;
    keypadPending();
    sendKeypad(buildingId, code);
  }, [keypad.pending, code, locked, buildingId]);
  const press = useCallback(
    (key: (typeof KEYS)[number]) => {
      if (keypad.pending || locked) return;
      if (key === "ok") return submit();
      if (key === "back") return setCode((c) => c.slice(0, -1));
      setCode((c) => (c.length < 4 ? c + key : c));
    },
    [keypad.pending, locked, submit],
  );
  // the physical keyboard: digits, Backspace, Enter (Esc is the overlay stack's)
  useEffect(() => {
    if (!open || !ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key as (typeof KEYS)[number]);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter") press("ok");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ready, press]);

  if (!open || buildingId === null) return null;
  const message = locked
    ? lockoutText((lockedUntil - now) / 1000)
    : !ready
      ? KEYPAD_TEXT.notReady
      : result && !result.ok
        ? reasonText(result)
        : result?.ok
          ? KEYPAD_TEXT.opening
          : null;
  return (
    <div className="cv-keypad" role="dialog" aria-modal="true" aria-label={keypadTitle(buildingId)} data-house={buildingId}>
      <div className="cv-keypad-backdrop" onPointerDown={closeKeypad} />
      <div className="cv-keypad-panel" key={shake} data-shake={shake > 0 ? "1" : "0"}>
        <div className="cv-keypad-title">{keypadTitle(buildingId)}</div>
        {ready ? (
          <>
            <div className="cv-keypad-dots" aria-label={`${code.length}자리 입력됨`} data-length={code.length}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={i < code.length ? "is-on" : undefined} />
              ))}
            </div>
            <div className="cv-keypad-grid">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`cv-keypad-key${k === "ok" ? " is-ok" : ""}${k === "back" ? " is-back" : ""}`}
                  data-key={k}
                  disabled={keypad.pending || locked || (k === "ok" && code.length !== 4)}
                  onClick={() => press(k)}
                  aria-label={k === "back" ? "지우기" : k === "ok" ? "확인" : k}
                >
                  {k === "back" ? "⌫" : k === "ok" ? "확인" : k}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {message ? (
          <div className={`cv-keypad-result ${result?.ok ? "is-ok" : "is-error"}`} aria-live="polite" data-reason={result?.reason ?? (locked ? "locked_out" : ready ? "" : "not_ready")}>
            {message}
          </div>
        ) : null}
        <button type="button" className="cv-keypad-close" onClick={closeKeypad}>닫기</button>
      </div>
    </div>
  );
}
