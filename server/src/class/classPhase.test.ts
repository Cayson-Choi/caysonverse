import { describe, it, expect } from "vitest";
import type { ClassCommand, ClassPhase } from "@caysonverse/shared/escape/constants";
import { isClassCommand, nextPhase } from "./classPhase";

const PHASES: readonly ClassPhase[] = ["lobby", "running", "paused", "ended"];
const COMMANDS: readonly ClassCommand[] = ["start", "pause", "resume", "end"];

describe("nextPhase", () => {
  it("allows only the spec transitions", () => {
    expect(nextPhase("lobby", "start")).toBe("running");
    expect(nextPhase("lobby", "pause")).toBeNull();
    expect(nextPhase("paused", "resume")).toBe("running");
    expect(nextPhase("running", "end")).toBe("ended");
    expect(nextPhase("ended", "start")).toBeNull();
  });

  it("the full table: start, pause, resume once each; end from anything but ended; the rest null", () => {
    const allowed: Record<string, ClassPhase> = {
      "lobby/start": "running",
      "running/pause": "paused",
      "paused/resume": "running",
      "lobby/end": "ended",
      "running/end": "ended",
      "paused/end": "ended",
    };
    for (const phase of PHASES) {
      for (const cmd of COMMANDS) {
        expect(nextPhase(phase, cmd), `${phase}/${cmd}`).toBe(allowed[`${phase}/${cmd}`] ?? null);
      }
    }
  });
});

describe("isClassCommand", () => {
  it("accepts exactly the four commands", () => {
    for (const cmd of COMMANDS) expect(isClassCommand(cmd)).toBe(true);
    for (const bad of ["START", " start", "stop", "", null, undefined, 1, {}, ["start"]]) {
      expect(isClassCommand(bad), String(bad)).toBe(false);
    }
  });
});
