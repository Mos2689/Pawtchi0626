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
});
