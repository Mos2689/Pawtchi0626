import { connectView, type ConnectStatus } from './connectStatus';

const STATUSES: ConnectStatus[] = ['unknown', 'loading', 'ready', 'error'];

describe('connectView', () => {
  it('never shows the empty card or the empty CTA unless the server confirmed none', () => {
    for (const status of STATUSES) {
      const view = connectView(status, false);
      const saysEmpty = view.lead === 'upNext' || view.showEmptyCta;
      expect([status, saysEmpty]).toEqual([status, status === 'ready']);
    }
  });

  it('shows a skeleton — not "NOTHING PLANNED" — while the first answer is pending (the cold-start bug)', () => {
    expect(connectView('unknown', false).lead).toBe('skeleton');
    expect(connectView('loading', false).lead).toBe('skeleton');
  });

  it('shows an honest error, not an empty state, when the first answer failed', () => {
    expect(connectView('error', false)).toEqual({
      lead: 'error', showEmptyCta: false, showUpdating: false, showRefreshFailed: false,
    });
  });

  it('paints an earlier answer at once and says it is being checked', () => {
    expect(connectView('unknown', true)).toMatchObject({ lead: 'upNext', showUpdating: true });
    expect(connectView('loading', true)).toMatchObject({ lead: 'upNext', showUpdating: true });
  });

  it('drops the note once the server has answered', () => {
    expect(connectView('ready', true)).toEqual({
      lead: 'upNext', showEmptyCta: false, showUpdating: false, showRefreshFailed: false,
    });
  });

  it('keeps the earlier answer when the refresh fails, and says so', () => {
    expect(connectView('error', true)).toMatchObject({ lead: 'upNext', showRefreshFailed: true, showEmptyCta: false });
  });
});
