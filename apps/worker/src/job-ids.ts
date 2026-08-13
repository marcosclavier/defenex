/**
 * Deterministic BullMQ job ids. Kept free of any env dependency so they stay
 * testable — importing the queue module boots the whole environment.
 *
 * The separator is a hyphen, not a colon: BullMQ uses ":" to namespace its own
 * Redis keys and rejects custom ids containing one ("Custom Id cannot contain :").
 * A double form submission must map to the same id, or the same scan gets
 * enqueued twice and the search API is billed twice.
 */
export function scanJobId(scanId: string): string {
  return `scan-${scanId}`;
}

export function reportJobId(scanId: string): string {
  return `report-${scanId}`;
}
