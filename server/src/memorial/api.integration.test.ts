import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_OWNERS_PER_IP_PER_DAY, SIGNED_URL_TTL_MS } from "@caysonverse/shared/memorial/constants";
import type { ClaimCreateResponse, ClaimMine, HallResponse, MeResponse } from "@caysonverse/shared/memorial/types";
import { deviceKey, jpegWithGps, startApi, tempDir, type ApiHarness } from "./testUtil";

// A real server and real sockets/HTTP: each step takes well under a second alone, but a loaded machine (the whole suite in parallel,
// other worktrees) has pushed a boot past the 10 s hook default and a round trip past the 5 s test default. A hang still fails.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const ADMIN = "test-admin-key-not-a-secret";
const running: ApiHarness[] = [];
afterEach(async () => {
  for (const h of running.splice(0)) await h.close();
});
async function api(opts?: Parameters<typeof startApi>[0]) {
  const h = await startApi({ adminKey: ADMIN, ...opts });
  running.push(h);
  return h;
}

function call(h: ApiHarness, path: string, init: RequestInit & { key?: string; json?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.key) headers.Authorization = `Device ${init.key}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.ip) headers["X-Forwarded-For"] = `9.9.9.9, ${init.ip}`;
  return fetch(h.base + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
}

const FORM = { slotId: "M1-A-r3-c10", petName: "콩이", species: "dog", born: "2014-05-17", passed: "2026-11-01", line: "늘 고마웠어요" };

async function claim(h: ApiHarness, key: string, body: Record<string, unknown> = FORM, ip = "1.1.1.1") {
  const r = await call(h, "/api/memorial/claims", { method: "POST", key, json: body, ip });
  return { status: r.status, body: (await r.json()) as ClaimCreateResponse & { error?: string; message?: string } };
}

async function upload(h: ApiHarness, key: string, claimId: string, img: Buffer, type = "image/jpeg") {
  const r = await call(h, `/api/memorial/claims/${claimId}/photos`, { method: "POST", key, body: img, headers: { "Content-Type": type } });
  return { status: r.status, body: (await r.json()) as { claim?: ClaimMine; error?: string; message?: string } };
}

describe("memorial API: claim (모시기)", () => {
  it("claims a free cubby, returns the recovery code once, and shows it in the hall", async () => {
    const h = await api();
    const key = deviceKey();
    const r = await claim(h, key);
    expect(r.status).toBe(201);
    expect(r.body.recoveryCode).toMatch(/^[0-9A-Z]{12}$/);
    expect(r.body.claim).toMatchObject({ slotId: "M1-A-r3-c10", petName: "콩이", mine: true, photo: null, familyCover: null });
    const hall = (await (await call(h, "/api/memorial/hall")).json()) as HallResponse;
    expect(hall.claims.map((c) => c.slotId)).toEqual(["M1-A-r3-c10"]);
    expect(hall.mine).toEqual([]); // no key → no family view
    const mine = (await (await call(h, "/api/memorial/hall", { key })).json()) as HallResponse;
    expect(mine.mine).toHaveLength(1);
    const me = (await (await call(h, "/api/memorial/me", { key })).json()) as MeResponse;
    expect(me.owner?.freeLeft).toBe(0);
    expect(me.owner?.devices).toHaveLength(1);
    // a second cubby for the same family is refused; the owner's next claim does not return a new recovery code
    const again = await claim(h, key, { ...FORM, slotId: "M1-B-r1-c01" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("claim_limit");
    expect(again.body.message).not.toContain("!");
  });

  it("refuses without a key, a bad form, rude or ad text, taken / sample slots", async () => {
    const h = await api();
    expect((await call(h, "/api/memorial/claims", { method: "POST", json: FORM })).status).toBe(401);
    expect((await call(h, "/api/memorial/claims", { method: "POST", json: FORM, headers: { Authorization: "Device short" } })).status).toBe(401);
    const k = deviceKey();
    expect((await claim(h, k, { ...FORM, petName: "" })).status).toBe(400);
    expect((await claim(h, k, { ...FORM, species: "fish" })).status).toBe(400);
    expect((await claim(h, k, { ...FORM, line: "카톡 아이디 주세요" })).body.error).toBe("not_nice");
    expect((await claim(h, k, { ...FORM, line: "www.example.com 방문" })).body.error).toBe("not_nice");
    expect((await claim(h, k, { ...FORM, petName: "시발" })).body.error).toBe("not_nice");
    expect((await claim(h, k, { ...FORM, slotId: "M1-A-r3-c11" })).body.error).toBe("slot_unavailable"); // the sample
    expect((await claim(h, k)).status).toBe(201);
    expect((await claim(h, deviceKey())).body.error).toBe("slot_taken");
  });

  it("caps new owners per IP per day (abuse: fresh keys for free cubbies)", async () => {
    const h = await api();
    for (let i = 0; i < NEW_OWNERS_PER_IP_PER_DAY; i += 1) {
      expect((await claim(h, deviceKey(), { ...FORM, slotId: `M1-B-r0-c0${i}` }, "5.5.5.5")).status).toBe(201);
    }
    const r = await claim(h, deviceKey(), { ...FORM, slotId: "M1-B-r0-c09" }, "5.5.5.5");
    expect(r.status).toBe(429);
    expect((await claim(h, deviceKey(), { ...FORM, slotId: "M1-B-r0-c09" }, "6.6.6.6")).status).toBe(201);
  });

  it("edits the claim (owner only)", async () => {
    const h = await api();
    const key = deviceKey();
    const { body } = await claim(h, key);
    const id = body.claim.claimId;
    const ok = await call(h, `/api/memorial/claims/${id}`, { method: "PATCH", key, json: { line: "새 한 줄이에요" } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { claim: ClaimMine }).claim.line).toBe("새 한 줄이에요");
    expect((await call(h, `/api/memorial/claims/${id}`, { method: "PATCH", key: deviceKey(), json: { line: "x" } })).status).toBe(403);
    expect((await call(h, `/api/memorial/claims/${id}`, { method: "PATCH", key, json: { line: "http://spam" } })).status).toBe(422);
  });

  it("answers CORS preflight for the Vercel origin", async () => {
    const h = await api();
    const r = await fetch(h.base + "/api/memorial/claims", { method: "OPTIONS", headers: { Origin: "https://example.vercel.app" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-allow-headers")).toContain("Authorization");
  });
});

describe("memorial API: photos and review (test matrix #13, #14, #17)", () => {
  it("pending photo: only the family sees it (signed URL), review approves it, then everyone does", async () => {
    const h = await api();
    const key = deviceKey();
    const { body } = await claim(h, key);
    const id = body.claim.claimId;
    const up = await upload(h, key, id, await jpegWithGps());
    expect(up.status).toBe(201);
    const fam = up.body.claim!;
    expect(fam.familyCover?.moderation).toBe("pending");
    expect(fam.photo).toBeNull(); // public view: nothing yet
    const signed = fam.familyCover!.urls!.s512;
    expect(signed).toMatch(/^\/media\/s\/.+\?exp=\d+&sig=/);
    const img = await fetch(h.base + signed);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    const bytes = Buffer.from(await img.arrayBuffer());
    expect((await sharp(bytes).metadata()).exif).toBeUndefined(); // the served file has no EXIF / GPS
    // the public URL does not work while pending; a tampered signature does not either
    const pid = fam.familyCover!.id;
    expect((await fetch(`${h.base}/media/p/${pid}_512.webp`)).status).toBe(404);
    expect((await fetch(h.base + signed.replace(/sig=./, "sig=A"))).status).toBe(403);
    // a visitor's claim view has no photo
    const pub = (await (await call(h, "/api/memorial/claims/M1-A-r3-c10")).json()) as { claim: ClaimMine };
    expect(pub.claim.photo).toBeNull();
    expect(pub.claim.mine).toBeUndefined();
    // the signed link expires after 10 minutes
    h.clock.t += SIGNED_URL_TTL_MS + 1;
    expect((await fetch(h.base + signed)).status).toBe(403);

    // review: no key / wrong key → refused; right key lists it and approves
    expect((await call(h, "/api/memorial/admin/review")).status).toBe(401);
    expect((await call(h, "/api/memorial/admin/review", { headers: { "X-Admin-Key": "wrong" } })).status).toBe(401);
    const q = (await (await call(h, "/api/memorial/admin/review", { headers: { "X-Admin-Key": ADMIN } })).json()) as { items: { photoId: string }[] };
    expect(q.items.map((i) => i.photoId)).toEqual([pid]);
    const ok = await call(h, `/api/memorial/admin/photos/${pid}`, { method: "POST", json: { decision: "approve" }, headers: { "X-Admin-Key": ADMIN } });
    expect(ok.status).toBe(200);
    const hall = (await (await call(h, "/api/memorial/hall")).json()) as HallResponse;
    expect(hall.claims[0]!.photo?.s128).toBe(`/media/p/${pid}_128.webp`);
    const pubImg = await fetch(`${h.base}/media/p/${pid}_128.webp`);
    expect(pubImg.status).toBe(200);
    const meta = await sharp(Buffer.from(await pubImg.arrayBuffer())).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(128);
  });

  it("rejected photo: the family is told, the public never sees it", async () => {
    const h = await api();
    const key = deviceKey();
    const { body } = await claim(h, key);
    const up = await upload(h, key, body.claim.claimId, await jpegWithGps());
    const pid = up.body.claim!.familyCover!.id;
    await call(h, `/api/memorial/admin/photos/${pid}`, { method: "POST", json: { decision: "reject" }, headers: { "X-Admin-Key": ADMIN } });
    const me = (await (await call(h, "/api/memorial/me", { key })).json()) as MeResponse;
    expect(me.owner!.claims[0]!.lastRejected).toBe(true);
    expect(me.owner!.claims[0]!.familyCover).toBeNull();
    expect((await fetch(`${h.base}/media/p/${pid}_512.webp`)).status).toBe(404);
  });

  it("refuses strangers, wrong types, junk, oversize and duplicates", async () => {
    const h = await api();
    const key = deviceKey();
    const { body } = await claim(h, key);
    const id = body.claim.claimId;
    const jpg = await jpegWithGps(800, 1000);
    expect((await upload(h, deviceKey(), id, jpg)).status).toBe(403); // not the family
    expect((await upload(h, key, id, Buffer.from("<svg/>"), "image/svg+xml")).status).toBe(415); // type not accepted → no body
    expect((await upload(h, key, id, Buffer.from("not an image at all"), "image/jpeg")).status).toBe(415);
    expect((await upload(h, key, id, Buffer.alloc(2 * 1024 * 1024 + 10, 0xff), "image/jpeg")).status).toBe(413);
    expect((await upload(h, key, id, jpg)).status).toBe(201);
    const dup = await upload(h, key, id, jpg);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_photo");
  });

  it("the review page is hidden without an operator key", async () => {
    const h = await api({ adminKey: "" });
    expect((await fetch(h.base + "/admin/memorial")).status).toBe(404);
    expect((await call(h, "/api/memorial/admin/review", { headers: { "X-Admin-Key": "x" } })).status).toBe(404);
    const h2 = await api();
    const page = await fetch(h2.base + "/admin/memorial");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("추모관 사진 검토");
    expect(html).not.toContain(ADMIN);
  });
});

describe("memorial API: family devices (test matrix #29) and restart (#31)", () => {
  it("invite link joins a second device that can then edit; reconnecting keeps ownership", async () => {
    const h = await api();
    const key = deviceKey();
    const { body } = await claim(h, key);
    const inv = (await (await call(h, "/api/memorial/owners/invite", { method: "POST", key })).json()) as { code: string; expiresAt: number };
    expect(inv.code).toHaveLength(12);
    const phone = deviceKey();
    const j = await call(h, "/api/memorial/owners/join", { method: "POST", key: phone, json: { code: inv.code, label: "엄마 폰" } });
    expect(j.status).toBe(200);
    const edit = await call(h, `/api/memorial/claims/${body.claim.claimId}`, { method: "PATCH", key: phone, json: { line: "엄마가 왔어요" } });
    expect(edit.status).toBe(200);
    expect((await call(h, "/api/memorial/owners/join", { method: "POST", key: deviceKey(), json: { code: inv.code } })).status).toBe(400);
    const me = (await (await call(h, "/api/memorial/me", { key: phone })).json()) as MeResponse;
    expect(me.owner!.devices.map((d) => [d.label, d.current])).toEqual([
      ["", false],
      ["엄마 폰", true],
    ]);
    // remove the phone: it is a stranger again
    const phoneId = me.owner!.devices[1]!.id;
    expect((await call(h, `/api/memorial/owners/devices/${phoneId}`, { method: "DELETE", key })).status).toBe(200);
    expect(((await (await call(h, "/api/memorial/me", { key: phone })).json()) as MeResponse).owner).toBeNull();
  });

  it("recovery code restores a lost device; a restart keeps claims and photos", async () => {
    const dir = tempDir("restart");
    const h = await startApi({ dir, adminKey: ADMIN });
    const key = deviceKey();
    const { body } = await claim(h, key);
    await upload(h, key, body.claim.claimId, await jpegWithGps());
    await h.close();
    const h2 = await api({ dir });
    const lost = deviceKey();
    const r = await call(h2, "/api/memorial/owners/recover", { method: "POST", key: lost, json: { code: body.recoveryCode } });
    expect(r.status).toBe(200);
    const me = (await (await call(h2, "/api/memorial/me", { key: lost })).json()) as MeResponse;
    expect(me.owner!.claims[0]!.petName).toBe("콩이");
    expect(me.owner!.claims[0]!.familyCover?.moderation).toBe("pending");
    const img = await fetch(h2.base + me.owner!.claims[0]!.familyCover!.urls!.s128);
    expect(img.status).toBe(200);
  });

  it("rate-limits code guessing per IP", async () => {
    const h = await api();
    let last = 0;
    for (let i = 0; i < 25; i += 1) {
      last = (await call(h, "/api/memorial/owners/join", { method: "POST", key: deviceKey(), json: { code: "AAAAAAAAAAAA" }, ip: "7.7.7.7" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("memorial API off", () => {
  it("answers 503 with a gentle line when persistence is unavailable", async () => {
    const express = (await import("express")).default;
    const { mountMemorialApi } = await import("./api");
    const app = express();
    mountMemorialApi(app, { get: () => null });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as import("node:net").AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${port}/api/memorial/hall`);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { message: string }).message).toContain("잠시 뒤에");
    srv.close();
  });
});
