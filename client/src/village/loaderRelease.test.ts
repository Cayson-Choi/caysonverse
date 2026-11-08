import { describe, expect, it } from "vitest";
import { type CachedFile, isWaitingForLoad, releaseCachedFile } from "./loaderRelease";

function file(id: string) {
  let state: { kind: "ready"; v: string } | { kind: "loading"; p: Promise<void>; done: () => void } | { kind: "error" } | null = null;
  const log: string[] = [];
  const f: CachedFile<string> = {
    id,
    read: () => {
      if (!state) throw new Error("never requested");
      if (state.kind === "loading") throw state.p;
      if (state.kind === "error") throw new Error("Could not load");
      return state.v;
    },
    clear: () => {
      log.push("clear");
      state = null;
    },
    free: (v) => void log.push(`free ${v}`),
  };
  return {
    f,
    log,
    ready: (v: string) => void (state = { kind: "ready", v }),
    error: () => void (state = { kind: "error" }),
    loading: () => {
      let done!: () => void;
      const p = new Promise<void>((res) => (done = res));
      state = { kind: "loading", p, done };
      return (v: string) => {
        state = { kind: "ready", v };
        done();
      };
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("releaseCachedFile", () => {
  it("ready: clears and frees now", () => {
    const x = file("a");
    x.ready("glb");
    releaseCachedFile(x.f, () => false);
    expect(x.log).toEqual(["clear", "free glb"]);
  });

  it("a failed load: clears the error, frees nothing", () => {
    const x = file("b");
    x.error();
    releaseCachedFile(x.f, () => false);
    expect(x.log).toEqual(["clear"]);
  });

  it("still loading: waits once (a second release is not doubled), then clears and frees", async () => {
    const x = file("c");
    const arrive = x.loading();
    releaseCachedFile(x.f, () => false);
    releaseCachedFile(x.f, () => false);
    expect(isWaitingForLoad("c")).toBe(true);
    expect(x.log).toEqual([]);
    arrive("late");
    await flush();
    expect(isWaitingForLoad("c")).toBe(false);
    expect(x.log).toEqual(["clear", "free late"]);
  });

  it("still loading and held again by the time it arrives: left to the new holder", async () => {
    const x = file("d");
    const arrive = x.loading();
    releaseCachedFile(x.f, () => true);
    arrive("kept");
    await flush();
    expect(x.log).toEqual([]);
  });
});
