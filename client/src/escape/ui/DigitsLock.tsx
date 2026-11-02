import { WheelRow } from "./WheelRow";

/** Every wheel of a digits lock shows 0-9. */
const DIGIT_WHEEL_LEN = 10;
const digitLen = (): number => DIGIT_WHEEL_LEN;
const digitShow = (_i: number, pos: number): string => String(pos);

/**
 * The number lock (AI 학교 탈출, Task 19): `length` wheels of 0-9 drawn from the team's shared input. Turn a wheel
 * with ▲ / ▼, by dragging it, or from the keyboard (type the digits, ← → to move, ↑ ↓ to turn). `value` is
 * what to draw (the server's input, or the change still on its way); `onChange` hands every new value up.
 */
export function DigitsLock({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <WheelRow
        value={value}
        wheelLen={digitLen}
        show={digitShow}
        typeDigits
        label="숫자 자물쇠"
        onChange={onChange}
        onSubmit={onSubmit}
      />
      <span className="cv-sr-only" role="status" aria-live="polite">
        {`지금 맞춘 숫자 ${value.split("").join(" ")}`}
      </span>
    </>
  );
}
