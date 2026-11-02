import { useEffect, useMemo, useState } from "react";
import { EscapeMsg, type PublicItem } from "@caysonverse/shared/escape/messages";
import { isTouchDevice } from "../../device";
import { sendEscape } from "../../net/connection";
import { useEscapeStore } from "../../stores/escapeStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTouchHudLayout } from "../../ui/useTouchHudLayout";
import { bagChips, bagEventText, reconcileSelection, selectItem, type BagSelection } from "./bag";
import "../escape.css";

const NO_ITEMS: readonly PublicItem[] = [];
const NO_SELECTION: BagSelection = { first: null };
/** Gap between the bag button and the context button under it (touch). */
const TOUCH_GAP_PX = 8;

/**
 * The toast the whole team reads when someone puts an item in the bag or combines two ("○○님이 자외선
 * 손전등을 만들었어요"): the room's `picked` / `combined` events turned into the classroom toast. Lives as
 * long as the bag panel does (the scene's whole life); an event that was already there at mount is not replayed.
 */
function useBagToasts(): void {
  useEffect(() => {
    let seen = useEscapeStore.getState().eventSeq;
    return useEscapeStore.subscribe((s) => {
      if (s.eventSeq === seen) return;
      seen = s.eventSeq;
      const ev = s.lastEvent;
      if (ev === null || s.content === null) return;
      const text = bagEventText(ev, s.content.items, s.view?.members ?? []);
      if (text !== null) s.showToast(text);
    });
  }, []);
}

/**
 * The team bag (AI 학교 탈출, Task 18): 🎒 at the bottom right (above the context button on a phone,
 * above the E pill on a PC) with the number of things in it; a tap opens the tray of chips. The bag is
 * the TEAM's — everyone sees the same chips. Tap one chip to pick it (highlighted), tap another to ask
 * the server to combine the two, tap the same one again to put it back. The answer comes as the room's
 * `combined` event (a toast for everyone), not from here. Nothing about the recipes is known on this
 * side: any two items may be tried.
 */
export function BagPanel() {
  const bagKey = useEscapeStore((s) => (s.view ? s.view.bag.join("|") : ""));
  const items = useEscapeStore((s) => s.content?.items ?? NO_ITEMS);
  const bag = useMemo(() => (bagKey === "" ? [] : bagKey.split("|")), [bagKey]);
  const chips = useMemo(() => bagChips(bag, items), [bag, items]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<BagSelection>(NO_SELECTION);
  const layout = useTouchHudLayout();
  const mirrored = useSettingsStore((s) => s.settings.leftHanded) && isTouchDevice;
  useBagToasts();

  // An item that left the bag (combined away) cannot stay selected.
  useEffect(() => setSel((s) => reconcileSelection(s, bag)), [bag]);

  const tap = (id: string): void => {
    const r = selectItem(sel, id);
    setSel(r.sel);
    if (r.combine !== null) sendEscape(EscapeMsg.Combine, { a: r.combine[0], b: r.combine[1] });
  };

  const a = layout.action;
  const style = isTouchDevice
    ? { left: a.x, top: a.y - TOUCH_GAP_PX - a.w, width: a.w, height: a.w }
    : undefined;

  return (
    <div className={"cv-escui cv-esc-bag" + (isTouchDevice ? " is-touch" : "") + (mirrored ? " is-mirrored" : "")} style={style}>
      {open && (
        <div className="cv-esc-bag-tray" role="group" aria-label="팀 가방">
          <div className="cv-esc-bag-title">
            <span aria-hidden="true">🎒</span> 팀 가방
          </div>
          {chips.length === 0 && <p className="cv-esc-bag-note">아직 비어 있어요</p>}
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className={"cv-esc-bag-chip" + (sel.first === c.id ? " is-picked" : "")}
              aria-pressed={sel.first === c.id}
              // A mouse click must not leave focus on the chip (Space / Enter would press it again).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => tap(c.id)}
            >
              <span className="cv-esc-bag-chip-icon" aria-hidden="true">
                {c.icon}
              </span>
              <span className="cv-esc-bag-chip-label">{c.label}</span>
            </button>
          ))}
          {sel.first !== null && <p className="cv-esc-bag-note">합칠 물건을 하나 더 눌러요</p>}
        </div>
      )}
      <button
        type="button"
        className={"cv-esc-bag-btn" + (open ? " is-open" : "")}
        aria-expanded={open}
        aria-label={`팀 가방, ${chips.length}개`}
        // Like the context button: never keep focus, so Space / Enter cannot press it again.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        tabIndex={-1}
      >
        <span aria-hidden="true">🎒</span>
        <span className="cv-esc-bag-count" key={chips.length} aria-hidden="true">
          {chips.length}
        </span>
      </button>
    </div>
  );
}
