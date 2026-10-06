/**
 * clearFinishedWalk: a meetup walk's wrap-up puts the recorder back at rest,
 * but never touches a walk started since.
 */
jest.mock('../analytics', () => ({ track: jest.fn(), posthog: null }));
jest.mock('../firebaseAnalytics', () => ({ trackFirebaseEvent: jest.fn() }));
jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('./walkTracker', () => ({}));
jest.mock('./walkSync', () => ({}));
jest.mock('./geoLabels', () => ({}));

import { useWalkStore } from '../../store/useWalkStore';

const finished = (id: string) => ({ walkSessionId: id }) as never;

beforeEach(() => {
  useWalkStore.setState({ phase: 'idle', lastResult: null, session: null, lastObservation: null, marker: null });
});

describe('clearFinishedWalk', () => {
  it('clears the finished meetup walk that is still sitting in summary', () => {
    useWalkStore.setState({
      phase: 'summary',
      lastResult: finished('walk-a'),
      session: { path: [] } as never,
      lastObservation: { at: 1, accuracy: 5 },
    });
    useWalkStore.getState().clearFinishedWalk('walk-a');
    const state = useWalkStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.lastResult).toBeNull();
    expect(state.session).toBeNull();
    expect(state.lastObservation).toBeNull();
  });

  it('never touches a walk started since', () => {
    useWalkStore.setState({ phase: 'starting', lastResult: null, session: { path: [] } as never });
    useWalkStore.getState().clearFinishedWalk('walk-a');
    expect(useWalkStore.getState().phase).toBe('starting');
    expect(useWalkStore.getState().session).not.toBeNull();
  });

  it('ignores a different walk’s result', () => {
    useWalkStore.setState({ phase: 'summary', lastResult: finished('walk-b') });
    useWalkStore.getState().clearFinishedWalk('walk-a');
    expect(useWalkStore.getState().phase).toBe('summary');
  });
});
