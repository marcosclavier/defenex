/**
 * Wording the customer agrees to when claiming rights in a mark.
 *
 * Every notice we file states that we are authorised to act for the owner.
 * This is the basis for that statement, so the exact text is a constant: it is
 * shown in the form, stored verbatim on the rights record, and is what we would
 * produce if a notice were ever challenged. Snapshotting it on the row matters
 * because this wording will change and an old attestation must still say what
 * the person actually agreed to.
 */
export const RIGHTS_ATTESTATION_TEXT = [
  "I confirm that I am the owner of the registration identified above, or am authorised to act on the owner's behalf.",
  "I authorise Defenex to prepare and submit infringement notices in respect of this mark on my behalf.",
  "I understand that a notice which knowingly misrepresents that material is infringing can create liability under 17 U.S.C. §512(f) and equivalent law, and that the details I have given here form part of the record if a notice is challenged.",
].join(" ");

/** Version tag so a stored attestation can be matched to the wording in force. */
export const RIGHTS_ATTESTATION_VERSION = "2026-08-15";
