import { useCallback } from "react";
import { WheelRow } from "./WheelRow";

/**
 * The letter lock (AI 학교 탈출, Task 19): one wheel of letters per `wheels` entry, in the order the room sent them.
 * The shared input is one position digit per wheel, so a letter wheel is turned exactly like a number wheel
 * (▲ / ▼, a drag, ↑ ↓ from the keyboard). The letters on the wheels are the room's public content; whether a
 * combination is the right word is the server's to say.
 */
export function LettersLock({
  wheels,
  value,
  onChange,
  onSubmit,
}: {
  wheels: readonly (readonly string[])[];
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const wheelLen = useCallback((i: number) => wheels[i]?.length ?? 1, [wheels]);
  const show = useCallback((i: number, pos: number) => wheels[i]?.[pos] ?? "", [wheels]);
  const now = value
    .split("")
    .map((c, i) => wheels[i]?.[c.charCodeAt(0) - 48] ?? "")
    .join(" ");
  return (
    <>
      <WheelRow
        value={value}
        wheelLen={wheelLen}
        show={show}
        typeDigits={false}
        label="글자 자물쇠"
        onChange={onChange}
        onSubmit={onSubmit}
      />
      <span className="cv-sr-only" role="status" aria-live="polite">
        {`지금 맞춘 글자 ${now}`}
      </span>
    </>
  );
}
