import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVICE_KEY_PATTERN } from "@caysonverse/shared/memorial/constants";
import { MemorialServerMsg } from "@caysonverse/shared/memorial/messages";
import type { ClaimMine } from "@caysonverse/shared/memorial/types";
import { makeDeviceKey } from "./deviceKey";
import { cropPlan } from "./imageResize";
import { inviteCodeIn } from "./inviteJoin";
import { slotLabel } from "./slotLabel";
import { bindClaimUpdates, claimFor, claimsSnapshot, isMine, noteMyClaim, resetClaimsForTest } from "./claimsStore";
import { MEM_COPY } from "./memorialSheets";
import { inviteLink } from "./FamilySheet";
import { claimPhotoUrl } from "./ClaimFrames";

afterEach(() => resetClaimsForTest());

const MINE: ClaimMine = {
  claimId: "c1",
  slotId: "M1-A-r3-c10",
  petName: "콩이",
  species: "dog",
  born: null,
  bornPrec: "unknown",
  passed: null,
  passedPrec: "unknown",
  line: "",
  photo: null,
  createdAt: 0,
  mine: true,
  privacy: "public",
  photos: [],
  familyCover: { id: "p", moderation: "pending", urls: { s1600: "/media/s/a", s512: "/media/s/b", s128: "/media/s/c" }, isCover: true, caption: "", w: 1, h: 1, createdAt: 0 },
  lastRejected: false,
  albumFree: 5,
};

describe("memorial client helpers", () => {
  it("device keys are 32 random bytes in base64url (43 chars)", () => {
    const k = makeDeviceKey();
    expect(k).toMatch(DEVICE_KEY_PATTERN);
    expect(makeDeviceKey(() => new Uint8Array(32).fill(255))).toBe("_".repeat(42) + "8");
    expect(makeDeviceKey()).not.toBe(k);
  });

  it("names a cubby the way the card says it", () => {
    expect(slotLabel("M1-A-r3-c11")).toBe("A구역 4단 12번");
    expect(slotLabel("M1-E-r0-c00")).toBe("E구역 1단 1번");
    expect(slotLabel("nope")).toBe("");
  });

  it("crops to a 4:5 portrait from the centre and shrinks the long edge to 1600", () => {
    expect(cropPlan(4032, 3024)).toEqual({ sx: 807, sy: 0, sw: 2419, sh: 3024, dw: 1280, dh: 1600 });
    expect(cropPlan(3024, 4032)).toEqual({ sx: 0, sy: 126, sw: 3024, sh: 3780, dw: 1280, dh: 1600 });
    expect(cropPlan(400, 500)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 500, dw: 400, dh: 500 }); // never enlarged
  });

  it("reads the family link from ?f= or /f/, normalised", () => {
    expect(inviteCodeIn("https://x.app/?f=abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
    expect(inviteCodeIn("https://x.app/f/ABCDEFGHJKMN")).toBe("ABCDEFGHJKMN");
    expect(inviteCodeIn("https://x.app/?f=short")).toBeNull();
    expect(inviteCodeIn("https://x.app/")).toBeNull();
    expect(inviteLink("ABCDEFGHJKMN", "https://x.app")).toBe("https://x.app/?f=ABCDEFGHJKMN");
  });

  it("keeps my claim with its family view, and the 3D frame shows my pending photo", () => {
    noteMyClaim(MINE);
    const s = claimsSnapshot();
    expect(s.freeLeft).toBe(0);
    const c = claimFor("M1-A-r3-c10");
    expect(isMine(c)).toBe(true);
    expect(claimPhotoUrl(c, false)).toMatch(/\/media\/s\/c$/);
    expect(claimPhotoUrl({ ...MINE, mine: undefined, photo: null } as never, false)).toBe("");
  });

  it("ClaimUpdated refetches once per burst (only after the hall data was asked for)", async () => {
    vi.useFakeTimers();
    const handlers = new Map<string, (m: unknown) => void>();
    const room = { onMessage: <T,>(t: string, cb: (m: T) => void) => (handlers.set(t, cb as (m: unknown) => void), () => handlers.delete(t)) };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "not_found", message: "x" }), { status: 404 }));
    const off = bindClaimUpdates(room);
    noteMyClaim(MINE); // status stays idle → updates are ignored until the hall is asked for
    handlers.get(MemorialServerMsg.ClaimUpdated)!({ slotId: "M1-A-r3-c10", fields: ["text"] });
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchSpy).not.toHaveBeenCalled();
    off();
    expect(handlers.size).toBe(0);
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("speaks gently: no exclamation marks anywhere in the memorial copy", () => {
    for (const v of Object.values(MEM_COPY)) expect(v).not.toContain("!");
  });
});
