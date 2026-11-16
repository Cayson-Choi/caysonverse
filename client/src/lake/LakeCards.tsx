import { useEffect } from "react";
import { FISH_SPECIES, catchBadge, species } from "./lakeProtocol";
import { FISH_NOTES, fishCardStyle } from "./fishCards";
import type { LakeFishId } from "@caysonverse/shared/village/lakeGear";
import { sendBoardRequest } from "./lakeNet";
import { useLakeStore, type CatchCard } from "./lakeStore";

/** The species' own picture (a render of its 3D model, fishCards.ts); not caught yet: the same shape as a dark silhouette. */
function FishPicture({ id, width, caught = true }: { id: LakeFishId; width: number; caught?: boolean }) {
  return <div className={"cv-lake-fishpic" + (caught ? "" : " is-unknown")} style={fishCardStyle(id, width)} role="img" aria-label={caught ? undefined : "아직 못 잡은 물고기"} />;
}

/** The catch card (design 7.1: the species, the length and the 월척 badge) and, when open, the dex (9.6: kept on this device only). */
export function LakeCards({ card }: { card: CatchCard | null }) {
  const dexOpen = useLakeStore((s) => s.dexOpen);
  const dex = useLakeStore((s) => s.dex);
  const halo = useLakeStore((s) => s.halo);
  const board = useLakeStore((s) => s.board);
  useEffect(() => {
    if (dexOpen) sendBoardRequest();
  }, [dexOpen]);
  const sp = card ? species(card.kind) : null;
  return (
    <>
      {card && sp && (
        <div className="cv-lake-card" role="status" aria-live="polite" onClick={() => useLakeStore.getState().dismissCard()} data-lake-card>
          <FishPicture id={sp.id as LakeFishId} width={240} />
          <div className="cv-lake-card-title">
            {sp.label} {Math.round(card.cm * 10) / 10}cm{card.badge ? ` · ${card.badge}` : ""}
          </div>
          {card.first && <div className="cv-lake-card-first">처음 잡았어요! 도감에 올렸어요.</div>}
          {!card.first && card.record && <div className="cv-lake-card-first">내 새 기록이에요!</div>}
          <div className="cv-lake-card-sub">{sp.invasive ? "생태계 교란 생물이에요. 수거함에 넣어요." : "물에 놓아줘요."}</div>
        </div>
      )}
      {dexOpen && (
        <div className="cv-lake-dex-wrap" onClick={() => useLakeStore.getState().setDexOpen(false)}>
          <div className="cv-lake-dex" role="dialog" aria-label="내 도감" onClick={(e) => e.stopPropagation()}>
            <div className="cv-lake-dex-head">
              <strong>📖 내 도감</strong>
              <button type="button" onClick={() => useLakeStore.getState().setDexOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>
            <div className="cv-lake-dex-count">
              {FISH_SPECIES.filter((s) => dex[s.id]).length} / {FISH_SPECIES.length}종 · 잡은 물고기 {FISH_SPECIES.reduce((n, s) => n + (dex[s.id]?.count ?? 0), 0)}마리
            </div>
            <div className="cv-lake-dex-grid">
              {FISH_SPECIES.map((s) => {
                const e = dex[s.id];
                const badge = e ? catchBadge(s.kind, e.best) : "";
                return (
                  <div key={s.id} className={"cv-lake-dex-item" + (e ? " is-got" : "")} data-dex={s.id} data-dex-best={e ? e.best : undefined} data-dex-count={e ? e.count : undefined}>
                    <div className="cv-lake-dex-pic">
                      <FishPicture id={s.id as LakeFishId} width={200} caught={!!e} />
                      {badge && <span className="cv-lake-dex-badge">{badge.replace(/!$/, "")}</span>}
                      {e && s.invasive && <span className="cv-lake-dex-tag">외래종</span>}
                    </div>
                    <div className="cv-lake-dex-name">{e ? s.label : "???"}</div>
                    <div className="cv-lake-dex-note">{e ? FISH_NOTES[s.id as LakeFishId] : "아직 못 잡았어요. 어떤 물고기일까요?"}</div>
                    {e && (
                      <div className="cv-lake-dex-rec">
                        <span>최대 <b>{Math.round(e.best * 10) / 10}cm</b></span>
                        <span>{e.count}마리</span>
                      </div>
                    )}
                    {e && <div className="cv-lake-dex-day">처음 잡은 날 {e.first}</div>}
                  </div>
                );
              })}
            </div>
            <label className="cv-lake-dex-opt">
              <input
                type="checkbox"
                checked={halo}
                onChange={(e) => {
                  useLakeStore.setState({ halo: e.target.checked });
                  try {
                    localStorage.setItem("cv.lake.halo", e.target.checked ? "1" : "0");
                  } catch {
                    // private mode: the choice lasts until the page closes
                  }
                }}
              />
              내 찌 둘레에 옅은 테두리 보이기
            </label>
            <div className="cv-lake-dex-foot">이 기기에만 저장돼요.</div>
            <div className="cv-lake-board" data-lake-board>
              <strong>🏆 오늘의 대어</strong>
              {board.length === 0 ? (
                <div className="cv-lake-dex-sub">아직 없어요. 첫 대어의 주인공이 되어 봐요!</div>
              ) : (
                [...board]
                  .sort((a, b) => b.cm - a.cm)
                  .slice(0, 5)
                  .map((b, i) => (
                    <div key={i} className="cv-lake-dex-sub">
                      {species(b.kind)?.label ?? b.label} {Math.round(b.cm)}cm · {b.by}
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
