import crypto from "node:crypto";
import fs from "node:fs";
import express, { type Application, type NextFunction, type Request, type Response } from "express";
import {
  ADMIN_FAILS_PER_IP,
  CLAIM_EDITS_PER_HOUR,
  DEVICE_AUTH_SCHEME,
  DEVICE_LABEL_MAX,
  KEY_ATTEMPTS_PER_IP_PER_HOUR,
  NEW_OWNERS_PER_IP_PER_DAY,
  PHOTO_CONTENT_TYPES,
  PHOTO_UPLOADS_PER_DAY,
  PHOTO_UPLOAD_MAX_BYTES,
} from "@caysonverse/shared/memorial/constants";
import { MEMORIAL_API } from "@caysonverse/shared/memorial/messages";
import type {
  AdminReviewItem,
  ApiError,
  ApiErrorCode,
  ClaimCreateResponse,
  HallResponse,
  InviteResponse,
  JoinOwnerResponse,
  MeResponse,
} from "@caysonverse/shared/memorial/types";
import { cleanText, validateClaimFields } from "@caysonverse/shared/memorial/validate";
import { ADMIN_PAGE_HTML } from "./adminPage";
import { parseMediaFile, signedUrls, verifySig } from "./media";
import { photoPath, processQueued, writeVariants } from "./photos";
import { KeyedRate, Memorial, memorial } from "./service";
import { randomId, sha256Hex, StoreFail } from "./store";
import { textIsNice } from "./textFilter";

/**
 * The memorial HTTPS API (stage B) on the Colyseus Express app: `/api/memorial/*`, the photo files `/media/*`, and the operator's
 * review page `/admin/memorial`. Mounted BEFORE the SPA fallback (index.ts).
 *
 * Auth: `Authorization: Device <key>` (the browser's random device key; only its SHA-256 is looked up). The client is on another
 * origin (Vercel), so CORS allows any origin — safe because nothing rides on cookies. Request bodies, keys and codes are never
 * logged. Every refusal is `{ error, message }` with a short Korean line.
 */

const COPY: Record<ApiErrorCode, string> = {
  bad_request: "내용을 다시 확인해 주세요",
  unauthorized: "이 기기를 확인하지 못했어요. 페이지를 새로고침해 주세요",
  forbidden: "이 칸의 가족 기기에서만 할 수 있어요",
  not_found: "찾지 못했어요",
  slot_taken: "방금 다른 가족이 이 칸에 아이를 모셨어요. 다른 칸을 골라 주세요",
  slot_unavailable: "이 칸에는 모실 수 없어요. 다른 칸을 골라 주세요",
  claim_limit: "지금은 한 가족에 한 칸까지 모실 수 있어요",
  not_nice: "고운 말로 다시 써 볼까요?",
  rate_limited: "조금 쉬었다가 다시 해 주세요",
  too_large: "사진이 너무 커요. 다른 사진을 골라 주세요",
  bad_image: "사진을 읽지 못했어요. JPG나 PNG 사진을 골라 주세요",
  duplicate_photo: "이미 올린 사진이에요",
  album_full: "사진은 5장까지 무료예요",
  invite_invalid: "링크나 코드가 맞지 않거나 시간이 지났어요",
  device_limit: "한 가족에 기기는 6대까지 연결할 수 있어요",
  device_owned: "이 기기는 이미 다른 칸의 가족 기기예요",
  unavailable: "지금은 모시기를 할 수 없어요. 잠시 뒤에 다시 해 주세요",
};

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  slot_taken: 409,
  slot_unavailable: 409,
  claim_limit: 409,
  not_nice: 422,
  rate_limited: 429,
  too_large: 413,
  bad_image: 415,
  duplicate_photo: 409,
  album_full: 409,
  invite_invalid: 400,
  device_limit: 409,
  device_owned: 409,
  unavailable: 503,
};

function fail(res: Response, code: ApiErrorCode): void {
  const body: ApiError = { error: code, message: COPY[code] };
  res.status(STATUS[code]).json(body);
}

/** The client's address: the RIGHTMOST X-Forwarded-For entry (the one Caddy added), else the socket. Node runs only behind Caddy. */
export function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  const last = raw?.split(",").pop()?.trim();
  return last || req.socket.remoteAddress || "unknown";
}

/** `Authorization: Device <key>` → the key's SHA-256, or null. */
export function deviceKeyHash(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const [scheme, key] = h.split(" ");
  if (scheme !== DEVICE_AUTH_SCHEME || !key) return null;
  return Memorial.keyHash(key);
}

function cors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Admin-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface MountOptions {
  /** Tests: a specific instance instead of the process one. */
  get?: () => Memorial | null;
}

export function mountMemorialApi(app: Application, opts: MountOptions = {}): void {
  const get = opts.get ?? memorial;
  const newOwnerRate = new KeyedRate(NEW_OWNERS_PER_IP_PER_DAY, DAY);
  const keyAttemptRate = new KeyedRate(KEY_ATTEMPTS_PER_IP_PER_HOUR, HOUR);
  const editRate = new KeyedRate(CLAIM_EDITS_PER_HOUR, HOUR);
  const uploadIpRate = new KeyedRate(PHOTO_UPLOADS_PER_DAY * 2, DAY);
  const adminFailRate = new KeyedRate(ADMIN_FAILS_PER_IP, 10 * 60_000);
  const json = express.json({ limit: "8kb" });
  const raw = express.raw({ type: [...PHOTO_CONTENT_TYPES], limit: PHOTO_UPLOAD_MAX_BYTES });

  const router = express.Router();
  router.use(cors);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  /** Run a handler with the memorial (503 when off). */
  const withM =
    (fn: (m: Memorial, req: Request, res: Response) => unknown) =>
    async (req: Request, res: Response): Promise<void> => {
      const m = get();
      if (!m) return fail(res, "unavailable");
      try {
        await fn(m, req, res);
      } catch (err) {
        if (err instanceof StoreFail) return fail(res, err.code as ApiErrorCode);
        console.error(`[memorial] ${req.method} ${req.route?.path ?? "?"} failed: ${(err as Error).message}`);
        if (!res.headersSent) fail(res, "unavailable");
      }
    };

  /** The asking device's owner, or a 401/403 written. */
  const ownerOrFail = (m: Memorial, req: Request, res: Response) => {
    const kh = deviceKeyHash(req);
    if (!kh) {
      fail(res, "unauthorized");
      return null;
    }
    const o = m.ownerOf(kh);
    if (!o) {
      fail(res, "forbidden");
      return null;
    }
    return { ...o, keyHash: kh };
  };

  router.get(
    "/hall",
    withM((m, req, res) => {
      const o = m.ownerOf(deviceKeyHash(req));
      const body: HallResponse = {
        claims: m.hallClaims(),
        mine: o ? m.store.liveClaimsOf(o.ownerId).map((c) => m.mineView(c)) : [],
        serverNow: m.now(),
      };
      res.json(body);
    }),
  );

  router.get(
    "/me",
    withM((m, req, res) => {
      const kh = deviceKeyHash(req);
      if (!kh) return fail(res, "unauthorized");
      const o = m.ownerOf(kh);
      const body: MeResponse = {
        owner: o
          ? {
              id: o.ownerId,
              devices: m.deviceViews(o.ownerId, o.keyId),
              claims: m.store.liveClaimsOf(o.ownerId).map((c) => m.mineView(c)),
              freeLeft: m.store.claimAllowance(o.ownerId),
            }
          : null,
      };
      res.json(body);
    }),
  );

  router.get(
    "/claims/:slotId",
    withM((m, req, res) => {
      const c = m.store.liveClaimBySlot(String(req.params.slotId));
      if (!c || c.status !== "active") return fail(res, "not_found");
      const o = m.ownerOf(deviceKeyHash(req));
      res.json({ claim: o && o.ownerId === c.owner_id ? m.mineView(c) : m.publicView(c) });
    }),
  );

  router.post(
    "/claims",
    json,
    withM((m, req, res) => {
      const kh = deviceKeyHash(req);
      if (!kh) return fail(res, "unauthorized");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slotId = typeof body.slotId === "string" ? body.slotId : "";
      const f = validateClaimFields(body, m.now());
      if (!f.ok) return res.status(400).json({ error: "bad_request", message: f.message, field: f.field });
      if (!textIsNice(f.value.petName) || !textIsNice(f.value.line)) return fail(res, "not_nice");
      const slot = m.store.slot(slotId);
      if (!slot || slot.sample) return fail(res, "slot_unavailable");
      if (m.store.liveClaimBySlot(slotId)) return fail(res, "slot_taken");
      let owner = m.ownerOf(kh);
      let recoveryCode: string | undefined;
      if (!owner) {
        if (!newOwnerRate.tryAccept(m.ipHash(clientIp(req)), m.now())) return fail(res, "rate_limited");
        const created = m.store.createOwner(kh, cleanText(String(body.deviceLabel ?? "")).slice(0, DEVICE_LABEL_MAX));
        owner = { ownerId: created.ownerId, keyId: created.keyId };
        recoveryCode = created.recoveryCode;
      }
      const row = m.store.createClaim(owner.ownerId, slotId, f.value, kh);
      m.emit(slotId, ["claimed"]);
      const out: ClaimCreateResponse = { claim: m.mineView(row), ...(recoveryCode ? { recoveryCode } : {}) };
      res.status(201).json(out);
    }),
  );

  router.patch(
    "/claims/:id",
    json,
    withM((m, req, res) => {
      const o = ownerOrFail(m, req, res);
      if (!o) return;
      const c = m.store.claimById(String(req.params.id));
      if (!c || c.owner_id !== o.ownerId || (c.status !== "active" && c.status !== "hidden")) return fail(res, "forbidden");
      if (!editRate.tryAccept(o.ownerId, m.now())) return fail(res, "rate_limited");
      const base = {
        petName: c.pet_name,
        species: c.species,
        born: c.born,
        bornPrec: c.born_prec,
        passed: c.passed,
        passedPrec: c.passed_prec,
        line: c.line,
      };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const f = validateClaimFields(body, m.now(), base);
      if (!f.ok) return res.status(400).json({ error: "bad_request", message: f.message, field: f.field });
      if (!textIsNice(f.value.petName) || !textIsNice(f.value.line)) return fail(res, "not_nice");
      const privacy = body.privacy === "public" || body.privacy === "family" ? body.privacy : undefined;
      const row = m.store.updateClaim(c.id, f.value, privacy);
      m.emit(c.slot_id, ["text"]);
      res.json({ claim: m.mineView(row) });
    }),
  );

  router.post(
    "/claims/:id/photos",
    raw,
    withM(async (m, req, res) => {
      const o = ownerOrFail(m, req, res);
      if (!o) return;
      const c = m.store.claimById(String(req.params.id));
      if (!c || c.owner_id !== o.ownerId || c.status !== "active") return fail(res, "forbidden");
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, "bad_image");
      if (m.store.uploadsSince(o.ownerId, m.now() - DAY) >= PHOTO_UPLOADS_PER_DAY) return fail(res, "rate_limited");
      if (!uploadIpRate.tryAccept(m.ipHash(clientIp(req)), m.now())) return fail(res, "rate_limited");
      const p = await processQueued(req.body);
      if (typeof p === "string") return fail(res, p);
      const id = randomId();
      // Check the album and duplicates before writing files (addPhoto re-checks in its transaction).
      const live = m.store.livePhotos(c.id).filter((x) => x.moderation !== "rejected");
      if (live.some((x) => x.sha256 === p.sha256)) return fail(res, "duplicate_photo");
      if (live.length >= m.store.albumLimit(c.id)) return fail(res, "album_full");
      writeVariants(m.config.mediaDir, id, p.variants);
      const row = m.store.addPhoto({ id, claimId: c.id, sha256: p.sha256, w: p.w, h: p.h, bytes: req.body.length, byKeyHash: o.keyHash });
      m.emit(c.slot_id, ["photo_pending"]);
      res.status(201).json({ claim: m.mineView(m.store.claimById(c.id)!), photoId: row.id });
    }),
  );
  // An over-size or wrong-type body: express.raw leaves it unread / throws 413 — answer in our shape.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large" || e?.status === 413) return fail(res, "too_large");
    if (e?.status === 400) return fail(res, "bad_request");
    next(err);
  });

  router.post(
    "/owners/invite",
    withM((m, req, res) => {
      const o = ownerOrFail(m, req, res);
      if (!o) return;
      if (!keyAttemptRate.tryAccept(m.ipHash(clientIp(req)), m.now())) return fail(res, "rate_limited");
      const inv: InviteResponse = m.store.createInvite(o.ownerId);
      res.status(201).json(inv);
    }),
  );

  for (const [route, op] of [
    ["/owners/join", "join"],
    ["/owners/recover", "recover"],
  ] as const) {
    router.post(
      route,
      json,
      withM((m, req, res) => {
        const kh = deviceKeyHash(req);
        if (!kh) return fail(res, "unauthorized");
        if (!keyAttemptRate.tryAccept(m.ipHash(clientIp(req)), m.now())) return fail(res, "rate_limited");
        const body = (req.body ?? {}) as Record<string, unknown>;
        const label = cleanText(String(body.label ?? "")).slice(0, DEVICE_LABEL_MAX);
        const r = op === "join" ? m.store.joinInvite(body.code, kh, label) : m.store.recover(body.code, kh, label);
        const out: JoinOwnerResponse = { ownerId: r.ownerId };
        for (const c of m.store.liveClaimsOf(r.ownerId)) m.emit(c.slot_id, ["family"]);
        res.json(out);
      }),
    );
  }

  router.delete(
    "/owners/devices/:keyId",
    withM((m, req, res) => {
      const o = ownerOrFail(m, req, res);
      if (!o) return;
      if (!m.store.revokeDevice(o.ownerId, String(req.params.keyId))) return fail(res, "not_found");
      res.json({ ok: true });
    }),
  );

  // ─── operator review (CV_ADMIN_KEY_SHA256) ───
  const adminOk = (m: Memorial, req: Request, res: Response): boolean => {
    const want = m.config.adminKeySha256;
    if (!want) {
      fail(res, "not_found");
      return false;
    }
    const ip = m.ipHash(clientIp(req));
    const key = req.headers["x-admin-key"];
    const got = typeof key === "string" && key.length > 0 && key.length < 256 ? sha256Hex(key) : "";
    const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
    if (!ok) {
      if (!adminFailRate.tryAccept(ip, m.now())) fail(res, "rate_limited");
      else fail(res, "unauthorized");
      return false;
    }
    return true;
  };

  router.get(
    "/admin/review",
    withM((m, req, res) => {
      if (!adminOk(m, req, res)) return;
      const items: AdminReviewItem[] = m.store.reviewQueue().map((p) => ({
        photoId: p.id,
        claimId: p.claim_id,
        slotId: p.slot_id,
        petName: p.pet_name,
        createdAt: p.created_at,
        urls: signedUrls(m.config.mediaSecret, p.id, m.now()),
      }));
      res.json({ items });
    }),
  );

  router.post(
    "/admin/photos/:id",
    json,
    withM((m, req, res) => {
      if (!adminOk(m, req, res)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : null;
      if (!decision) return fail(res, "bad_request");
      const reason = typeof body.reason === "string" ? cleanText(body.reason).slice(0, 80) : null;
      const p = m.store.setModeration(String(req.params.id), decision, reason);
      if (!p) return fail(res, "not_found");
      const c = m.store.claimById(p.claim_id);
      if (c) m.emit(c.slot_id, [decision === "approved" ? "photo" : "photo_rejected"]);
      res.json({ ok: true, moderation: p.moderation });
    }),
  );

  app.use(MEMORIAL_API.base, router);

  // ─── photo files ───
  const media = express.Router();
  media.use(cors);
  const sendPhoto = (m: Memorial, res: Response, id: string, size: 1600 | 512 | 128, cache: string) => {
    const file = photoPath(m.config.mediaDir, id, size);
    if (!fs.existsSync(file)) return fail(res, "not_found");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", cache);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(file);
  };
  media.get(
    "/p/:file",
    withM((m, req, res) => {
      const f = parseMediaFile(String(req.params.file));
      if (!f) return fail(res, "not_found");
      const p = m.store.photo(f.id);
      const c = p ? m.store.claimById(p.claim_id) : undefined;
      if (!p || p.deleted_at || p.moderation !== "approved" || p.visibility !== "public" || !c || c.status !== "active" || c.privacy !== "public") {
        return fail(res, "not_found");
      }
      sendPhoto(m, res, f.id, f.size, "public, max-age=3600");
    }),
  );
  media.get(
    "/s/:file",
    withM((m, req, res) => {
      const f = parseMediaFile(String(req.params.file));
      if (!f || !verifySig(m.config.mediaSecret, f.id, f.size, req.query.exp, req.query.sig, m.now())) return fail(res, "forbidden");
      const p = m.store.photo(f.id);
      if (!p || p.deleted_at) return fail(res, "not_found");
      sendPhoto(m, res, f.id, f.size, "private, max-age=600");
    }),
  );
  app.use("/media", media);

  // The review page itself holds no secret: the key is typed in and sent as a header.
  app.get("/admin/memorial", (_req, res) => {
    const m = get();
    if (!m?.config.adminKeySha256) return void res.status(404).end();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    res.type("html").send(ADMIN_PAGE_HTML);
  });
}
