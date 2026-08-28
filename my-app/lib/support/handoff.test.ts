/**
 * The support handoff — the contract behind "Contact support".
 *
 * These tests exist because that button was dead everywhere except one
 * component for the whole of Support v1: the copy catalog offered it, each
 * screen mapped the action onto its own handler, and every handler only knew
 * 'retry'. The invariant at the bottom is the one that matters — every action
 * the catalog can produce must be one that something actually implements.
 */

jest.mock('../analytics', () => ({ track: jest.fn() }));

import {
  ALL_ERROR_CONTEXTS,
  ALL_ERROR_KINDS,
  appError,
  errorCopy,
  type ErrorContext,
  type RecoveryActionId,
} from '../appError';
import { areaFromContext } from './copy';
import {
  FLOW_INDEPENDENT_RECOVERY,
  SUPPORT_COMPOSER_ROUTE,
  isFlowIndependent,
  supportRouteForFailure,
} from './handoff';

describe('supportRouteForFailure', () => {
  it('opens the composer as a bug report from the failure surface', () => {
    const route = supportRouteForFailure();
    expect(route.pathname).toBe(SUPPORT_COMPOSER_ROUTE);
    expect(route.params).toEqual({ topic: 'bug', source: 'error_state' });
  });

  it('carries the failure through so the owner needn’t describe it', () => {
    const route = supportRouteForFailure({
      kind: 'ai_unreadable',
      context: 'food_scan',
      screen: '/(tabs)/meal',
    });
    expect(route.params).toEqual({
      topic: 'bug',
      source: 'error_state',
      errorKind: 'ai_unreadable',
      errorContext: 'food_scan',
      screen: '/(tabs)/meal',
    });
  });

  it('drops empty values instead of sending them as strings', () => {
    // expo-router serialises params into the URL, where a literal "null" is a
    // value the composer would try to prefill from.
    const route = supportRouteForFailure({ kind: null, context: null, screen: '' });
    expect(route.params).toEqual({ topic: 'bug', source: 'error_state' });
  });

  it('accepts a different entry source for non-failure doors', () => {
    expect(supportRouteForFailure(null, 'paywall').params.source).toBe('paywall');
  });

  it('every context it can carry maps to a real area chip', () => {
    for (const context of ALL_ERROR_CONTEXTS as ErrorContext[]) {
      const route = supportRouteForFailure({ context });
      expect(route.params.errorContext).toBe(context);
      expect(areaFromContext(context)).not.toBeNull();
    }
  });
});

describe('recovery actions — nothing the catalog offers may go nowhere', () => {
  // What a screen's own handleRecovery is expected to implement. Everything
  // else is handled by the presenters (ErrorState / FailureModal).
  const FLOW_OWNED: RecoveryActionId[] = ['retry', 'pick_again', 'dismiss'];

  it('every action in the copy catalog is either flow-owned or handled centrally', () => {
    const contexts: (ErrorContext | undefined)[] = [undefined, ...ALL_ERROR_CONTEXTS];
    for (const context of contexts) {
      for (const kind of ALL_ERROR_KINDS) {
        for (const { action } of errorCopy(appError(kind, 'tech'), { context }).actions) {
          expect(FLOW_OWNED.includes(action) || isFlowIndependent(action)).toBe(true);
        }
      }
    }
  });

  it('the generic failure still offers the support door', () => {
    const actions = errorCopy(appError('unknown', 'tech')).actions.map((a) => a.action);
    expect(actions).toContain('contact_support');
    expect(isFlowIndependent('contact_support')).toBe(true);
  });

  it('flow-independent actions are exactly the ones no screen implements', () => {
    expect([...FLOW_INDEPENDENT_RECOVERY].sort())
      .toEqual(['contact_support', 'go_back', 'open_settings']);
  });
});
