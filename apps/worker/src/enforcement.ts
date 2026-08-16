import { consumeEnforcement, getBrand, updateFindingStatus } from "@defenex/db";

/**
 * Only what this module logs with. Pino's root logger and its children carry
 * different generic parameters, so a structural type accepts both.
 */
export interface JobLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * What it means for an enforcement to have been delivered.
 *
 * Called exactly once per takedown, from whichever path completes the
 * `awaiting_filing → submitted` transition — the submit job for an email
 * channel, an admin for a portal. The transition itself is the guard: it only
 * fires from `awaiting_filing`, so a retried job or a double-clicked button
 * cannot bill twice.
 */
export async function chargeEnforcement(
  takedown: { id: string; brandId: string; findingId: string; requestedByUserId: string | null },
  log: JobLogger,
): Promise<void> {
  // The finding is now the subject of a filed notice, which is a different
  // thing from an open finding nobody has acted on.
  await updateFindingStatus(takedown.findingId, "actioned").catch((err: unknown) =>
    log.warn({ takedownId: takedown.id, err: String(err) }, "could not mark finding actioned"),
  );

  if (!takedown.requestedByUserId) {
    // An internally-raised takedown with no requester has nobody to bill.
    log.info({ takedownId: takedown.id }, "no requester; enforcement not charged");
    return;
  }

  await consumeEnforcement(takedown.requestedByUserId);
  const brand = await getBrand(takedown.brandId);
  log.info(
    { takedownId: takedown.id, userId: takedown.requestedByUserId, brand: brand?.domain },
    "enforcement charged",
  );
}

/** Channels we send ourselves. Everything else needs a human at a portal. */
export function isEmailChannel(channel: string): boolean {
  return channel === "host_abuse" || channel === "registrar_abuse";
}
