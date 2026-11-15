import { useClickHint } from "../stores/clickHintStore";
import "./clickHint.css";

/**
 * The click hint (stores/clickHintStore.ts): one calm line low in the middle of the screen for a moment, read aloud by a screen
 * reader (role status), never in the way — a touch or a click goes straight through it.
 */
export function ClickHint() {
  const text = useClickHint((s) => s.text);
  const serial = useClickHint((s) => s.serial);
  if (!text) return null;
  return (
    <div key={serial} className="cv-click-hint" role="status" aria-live="polite" data-testid="click-hint">
      {text}
    </div>
  );
}
