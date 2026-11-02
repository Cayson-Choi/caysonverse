import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM_COLORS, TEAM_COLOR_LABELS, TEAM_MAX, TEAM_NAMES } from "@caysonverse/shared/escape/constants";
import { ClassMsg } from "@caysonverse/shared/escape/messages";
import { teamDisplayName, type TeamCombo } from "@caysonverse/shared/escape/teams";
import { sendClass } from "../../net/connection";
import { acquireUiCapture, releaseUiCapture } from "../../game/uiCapture";
import { useClassStore, type TeamRow } from "../../stores/classStore";
import { useHubUi } from "./hubUi";
import { colorFlags, joinState, nameFlags, pickColor, pickName, resolveCombo, usedCombos } from "./teamChoices";
import "./hub.css";

/** The keyboard owner name while the panel is open (movement and the E key wait; Esc still works). */
const CAPTURE_OWNER = "team";

function Dot({ color }: { color: string }) {
  return <span className="cv-hub-dot" style={{ background: color }} aria-hidden="true" />;
}

function TeamItem({ team, iHaveTeam }: { team: TeamRow; iHaveTeam: boolean }) {
  const state = joinState(team, iHaveTeam);
  const names = team.members.map((m) => m.nickname).join(", ");
  return (
    <li className={"cv-hub-team" + (team.mine ? " is-mine" : "")}>
      <Dot color={team.color} />
      <span className="cv-hub-team-main">
        <span className="cv-hub-team-name">{team.name}</span>
        <span className="cv-hub-team-members">{names || "아직 아무도 없어요"}</span>
      </span>
      <span className="cv-hub-count" aria-label={`${team.members.length}명, 최대 ${TEAM_MAX}명`}>
        {team.members.length}/{TEAM_MAX}
      </span>
      {state === "mine" ? (
        <span className="cv-hub-tag">내 팀</span>
      ) : (
        <button
          type="button"
          className="cv-hub-btn is-small"
          disabled={state !== "join"}
          onClick={() => sendClass(ClassMsg.TeamJoin, { teamId: team.id })}
        >
          {state === "full" ? "가득 찼어요" : "들어가기"}
        </button>
      )}
    </li>
  );
}

/** "새 팀 만들기": the names and colours still free (a pair already used cannot be picked). */
function CreateTeam({ teams }: { teams: TeamRow[] }) {
  const [want, setWant] = useState<TeamCombo | null>(null);
  const used = useMemo(() => usedCombos(teams), [teams]);
  const choice = useMemo(() => resolveCombo(used, want), [used, want]);
  const names = useMemo(() => nameFlags(used), [used]);
  const colors = useMemo(() => (choice ? colorFlags(used, choice.nameIndex) : []), [used, choice]);

  if (!choice) return <p className="cv-hub-note">만들 수 있는 팀 이름이 모두 쓰이고 있어요.</p>;
  const previewColor = TEAM_COLORS[choice.colorIndex];
  return (
    <section className="cv-hub-section" aria-label="새 팀 만들기">
      <h3 className="cv-hub-h3">새 팀 만들기</h3>
      <div className="cv-hub-chips" role="group" aria-label="팀 이름">
        {TEAM_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            className="cv-hub-chip"
            aria-pressed={i === choice.nameIndex}
            disabled={!names[i]}
            onClick={() => setWant(pickName(used, choice, i))}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="cv-hub-swatches" role="group" aria-label="팀 색">
        {TEAM_COLORS.map((color, i) => (
          <button
            key={color}
            type="button"
            className="cv-hub-swatch"
            style={{ background: color }}
            aria-label={TEAM_COLOR_LABELS[i]}
            aria-pressed={i === choice.colorIndex}
            disabled={!colors[i]}
            onClick={() => setWant(pickColor(used, choice, i))}
          >
            <span className="cv-hub-swatch-mark" aria-hidden="true">
              {i === choice.colorIndex ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>
      <div className="cv-hub-make">
        <span className="cv-hub-preview">
          <Dot color={previewColor} />
          <span>{teamDisplayName(choice.nameIndex, choice.colorIndex)}</span>
        </span>
        <button
          type="button"
          className="cv-hub-btn is-primary"
          onClick={() => sendClass(ClassMsg.TeamCreate, { nameIndex: choice.nameIndex, colorIndex: choice.colorIndex })}
        >
          새 팀 만들기
        </button>
      </div>
    </section>
  );
}

/**
 * The team panel (AI 학교 탈출, Task 16) — opened by the 👥 "팀 만들기" button on the team rug. A
 * centred glass dialog (a bottom sheet on a phone): the class's teams with their colour, name and
 * n/6 and a "들어가기", then — when you have no team — "새 팀 만들기" with the names and colours
 * still free; with a team, "팀에서 나오기". The server judges every move (it must be made on the
 * rug) and answers a refusal with a notice (the toast), so the panel only sends.
 *
 * While it is open the keyboard belongs to it (movement and E wait). Esc / the ✕ / a tap on the veil
 * close it; Esc is consumed here first (preventDefault, captured on the window) so it does not also
 * open the menu.
 */
export function TeamPanel() {
  const open = useHubUi((s) => s.teamPanelOpen);
  if (!open) return null;
  return <TeamPanelBody />;
}

function TeamPanelBody() {
  const teams = useClassStore((s) => s.teams);
  const mine = teams.find((t) => t.mine) ?? null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = () => useHubUi.getState().closeTeamPanel();

  useEffect(() => {
    acquireUiCapture(CAPTURE_OWNER);
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== "Escape") return;
      e.preventDefault(); // the hotkey table drops a consumed key: Esc closes this, not "opens the menu"
      useHubUi.getState().closeTeamPanel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      releaseUiCapture(CAPTURE_OWNER);
    };
  }, []);

  return (
    <div
      className="cv-hub-veil cv-hubui"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="cv-hub-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cv-hub-team-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="cv-hub-head">
          <span className="cv-hub-badge" aria-hidden="true">
            👥
          </span>
          <h2 className="cv-hub-title" id="cv-hub-team-title">
            팀 만들기
          </h2>
          <button type="button" className="cv-hub-x" aria-label="닫기" onClick={close}>
            ✕
          </button>
        </header>

        <div className="cv-hub-body">
          {mine && (
            <section className="cv-hub-mine" aria-label="내 팀">
              <Dot color={mine.color} />
              <span className="cv-hub-team-main">
                <span className="cv-hub-mine-label">내 팀</span>
                <span className="cv-hub-team-name">{mine.name}</span>
              </span>
              <button type="button" className="cv-hub-btn is-small" onClick={() => sendClass(ClassMsg.TeamLeave, {})}>
                팀에서 나오기
              </button>
            </section>
          )}

          <section className="cv-hub-section" aria-label="팀 목록">
            <h3 className="cv-hub-h3">우리 반 팀</h3>
            {teams.length === 0 ? (
              <p className="cv-hub-note">아직 팀이 없어요. 첫 팀을 만들어 보세요!</p>
            ) : (
              <ul className="cv-hub-teams">
                {teams.map((t) => (
                  <TeamItem key={t.id} team={t} iHaveTeam={mine !== null} />
                ))}
              </ul>
            )}
          </section>

          {!mine && <CreateTeam teams={teams} />}
        </div>

        <footer className="cv-hub-foot">
          <button type="button" className="cv-hub-btn" onClick={close}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
