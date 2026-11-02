import { useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EscapeMsg } from "@caysonverse/shared/escape/messages";
import { isTouchDevice } from "../../device";
import { sendEscape } from "../../net/connection";
import { FOCUSABLE_SELECTOR } from "../../ui/focusTrap";
import { cycleBin } from "./lockInput";
import { useOverrides } from "./useLockState";

interface Bin {
  id: string;
  label: string;
}
interface Card {
  id: string;
  label: string;
}

/**
 * The sorting board (AI 학교 탈출, Task 19): the room's cards, in the order the server sent them, sorted into its
 * bins. It draws the team's shared board — a card a teammate moved moves here too. A card not in any bin
 * sits in the tray ("아직 안 놓은 카드"). To move a card: drag it onto a bin (a PC), or tap it — each tap
 * sends it to the next bin and then back to the tray (`cycleBin`; the way on a phone, and Enter / Space
 * on a focused card). Arrow keys walk the cards.
 *
 * Every move is one `BoardPlace`; the card shows its new place at once and the server's board takes over
 * when it echoes. Whether the cards are in the RIGHT bins is never known here: "열기" (the lock panel)
 * asks the server, which answers how many are out of place.
 */
export function SortBoard({
  lockId,
  bins,
  cards,
  server,
}: {
  lockId: string;
  bins: readonly Bin[];
  cards: readonly Card[];
  /** The team's board: cardId → binId ("" or missing = in the tray). */
  server: Readonly<Record<string, string>>;
}) {
  const { get, set } = useOverrides(server);
  const binIds = useMemo(() => bins.map((b) => b.id), [bins]);
  const drag = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  /** Where a card is now: its pending move, else the server's board, else the tray. A bin the room does not have reads as the tray. */
  const binOf = (cardId: string): string => {
    const b = get(cardId, server[cardId] ?? "");
    return binIds.includes(b) ? b : "";
  };

  const place = (cardId: string, bin: string): void => {
    if (binOf(cardId) === bin) return;
    set(cardId, bin);
    sendEscape(EscapeMsg.BoardPlace, { lockId, cardId, bin });
  };

  const groups: Card[][] = [[], ...bins.map(() => [] as Card[])];
  for (const c of cards) groups[binIds.indexOf(binOf(c.id)) + 1].push(c);
  const placed = cards.length - groups[0].length;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length].focus();
  };

  const dropOn = (bin: string) => ({
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      if (drag.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (hover !== bin) setHover(bin);
    },
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover((h) => (h === bin ? null : h));
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault();
      const id = drag.current;
      drag.current = null;
      setHover(null);
      if (id !== null) place(id, bin);
    },
  });

  const renderCard = (c: Card) => {
    const here = binOf(c.id);
    const binLabel = bins.find((b) => b.id === here)?.label;
    return (
      <button
        key={c.id}
        type="button"
        className={"cv-sort-card" + (here !== "" ? " is-placed" : "")}
        draggable={!isTouchDevice}
        aria-label={`${c.label}, ${binLabel ? `${binLabel} 칸에 있어요` : "아직 놓지 않았어요"}. 누르면 다음 칸으로 옮겨요`}
        onDragStart={(e) => {
          drag.current = c.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", c.id);
        }}
        onDragEnd={() => {
          drag.current = null;
          setHover(null);
        }}
        onClick={() => place(c.id, cycleBin(here, binIds))}
      >
        {c.label}
      </button>
    );
  };

  return (
    <div className="cv-sort" role="group" aria-label="분류판" tabIndex={0} data-lock-focus="" onKeyDown={onKeyDown}>
      <div className={"cv-sort-tray" + (hover === "" ? " is-over" : "")} {...dropOn("")}>
        <div className="cv-sort-title">
          아직 안 놓은 카드 <span className="cv-sort-count">{groups[0].length}</span>
        </div>
        <div className="cv-sort-cards">
          {groups[0].length === 0 ? <span className="cv-sort-empty">모두 놓았어요</span> : groups[0].map(renderCard)}
        </div>
      </div>
      <div className="cv-sort-bins">
        {bins.map((b, k) => (
          <div key={b.id} className={"cv-sort-bin" + (hover === b.id ? " is-over" : "")} data-bin={b.id} {...dropOn(b.id)}>
            <div className="cv-sort-title">
              {b.label} <span className="cv-sort-count">{groups[k + 1].length}</span>
            </div>
            <div className="cv-sort-cards">{groups[k + 1].map(renderCard)}</div>
          </div>
        ))}
      </div>
      <p className="cv-sort-hint" aria-live="polite">
        {`${placed}/${cards.length}장 놓았어요 · ${isTouchDevice ? "카드를 누르면 칸이 바뀌어요" : "카드를 끌어서 놓거나, 눌러서 옮겨요"}`}
      </p>
    </div>
  );
}
