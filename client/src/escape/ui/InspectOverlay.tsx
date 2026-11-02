import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { EscapeMsg, type InspectViewPayload, type ObjectKind } from "@caysonverse/shared/escape/messages";
import { isTouchDevice } from "../../device";
import { sendEscape } from "../../net/connection";
import { useEscapeStore } from "../../stores/escapeStore";
import { FOCUSABLE_SELECTOR, tabWrapTarget } from "../../ui/focusTrap";
import { popOverlay, pushOverlay } from "../../ui/overlayStack";
import { objectKindOf } from "../escapeTargets";
import { flipped, inspectImageUrl, noteNumber, tiltFromDrag, tiltTransform, uvMaskStyle } from "./inspectCard";
import "../escape.css";

/** The overlay's id on the overlay stack (Esc closes the top one). */
export const INSPECT_OVERLAY_ID = "inspect";

/** The UV light's circle, in the card's own pixels. */
const UV_RADIUS_PX = 84;
const UV_RADIUS_TOUCH_PX = 104;
/** A drag shorter than this (CSS px) does not tip the card (a tap on it is not a drag). */
const DRAG_SLOP_PX = 3;

const closeInspect = (): void => useEscapeStore.getState().setInspect(null);

/** The placeholder's icon and colour while a picture is not there (Task 24 brings them all). */
const KIND_LOOK: Record<ObjectKind | "unknown", { icon: string; color: string }> = {
  inspect: { icon: "🔍", color: "#DCE8FF" },
  screen: { icon: "📺", color: "#E7DDFF" },
  switch: { icon: "🔑", color: "#FFE9CC" },
  door: { icon: "🚪", color: "#D8F2E0" },
  unknown: { icon: "🔍", color: "#E9E6F5" },
};

/** Pictures that failed to load once are not asked for again this session (one miss, not one per opening). */
const missingImages = new Set<string>();

/** The object's picture, or a styled placeholder while the file is missing. A numbered note shows its number on the shared picture. */
function CardImage({ objectId, kind }: { objectId: string; kind: ObjectKind | null }) {
  const url = inspectImageUrl(objectId);
  const [failed, setFailed] = useState(() => url === null || missingImages.has(url));
  const no = noteNumber(objectId);
  const look = KIND_LOOK[kind ?? "unknown"];
  return (
    <div className="cv-insp-pic" style={failed ? { background: look.color } : undefined}>
      {failed || url === null ? (
        <span className="cv-insp-pic-icon" aria-hidden="true">
          {look.icon}
        </span>
      ) : (
        <img
          src={url}
          alt=""
          width={512}
          height={512}
          decoding="async"
          draggable={false}
          onError={() => {
            missingImages.add(url);
            setFailed(true);
          }}
        />
      )}
      {no !== null && (
        <span className="cv-insp-noteno" aria-hidden="true">
          {no}
        </span>
      )}
    </div>
  );
}

/**
 * The close-up of one object (AI 학교 탈출, Task 18): the card the server's `InspectView` describes.
 * The front shows the picture, the title and the body; a drag tips the card (±35°, `tiltFromDrag`);
 * "뒤집기" turns it over when it has a back; "자외선 비추기" (only while the team bag holds the UV light —
 * the server sends `reveal` then) darkens the card and shows the hidden writing inside a circle that
 * follows the finger / mouse; "가방에 넣기" puts the object's item in the team bag. A split clue shows
 * this player's half, or a faded line saying whose it is. The lock plate (`lockId`) plugs in here in
 * Task 19. Esc, the ✕ and a tap outside close it.
 *
 * Everything shown comes from the server's payload and the room's public content — nothing is worked
 * out here. While it is open the room's flags / bag / members changing asks for the close-up again, so
 * a pickup, a UV light just made or a teammate leaving shows at once.
 *
 * Per-frame values (the tilt, the light's place) go straight to the elements' style from the pointer
 * handlers (the light through one requestAnimationFrame at most per frame); only the flip, the UV
 * switch and the "sent" flag are React state.
 */
function InspectCard({ view }: { view: InspectViewPayload }) {
  const kind = useEscapeStore((s) => objectKindOf(s.content, view.objectId));
  const pickItem = useEscapeStore((s) => {
    if (!view.canPickup) return null;
    return s.content?.items.find((i) => i.id === view.canPickup) ?? null;
  });
  const [flip, setFlip] = useState(false);
  const [uv, setUv] = useState(false);
  const [sent, setSent] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const uvRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; y0: number } | null>(null);
  const light = useRef({ x: 0, y: 0, frame: 0 });

  const hasReveal = view.reveal !== undefined && view.reveal !== "";
  const uvOn = uv && hasReveal;

  // On the overlay stack for as long as it is open: Esc closes the top one, the keyboard belongs to it.
  useEffect(() => {
    pushOverlay(INSPECT_OVERLAY_ID, closeInspect);
    dialogRef.current?.focus({ preventScroll: true });
    return () => popOverlay(INSPECT_OVERLAY_ID);
  }, []);

  // The team's state moved (a flag, the bag, who is here): ask for this close-up again.
  const stateKey = useEscapeStore((s) => {
    const v = s.view;
    return v ? `${v.flags.join("|")}#${v.bag.join("|")}#${v.members.map((m) => m.sid).join("|")}` : "";
  });
  const lastKey = useRef(stateKey);
  useEffect(() => {
    if (lastKey.current === stateKey) return;
    lastKey.current = stateKey;
    setSent(false);
    sendEscape(EscapeMsg.Inspect, { objectId: view.objectId });
  }, [stateKey, view.objectId]);

  useEffect(
    () => () => {
      if (light.current.frame !== 0) cancelAnimationFrame(light.current.frame);
    },
    [],
  );

  /** Move the UV light to the card-local point (px, py): the mask on the hidden writing and the glow under it. */
  const paintLight = useCallback((px: number, py: number): void => {
    const radius = isTouchDevice ? UV_RADIUS_TOUCH_PX : UV_RADIUS_PX;
    const mask = uvMaskStyle(px, py, radius);
    const layer = uvRef.current;
    if (layer) {
      layer.style.maskImage = mask;
      layer.style.setProperty("-webkit-mask-image", mask);
    }
    const face = faceRef.current;
    if (face) {
      face.style.setProperty("--uvx", `${px}px`);
      face.style.setProperty("--uvy", `${py}px`);
      face.style.setProperty("--uvr", `${radius}px`);
    }
  }, []);

  /** Pointer position (client px) → the card's own pixels, then one paint per frame. */
  const aimLight = useCallback(
    (clientX: number, clientY: number): void => {
      const card = tiltRef.current;
      if (!card) return;
      const r = card.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      light.current.x = (clientX - r.left) * (card.offsetWidth / r.width);
      light.current.y = (clientY - r.top) * (card.offsetHeight / r.height);
      if (light.current.frame !== 0) return;
      light.current.frame = requestAnimationFrame(() => {
        light.current.frame = 0;
        paintLight(light.current.x, light.current.y);
      });
    },
    [paintLight],
  );

  // Switching the light on: start in the middle so there is something to see before the pointer moves.
  useEffect(() => {
    if (!uvOn) return;
    const card = tiltRef.current;
    if (card) paintLight(card.offsetWidth / 2, card.offsetHeight / 2);
  }, [uvOn, paintLight]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const card = tiltRef.current;
    if (!card) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    card.setPointerCapture(e.pointerId);
    card.style.transition = "none";
    if (uvOn) aimLight(e.clientX, e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (uvOn) aimLight(e.clientX, e.clientY);
    const d = drag.current;
    const card = tiltRef.current;
    if (!d || d.id !== e.pointerId || !card) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.abs(dx) < DRAG_SLOP_PX && Math.abs(dy) < DRAG_SLOP_PX) return;
    card.style.transform = tiltTransform(tiltFromDrag(dx, dy, card.offsetWidth));
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const card = tiltRef.current;
    if (!d || d.id !== e.pointerId || !card) return;
    drag.current = null;
    if (card.hasPointerCapture(e.pointerId)) card.releasePointerCapture(e.pointerId);
    card.style.transition = "transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1)";
    card.style.transform = tiltTransform({ rx: 0, ry: 0 });
  };

  /** Tab stays inside the overlay (the chat field behind it must not take focus). */
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const target = tabWrapTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (target !== null) {
      e.preventDefault();
      items[target].focus();
    }
  };

  const pickUp = (): void => {
    if (sent || !view.canPickup) return;
    setSent(true);
    sendEscape(EscapeMsg.Pickup, { objectId: view.objectId });
    // The team's toast says who took what; the bag chip shows the rest. Back to the room.
    closeInspect();
  };

  const split = view.split;
  return (
    <div
      ref={dialogRef}
      className={"cv-escui cv-insp" + (uvOn ? " is-uv" : "")}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-insp-title"
      tabIndex={-1}
      onKeyDown={trapTab}
    >
      <div className="cv-insp-backdrop" onClick={closeInspect} />
      <div className="cv-insp-panel">
        <div className="cv-insp-head">
          <h2 id="cv-insp-title" className="cv-insp-title">
            {view.title}
          </h2>
          <button type="button" className="cv-insp-close" onClick={closeInspect} aria-label="닫기">
            <span aria-hidden="true">✕</span>
            {!isTouchDevice && <kbd aria-hidden="true">Esc</kbd>}
          </button>
        </div>

        <div className="cv-insp-stage">
          <div
            ref={tiltRef}
            className="cv-insp-tilt"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="cv-insp-flip" style={{ transform: `rotateY(${flipped({ flipped: flip })}deg)` }}>
              <div ref={faceRef} className="cv-insp-face is-front" aria-hidden={flip}>
                <CardImage objectId={view.objectId} kind={kind} />
                <p className="cv-insp-body">{view.body}</p>
                {split && split.text !== undefined && (
                  <div className="cv-insp-split is-mine">
                    <span className="cv-insp-split-tag">내가 읽을 수 있는 반쪽</span>
                    <p>{split.text}</p>
                  </div>
                )}
                {split && split.text === undefined && split.lockedText !== undefined && (
                  <div className="cv-insp-split is-locked">
                    <p>{split.lockedText}</p>
                  </div>
                )}
                {hasReveal && (
                  <>
                    <div className="cv-insp-uvglow" aria-hidden="true" />
                    <div ref={uvRef} className="cv-insp-uvtext" aria-hidden={!uvOn}>
                      <p>{view.reveal}</p>
                    </div>
                  </>
                )}
              </div>
              <div className="cv-insp-face is-back" aria-hidden={!flip}>
                <p className="cv-insp-body">{view.back ?? ""}</p>
              </div>
            </div>
          </div>
        </div>

        <p className="cv-insp-hint" aria-hidden="true">
          {uvOn ? "카드 위로 불빛을 움직여 봐요" : "끌어서 카드를 기울여 봐요"}
        </p>

        <div className="cv-insp-actions">
          {view.back !== undefined && (
            <button type="button" className="cv-insp-btn" onClick={() => setFlip((f) => !f)} aria-pressed={flip}>
              뒤집기
            </button>
          )}
          {hasReveal && (
            <button type="button" className={"cv-insp-btn is-uv" + (uvOn ? " is-on" : "")} onClick={() => setUv((u) => !u)} aria-pressed={uvOn}>
              자외선 비추기
            </button>
          )}
          {view.canPickup && (
            <button type="button" className="cv-insp-btn is-primary" onClick={pickUp} disabled={sent}>
              {pickItem && (
                <span className="cv-insp-btn-item" aria-hidden="true">
                  {pickItem.icon}
                </span>
              )}
              가방에 넣기
            </button>
          )}
          {/* Task 19: the lock plate for `view.lockId` plugs in here. */}
        </div>
      </div>
    </div>
  );
}

/** The close-up the server sent (escape store `inspect`), or nothing. Keyed by object: a new object starts face up, light off. */
export function InspectOverlay() {
  const view = useEscapeStore((s) => s.inspect);
  if (!view) return null;
  return <InspectCard key={view.objectId} view={view} />;
}
