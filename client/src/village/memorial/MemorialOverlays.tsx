import { useEffect } from "react";
import { useLocalArea } from "../villageArea";
import { ClaimWizard } from "./ClaimWizard";
import { FamilySheet } from "./FamilySheet";
import { refreshHall } from "./claimsStore";
import { consumeInvite, dismissMemorialNotice, useMemorialNotice } from "./inviteJoin";
import { closeSheet } from "./memorialSheets";
import "./memorial.css";

/**
 * The memorial's HUD layer (one line in VillageScene): the claim / family / recovery sheets, the family-link notice, and the
 * data refresh — the hall's claims are fetched when the hall opens (and again on each visit); sheets close when leaving it.
 */
export function MemorialOverlays() {
  const area = useLocalArea();
  const notice = useMemorialNotice();
  useEffect(() => {
    void consumeInvite();
    void refreshHall(); // the 3D frames need the hall's claims before the first visit too (cheap: one small JSON)
  }, []);
  useEffect(() => {
    if (area === "hall") void refreshHall();
    else closeSheet();
  }, [area]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismissMemorialNotice, 12000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <>
      {area === "hall" ? (
        <>
          <ClaimWizard />
          <FamilySheet />
        </>
      ) : null}
      {notice ? (
        <div className="cv-mem-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={dismissMemorialNotice}>
            닫기
          </button>
        </div>
      ) : null}
    </>
  );
}
