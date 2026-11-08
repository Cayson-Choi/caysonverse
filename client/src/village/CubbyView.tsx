import { useEffect, useRef, useState } from "react";
import { CANDLE_RATE } from "@caysonverse/shared/village/messages";
import { sendLightCandle } from "../net/connection";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { SAMPLE_BY_ID } from "./sampleCubbies";
import {
  CUBBY_COPY,
  closeCubbyCard,
  cubbyIdAt,
  litByLabel,
  moveCubbyRow,
  photoAlt,
  photoBackground,
  rowLabel,
  useCubbyCard,
  yearsLabel,
} from "./cubbyCard";
import { burningCandles, candleClock, isCandleBurning, pruneCandles, useCandles } from "./hallCandles";
import { useLocalArea } from "./villageArea";
import "./cubbyView.css";

/** The card's id on the overlay stack (Esc closes it; WASD and E stay with it while it is open). */
export const CUBBY_OVERLAY_ID = "cubby";

/** Rows in a cubby column (the layout's 7). */
const ROWS = 7;

/** A press the server never answered (out of reach, the 5 s cap) gives the button back after this long. */
const LIGHT_WAIT_MS = 2000;

/**
 * The close-up card of a memorial cubby (케이슨 마을 Task 9; the pure part is cubbyCard.ts). Opened by "가까이 보기"
 * within 1.2 m of a column; shows the cubby nearest eye height first, "위 칸" / "아래 칸" step through the column. A filled
 * cubby: portrait, name, years, the family's line and "촛불 켜기"; an empty one: "곧 이 자리에 우리 아이를 모실 수 있어요".
 * Closes with 닫기, Esc, or when the player leaves the hall.
 */
export function CubbyView() {
  const card = useCubbyCard();
  const area = useLocalArea();
  useCandles(); // re-render when a candle is lit or goes out
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const lastSent = useRef(-Infinity);
  const [, setTick] = useState(0);

  const open = card !== null && area === "hall";
  useEffect(() => {
    if (card !== null && area !== "hall") closeCubbyCard();
  }, [card, area]);
  useEffect(() => {
    if (!open) return;
    pushOverlay(CUBBY_OVERLAY_ID, closeCubbyCard);
    return () => popOverlay(CUBBY_OVERLAY_ID);
  }, [open]);
  useEffect(() => () => closeCubbyCard(), []);
  // While open, burnt-out candles are dropped and the "wait a moment" state ends on time (1 Hz is plenty for a label).
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      pruneCandles();
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") moveCubbyRow(1);
      else if (e.key === "ArrowDown") moveCubbyRow(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (pendingFor === null) return;
    const t = setTimeout(() => setPendingFor(null), LIGHT_WAIT_MS);
    return () => clearTimeout(t);
  }, [pendingFor]);

  if (!open || card === null) return null;
  const id = cubbyIdAt(card.column, card.row);
  const sample = id ? SAMPLE_BY_ID.get(id) : undefined;
  const now = candleClock();
  const burning = id !== null && isCandleBurning(id, now);
  const coolingDown = now - lastSent.current < CANDLE_RATE.windowMs;
  const pending = id !== null && pendingFor === id && !burning;

  const light = () => {
    if (!id || burning || pending || coolingDown) return;
    lastSent.current = candleClock();
    setPendingFor(id);
    sendLightCandle(id);
  };

  return (
    <div className="cv-cubby" role="dialog" aria-modal="true" aria-label={CUBBY_COPY.dialog} data-cubby={id ?? ""}>
      <div className="cv-cubby-backdrop" onPointerDown={closeCubbyCard} />
      <div className="cv-cubby-panel">
        <div className="cv-cubby-where">{rowLabel(card.row)}</div>
        {sample ? (
          <>
            <div className="cv-cubby-photo" role="img" aria-label={photoAlt(sample.name)} style={photoBackground(sample.photo)}>
              {burning ? <span className="cv-cubby-flame" aria-hidden="true" /> : null}
            </div>
            <div className="cv-cubby-name">{sample.name}</div>
            <div className="cv-cubby-years">{yearsLabel(sample)}</div>
            <p className="cv-cubby-line">{sample.line}</p>
            <button
              type="button"
              className="cv-cubby-light"
              disabled={burning || pending || coolingDown}
              onClick={light}
            >
              {burning ? CUBBY_COPY.burning : pending ? CUBBY_COPY.lighting : coolingDown ? CUBBY_COPY.wait : CUBBY_COPY.light}
            </button>
            {burning ? <div className="cv-cubby-by">{litByLabel(burningCandles().get(id!)?.by ?? "")}</div> : null}
          </>
        ) : (
          <>
            <div className="cv-cubby-photo is-empty" aria-hidden="true" />
            <div className="cv-cubby-name">{CUBBY_COPY.emptyTitle}</div>
            <p className="cv-cubby-line">{CUBBY_COPY.empty}</p>
          </>
        )}
        <div className="cv-cubby-nav">
          <button type="button" onClick={() => moveCubbyRow(-1)} disabled={card.row === 0}>
            {CUBBY_COPY.down}
          </button>
          <button type="button" onClick={() => moveCubbyRow(1)} disabled={card.row >= ROWS - 1}>
            {CUBBY_COPY.up}
          </button>
          <button type="button" className="cv-cubby-close" onClick={closeCubbyCard}>
            {CUBBY_COPY.close}
          </button>
        </div>
      </div>
    </div>
  );
}
