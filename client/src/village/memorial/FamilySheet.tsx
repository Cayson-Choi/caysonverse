import { useEffect, useState } from "react";
import { INVITE_QUERY_KEY } from "@caysonverse/shared/memorial/messages";
import { popOverlay, pushOverlay } from "../../ui/overlayStack";
import { claimsSnapshot, refreshHall, useClaims } from "./claimsStore";
import { memorialApi, MemorialApiError } from "./memorialApi";
import { MEM_COPY, closeSheet, useSheet } from "./memorialSheets";
import { CLAIM_OVERLAY_ID } from "./ClaimWizard";
import "./memorial.css";

/** The family invite link: `<this site>/?f=<code>` (a query works on any static host without a rewrite). */
export function inviteLink(code: string, origin = window.location.origin): string {
  return `${origin}/?${INVITE_QUERY_KEY}=${code}`;
}

/**
 * Family devices (memorial-2 §2 F6 "가족 초대 링크", test matrix #29): make a one-time 24-hour link for another device, see the
 * connected devices and remove one. And the recovery sheet: type the 12-character code to bring this device back to its family.
 */
export function FamilySheet() {
  const sheet = useSheet();
  const open = sheet?.kind === "family" || sheet?.kind === "recover";
  const claims = useClaims();
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return;
    setLink("");
    setNote("");
    setCode("");
    pushOverlay(CLAIM_OVERLAY_ID, closeSheet);
    if (sheet?.kind === "family") void refreshHall();
    return () => popOverlay(CLAIM_OVERLAY_ID);
  }, [open, sheet?.kind]);

  if (!open || !sheet) return null;

  const makeLink = async () => {
    setBusy(true);
    try {
      const r = await memorialApi.invite();
      setLink(inviteLink(r.code));
      setNote("");
    } catch (err) {
      setNote(err instanceof MemorialApiError ? err.message : "");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote(MEM_COPY.copied);
    } catch {
      setNote(link);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "케이슨 마을 추모관", text: MEM_COPY.familyTitle, url: link });
    } catch {
      /* cancelled */
    }
  };
  const remove = async (id: string) => {
    try {
      await memorialApi.removeDevice(id);
      await refreshHall();
    } catch (err) {
      setNote(err instanceof MemorialApiError ? err.message : "");
    }
  };
  const recover = async () => {
    setBusy(true);
    try {
      await memorialApi.recover(code);
      await refreshHall();
      setNote(MEM_COPY.joined);
      setTimeout(closeSheet, 1200);
    } catch (err) {
      setNote(err instanceof MemorialApiError ? err.message : MEM_COPY.joinFailed);
    } finally {
      setBusy(false);
    }
  };

  if (sheet.kind === "recover") {
    return (
      <div className="cv-mem-sheet" role="dialog" aria-modal="true" aria-label={MEM_COPY.recoverTitle}>
        <div className="cv-mem-panel is-compact">
          <div className="cv-mem-head">
            <div className="cv-mem-title">{MEM_COPY.recoverTitle}</div>
          </div>
          <div className="cv-mem-body">
            <p className="cv-mem-note">{MEM_COPY.recoverBody}</p>
            <input className="cv-mem-codeinput" value={code} maxLength={16} placeholder={MEM_COPY.recoverPh} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
            {note ? <p className="cv-mem-note is-strong">{note}</p> : null}
          </div>
          <div className="cv-mem-actions">
            <button type="button" className="cv-mem-ghost" onClick={closeSheet}>
              {MEM_COPY.cancel}
            </button>
            <button type="button" className="cv-mem-primary" disabled={busy || code.replace(/[\s-]/g, "").length !== 12} onClick={() => void recover()}>
              {MEM_COPY.connect}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const devices = claims.devices.length > 0 ? claims.devices : claimsSnapshot().devices;
  return (
    <div className="cv-mem-sheet" role="dialog" aria-modal="true" aria-label={MEM_COPY.familyTitle}>
      <div className="cv-mem-panel is-compact">
        <div className="cv-mem-head">
          <div className="cv-mem-title">{MEM_COPY.familyTitle}</div>
        </div>
        <div className="cv-mem-body">
          <p className="cv-mem-note is-strong">{MEM_COPY.familyBody}</p>
          {link ? (
            <>
              <div className="cv-mem-link" data-testid="invite-link">
                {link}
              </div>
              <div className="cv-mem-row">
                <button type="button" className="cv-mem-secondary" onClick={() => void copy()}>
                  {MEM_COPY.copy}
                </button>
                {typeof navigator.share === "function" ? (
                  <button type="button" className="cv-mem-secondary" onClick={() => void share()}>
                    {MEM_COPY.share}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <button type="button" className="cv-mem-secondary" disabled={busy} onClick={() => void makeLink()}>
              {MEM_COPY.makeLink}
            </button>
          )}
          {note ? <p className="cv-mem-note">{note}</p> : null}
          <div className="cv-mem-devices">
            <div className="cv-mem-sub">{MEM_COPY.devices}</div>
            {devices.map((d, i) => (
              <div className="cv-mem-device" key={d.id}>
                <span>{d.current ? MEM_COPY.thisDevice : d.label || `기기 ${i + 1}`}</span>
                {d.current ? null : (
                  <button type="button" className="cv-mem-ghost is-small" onClick={() => void remove(d.id)}>
                    {MEM_COPY.removeDevice}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="cv-mem-actions">
          <button type="button" className="cv-mem-primary" onClick={closeSheet}>
            {MEM_COPY.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
