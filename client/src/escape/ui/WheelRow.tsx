import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cursorMove, dragSteps, spinWheel, typeDigit } from "./lockInput";

/** A vertical drag turns a wheel one position per this many CSS px. */
const DRAG_STEP_PX = 26;

/**
 * A row of number / letter wheels (AI 학교 탈출, Task 19) — the part the digits lock and the letters lock share.
 * It draws `value` (one wheel-position digit per wheel, the shared input) and reports every change through
 * `onChange(next)`; the parent decides what to do with it (show it at once, send it to the server).
 *
 * Ways to turn a wheel: the ▲ / ▼ buttons above and below it, a vertical drag on its face (up = the next
 * position, like a drum), or the keyboard — ← → move the cursor wheel, ↑ ↓ turn it, Home / End jump, and
 * (digits lock) 0-9 write a digit and move on, Backspace / Delete zero it. Enter opens the lock.
 * The row itself is the one tab stop (the ▲ ▼ buttons are for the mouse and the finger), and its
 * `data-lock-focus` mark is how the close-up gives it the keyboard when it opens.
 */
export function WheelRow({
  value,
  wheelLen,
  show,
  typeDigits,
  label,
  onChange,
  onSubmit,
}: {
  value: string;
  /** How many positions wheel `i` has (digits: 10; letters: that wheel's letters). */
  wheelLen: (i: number) => number;
  /** What wheel `i` shows at position `pos`. */
  show: (i: number, pos: number) => string;
  /** The digits lock lets 0-9 be typed. */
  typeDigits: boolean;
  /** Spoken name of the row. */
  label: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  // The cursor wheel: which one the keyboard turns. Local to the row (the server does not know it).
  const [cursor, setCursor] = useState(0);
  // The value the drag handlers build on: always the latest one this component drew or produced.
  const latest = useRef(value);
  latest.current = value;
  const drag = useRef<{ id: number; wheel: number; y0: number; applied: number } | null>(null);

  const commit = (next: string): void => {
    if (next === latest.current) return;
    latest.current = next;
    onChange(next);
  };
  const spin = (i: number, dir: 1 | -1): void => commit(spinWheel(latest.current, i, dir, wheelLen(i)));

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    const len = value.length;
    switch (e.key) {
      case "ArrowLeft":
        setCursor(cursorMove(cursor, -1, len));
        break;
      case "ArrowRight":
        setCursor(cursorMove(cursor, 1, len));
        break;
      case "ArrowUp":
        spin(cursor, 1);
        break;
      case "ArrowDown":
        spin(cursor, -1);
        break;
      case "Home":
        setCursor(0);
        break;
      case "End":
        setCursor(Math.max(0, len - 1));
        break;
      case "Backspace":
      case "Delete": {
        if (!typeDigits) return;
        commit(typeDigit(latest.current, cursor, "0").value);
        if (e.key === "Backspace") setCursor(cursorMove(cursor, -1, len));
        break;
      }
      case "Enter":
        // Enter on a ▲ / ▼ / 열기 button is that button's own click.
        if (e.target !== e.currentTarget) return;
        onSubmit();
        break;
      default: {
        if (!typeDigits || e.key.length !== 1 || e.key < "0" || e.key > "9") return;
        const r = typeDigit(latest.current, cursor, e.key);
        setCursor(r.cursor);
        commit(r.value);
      }
    }
    e.preventDefault();
  };

  const onFaceDown = (i: number, e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setCursor(i);
    drag.current = { id: e.pointerId, wheel: i, y0: e.clientY, applied: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onFaceMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const steps = dragSteps(e.clientY - d.y0, DRAG_STEP_PX);
    if (steps === d.applied) return;
    const dir = steps > d.applied ? 1 : -1;
    let next = latest.current;
    for (let k = d.applied; k !== steps; k += dir) next = spinWheel(next, d.wheel, dir, wheelLen(d.wheel));
    d.applied = steps;
    commit(next);
  };
  const onFaceEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const wheels: number[] = [];
  for (let i = 0; i < value.length; i++) wheels.push(i);

  return (
    <div className="cv-wheels" role="group" aria-label={label} tabIndex={0} data-lock-focus="" onKeyDown={onKeyDown}>
      {wheels.map((i) => {
        const len = Math.max(1, wheelLen(i));
        const pos = (value.charCodeAt(i) - 48 + len * 10) % len;
        const prev = (pos + len - 1) % len;
        const next = (pos + 1) % len;
        return (
          <div className={"cv-wheel" + (i === cursor ? " is-cursor" : "")} key={i}>
            <button
              type="button"
              className="cv-wheel-btn"
              tabIndex={-1}
              aria-label={`${i + 1}번째 칸 올리기`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setCursor(i);
                spin(i, 1);
              }}
            >
              <span aria-hidden="true">▲</span>
            </button>
            <div
              className="cv-wheel-face"
              onPointerDown={(e) => onFaceDown(i, e)}
              onPointerMove={onFaceMove}
              onPointerUp={onFaceEnd}
              onPointerCancel={onFaceEnd}
            >
              <span className="cv-wheel-peek" aria-hidden="true">
                {show(i, prev)}
              </span>
              <span className="cv-wheel-now">{show(i, pos)}</span>
              <span className="cv-wheel-peek" aria-hidden="true">
                {show(i, next)}
              </span>
            </div>
            <button
              type="button"
              className="cv-wheel-btn"
              tabIndex={-1}
              aria-label={`${i + 1}번째 칸 내리기`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setCursor(i);
                spin(i, -1);
              }}
            >
              <span aria-hidden="true">▼</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
