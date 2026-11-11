import type {
  FishingRejectedPayload,
  FishingResultPayload,
  FishingStatePayload,
} from "@caysonverse/shared/village/messages";
import type { FishCatch, FishKind, FishingPhase } from "@caysonverse/shared/village/fishing";

/** The UI starts at the server's empty session state and never predicts a cast or catch. */
export const EMPTY_FISHING_STATE: FishingStatePayload = {
  phase: "no_rod",
  rodRented: false,
  castId: 0,
  lastResult: "none",
  catch: null,
  serverNowMs: 0,
};

const PHASES: readonly FishingPhase[] = ["no_rod", "ready", "waiting", "submerged"];
const RESULTS: readonly FishingStatePayload["lastResult"][] = ["none", "cast", "bite", "missed", "caught"];
const SPECIES: readonly FishCatch["kind"][] = ["minnow", "crucian_carp", "bass", "koi", "giant_catfish"];

function isCatch(value: unknown): value is FishCatch {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FishCatch>;
  return (
    typeof item.kind === "string" && SPECIES.includes(item.kind as FishKind) &&
    typeof item.label === "string" && item.label.length > 0 && item.label.length <= 20 &&
    typeof item.lengthCm === "number" && Number.isFinite(item.lengthCm) && item.lengthCm > 0 && item.lengthCm <= 300 &&
    typeof item.caughtAt === "number" && Number.isFinite(item.caughtAt)
  );
}

/** Drop malformed network payloads before they reach React state or become a misleading result card. */
export function parseFishingState(value: unknown): FishingStatePayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<FishingStatePayload>;
  if (!PHASES.includes(input.phase as FishingPhase)) return null;
  if (typeof input.rodRented !== "boolean") return null;
  if (typeof input.castId !== "number" || !Number.isInteger(input.castId) || input.castId < 0) return null;
  if (!RESULTS.includes(input.lastResult as FishingStatePayload["lastResult"])) return null;
  if (input.catch !== null && !isCatch(input.catch)) return null;
  if (typeof input.serverNowMs !== "number" || !Number.isFinite(input.serverNowMs)) return null;
  return {
    phase: input.phase as FishingPhase,
    rodRented: input.rodRented,
    castId: input.castId,
    lastResult: input.lastResult as FishingStatePayload["lastResult"],
    catch: input.catch as FishCatch | null,
    serverNowMs: input.serverNowMs,
  };
}

export function parseFishingResult(value: unknown): FishingResultPayload | null {
  const state = parseFishingState(value);
  if (!state || !value || typeof value !== "object") return null;
  const event = (value as { event?: unknown }).event;
  if (event !== "cast" && event !== "bite" && event !== "missed" && event !== "caught") return null;
  return { ...state, event };
}

export function fishingRejectLabel(value: unknown): string {
  const reason = value && typeof value === "object" ? (value as Partial<FishingRejectedPayload>).reason : undefined;
  switch (reason) {
    case "not_near_rental": return "낚싯대 대여점 가까이에서 눌러 주세요.";
    case "already_has_rod": return "이미 낚싯대를 빌렸어요.";
    case "not_near_pond": return "연못 가장자리에서 낚싯대를 던져 주세요.";
    case "rod_required": return "먼저 대여점에서 낚싯대를 빌려 주세요.";
    case "already_cast": return "찌가 움직일 때까지 기다려 주세요.";
    case "no_bite": return "아직 물고기가 물지 않았어요.";
    case "bite_expired": return "찌가 다시 올라와 헛탕쳤어요. 다음에는 잠길 때 당겨 보세요.";
    case "too_soon": return "잠시 후 다시 시도해 주세요.";
    default: return "낚시 요청을 처리하지 못했어요.";
  }
}

export function fishingPhaseLabel(phase: FishingPhase): string {
  switch (phase) {
    case "no_rod": return "낚싯대가 필요해요";
    case "ready": return "던질 준비가 됐어요";
    case "waiting": return "찌를 지켜보세요";
    case "submerged": return "찌가 잠겼어요! 지금 당겨요";
  }
}

export function fishingResultLabel(state: FishingStatePayload): string | null {
  if (state.lastResult === "missed") return "찌가 다시 올라와서 헛탕쳤어요.";
  if (state.lastResult === "caught" && state.catch) return `${state.catch.label} ${state.catch.lengthCm}cm를 낚았어요!`;
  return null;
}
