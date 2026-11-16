import { useEffect, useMemo, useRef, useState } from "react";
import { CLAIM_LINE_MAX, PET_NAME_MAX, SPECIES, SPECIES_LABEL, type Species } from "@caysonverse/shared/memorial/constants";
import { groupCode } from "@caysonverse/shared/memorial/codes";
import { kstDate } from "@caysonverse/shared/memorial/kst";
import type { ClaimMine, DatePrecision } from "@caysonverse/shared/memorial/types";
import { validateClaimFields } from "@caysonverse/shared/memorial/validate";
import { popOverlay, pushOverlay } from "../../ui/overlayStack";
import { slotLabel } from "./slotLabel";
import { claimFor, isMine, noteMyClaim, refreshHall, useClaims } from "./claimsStore";
import { memorialApi, MemorialApiError } from "./memorialApi";
import { MEM_COPY, closeSheet, useSheet } from "./memorialSheets";
import { prepareUpload } from "./imageResize";
import "./memorial.css";

export const CLAIM_OVERLAY_ID = "memorial-sheet";

type Step = "info" | "photo" | "check" | "saving" | "recovery";

interface Form {
  petName: string;
  species: Species;
  born: string;
  bornKnown: boolean;
  passed: string;
  passedKnown: boolean;
  line: string;
}

/** The latest date a form may carry: today on the KST calendar (the server checks the same). */
const today = () => kstDate(Date.now());

function formFrom(c: ClaimMine | undefined): Form {
  return {
    petName: c?.petName ?? "",
    species: c?.species ?? "dog",
    born: c?.bornPrec === "day" && c.born ? c.born : "",
    bornKnown: c?.bornPrec === "day",
    passed: c?.passedPrec === "day" && c.passed ? c.passed : "",
    passedKnown: c?.passedPrec === "day",
    line: c?.line ?? "",
  };
}

function body(f: Form) {
  const prec = (known: boolean, d: string): DatePrecision => (known && d ? "day" : "unknown");
  return {
    petName: f.petName,
    species: f.species,
    born: f.bornKnown && f.born ? f.born : null,
    bornPrec: prec(f.bornKnown, f.born),
    passed: f.passedKnown && f.passed ? f.passed : null,
    passedPrec: prec(f.passedKnown, f.passed),
    line: f.line,
  };
}

/**
 * The claim form (모시기) and its edit (고치기), memorial design §2 step 9: ① name, kind, dates (optional), one line →
 * ② photo (optional; shrunk on the device) → ③ check → the recovery code once (first claim of this device). Phone: full-screen
 * steps; PC: a centred window. Esc / 닫기 closes without saving.
 */
export function ClaimWizard() {
  const sheet = useSheet();
  const open = sheet !== null && (sheet.kind === "claim" || sheet.kind === "edit");
  const slotId = open ? sheet.slotId : null;
  const editing = open && sheet.kind === "edit";
  const claims = useClaims();
  const existing = useMemo(() => {
    const c = claimFor(slotId, claims);
    return isMine(c) ? c : undefined;
  }, [slotId, claims]);

  const [step, setStep] = useState<Step>("info");
  const [form, setForm] = useState<Form>(() => formFrom(undefined));
  const [error, setError] = useState<string>("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [photoNote, setPhotoNote] = useState<string>("");
  const [recovery, setRecovery] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("info");
    setForm(formFrom(editing ? existing : undefined));
    setError("");
    setPhoto(null);
    setPhotoUrl("");
    setPhotoNote("");
    setRecovery("");
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slotId, editing]);
  useEffect(() => {
    if (!open) return;
    pushOverlay(CLAIM_OVERLAY_ID, closeSheet);
    return () => popOverlay(CLAIM_OVERLAY_ID);
  }, [open]);
  useEffect(() => () => (photoUrl ? URL.revokeObjectURL(photoUrl) : undefined), [photoUrl]);

  if (!open || !slotId) return null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(""); // a correction clears the old hint at once
  };
  const nameLen = [...form.petName.trim()].length;
  const lineLen = [...form.line].length;

  const checkInfo = (): boolean => {
    const r = validateClaimFields(body(form), Date.now());
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setError("");
    return true;
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setPhotoNote(MEM_COPY.photoBusy);
    const out = await prepareUpload(file);
    if (out === "too_big") return setPhotoNote(MEM_COPY.photoTooBig);
    if (out === "not_image") return setPhotoNote(MEM_COPY.photoNotImage);
    setPhoto(out);
    setPhotoUrl(URL.createObjectURL(out));
    setPhotoNote("");
  };

  const submit = async () => {
    setStep("saving");
    setError("");
    try {
      let claim: ClaimMine;
      let code = "";
      if (editing && existing) {
        claim = (await memorialApi.patchClaim(existing.claimId, body(form))).claim;
      } else {
        const r = await memorialApi.createClaim({ slotId, ...body(form) });
        claim = r.claim;
        code = r.recoveryCode ?? "";
      }
      noteMyClaim(claim);
      if (photo) {
        try {
          claim = (await memorialApi.uploadPhoto(claim.claimId, photo)).claim;
          noteMyClaim(claim);
        } catch (err) {
          setPhotoNote(err instanceof MemorialApiError ? err.message : MEM_COPY.photoNotImage);
        }
      }
      void refreshHall();
      if (code) {
        setRecovery(code);
        setStep("recovery");
      } else closeSheet();
    } catch (err) {
      setError(err instanceof MemorialApiError ? err.message : MEM_COPY.photoNotImage);
      setStep(editing ? "info" : "check");
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(groupCode(recovery));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const steps: Step[] = editing ? ["info"] : ["info", "photo", "check"];
  const stepIndex = steps.indexOf(step);

  return (
    <div className="cv-mem-sheet" role="dialog" aria-modal="true" aria-label={editing ? MEM_COPY.editTitle : MEM_COPY.claimTitle} data-step={step}>
      <div className="cv-mem-panel">
        <div className="cv-mem-head">
          <div className="cv-mem-title">{step === "recovery" ? MEM_COPY.recoveryTitle : editing ? MEM_COPY.editTitle : MEM_COPY.claimTitle}</div>
          <div className="cv-mem-where">{slotLabel(slotId)}</div>
          {stepIndex >= 0 && steps.length > 1 ? (
            <ol className="cv-mem-steps" aria-label="단계">
              {steps.map((s, i) => (
                <li key={s} className={i === stepIndex ? "is-on" : i < stepIndex ? "is-done" : ""}>
                  {i + 1}. {s === "info" ? MEM_COPY.stepInfo : s === "photo" ? MEM_COPY.stepPhoto : MEM_COPY.stepCheck}
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        {step === "info" ? (
          <div className="cv-mem-body">
            <label className="cv-mem-field">
              <span>
                {MEM_COPY.name} <em>{nameLen}/{PET_NAME_MAX}</em>
              </span>
              <input
                name="petName"
                value={form.petName}
                maxLength={PET_NAME_MAX}
                placeholder={MEM_COPY.namePh}
                autoComplete="off"
                onChange={(e) => set("petName", e.target.value)}
              />
            </label>
            <div className="cv-mem-field">
              <span>{MEM_COPY.species}</span>
              <div className="cv-mem-chips" role="radiogroup" aria-label={MEM_COPY.species}>
                {SPECIES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={form.species === s} className={form.species === s ? "is-on" : ""} onClick={() => set("species", s)}>
                    {SPECIES_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            {(["born", "passed"] as const).map((k) => {
              const known = k === "born" ? form.bornKnown : form.passedKnown;
              return (
                <div className="cv-mem-field" key={k}>
                  <span>{k === "born" ? MEM_COPY.born : MEM_COPY.passed}</span>
                  <div className="cv-mem-date">
                    <input
                      type="date"
                      name={k}
                      min="1980-01-01"
                      max={today()}
                      value={form[k]}
                      disabled={!known}
                      onChange={(e) => set(k, e.target.value)}
                    />
                    <label className="cv-mem-check">
                      <input type="checkbox" checked={!known} onChange={(e) => set(k === "born" ? "bornKnown" : "passedKnown", !e.target.checked)} />
                      {MEM_COPY.dateUnknown}
                    </label>
                  </div>
                </div>
              );
            })}
            <label className="cv-mem-field">
              <span>
                {MEM_COPY.line} <em>{lineLen}/{CLAIM_LINE_MAX}</em>
              </span>
              <input name="line" value={form.line} maxLength={CLAIM_LINE_MAX} placeholder={MEM_COPY.linePh} autoComplete="off" onChange={(e) => set("line", e.target.value)} />
            </label>
          </div>
        ) : null}

        {step === "photo" ? (
          <div className="cv-mem-body cv-mem-photo-step">
            <div className={`cv-mem-preview${photoUrl ? "" : " is-empty"}`} style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined} aria-hidden="true" />
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            <button type="button" className="cv-mem-secondary" onClick={() => fileRef.current?.click()}>
              {photoUrl ? MEM_COPY.changePhoto : MEM_COPY.pickPhoto}
            </button>
            <p className="cv-mem-note">{photoNote || (photoUrl ? MEM_COPY.photoReview : MEM_COPY.photoLater)}</p>
          </div>
        ) : null}

        {step === "check" || step === "saving" ? (
          <div className="cv-mem-body cv-mem-check-step">
            <div className="cv-mem-summary">
              <div className={`cv-mem-preview is-small${photoUrl ? "" : " is-empty"}`} style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined} aria-hidden="true" />
              <div>
                <div className="cv-mem-sum-name">{form.petName.trim()}</div>
                <div className="cv-mem-sum-sub">
                  {SPECIES_LABEL[form.species]}
                  {form.bornKnown && form.born ? ` · ${form.born.slice(0, 4)}` : ""}
                  {form.passedKnown && form.passed ? ` – ${form.passed.slice(0, 4)}` : ""}
                </div>
                {form.line.trim() ? <div className="cv-mem-sum-line">{form.line.trim()}</div> : null}
              </div>
            </div>
            <ul className="cv-mem-notes">
              <li>{MEM_COPY.free}</li>
              <li>{MEM_COPY.deviceNote}</li>
              <li>{MEM_COPY.privacy}</li>
              {photoUrl ? <li>{MEM_COPY.photoReview}</li> : null}
            </ul>
          </div>
        ) : null}

        {step === "recovery" ? (
          <div className="cv-mem-body">
            <p className="cv-mem-note is-strong">{MEM_COPY.recoveryBody}</p>
            <div className="cv-mem-code" data-testid="recovery-code">
              {groupCode(recovery)}
            </div>
            <button type="button" className="cv-mem-secondary" onClick={() => void copyCode()}>
              {copied ? MEM_COPY.copied : MEM_COPY.copy}
            </button>
            {photoNote ? <p className="cv-mem-note">{photoNote}</p> : null}
          </div>
        ) : null}

        {error ? (
          <p className="cv-mem-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="cv-mem-actions">
          {step === "recovery" ? (
            <button type="button" className="cv-mem-primary" onClick={closeSheet}>
              {MEM_COPY.wroteIt}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="cv-mem-ghost"
                disabled={step === "saving"}
                onClick={() => (stepIndex <= 0 ? closeSheet() : setStep(steps[stepIndex - 1]!))}
              >
                {stepIndex <= 0 ? MEM_COPY.cancel : MEM_COPY.back}
              </button>
              <button
                type="button"
                className="cv-mem-primary"
                disabled={step === "saving" || (step === "photo" && photoNote === MEM_COPY.photoBusy)}
                onClick={() => {
                  if (step === "info") {
                    if (!checkInfo()) return;
                    if (editing) void submit();
                    else setStep("photo");
                  } else if (step === "photo") setStep("check");
                  else if (step === "check") void submit();
                }}
              >
                {step === "saving" ? MEM_COPY.saving : step === "check" ? MEM_COPY.confirm : editing ? MEM_COPY.save : MEM_COPY.next}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
