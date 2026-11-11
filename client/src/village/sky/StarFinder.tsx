import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  SEASON_NAME,
  SEASON_ORDER,
  SKY_FIGURES,
  figureById,
  figureTitle,
  whenToLook,
  type SkyFigure,
} from "@caysonverse/shared/village/constellations";
import { altAzOf, seasonAt, type Vec3 } from "@caysonverse/shared/village/skyMath";
import type { Orbit } from "../../game/types";
import { enterFp, exitFp, exitOverview, viewState } from "../../game/viewState";
import { isTouchDevice } from "../../device";
import { HUD_INFO_BTN_W_PX } from "../../game/hud";
import { useTouchHudLayout } from "../../ui/useTouchHudLayout";
import { useLocalArea } from "../villageArea";
import { villageClock } from "../villageClock";
import { MAX_LABELS, RING_LENGTH, skyOverlay } from "./finderRuntime";
import { foundDateText, seasonCounts } from "./starProgress";
import { anchorDirection, sky } from "./skyRuntime";
import {
  closeFinder,
  setFinderView,
  setShowFound,
  patchFinder,
  useStarFinder,
  type TargetShape,
} from "./starFinderStore";
import { countText, nextInRanking } from "./finderRules";
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

  // The memorial hall has no sky.
  useEffect(() => {
    if (area !== "village" && useStarFinder.getState().open) closeFinder();
  }, [area]);

  return (
    <>
      <SkyLayers />
      {open && area === "village" && <FinderCard orbit={orbit} />}
      <Announcer />
    </>
  );
}

/** The reticle, the edge arrow and the names on the sky: always mounted (found figures' names show with the card closed). */
function SkyLayers() {
  const reticle = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const arrowText = useRef<HTMLSpanElement>(null);
  const labels = useRef<HTMLSpanElement[]>([]);
  useEffect(() => {
    skyOverlay.reticle = reticle.current;
    skyOverlay.ring = ring.current;
    skyOverlay.arrow = arrow.current;
    skyOverlay.arrowText = arrowText.current;
    skyOverlay.labels = labels.current.filter(Boolean);
    return () => {
      skyOverlay.reticle = null;
      skyOverlay.ring = null;
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
      <div className="cv-sky-reticle" ref={reticle} hidden>
        <svg viewBox="0 0 100 100">
          <circle className="cv-sky-reticle-base" cx="50" cy="50" r="46" />
          <circle
            className="cv-sky-reticle-ring"
            ref={ring}
            cx="50"
            cy="50"
            r="46"
            style={{ strokeDasharray: RING_LENGTH.toFixed(1), strokeDashoffset: RING_LENGTH.toFixed(1) }}
          />
          <circle className="cv-sky-reticle-dot" cx="50" cy="50" r="2.2" />
        </svg>
      </div>
      <div className="cv-sky-arrow" ref={arrow} hidden>
        <span className="cv-sky-arrow-glyph">➜</span>
        <span className="cv-sky-arrow-text" ref={arrowText} />
      </div>
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
  const [folded, setFolded] = useState(false);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    skyOverlay.card = card.current;
    return () => {
      skyOverlay.card = null;
    };
  }, []);
  // A phone: beside the HUD's button column (its side and inset from the touch layout), under the top row.
  const layout = useTouchHudLayout();
  const beside = layout.column.inset + HUD_INFO_BTN_W_PX + 8;
  const style: CSSProperties | undefined = isTouchDevice
    ? layout.column.side === "left"
      ? { left: beside, right: layout.column.inset }
      : { left: layout.column.inset, right: beside }
    : undefined;
  return (
    <section
      ref={card}
      style={style}
      className={"cv-sky-card" + (isTouchDevice ? " is-touch" : "") + (folded ? " is-folded" : "")} aria-label="별자리 찾기">
      <CardHead folded={folded} onFold={() => setFolded((f) => !f)} />
      {!folded && (view === "album" ? <Album /> : phase === "day" ? <DayBody /> : <NightBody orbit={orbit} />)}
    </section>
  );
}

function CardHead({ folded, onFold }: { folded: boolean; onFold: () => void }) {
  const view = useStarFinder((s) => s.view);
  const progress = useStarFinder((s) => s.progress);
  const season = seasonAt(villageClock.nowMs());
  const c = seasonCounts(progress)[season];
  return (
    <header className="cv-sky-head">
      <span className="cv-sky-title">
        🔭 {!isTouchDevice && "별자리 찾기 "}
        <span className="cv-sky-count">
          {!isTouchDevice && "· "}
          {countText(SEASON_NAME[season], c.found, c.total)}
        </span>
      </span>
      <span className="cv-sky-head-btns">
        <CardButton label={view === "album" ? "찾기로 돌아가기" : "별자리 도감"} onClick={() => setFinderView(view === "album" ? "find" : "album")}>
          {view === "album" ? "🔭" : "📖"}
        </CardButton>
        {isTouchDevice && (
          <CardButton label={folded ? "카드 펼치기" : "카드 접기"} onClick={onFold}>
            {folded ? "▾" : "▴"}
          </CardButton>
        )}
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
  const foundNow = useStarFinder((s) => s.foundNow);
  const notice = useStarFinder((s) => s.notice);
  if (!ready) return <p className="cv-sky-text cv-sky-body">별을 불러오는 중이에요…</p>;
  if (foundNow) return <FoundBody id={foundNow} />;
  return (
    <div className="cv-sky-body">
      {notice && <p className="cv-sky-notice">{notice}</p>}
      {!firstPerson && (
        <div className="cv-sky-fp">
          <span>1인칭(V)에서 찾을 수 있어요</span>
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
      {targetId ? <TargetBody id={targetId} /> : <p className="cv-sky-text">지금은 언덕 위로 올라온 별자리가 없어요. 조금 뒤에 다시 해 보세요.</p>}
    </div>
  );
}

function TargetBody({ id }: { id: string }) {
  const f = figureById(id)!;
  const shape = useStarFinder((s) => s.targetShape);
  const where = useStarFinder((s) => s.targetWhere);
  const ghost = useStarFinder((s) => s.ghost);
  const aimInfo = useStarFinder((s) => s.aimInfo);
  const again = useStarFinder((s) => !!s.progress.found[id]);
  const ranking = useStarFinder((s) => s.ranking);
  const look = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    skyOverlay.look = look.current;
    return () => {
      skyOverlay.look = null;
    };
  }, []);
  return (
    <>
      <div className="cv-sky-target">
        {shape && <MiniSky shape={shape} asterism={f.kind === "asterism"} />}
        <div className="cv-sky-target-text">
          <p className="cv-sky-name">
            {figureTitle(f)}
            {again && <span className="cv-sky-again"> · 찾은 별자리</span>}
          </p>
          <p className="cv-sky-hint">{f.hint}</p>
          <p className="cv-sky-where">
            <span aria-hidden="true">📍 </span>
            {where}
          </p>
          <p className="cv-sky-look">
            <span aria-hidden="true">👀 </span>지금 보는 곳: <span ref={look} />
          </p>
        </div>
      </div>
      <p className="cv-sky-text">가운데 동그라미에 1초 동안 맞춰 보세요.</p>
      {id === "polaris" && <p className="cv-sky-tip">북두칠성이 낮을 땐 카시오페이아 W의 가운데에서 북쪽으로 따라가도 북극성이 나와요.</p>}
      {ghost && <p className="cv-sky-tip">희미한 선을 따라가 보세요.</p>}
      {aimInfo && <p className="cv-sky-info">✦ {aimInfo}</p>}
      <div className="cv-sky-actions">
        {ranking.length > 1 && (
          <CardButton label="다른 별자리" wide onClick={() => skipTarget()}>
            다른 별자리
          </CardButton>
        )}
        <ShowFoundToggle />
      </div>
    </>
  );
}

/** "다른 별자리": the next figure that is up. */
function skipTarget(): void {
  const st = useStarFinder.getState();
  const next = nextInRanking(st.ranking, st.targetId);
  if (next && next !== st.targetId) patchFinder({ targetId: next, targetShape: null, ghost: false, aimInfo: null });
}

function ShowFoundToggle() {
  const on = useStarFinder((s) => s.progress.showFound);
  return (
    <label className="cv-sky-toggle" onPointerDown={(e) => e.preventDefault()}>
      <input type="checkbox" tabIndex={-1} checked={on} onChange={(e) => setShowFound(e.currentTarget.checked)} />
      찾은 별자리 보기
    </label>
  );
}

function FoundBody({ id }: { id: string }) {
  const f = figureById(id)!;
  const polaris = id === "polaris" ? polarisAltitude() : null;
  return (
    <div className="cv-sky-body cv-sky-found">
      <p className="cv-sky-big">찾았어요! ✨ {figureTitle(f)}</p>
      <p className="cv-sky-story">{f.story}</p>
      {polaris !== null && (
        <p className="cv-sky-tip">
          북극성 높이 {polaris.toFixed(1)}° — 마을의 위도(36.5°)와 거의 같아요.
        </p>
      )}
      <div className="cv-sky-actions">
        <CardButton label="다음 별자리" wide onClick={() => patchFinder({ foundNow: null, targetId: null, targetShape: null })}>
          다음 별자리 →
        </CardButton>
        <ShowFoundToggle />
      </div>
    </div>
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
      <div className="cv-sky-actions">
        <ShowFoundToggle />
      </div>
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
