import { beforeEach, describe, expect, it } from "vitest";
import { acceptInspectReply, dropInspectRequests, noteInspectRequest } from "./inspectRequests";

beforeEach(() => dropInspectRequests());

describe("which close-up replies the player is still waiting for", () => {
  it("accepts the reply to something asked for", () => {
    noteInspectRequest("note_2");
    expect(acceptInspectReply("note_2")).toBe(true);
  });

  it("ignores a reply nobody asked for", () => {
    expect(acceptInspectReply("note_2")).toBe(false);
    noteInspectRequest("note_3");
    expect(acceptInspectReply("note_2")).toBe(false);
  });

  it("a reply that comes after the card was closed does not reopen it", () => {
    noteInspectRequest("cabinet");
    dropInspectRequests(); // Esc / ✕ / backdrop: the store's inspect went to null
    expect(acceptInspectReply("cabinet")).toBe(false);
  });

  it("the refresh the open card asked for is dropped too once the card is closed", () => {
    noteInspectRequest("cabinet"); // the first look
    expect(acceptInspectReply("cabinet")).toBe(true);
    noteInspectRequest("cabinet"); // the card refreshes itself after a flag changed
    dropInspectRequests(); // ...and the player closes it before the answer comes
    expect(acceptInspectReply("cabinet")).toBe(false);
  });

  it("asking again after the close is wanted again", () => {
    noteInspectRequest("cabinet");
    dropInspectRequests();
    noteInspectRequest("cabinet");
    expect(acceptInspectReply("cabinet")).toBe(true);
  });

  it("closing forgets every object, not just one", () => {
    noteInspectRequest("a");
    noteInspectRequest("b");
    dropInspectRequests();
    expect(acceptInspectReply("a")).toBe(false);
    expect(acceptInspectReply("b")).toBe(false);
  });
});
