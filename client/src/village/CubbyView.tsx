import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CANDLE_RATE } from "@caysonverse/shared/village/messages";
import { sendLightCandle } from "../net/connection";
import { popOverlay, pushOverlay } from "../ui/overlayStack";
import { HALL_CUBBY_ANCHORS, SAMPLE_BY_ID } from "./sampleCubbies";
import { claimYears } from "@caysonverse/shared/memorial/validate";
import { claimFor, isMine, noteMyClaim, refreshSlot, useClaims } from "./memorial/claimsStore";
import { mediaUrl, memorialApi, MemorialApiError } from "./memorial/memorialApi";
import { MEM_COPY, openSheet } from "./memorial/memorialSheets";
import { prepareUpload } from "./memorial/imageResize";
import "./memorial/memorial.css";
import {
  CUBBY_COPY,
  closeCubbyCard,
  cubbyCardAnchor,
  cubbyIdAt,
  litByLabel,
  moveCubbyRow,
  openCubbyAt,
  photoAlt,
  photoBackground,
  rowLabel,
  useCubbyCard,
  yearsLabel,
} from "./cubbyCard";
import { burningCandles, candleClock, isCandleBurning, pruneCandles, useCandles } from "./hallCandles";
import { resetCubbyFocus, setCubbyFocus, setCubbyFocusInset } from "./cubbyFocus";
import { useLocalArea } from "./villageArea";
import "./cubbyView.css";

/** The card's id on the overlay stack (Esc closes it; WASD and E stay with it while it is open). */
export const CUBBY_OVERLAY_ID = "cubby";

/** Rows in a cubby column (the layout's 8). */
const ROWS = 8;

/** A press the server never answered (out of reach, the 5 s cap) gives the button back after this long. */
const LIGHT_WAIT_MS = 2000;

/**
 * The close-up of a memorial cubby (케이슨 마을 Task 9; the pure part is cubbyCard.ts). Opened by "가까이 보기" within 1.2 m of a
 * column, or by clicking / tapping any cubby in the hall — the top row as easily as the middle (owner 2026-11-13). The camera
 * glides to the front of that cubby at its own height (cubbyFocus.ts) and the card docks beside it (on the right of a wide
 * screen, at the bottom of a phone), so the cubby itself stays in view; "위 칸" / "아래 칸" move the close-up through the column.
 * A filled cubby: portrait, name, years, the family's line and "촛불 켜기" (who lit it and how long ago); the hall's one example
 * is marked 견본. A family's cubby (memorial stage B): its photo (the family also sees one in review, marked 검토 중이에요), name,
 * years, line and candle; on the family's own devices 고치기 / 사진 바꾸기 / 가족 기기. An empty one: "우리 아이 모시기" while this
 * family has a free cubby left (else "한 가족에 한 칸" + a way to its own), or the old "곧 …" line when the server has no memorial
 * store. Ends with "가까이 보기 끝내기", Esc, or leaving the hall.
 */
export function CubbyView() {
  const card = useCubbyCard();
  const area = useLocalArea();
  useCandles(); // re-render when a candle is lit or goes out
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const lastSent = useRef(-Infinity);
  const [, setTick] = useState(0);

  const open = card !== null && area === "hall";
  const claims = useClaims();
  const [photoStatus, setPhotoStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cardId = card ? cubbyIdAt(card.column, card.row) : null;
  // Opening a claimed cubby refetches it: fresh signed links for a family's photo in review, a photo approved meanwhile.
  useEffect(() => {
    setPhotoStatus("");
    if (open && cardId && claims.claims.has(cardId)) void refreshSlot(cardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cardId]);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (card !== null && area !== "hall") closeCubbyCard();
  }, [card, area]);
  // The camera follows the card: in front of the cubby it shows while open, back to the player's view when it closes.
  const anchor = open ? cubbyCardAnchor(card) : null;
  useEffect(() => {
    setCubbyFocus(anchor);
  }, [anchor]);
  useEffect(() => () => resetCubbyFocus(), []);
  useEffect(() => {
    if (area !== "hall") resetCubbyFocus();
  }, [area]);
  // What the card covers, so the cubby is framed in the part of the screen left free.
  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      if (wideLayout(w, h)) setCubbyFocusInset({ side: "right", frac: Math.min(0.6, (w - r.left) / w) });
      else setCubbyFocusInset({ side: "bottom", frac: Math.min(0.6, (h - r.top) / h) });
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
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

  const lit = id !== null && burning ? burningCandles().get(id) : undefined;
  const bank = id ? id.split("-")[1] ?? "" : "";
  const claim = sample ? undefined : claimFor(id, claims);
  const mine = isMine(claim) ? claim : undefined;
  const filled = Boolean(sample || claim);
  const myFirst = [...claims.mine.keys()][0];
  const shownPhoto = mine ? (mine.familyCover?.urls ?? null) : (claim?.photo ?? null);
  const pendingPhoto = mine?.familyCover?.moderation === "pending";

  const changePhoto = async (file: File | undefined) => {
    if (!file || !mine) return;
    setPhotoStatus(MEM_COPY.photoBusy);
    const out = await prepareUpload(file);
    if (out === "too_big") return setPhotoStatus(MEM_COPY.photoTooBig);
    if (out === "not_image") return setPhotoStatus(MEM_COPY.photoNotImage);
    setPhotoStatus(MEM_COPY.uploading);
    try {
      noteMyClaim((await memorialApi.uploadPhoto(mine.claimId, out)).claim);
      setPhotoStatus(MEM_COPY.photoReview);
    } catch (err) {
      setPhotoStatus(err instanceof MemorialApiError ? err.message : MEM_COPY.photoNotImage);
    }
  };
  const goMine = () => {
    const a = HALL_CUBBY_ANCHORS.find((x) => x.id === myFirst);
    if (a) openCubbyAt(a);
  };

  return (
    <div className="cv-cubby" role="dialog" aria-modal="false" aria-label={CUBBY_COPY.dialog} data-cubby={id ?? ""}>
      <div className="cv-cubby-panel" ref={panelRef}>
        <div className="cv-cubby-where">
          {bank ? `${bank} 구역 · ` : ""}
          {rowLabel(card.row)}
        </div>
        {sample ? (
          <div className="cv-cubby-body">
            <div className="cv-cubby-photo" role="img" aria-label={photoAlt(sample.name)} style={photoBackground(sample.photo)}>
              {burning ? <span className="cv-cubby-flame" aria-hidden="true" /> : null}
            </div>
            <div className="cv-cubby-text">
              <div className="cv-cubby-sample" title={CUBBY_COPY.sampleNote}>
                {CUBBY_COPY.sample}
              </div>
              <div className="cv-cubby-name">{sample.name}</div>
              <div className="cv-cubby-years">{yearsLabel(sample)}</div>
              <p className="cv-cubby-line">{sample.line}</p>
              <p className="cv-cubby-note">{CUBBY_COPY.sampleNote}</p>
            </div>
          </div>
        ) : null}
        {claim ? (
          <div className="cv-cubby-body" data-claimed={mine ? "mine" : "public"}>
            <div
              className={`cv-cubby-photo${shownPhoto ? " is-photo" : " is-empty"}`}
              role="img"
              aria-label={photoAlt(claim.petName)}
              style={shownPhoto ? { backgroundImage: `url(${mediaUrl(shownPhoto.s512)})` } : undefined}
            >
              {burning ? <span className="cv-cubby-flame" aria-hidden="true" /> : null}
              {mine && pendingPhoto ? <span className="cv-cubby-badge">{MEM_COPY.pending}</span> : null}
            </div>
            <div className="cv-cubby-text">
              {mine ? <div className="cv-cubby-mine">{MEM_COPY.mineBadge}</div> : null}
              <div className="cv-cubby-name">{claim.petName}</div>
              {claimYears(claim) ? <div className="cv-cubby-years">{claimYears(claim)}</div> : null}
              {claim.line ? <p className="cv-cubby-line">{claim.line}</p> : null}
              {mine && mine.lastRejected && !photoStatus ? <p className="cv-cubby-note">{MEM_COPY.rejected}</p> : null}
              {mine && !shownPhoto && !mine.lastRejected && !photoStatus ? <p className="cv-cubby-note">{MEM_COPY.noPhoto}</p> : null}
              {mine && pendingPhoto && !photoStatus ? <p className="cv-cubby-note">{MEM_COPY.pendingNote}</p> : null}
              {photoStatus ? <p className="cv-cubby-status" role="status">{photoStatus}</p> : null}
            </div>
          </div>
        ) : null}
        {mine && id ? (
          <div className="cv-cubby-family">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void changePhoto(e.target.files?.[0])} />
            <button type="button" onClick={() => openSheet({ kind: "edit", slotId: id })}>
              {MEM_COPY.edit}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              {shownPhoto || mine.lastRejected ? MEM_COPY.photo : MEM_COPY.addPhoto}
            </button>
            <button type="button" onClick={() => openSheet({ kind: "family", slotId: id })}>
              {MEM_COPY.family}
            </button>
          </div>
        ) : null}
        {filled ? (
          <>
            <button
              type="button"
              className="cv-cubby-light"
              disabled={burning || pending || coolingDown}
              onClick={light}
            >
              {burning ? CUBBY_COPY.burning : pending ? CUBBY_COPY.lighting : coolingDown ? CUBBY_COPY.wait : CUBBY_COPY.light}
            </button>
            {lit ? <div className="cv-cubby-by">{litByLabel(lit.by, now - lit.at)}</div> : null}
          </>
        ) : (
          <>
            <div className="cv-cubby-photo is-empty" aria-hidden="true" />
            <div className="cv-cubby-name">{CUBBY_COPY.emptyTitle}</div>
            {claims.status === "off" || claims.status === "idle" || !id ? (
              <p className="cv-cubby-line">{CUBBY_COPY.empty}</p>
            ) : claims.freeLeft > 0 ? (
              <>
                <p className="cv-cubby-line">{MEM_COPY.free}</p>
                <button type="button" className="cv-cubby-claim" onClick={() => openSheet({ kind: "claim", slotId: id })}>
                  {MEM_COPY.claimCta}
                </button>
                {claims.mine.size === 0 ? (
                  <button type="button" className="cv-cubby-link" onClick={() => openSheet({ kind: "recover", slotId: id })}>
                    {MEM_COPY.haveCode}
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <p className="cv-cubby-line">{MEM_COPY.oneOnly}</p>
                {myFirst ? (
                  <button type="button" className="cv-cubby-claim" onClick={goMine}>
                    {MEM_COPY.goMine}
                  </button>
                ) : null}
              </>
            )}
          </>
        )}
        <div className="cv-cubby-nav">
          <button type="button" onClick={() => moveCubbyRow(-1)} disabled={card.row === 0}>
            {CUBBY_COPY.down}
          </button>
          <button type="button" onClick={() => moveCubbyRow(1)} disabled={card.row >= ROWS - 1}>
            {CUBBY_COPY.up}
          </button>
        </div>
        <button type="button" className="cv-cubby-close" onClick={closeCubbyCard}>
          {CUBBY_COPY.exit}
        </button>
      </div>
    </div>
  );
}

/** A wide screen docks the card on the right; a tall one (a phone held upright) at the bottom. */
export function wideLayout(w: number, h: number): boolean {
  return w >= 720 && w >= h;
}
