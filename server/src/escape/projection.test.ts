import { describe, expect, it, vi } from "vitest";
import { Decoder, Encoder } from "@colyseus/schema";
import { EscapeState } from "@caysonverse/shared/schema";
import { createEngineState } from "./engine";
import { projectToSchema } from "./projection";
import { counsel } from "./rooms/counsel";

/** What a client holds after decoding everything sent so far (full state, then patches). */
function syncedCopy() {
  const st = new EscapeState();
  const encoder = new Encoder(st);
  const decoded = new EscapeState();
  const decoder = new Decoder(decoded);
  decoder.decode(encoder.encodeAll());
  return {
    st,
    decoded,
    /** Send this round's changes to the client, as a patch. */
    patch() {
      decoder.decode(encoder.encode());
      encoder.discardChanges();
    },
  };
}

describe("projectToSchema", () => {
  it("projects flags append-only, bag as a whole, maps by changed keys", () => {
    const es = createEngineState(counsel);
    const { st, decoded, patch } = syncedCopy();

    // First projection: the initial lock inputs ("0000"), empty everything else.
    projectToSchema(es, st);
    patch();
    expect(decoded.lockInput.toJSON()).toEqual({ cabinet_lock: "0000", cover_lock: "0000" });
    expect([...decoded.flags]).toEqual([]);
    expect([...decoded.bag]).toEqual([]);

    // Flags: the new ones are appended in the order they were set; existing ones are never rewritten.
    es.flags.add("picked:flashlight");
    es.flags.add("picked:uv_film");
    es.bag.push("flashlight", "uv_film");
    es.lockInput.set("cabinet_lock", "4700");
    es.board.set("festival", "ok");
    es.board.set("lunch", "stop");
    es.votes.set("s1", "privacy");
    es.finaleStep = 1;
    es.hintsUsed = 2;
    es.wrongAttempts = 3;

    const flagPush = vi.spyOn(st.flags, "push");
    const lockSet = vi.spyOn(st.lockInput, "set");
    projectToSchema(es, st);
    patch();
    expect(flagPush.mock.calls.flat()).toEqual(["picked:flashlight", "picked:uv_film"]);
    // Only the changed lock input was written (cover_lock stayed "0000").
    expect(lockSet.mock.calls).toEqual([["cabinet_lock", "4700"]]);
    expect(decoded.toJSON()).toMatchObject({
      flags: ["picked:flashlight", "picked:uv_film"],
      bag: ["flashlight", "uv_film"],
      lockInput: { cabinet_lock: "4700", cover_lock: "0000" },
      board: { festival: "ok", lunch: "stop" },
      votes: { s1: "privacy" },
      finaleStep: 1,
      hintsUsed: 2,
      wrongAttempts: 3,
    });

    // Nothing changed → nothing is written: no flag push, no bag rewrite, no map write.
    flagPush.mockClear();
    lockSet.mockClear();
    const bagClear = vi.spyOn(st.bag, "clear");
    const boardSet = vi.spyOn(st.board, "set");
    const boardDelete = vi.spyOn(st.board, "delete");
    projectToSchema(es, st);
    expect(flagPush).not.toHaveBeenCalled();
    expect(bagClear).not.toHaveBeenCalled();
    expect(lockSet).not.toHaveBeenCalled();
    expect(boardSet).not.toHaveBeenCalled();
    expect(boardDelete).not.toHaveBeenCalled();

    // The bag is rewritten as a whole when it differs (combine: two items out, one in).
    es.bag = ["uv_flashlight"];
    // Maps: a changed key is set, a removed key is deleted, an unchanged key is left alone.
    es.board.set("lunch", "ok");
    es.board.delete("festival");
    es.votes.clear();
    const bagPush = vi.spyOn(st.bag, "push");
    projectToSchema(es, st);
    patch();
    expect(bagClear).toHaveBeenCalledTimes(1);
    expect(bagPush.mock.calls).toEqual([["uv_flashlight"]]);
    expect(boardSet.mock.calls).toEqual([["lunch", "ok"]]);
    expect(boardDelete.mock.calls).toEqual([["festival"]]);
    expect([...decoded.bag]).toEqual(["uv_flashlight"]);
    expect(decoded.board.toJSON()).toEqual({ lunch: "ok" });
    expect(decoded.votes.toJSON()).toEqual({});

    // Append-only: a flag the engine no longer lists is NOT taken off the synced list (the engine
    // never removes flags; the projection never rewrites what clients already hold).
    es.flags.delete("picked:uv_film");
    es.flags.add("made:uv_flashlight");
    projectToSchema(es, st);
    patch();
    expect([...decoded.flags]).toEqual(["picked:flashlight", "picked:uv_film", "made:uv_flashlight"]);

    // The counters saturate at their wire types instead of wrapping.
    es.wrongAttempts = 70_000;
    es.hintsUsed = 300;
    projectToSchema(es, st);
    patch();
    expect(decoded.wrongAttempts).toBe(65_535);
    expect(decoded.hintsUsed).toBe(255);
  });
});
