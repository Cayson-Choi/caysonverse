/**
 * The class's progress phases (spec §14): lobby → running ⇄ paused, and end from any of them.
 * Pure: the ClassRoom applies the result, announces it and closes the class after an end.
 */

import type { ClassCommand, ClassPhase } from "@caysonverse/shared/escape/constants";

const COMMANDS: ReadonlySet<string> = new Set<ClassCommand>(["start", "pause", "resume", "end"]);

/** True for exactly the four teacher commands (anything a client sends is checked with this). */
export function isClassCommand(v: unknown): v is ClassCommand {
  return typeof v === "string" && COMMANDS.has(v);
}

/**
 * The phase `cmd` moves `p` to, or null when the command does not apply:
 * lobby-start → running, running-pause → paused, paused-resume → running,
 * (anything but ended)-end → ended. Everything else (a second start, pause in the lobby, any
 * command after the end…) is null, so the room ignores it and says nothing.
 */
export function nextPhase(p: ClassPhase, cmd: ClassCommand): ClassPhase | null {
  switch (cmd) {
    case "start":
      return p === "lobby" ? "running" : null;
    case "pause":
      return p === "running" ? "paused" : null;
    case "resume":
      return p === "paused" ? "running" : null;
    case "end":
      return p === "ended" ? null : "ended";
  }
}
