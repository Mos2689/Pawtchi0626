/**
 * Vet-report freshness helper.
 *
 * Per the design call:
 *   - <= 6 months: fresh, no banner.
 *   - 6–12 months: aging, show "report is X months old — please confirm or update".
 *   - > 12 months: stale, require re-confirmation before any condition affects calculations.
 */

export type FreshnessStatus = 'fresh' | 'aging' | 'stale';

export interface FreshnessResult {
  status: FreshnessStatus;
  monthsOld: number;
  /** UI-ready message; null when fresh. */
  message: string | null;
  /** True when the verdict layer should disable clinical adjustments for this pet. */
  requiresReconfirm: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Compute freshness from a report date. Accepts ISO strings or Date.
 * `now` is injectable for deterministic tests.
 */
export function getReportFreshness(
  reportDate: string | Date | null | undefined,
  now: Date = new Date(),
): FreshnessResult {
  if (!reportDate) {
    return {
      status: 'stale',
      monthsOld: Infinity,
      message: 'Report date unknown — please confirm conditions still apply.',
      requiresReconfirm: true,
    };
  }
  const d = typeof reportDate === 'string' ? new Date(reportDate) : reportDate;
  if (Number.isNaN(d.getTime())) {
    return {
      status: 'stale',
      monthsOld: Infinity,
      message: 'Report date unreadable — please confirm conditions still apply.',
      requiresReconfirm: true,
    };
  }

  const days = Math.max(0, (now.getTime() - d.getTime()) / MS_PER_DAY);
  const monthsOld = days / 30.44; // average month length

  if (monthsOld <= 6) {
    return { status: 'fresh', monthsOld, message: null, requiresReconfirm: false };
  }

  if (monthsOld <= 12) {
    const rounded = Math.round(monthsOld);
    return {
      status: 'aging',
      monthsOld,
      message: `This report is about ${rounded} months old — confirm or update if anything has changed.`,
      requiresReconfirm: false,
    };
  }

  const years = (monthsOld / 12).toFixed(1);
  return {
    status: 'stale',
    monthsOld,
    message: `This report is over ${years} years old. Please re-confirm with a recent visit before applying its conditions to nutrition targets.`,
    requiresReconfirm: true,
  };
}
