import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  SEASON_NAME,
  SEASON_ORDER,
  SKY_FIGURES,
  figureById,
  figureTitle,
  whenToLook,
  type SkyFigure,
} from "@caysonverse/shared/village/constellations";
import { altAzOf, moonPhaseName, seasonAt, type Vec3 } from "@caysonverse/shared/village/skyMath";
import type { Orbit } from "../../game/types";
import { clampFpPitch } from "../../game/viewMode";
import { enterFp, exitFp, exitOverview, setSkyZoomGoal, viewState, zoomSkyBy } from "../../game/viewState";
import { isTouchDevice } from "../../device";
import { HUD_INFO_BTN_W_PX } from "../../game/hud";
import { useTouchHudLayout } from "../../ui/useTouchHudLayout";
import { useLocalArea } from "../villageArea";
import { useTransitBoarded } from "../../net/transitSync";
import { villageClock } from "../villageClock";
import { MAX_LABELS, clearSelection, selectFigure, skyOverlay } from "./finderRuntime";
import { currentMoon, moonState } from "./StarSkyExtras";
import { foundDateText, seasonCounts } from "./starProgress";
import { anchorDirection, sky } from "./skyRuntime";
import { moonDirection } from "./StarSkyExtras";
import {
  closeFinder,
  setFinderView,
  setFolded,
  setShowFound,
  patchFinder,
  useStarFinder,
  type TargetShape,
} from "./starFinderStore";
import { compassWord, countText } from "./finderRules";
import "./starFinder.css";

/** The look-up pitch the finder starts a first-person view at (rad; negative = up): about 30° above the horizon. */
export const FINDER_START_PITCH = -0.52;
/** How long a notice line stays on the card (ms). */
export const NOTICE_MS = 7000;

/**
 * 별자리 찾기's HUD (케이슨 마을's night sky): the card (target, hint, found story, the album), and the layers the frame
 * writes into — the reticle in the middle of the screen, the edge arrow, the names on the sky. The card is not a modal:
 * it takes no keyboard and no focus, so the player keeps walking and looking around while it is up (✕ closes it).
 *
 * Opening it at night in third person switches to first person (the reticle needs the eye's view) and closing it switches
 * back; inside the memorial hall the finder closes.
 */
export function StarFinder({ orbit }: { orbit: Orbit }) {
  const open = useStarFinder((s) => s.open);
  const area = useLocalArea();
  const switched = useRef(false);

  // While it is open the look is free all the way up to the zenith (no detour round a pitch limit).
  useEffect(() => {
    if (!open) return;
    viewState.skyLook = true;
    return () => {
      viewState.skyLook = false;
      viewState.fpPitch = Math.max(viewState.fpPitch, clampFpPitch(viewState.fpPitch));
    };
  }, [open]);

  // Open at night: into first person (and off the map), looking up a little.
  useEffect(() => {
    if (!open) return;
    const st = useStarFinder.getState();
    if (st.phase !== "night") return;
    if (viewState.mode === "ov") exitOverview();
    if (viewState.mode === "tp") {
      enterFp(orbit.yaw);
      viewState.fpPitch = FINDER_START_PITCH;
      switched.current = true;
      patchFinder({ notice: "하늘을 올려다보려고 1인칭으로 바꿨어요 (V로 돌아가요)" });
    }
    return () => {
      if (switched.current && viewState.mode === "fp") exitFp(orbit);
      switched.current = false;
    };
  }, [open, orbit]);

  // A notice ("1인칭으로 바꿨어요", "곧 날이 밝아요") stays a few seconds.
  const notice = useStarFinder((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => patchFinder({ notice: null }), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  // Indoors (the memorial hall, a house) and aboard the bus there is no sky to search: it closes (UX 2026-11-16).
  const boarded = useTransitBoarded();
  useEffect(() => {
    if ((area !== "village" || boarded) && useStarFinder.getState().open) closeFinder();
  }, [area, boarded]);
  // A scene change (a reconnect remounts the scene, leaving to the entry screen) closes it too: no card left open behind.
  useEffect(
    () => () => {
      if (useStarFinder.getState().open) closeFinder();
    },
    [],
  );

  return (
    <>
      <SkyLayers />
      {open && area === "village" && !boarded && <FinderCard orbit={orbit} />}
      {open && area === "village" && !boarded && <ZoomControls />}
      <Discovery />
      <Announcer />
    </>
  );
}

/** The reticle, the edge arrow and the names on the sky: always mounted (found figures' names show with the card closed). */
function SkyLayers() {
  const arrow = useRef<HTMLDivElement>(null);
  const arrowText = useRef<HTMLSpanElement>(null);
  const labels = useRef<HTMLSpanElement[]>([]);
  useEffect(() => {
    skyOverlay.arrow = arrow.current;
    skyOverlay.arrowText = arrowText.current;
    skyOverlay.labels = labels.current.filter(Boolean);
    return () => {
      skyOverlay.arrow = null;
      skyOverlay.arrowText = null;
      skyOverlay.labels = [];
    };
  }, []);
  return (
    <div className="cv-sky-layer" aria-hidden="true">
      {Array.from({ length: MAX_LABELS }, (_, i) => (
        <span
          key={i}
          hidden
          className="cv-sky-label"
          ref={(el) => {
            if (el) labels.current[i] = el;
          }}
        />
      ))}
      <div className="cv-sky-arrow" ref={arrow} hidden>
        <span className="cv-sky-arrow-glyph">➜</span>
        <span className="cv-sky-arrow-text" ref={arrowText} />
      </div>
    </div>
  );
}

/** The zoom buttons (+ / the zoom readout that resets it / −): at the screen's side, only while looking at the night sky. */
function ZoomControls() {
  const night = useStarFinder((s) => s.phase === "night" && s.catalogReady);
  const firstPerson = useStarFinder((s) => s.firstPerson);
  const layout = useTouchHudLayout();
  const readout = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    skyOverlay.zoomText = readout.current;
    return () => {
      skyOverlay.zoomText = null;
    };
  }, [night, firstPerson]);
  if (!night || !firstPerson) return null;
  const left = isTouchDevice && layout.column.side === "right";
  return (
    <div className={"cv-sky-zoom" + (left ? " is-left" : "")} role="group" aria-label="하늘 확대">
      <CardButton label="하늘 확대" onClick={() => zoomSkyBy(1 / 1.4)}>
        ＋
      </CardButton>
      <button
        type="button"
        className="cv-sky-btn cv-sky-zoom-read"
        aria-label="확대 원래대로"
        title="눌러서 원래 크기로"
        tabIndex={-1}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setSkyZoomGoal(1)}
      >
        <span ref={readout}>×1.0</span>
      </button>
      <CardButton label="하늘 축소" onClick={() => zoomSkyBy(1.4)}>
        －
      </CardButton>
    </div>
  );
}

/** The "발견!" moment: a short sparkle and the figure's one-line story (the first time a figure is found). */
function Discovery() {
  const d = useStarFinder((s) => s.discovery);
  useEffect(() => {
    if (!d) return;
    const id = setTimeout(() => patchFinder({ discovery: null }), 5200);
    return () => clearTimeout(id);
  }, [d]);
  const f = d ? figureById(d.id) : undefined;
  if (!d || !f) return null;
  return (
    <div className="cv-sky-found" key={d.at} aria-hidden="true">
      <span className="cv-sky-sparks">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ "--a": `${i * 30}deg`, "--d": `${46 + (i % 3) * 14}px` } as CSSProperties} />
        ))}
      </span>
      <p className="cv-sky-found-big">✨ 발견! {figureTitle(f)}</p>
      <p className="cv-sky-found-story">{f.story}</p>
    </div>
  );
}

/** Screen-reader words ("카시오페이아자리를 찾았어요"). */
function Announcer() {
  const announce = useStarFinder((s) => s.announce);
  return (
    <div className="cv-sr-only cv-sky-announce" role="status" aria-live="polite">
      {announce}
    </div>
  );
}

function FinderCard({ orbit }: { orbit: Orbit }) {
  const view = useStarFinder((s) => s.view);
  const phase = useStarFinder((s) => s.phase);
  const folded = useStarFinder((s) => s.folded);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    skyOverlay.card = card.current;
    return () => {
      skyOverlay.card = null;
    };
  }, [folded]);
  // While the player drags to look around (or wheels / pinches the lens) the card and the zoom buttons fade, so the sky
  // is clear; they come back a moment after the hand lifts. Plain class toggles, no React render.
  useEffect(() => {
    let timer = 0;
    const fade = (on: boolean) => {
      for (const el of document.querySelectorAll(".cv-sky-card, .cv-sky-zoom")) el.classList.toggle("is-looking", on);
    };
    const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest(".cv-sky-card, .cv-sky-zoom, button, input");
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0 || inUi(e.target)) return;
      clearTimeout(timer);
      fade(true);
    };
    const onUp = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => fade(false), 700);
    };
    const onWheel = (e: WheelEvent) => {
      if (inUi(e.target)) return;
      fade(true);
      onUp();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("wheel", onWheel);
      fade(false);
    };
  }, []);
  // A phone: beside the HUD's button column (its side and inset from the touch layout), under the top row.
  const layout = useTouchHudLayout();
  const beside = layout.column.inset + HUD_INFO_BTN_W_PX + 8;
  const style: CSSProperties | undefined = isTouchDevice
    ? layout.column.side === "left"
      ? { left: beside, right: folded ? "auto" : layout.column.inset }
      : { left: folded ? "auto" : layout.column.inset, right: beside }
    : undefined;
  if (folded) return <FoldedPill style={style} cardRef={card} />;
  return (
    <section
      ref={card}
      style={style}
      className={"cv-sky-card" + (isTouchDevice ? " is-touch" : "")}
      aria-label="별자리 찾기"
    >
      <CardHead onFold={() => setFolded(true)} />
      <div className="cv-sky-scroll">
        {view === "album" ? <Album /> : phase === "day" ? <DayBody /> : <NightBody orbit={orbit} />}
      </div>
      {phase === "night" && <CardFoot />}
    </section>
  );
}

/** The folded card: one small pill ("🔭 별자리 6/6 ▸"); a tap unfolds it. */
function FoldedPill({ style, cardRef }: { style: CSSProperties | undefined; cardRef: React.RefObject<HTMLElement | null> }) {
  const progress = useStarFinder((s) => s.progress);
  const season = seasonAt(villageClock.nowMs());
  const c = seasonCounts(progress)[season];
  return (
    <section ref={cardRef} style={style} className={"cv-sky-card is-pill" + (isTouchDevice ? " is-touch" : "")} aria-label="별자리 찾기">
      <button
        type="button"
        className="cv-sky-pill-btn"
        aria-label="별자리 카드 펼치기"
        tabIndex={-1}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setFolded(false)}
      >
        🔭 별자리 {c.found}/{c.total} <span aria-hidden="true">▸</span>
      </button>
      <CardButton label="별자리 찾기 닫기" onClick={closeFinder}>
        ✕
      </CardButton>
    </section>
  );
}

/** The card's foot (night): whether the found figures' lines stay on the sky, with what it means in one line. */
function CardFoot() {
  return (
    <footer className="cv-sky-foot">
      <ShowFoundToggle />
    </footer>
  );
}

function CardHead({ onFold }: { onFold: () => void }) {
  const view = useStarFinder((s) => s.view);
  const progress = useStarFinder((s) => s.progress);
  const season = seasonAt(villageClock.nowMs());
  const c = seasonCounts(progress)[season];
  return (
    <header className="cv-sky-head">
      <span className="cv-sky-title">
        🔭 <span className="cv-sky-count">{countText(SEASON_NAME[season], c.found, c.total)}</span>
      </span>
      <span className="cv-sky-head-btns">
        <CardButton label={view === "album" ? "찾기로 돌아가기" : "별자리 도감"} onClick={() => setFinderView(view === "album" ? "find" : "album")}>
          {view === "album" ? "🔭" : "📖"}
        </CardButton>
        <CardButton label="카드 접기" onClick={onFold}>
          ◂
        </CardButton>
        <CardButton label="별자리 찾기 닫기" onClick={closeFinder}>
          ✕
        </CardButton>
      </span>
    </header>
  );
}

/** A small card button that never takes the keyboard's focus (as HudButton). */
function CardButton({
  label,
  onClick,
  children,
  wide,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      className={"cv-sky-btn" + (wide ? " is-wide" : "")}
      aria-label={wide ? undefined : label}
      tabIndex={-1}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DayBody() {
  const duskText = useStarFinder((s) => s.duskText);
  const notice = useStarFinder((s) => s.notice);
  return (
    <div className="cv-sky-body">
      {notice && <p className="cv-sky-notice">{notice}</p>}
      <p className="cv-sky-big">🌙 별은 밤에 보여요</p>
      {duskText && <p className="cv-sky-text">{duskText}부터 밝은 별이 하나둘 떠요.</p>}
      <div className="cv-sky-actions">
        <CardButton label="별자리 도감" wide onClick={() => setFinderView("album")}>
          📖 별자리 도감
        </CardButton>
        <CardButton label="닫기" wide onClick={closeFinder}>
          닫기
        </CardButton>
      </div>
    </div>
  );
}

function NightBody({ orbit }: { orbit: Orbit }) {
  const ready = useStarFinder((s) => s.catalogReady);
  const firstPerson = useStarFinder((s) => s.firstPerson);
  const targetId = useStarFinder((s) => s.targetId);
  const notice = useStarFinder((s) => s.notice);
  if (!ready) return <p className="cv-sky-text cv-sky-body">별을 불러오는 중이에요…</p>;
  return (
    <div className="cv-sky-body">
      {notice && <p className="cv-sky-notice">{notice}</p>}
      {!firstPerson && (
        <div className="cv-sky-fp">
          <span>하늘은 1인칭에서 올려다봐요</span>
          <CardButton
            label="1인칭으로 보기"
            wide
            onClick={() => {
              if (viewState.mode === "ov") exitOverview();
              if (viewState.mode === "tp") enterFp(orbit.yaw);
            }}
          >
            👁 1인칭으로 보기
          </CardButton>
        </div>
      )}
      {targetId ? <DetailBody id={targetId} /> : <ListBody orbit={orbit} />}
    </div>
  );
}

/** Tapping a name: into first person if needed, then the pick (the sky draws it and the view turns to it). */
function pick(id: string, orbit: Orbit): void {
  if (viewState.mode === "ov") exitOverview();
  if (viewState.mode === "tp") enterFp(orbit.yaw);
  selectFigure(id);
}

/** "지금 하늘에 보이는 별자리": one big row each. */
function ListBody({ orbit }: { orbit: Orbit }) {
  const ranking = useStarFinder((s) => s.ranking);
  const info = useStarFinder((s) => s.rowInfo);
  const found = useStarFinder((s) => s.progress.found);
  const moon = sky.catalog ? currentMoon(sky.utcMs) : null;
  const moonWhere = moon && moonState.alt > 3 ? `${compassWord(moonAz())}쪽 하늘에 떠 있어요` : "지금은 지평선 아래예요";
  if (ranking.length === 0) return <p className="cv-sky-text">지금은 언덕 위로 올라온 별자리가 없어요. 조금 뒤에 다시 해 보세요.</p>;
  return (
    <>
      <p className="cv-sky-lead">지금 하늘에 보이는 별자리 {ranking.length}개 · 이름을 누르면 하늘에서 알려줘요</p>
      <ul className="cv-sky-list">
        {ranking.map((id) => {
          const f = figureById(id);
          if (!f) return null;
          return (
            <li key={id}>
              <button
                type="button"
                className="cv-sky-row"
                tabIndex={-1}
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(id, orbit)}
              >
                <span className="cv-sky-row-main">
                  <span className="cv-sky-row-title">
                    {figureTitle(f)}
                    {found[id] && <span className="cv-sky-row-seen" aria-label="본 별자리"> ✓</span>}
                  </span>
                  <span className="cv-sky-row-sub">{info[id] ?? ""}</span>
                </span>
                <span className="cv-sky-row-go" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
      {moon && moonState.alt > -90 && (
        <p className="cv-sky-moonline">
          🌙 오늘의 달 · {moonPhaseName(moon)} · {moonWhere}
        </p>
      )}
    </>
  );
}

function moonAz(): number {
  const g = sky.catalog ? currentMoon(sky.utcMs) : null;
  if (!g) return 0;
  const d: Vec3 = [0, 0, 0];
  // the moon's apparent direction (the same as the one the sky draws)
  return altAzOf(moonDirection(currentMoon(sky.utcMs), d)).azDeg;
}

/** The picked figure: where it is, what to look for, its one-line story. */
function DetailBody({ id }: { id: string }) {
  const f = figureById(id)!;
  const shape = useStarFinder((s) => s.targetShape);
  const where = useStarFinder((s) => s.targetWhere);
  const aimInfo = useStarFinder((s) => s.aimInfo);
  const polaris = id === "polaris" ? polarisAltitude() : null;
  return (
    <>
      <div className="cv-sky-target">
        {shape && <MiniSky shape={shape} asterism={f.kind === "asterism"} />}
        <div className="cv-sky-target-text">
          <p className="cv-sky-name">{figureTitle(f)}</p>
          <p className="cv-sky-where">
            <span aria-hidden="true">📍 </span>
            {where}
          </p>
          <p className="cv-sky-hint">{f.hint}</p>
        </div>
      </div>
      <p className="cv-sky-story">{f.story}</p>
      {polaris !== null && <p className="cv-sky-tip">북극성 높이 {polaris.toFixed(1)}° — 마을의 위도(36.5°)와 거의 같아요.</p>}
      {id === "polaris" && <p className="cv-sky-tip">북두칠성이 낮을 땐 카시오페이아 W의 가운데에서 북쪽으로 따라가도 북극성이 나와요.</p>}
      {aimInfo && <p className="cv-sky-info">✦ 지금 가운데에 있는 별: {aimInfo}</p>}
      <div className="cv-sky-actions">
        <CardButton label="별자리 목록으로" wide onClick={clearSelection}>
          ← 다른 별자리
        </CardButton>
      </div>
    </>
  );
}

function ShowFoundToggle() {
  const on = useStarFinder((s) => s.progress.showFound);
  return (
    <label className="cv-sky-toggle" onPointerDown={(e) => e.preventDefault()}>
      <input type="checkbox" tabIndex={-1} checked={on} onChange={(e) => setShowFound(e.currentTarget.checked)} />
      <span className="cv-sky-toggle-text">
        <span className="cv-sky-toggle-label">찾은 별자리 선 항상 켜두기</span>
        <span className="cv-sky-toggle-hint">{on ? "켜짐 · 본 별자리 선이 하늘에 그대로 남아요" : "꺼짐 · 고른 별자리 선만 보여요"}</span>
      </span>
    </label>
  );
}

function polarisAltitude(): number | null {
  const g = sky.figures.find((x) => x.figure.id === "polaris");
  if (!g) return null;
  const d: Vec3 = [0, 0, 0];
  return altAzOf(anchorDirection(g, d)).altDeg;
}

/** The target's shape as it stands now (gnomonic, the zenith up): the stars by brightness, the lines faint. */
function MiniSky({ shape, asterism }: { shape: TargetShape; asterism: boolean }) {
  const W = 96;
  const H = 84;
  const pad = 10;
  const sx = (x: number) => W / 2 + x * (W / 2 - pad);
  const sy = (y: number) => H / 2 - y * (H / 2 - pad);
  return (
    <svg className="cv-sky-mini" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="지금 하늘에서의 모양">
      {shape.lines.map(([a, b], i) => (
        <line
          key={i}
          x1={sx(shape.points[a]!.x)}
          y1={sy(shape.points[a]!.y)}
          x2={sx(shape.points[b]!.x)}
          y2={sy(shape.points[b]!.y)}
          className={asterism ? "is-gold" : undefined}
        />
      ))}
      {shape.points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={1 + 2.2 * p.r} />
      ))}
    </svg>
  );
}

function Album() {
  const progress = useStarFinder((s) => s.progress);
  const counts = seasonCounts(progress);
  return (
    <div className="cv-sky-body cv-sky-album">
      {SEASON_ORDER.map((s) => (
        <section key={s} className="cv-sky-season">
          <h3>
            {SEASON_NAME[s]} <span>{counts[s].found}/{counts[s].total}</span>
          </h3>
          <ul>
            {SKY_FIGURES.filter((f) => f.season === s).map((f) => (
              <AlbumRow key={f.id} f={f} at={progress.found[f.id]} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AlbumRow({ f, at }: { f: SkyFigure; at: string | undefined }) {
  if (!at)
    return (
      <li className="is-unknown">
        <span className="cv-sky-row-name">❔ ???</span>
        <span className="cv-sky-row-when">{whenToLook(f)}</span>
      </li>
    );
  return (
    <li>
      <span className="cv-sky-row-name">
        ⭐ {figureTitle(f)} <span className="cv-sky-row-date">{foundDateText(at)}</span>
      </span>
      <span className="cv-sky-row-story">{f.story}</span>
    </li>
  );
}
