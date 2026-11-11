import { useEffect, useState } from "react";
import {
  FISHING_POND_REACH_M,
  FISHING_RENTAL_REACH_M,
  FISHING_SPOTS,
  distanceSquared,
  type FishingPhase,
} from "@caysonverse/shared/village/fishing";
import { VillageServerMsg, type FishingRejectedPayload, type FishingStatePayload } from "@caysonverse/shared/village/messages";
import { getRoom, sendFishingCast, sendFishingReel, sendFishingRentRod } from "../net/connection";
import type { Pose } from "../game/types";
import { fishingPhaseLabel, fishingRejectLabel, fishingResultLabel, parseFishingResult, parseFishingState, EMPTY_FISHING_STATE } from "./fishingUi";
import "./fishingPanel.css";

function near(pose: Pose, point: { x: number; z: number }, reach: number): boolean {
  return distanceSquared({ x: pose.x, z: pose.z }, point) <= reach * reach + 1e-9;
}

/**
 * The compact fishing HUD. It is only a command surface: phase, bobber and catch
 * results are accepted from the room's server messages, never predicted locally.
 */
export function FishingPanel({ pose }: { pose: Pose }) {
  const room = getRoom();
  const [state, setState] = useState<FishingStatePayload>(EMPTY_FISHING_STATE);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!room) return;
    const offState = room.onMessage(VillageServerMsg.FishingState, (payload: unknown) => {
      const parsed = parseFishingState(payload);
      if (parsed) setState(parsed);
    });
    const offResult = room.onMessage(VillageServerMsg.FishingResult, (payload: unknown) => {
      const parsed = parseFishingResult(payload);
      if (parsed) setState(parsed);
    });
    const offRejected = room.onMessage(VillageServerMsg.FishingRejected, (payload: unknown) => {
      const text = fishingRejectLabel(payload as FishingRejectedPayload);
      setNotice(text);
      window.setTimeout(() => setNotice((current) => current === text ? null : current), 2200);
    });
    return () => {
      offState();
      offResult();
      offRejected();
    };
  }, [room]);

  const nearRental = near(pose, FISHING_SPOTS.rental, FISHING_RENTAL_REACH_M + 0.9);
  const nearPond = near(pose, FISHING_SPOTS.pond, FISHING_POND_REACH_M + 0.9);
  if (!nearRental && !nearPond && state.phase === "no_rod") return null;

  const result = fishingResultLabel(state);
  const action: { label: string; disabled: boolean; onClick: () => void } | null =
    nearRental && !state.rodRented
      ? { label: "낚싯대 빌리기", disabled: false, onClick: sendFishingRentRod }
      : nearPond && state.phase === "ready"
        ? { label: "낚싯대 던지기", disabled: false, onClick: sendFishingCast }
        : nearPond && state.phase === "submerged"
          ? { label: "지금 당기기", disabled: false, onClick: sendFishingReel }
          : null;

  const phaseText: string = fishingPhaseLabel(state.phase as FishingPhase);
  const helper = !state.rodRented && nearPond
    ? "동쪽 대여점에서 낚싯대를 빌려 오세요."
    : state.phase === "waiting"
      ? "찌가 물속으로 잠길 때까지 기다리세요."
      : state.phase === "submerged"
        ? "지금 당기면 물고기를 낚을 수 있어요!"
        : null;

  return (
    <section className="cv-fishing" aria-label="연못 낚시" onPointerDown={(event) => event.stopPropagation()}>
      <div className="cv-fishing-title">🎣 연못 낚시</div>
      <div className={`cv-fishing-bobber is-${state.phase}`} aria-live="polite">
        <span className="cv-fishing-bobber-dot" aria-hidden="true" />
        <span>{phaseText}</span>
      </div>
      {helper ? <div className="cv-fishing-helper">{helper}</div> : null}
      {result ? <div className="cv-fishing-result" role="status">{result}</div> : null}
      {notice ? <div className="cv-fishing-notice" role="alert">{notice}</div> : null}
      {action ? (
        <button type="button" className="cv-fishing-action" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </section>
  );
}
