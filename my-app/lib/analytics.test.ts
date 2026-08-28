import { track, setAnalyticsSink, AnalyticsEvent } from './analytics';

describe('analytics', () => {
  test('routes events and props to the registered sink', () => {
    const calls: { event: string; props: Record<string, unknown> }[] = [];
    setAnalyticsSink((event, props) => calls.push({ event, props }));

    track('paywall_viewed', { mode: 'welcome' });
    track('paywall_plan_selected', { plan: 'yearly' });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ event: 'paywall_viewed', props: { mode: 'welcome' } });
    expect(calls[1].event).toBe('paywall_plan_selected');
  });

  test('defaults props to an empty object', () => {
    let received: Record<string, unknown> | null = null;
    setAnalyticsSink((_e, props) => { received = props; });
    track('paywall_dismissed');
    expect(received).toEqual({});
  });

  test('never throws even if the sink throws', () => {
    setAnalyticsSink(() => { throw new Error('provider down'); });
    expect(() => track('paywall_purchase_failed', { reason: 'x' })).not.toThrow();
  });

  test('event union is exercised (compile-time guard)', () => {
    const events: AnalyticsEvent[] = [
      'paywall_viewed',
      'paywall_plan_selected',
      'paywall_purchase_started',
      'paywall_purchase_succeeded',
      'paywall_purchase_cancelled',
      'paywall_purchase_failed',
      'paywall_offerings_error',
      'paywall_offerings_retried',
      'paywall_restore_tapped',
      'paywall_dismissed',
    ];
    expect(events).toHaveLength(10);
  });

  test('the win-back offer keeps its own namespace, not paywall_*', () => {
    // The existing paywall_* events are shared by both presentations and carry
    // a `variant` property instead of being forked, so the funnel above stays
    // whole. These are the offer *lifecycle*, which the standard paywall has no
    // equivalent of.
    const events: AnalyticsEvent[] = [
      'pro_offer_granted',
      'pro_offer_paywall_viewed',
      'pro_offer_paywall_dismissed',
      'pro_offer_purchase_started',
      'pro_offer_purchase_succeeded',
      'pro_offer_purchase_failed',
      'pro_offer_expired',
      'pro_offer_revoked',
      'pro_offer_inbox_shown',
      'pro_offer_inbox_tapped',
      'pro_offer_unavailable',
    ];
    expect(events).toHaveLength(11);
    // The engagement-reactivation campaigns in lib/notifications/copy.ts are
    // already called winback_7d / winback_30d. Colliding on that name would
    // make "winback" mean two unrelated things in the same dashboard.
    for (const e of events) expect(e.startsWith('pro_offer_')).toBe(true);
  });
});
