import { isTouchDevice } from "../../device";
import { useAnnounceStore } from "../../stores/announceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ClassToast } from "./ClassToast";
import { PhaseBanner } from "./PhaseBanner";
import { TeamPanel } from "./TeamPanel";
import { useHubUi } from "./hubUi";
import "./hub.css";

/** The line for the pad the player stands on ("선생님이 시작하면 문이 열려요" …): why there is no button here. */
function HubHint() {
  const info = useHubUi((s) => s.info);
  if (info === null) return null;
  return (
    <div className="cv-hub-hint" role="status" aria-live="polite" key={info}>
      <span className="cv-hub-hint-icon" aria-hidden="true">
        💡
      </span>
      <span>{info}</span>
    </div>
  );
}

/**
 * The hall's own DOM overlay (AI 학교 탈출, Task 16), after the shared HUD: the top-centre stack
 * (a notice toast, the phase banner, the pad's guidance line) and — for students — the team panel.
 * The teacher's panel hangs in the top-left HUD column instead (HubScene `hudColumn`).
 */
export function HubHud({ isTeacher }: { isTeacher: boolean }) {
  // An announcement banner takes the top-centre spot on a phone; the stack steps below it.
  const announced = useAnnounceStore((s) => s.text !== "");
  // Left-handed on a phone: the HUD columns swap sides, so does the stack.
  const mirrored = useSettingsStore((s) => s.settings.leftHanded) && isTouchDevice;
  return (
    <>
      <div className={"cv-hub-stack cv-hubui" + (announced ? " has-announce" : "") + (mirrored ? " is-mirrored" : "")}>
        <ClassToast />
        <PhaseBanner isTeacher={isTeacher} />
        {!isTeacher && <HubHint />}
      </div>
      {!isTeacher && <TeamPanel />}
    </>
  );
}
