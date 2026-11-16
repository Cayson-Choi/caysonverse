import { HudButton } from "../../ui/HudButton";
import { useLocalArea } from "../villageArea";
import { useTransitState } from "../../net/transitSync";
import { resumeVillageAudio } from "../villageAudio";
import { closeFinder, openFinder, useStarFinder } from "./starFinderStore";

/**
 * 🔭 — 별자리 찾기, in the HUD's left column (outside only: the memorial hall has no sky). By day it
 * is drawn dim with a small moon (there is something to do tonight) and opens the "별은 밤에 보여요" card. No hotkey: in
 * the village the letter keys type into the chat.
 */
export function StarFinderButton() {
  const area = useLocalArea();
  const open = useStarFinder((s) => s.open);
  const day = useStarFinder((s) => s.phase === "day");
  const { boarded } = useTransitState();
  if (area !== "village" || boarded) return null; // no sky indoors or aboard the bus
  return (
    <HudButton
      label={open ? "별자리 찾기 닫기" : "별자리 찾기"}
      pressed={open}
      className={"cv-sky-hud-btn" + (day && !open ? " is-day" : "")}
      onClick={() => {
        resumeVillageAudio(); // a gesture: the found chime may play later
        if (open) closeFinder();
        else openFinder();
      }}
    >
      🔭
    </HudButton>
  );
}
