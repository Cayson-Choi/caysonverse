import { FISH_SPECIES, species } from "./lakeProtocol";
import { useLakeStore, type CatchCard } from "./lakeStore";

/** A little fish picture (a stand-in until lake_fish.glb's renders): a body, a tail and an eye in the species colour. */
function FishPicture({ color, size = 96 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" aria-hidden="true">
      <ellipse cx="46" cy="30" rx="36" ry="17" fill={color} />
      <ellipse cx="46" cy="36" rx="30" ry="8" fill="rgba(255,255,255,0.35)" />
      <polygon points="80,30 98,14 98,46" fill={color} />
      <circle cx="26" cy="26" r="3.2" fill="#1a1a1a" />
    </svg>
  );
}

/** The catch card (design 7.1: the species, the length and the 월척 badge) and, when open, the dex (9.6: kept on this device only). */
export function LakeCards({ card }: { card: CatchCard | null }) {
  const dexOpen = useLakeStore((s) => s.dexOpen);
  const dex = useLakeStore((s) => s.dex);
  const halo = useLakeStore((s) => s.halo);
  const sp = card ? species(card.kind) : null;
  return (
    <>
      {card && sp && (
        <div className="cv-lake-card" role="status" aria-live="polite" onClick={() => useLakeStore.getState().dismissCard()} data-lake-card>
          <FishPicture color={sp.color} />
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
            <div className="cv-lake-dex-grid">
              {FISH_SPECIES.map((s) => {
                const e = dex[s.id];
                return (
                  <div key={s.id} className={"cv-lake-dex-item" + (e ? " is-got" : "")} data-dex={s.id}>
                    <FishPicture color={e ? s.color : "#3a3a44"} size={64} />
                    <div className="cv-lake-dex-name">{e ? s.label : "???"}</div>
                    <div className="cv-lake-dex-sub">{e ? `최대 ${Math.round(e.best * 10) / 10}cm · ${e.count}마리` : "아직 못 잡았어요"}</div>
                    {e && <div className="cv-lake-dex-day">{e.first}</div>}
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
            <div className="cv-lake-dex-note">이 기기에만 저장돼요.</div>
          </div>
        </div>
      )}
    </>
  );
}
