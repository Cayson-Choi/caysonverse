import { useEffect, useState } from "react";
import { VillageServerMsg, type KeypadResultPayload } from "@caysonverse/shared/village/messages";
import { getRoom, sendKeypad } from "../net/connection";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { useLocalArea } from "./villageArea";
import { closeKeypad, keypadPending, noteKeypadResult, useKeypad } from "./keypadStore";
import "./villageKeypad.css";

export const KEYPAD_OVERLAY_ID = "keypad";

function reasonText(result: KeypadResultPayload): string {
  switch (result.reason) {
    case "locked_out": return `잠금 상태예요. ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}초 뒤 다시 시도해 주세요.`;
    case "rate_limited": return "잠시 뒤 다시 시도해 주세요.";
    case "too_far": return "번호키에서 조금 더 가까이 서 주세요.";
    case "invalid_code": return "숫자 4자리를 입력해 주세요.";
    case "wrong_code": return "비밀번호가 맞지 않아요.";
    default: return "문을 열 수 없어요.";
  }
}

export function VillageKeypad() {
  const area = useLocalArea();
  const keypad = useKeypad();
  const [code, setCode] = useState("");
  const open = keypad.buildingId !== null && area === "village";

  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return room.onMessage<KeypadResultPayload>(VillageServerMsg.KeypadResult, (result) => {
      if (!result || typeof result.buildingId !== "string") return;
      noteKeypadResult(result);
    });
  }, []);
  useEffect(() => {
    if (!open) {
      closeKeypad();
      return;
    }
    pushOverlay(KEYPAD_OVERLAY_ID, closeKeypad);
    return () => popOverlay(KEYPAD_OVERLAY_ID);
  }, [open]);
  useEffect(() => {
    if (area !== "village") closeKeypad();
  }, [area]);

  if (!open || keypad.buildingId === null) return null;
  const result = keypad.result;
  const submit = () => {
    if (keypad.pending || code.length !== 4) return;
    keypadPending();
    sendKeypad(keypad.buildingId!, code);
  };
  return (
    <div className="cv-keypad" role="dialog" aria-modal="true" aria-label="집 번호키">
      <div className="cv-keypad-backdrop" onPointerDown={closeKeypad} />
      <div className="cv-keypad-panel">
        <div className="cv-keypad-title">집 번호키</div>
        <div className="cv-keypad-house">{keypad.buildingId}</div>
        <p className="cv-keypad-hint">비밀번호 4자리를 입력하면 문이 열려요.</p>
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          aria-label="비밀번호 4자리"
        />
        <button type="button" className="cv-keypad-submit" disabled={keypad.pending || code.length !== 4} onClick={submit}>
          {keypad.pending ? "확인 중…" : "문 열기"}
        </button>
        {result ? (
          <div className={`cv-keypad-result ${result.ok ? "is-ok" : "is-error"}`} aria-live="polite">
            {result.ok ? "잠금이 해제됐어요. 실내 공간으로 이동합니다." : reasonText(result)}
            {result.ok && result.placeholder ? <small>집 내부 3D 모델은 다음 아트 단계에서 연결됩니다.</small> : null}
          </div>
        ) : null}
        <button type="button" className="cv-keypad-close" onClick={closeKeypad}>닫기</button>
      </div>
    </div>
  );
}

