import { useEffect, useState, useSyncExternalStore } from "react";
import { characterModel } from "../game/characterModel";
import { useAppStore } from "../stores/appStore";
import { isTouchDevice } from "../device";
import { ENTRY_ART, entryArtFor } from "./stageLayout";
import { currentStep, loadActivity, loadPercent, loadSteps, villageLoad } from "./villageLoad";
import { entrySnapshot } from "./entryFigure";
import { MOTES } from "./EntryScreen";
import type { CSSProperties } from "react";
import "./loader.css";

/** 기다리는 동안 돌아가며 보이는 한 줄 도움말(PC / 폰). */
export const LOADER_TIPS: ReadonlyArray<{ pc: string; touch: string }> = [
  { pc: "Shift를 누른 채 걸으면 달려요.", touch: "왼쪽 아래 막대를 끝까지 밀면 달려요." },
  { pc: "🗺 지도에서 장소를 누르면 그곳까지 걸어가요.", touch: "🗺 지도에서 장소를 누르면 그곳까지 걸어가요." },
  { pc: "의자나 벤치를 누르면 걸어가서 앉아요.", touch: "의자나 벤치를 누르면 걸어가서 앉아요." },
  { pc: "추모관에서는 촛불을 켜고 편지를 남길 수 있어요.", touch: "추모관에서는 촛불을 켜고 편지를 남길 수 있어요." },
  { pc: "케이슨 낚시터 관리소에서 낚싯대를 빌려요.", touch: "케이슨 낚시터 관리소에서 낚싯대를 빌려요." },
  { pc: "Enter를 누르면 이웃에게 말을 걸 수 있어요.", touch: "💬 버튼으로 이웃에게 말을 걸 수 있어요." },
  { pc: "Esc를 누르면 메뉴가 열려요.", touch: "☰ 메뉴에서 설정을 바꿀 수 있어요." },
];
/** 도움말이 바뀌는 간격(ms). */
export const TIP_MS = 4200;

/**
 * 입장 로딩 화면 (UX 2026-11-16). 입장하기를 누른 순간부터 마을이 처음 보일 때까지 화면 전체를 덮는다: 입장 화면의
 * 마을 그림을 깔고(이미 받아 둔 그림, 새 파일 없음), 단계(마을 → 캐릭터 → 접속)와 진행 막대, 지금 하는 일, 돌아가는
 * 도움말. 앱 맨 위(App)에 있어 입장 화면과 마을 장면이 바뀌는 사이에도 그대로다. 다 되면 부드럽게 걷힌다.
 */
export function VillageLoader() {
  const s = useSyncExternalStore(villageLoad.subscribe, villageLoad.get, villageLoad.get);
  const [tip, setTip] = useState(0);
  const [art] = useState(() => ENTRY_ART[entryArtFor(window.innerWidth, window.innerHeight)]);

  // 마을에 들어갔다가 입장 화면으로 돌아가면(접속 끊김·내보내짐) 바로 닫는다: 입장 화면을 가리지 않게
  const screen = useAppStore((a) => a.screen);
  const [wasVillage, setWasVillage] = useState(false);
  useEffect(() => {
    if (screen === "village") setWasVillage(true);
    else if (wasVillage) {
      setWasVillage(false);
      villageLoad.fail();
    }
  }, [screen, wasVillage]);

  // 캐릭터: 입장 화면이 미리 받아 둔다. 아직이면 끝날 때 알린다.
  useEffect(() => {
    if (!s.open || s.charReady) return;
    let live = true;
    void characterModel.settle().then((ok) => {
      if (live && ok) villageLoad.charReady();
    });
    return () => {
      live = false;
    };
  }, [s.open, s.charReady]);

  useEffect(() => {
    if (!s.open) return;
    setTip(Math.floor(Math.random() * LOADER_TIPS.length));
    const id = window.setInterval(() => setTip((t) => (t + 1) % LOADER_TIPS.length), TIP_MS);
    return () => window.clearInterval(id);
  }, [s.open]);

  if (!s.open) return null;
  const pct = loadPercent(s);
  const step = currentStep(s);
  const t = LOADER_TIPS[tip % LOADER_TIPS.length]!;
  const snap = entrySnapshot();
  const snapArt = snap ? (ENTRY_ART[snap.art as keyof typeof ENTRY_ART] ?? art) : art;
  return (
    <div
      className={"cv-loader" + (s.closing ? " is-closing" : "") + (snap && snap.className.split(" ").includes("is-wide") ? " is-wide-stage" : "")}
      data-testid="village-loader"
      data-open="1"
      data-step={step}
      data-pct={pct}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="케이슨 마을로 가는 중"
    >
      {snap ? (
        // the entry screen's own stage, as it stood at the press: the same art at the same box, the podium's light, the motes,
        // and the figure where it stood (owner 2026-11-27: "캐릭터 고르기 화면과 동일해야")
        <>
          <div className={snap.className + " cv-loader-entry"} style={snap.vars as CSSProperties} aria-hidden="true">
            <div className="cv-entry-bg">
              <div className="cv-entry-lqip" style={{ backgroundImage: `url(${snapArt.lqip})` }} />
              <picture>
                <source type="image/avif" srcSet={snapArt.avif} />
                <img className="cv-entry-art" src={snapArt.webp} alt="" draggable={false} />
              </picture>
              <div className="cv-stage-spot" />
              <div className="cv-stage-glow" />
              <div className="cv-motes">
                {MOTES.map(([x, y, size, loop, ahead], i) => (
                  <span
                    key={i}
                    style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, animationDuration: `${loop}s`, animationDelay: `-${ahead}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
          <img
            className="cv-loader-figure"
            src={snap.image}
            alt=""
            aria-hidden="true"
            draggable={false}
            data-testid="loader-figure"
            style={{ left: snap.rect.x, top: snap.rect.y, width: snap.rect.w, height: snap.rect.h }}
          />
        </>
      ) : (
        <>
          <picture className="cv-loader-art" aria-hidden="true">
            <source type="image/avif" srcSet={art.avif} />
            <img src={art.webp} alt="" draggable={false} />
          </picture>
          <div className="cv-loader-shade" aria-hidden="true" />
        </>
      )}
      <div className="cv-loader-card">
        <img className="cv-loader-logo" src="/brand/cayson-logo-white.png" alt="Cayson" height={26} />
        <p className="cv-loader-title">케이슨 마을로 가는 중</p>
        <ol className="cv-loader-steps">
          {loadSteps(s).map((st, i) => (
            <li key={st.id} className={st.done ? "is-done" : st.id === step ? "is-now" : ""} data-step={st.id}>
              <span className="cv-loader-dot" aria-hidden="true">
                {st.done ? "✓" : i + 1}
              </span>
              {st.label}
            </li>
          ))}
        </ol>
        <div className="cv-loader-bar" aria-hidden="true">
          <div className="cv-loader-fill" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        <p className="cv-loader-now">
          <span>{loadActivity(s)}</span>
          <span className="cv-loader-pct">{pct}%</span>
        </p>
        <p className="cv-loader-tip" key={tip}>
          💡 {isTouchDevice ? t.touch : t.pc}
        </p>
      </div>
    </div>
  );
}
