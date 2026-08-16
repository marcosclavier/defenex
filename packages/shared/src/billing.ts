/**
 * Enforcement allowance arithmetic.
 *
 * Kept pure and outside the database layer so the boundary can be tested
 * directly. Getting it wrong in either direction is expensive: one way the
 * customer is billed for something they were promised, the other way we file
 * notices nobody paid for.
 */
/**
 * Price of an enforcement beyond the plan allowance, in USD. Subscribers on a
 * plan that includes enforcements pay the discounted rate; everyone else pays
 * the standalone price.
 *
 * Mirrored from the pricing page rather than read from Stripe: this figure is
 * quoted when a request is refused, and that must not depend on a network call.
 */
export const ENFORCEMENT_OVERAGE_USD: Record<string, number> = {
  free: 195,
  monitor: 195,
  protect: 85,
  managed: 85,
};

export function overagePriceFor(plan: string | null | undefined): number {
  return ENFORCEMENT_OVERAGE_USD[plan ?? "free"] ?? 195;
}

export interface AllowanceInput {
  plan?: string | null;
  enforcementsUsed?: number | null;
  enforcementsIncluded?: number | null;
}

export interface AllowanceState {
  used: number;
  included: number;
  remaining: number;
  exhausted: boolean;
  overageUsd: number;
}

/**
 * A missing customer is treated as the free plan with no allowance, not as
 * unlimited. Absence of a billing record must never grant entitlement.
 */
export function enforcementAllowance(customer: AllowanceInput | null | undefined): AllowanceState {
  const used = Math.max(0, customer?.enforcementsUsed ?? 0);
  const included = Math.max(0, customer?.enforcementsIncluded ?? 0);
  return {
    used,
    included,
    remaining: Math.max(0, included - used),
    exhausted: used >= included,
    overageUsd: overagePriceFor(customer?.plan),
  };
}
