import { DEVICE_AUTH_SCHEME } from "@caysonverse/shared/memorial/constants";
import { MEMORIAL_API } from "@caysonverse/shared/memorial/messages";
import type {
  ApiError,
  ClaimCreateBody,
  ClaimCreateResponse,
  ClaimMine,
  ClaimPatchBody,
  ClaimPublic,
  HallResponse,
  InviteResponse,
  JoinOwnerResponse,
  MeResponse,
} from "@caysonverse/shared/memorial/types";
import { SERVER_URL } from "../../net/endpoint";
import { readyDeviceKey } from "./deviceKey";

/**
 * The memorial HTTPS API from the browser (server/src/memorial/api.ts). Every call carries `Authorization: Device <key>`.
 * Failures become `MemorialApiError` with the server's gentle Korean line (or a generic one when the network failed).
 */

export class MemorialApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OFFLINE = "연결이 잠시 끊겼어요. 잠시 뒤에 다시 해 주세요";

/** A media path from the API (`/media/...`) as a full URL on the game server. */
export function mediaUrl(path: string | undefined | null): string {
  if (!path) return "";
  return /^https?:/.test(path) ? path : `${SERVER_URL}${path}`;
}

async function call<T>(path: string, init: { method?: string; json?: unknown; body?: Blob; type?: string } = {}): Promise<T> {
  const key = await readyDeviceKey();
  const headers: Record<string, string> = { Authorization: `${DEVICE_AUTH_SCHEME} ${key}` };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.body) {
    headers["Content-Type"] = init.type ?? init.body.type;
    body = init.body;
  }
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, { method: init.method ?? "GET", headers, body });
  } catch {
    throw new MemorialApiError("offline", OFFLINE, 0);
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || data === null) {
    throw new MemorialApiError(data?.error ?? "unavailable", data?.message ?? OFFLINE, res.status);
  }
  return data;
}

export const memorialApi = {
  hall: () => call<HallResponse>(MEMORIAL_API.hall),
  me: () => call<MeResponse>(MEMORIAL_API.me),
  claimBySlot: (slotId: string) => call<{ claim: ClaimPublic | ClaimMine }>(MEMORIAL_API.claimBySlot(slotId)),
  createClaim: (body: ClaimCreateBody) => call<ClaimCreateResponse>(MEMORIAL_API.claims, { method: "POST", json: body }),
  patchClaim: (id: string, body: ClaimPatchBody) => call<{ claim: ClaimMine }>(MEMORIAL_API.claim(id), { method: "PATCH", json: body }),
  uploadPhoto: (claimId: string, jpeg: Blob) => call<{ claim: ClaimMine; photoId: string }>(MEMORIAL_API.photos(claimId), { method: "POST", body: jpeg, type: "image/jpeg" }),
  invite: () => call<InviteResponse>(MEMORIAL_API.invite, { method: "POST" }),
  join: (code: string, label = "") => call<JoinOwnerResponse>(MEMORIAL_API.join, { method: "POST", json: { code, label } }),
  recover: (code: string, label = "") => call<JoinOwnerResponse>(MEMORIAL_API.recover, { method: "POST", json: { code, label } }),
  removeDevice: (keyId: string) => call<{ ok: true }>(MEMORIAL_API.device(keyId), { method: "DELETE" }),
};
