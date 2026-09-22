import {
  OVERDUE_GRACE_MS,
  pickUpNext,
  upNextEyebrow,
  upNextSubtitle,
  type UpNextCandidate,
} from './upNext';
import type { CommunityPack, CommunityWalk } from '../communityWalks';

const NOW = Date.parse('2026-09-20T09:00:00Z');
const MIN = 60_000;

function walk(over: Partial<CommunityWalk> = {}): CommunityWalk {
  return {
    id: 'w1',
    pack_id: 'p1',
    organizer_id: 'owner-1',
    title: 'Sunrise sniff loop',
    scheduled_for: null,
    meeting_label: 'Riverside Park',
    meeting_lat: null,
    meeting_lng: null,
    note: null,
    state: 'planned',
    started_at: null,
    ended_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function pack(id: string, nextWalk: CommunityWalk | null): CommunityPack {
  return {
    id,
    name: `Trail ${id}`,
    owner_id: 'owner-1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    nextWalk,
  };
}

const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('pickUpNext', () => {
  it('is empty with no trails', () => {
    expect(pickUpNext([], NOW)).toEqual({ state: 'empty', candidate: null });
  });

  it('is empty when every trail has no walk', () => {
    expect(pickUpNext([pack('a', null)], NOW).state).toBe('empty');
  });

  it('leads with a live walk over anything planned', () => {
    const result = pickUpNext(
      [
        pack('a', walk({ id: 'planned', scheduled_for: at(10 * MIN) })),
        pack('b', walk({ id: 'running', state: 'active', started_at: at(-12 * MIN) })),
      ],
      NOW,
    );
    expect(result.state).toBe('live');
    expect(result.candidate?.walk.id).toBe('running');
  });

  it('goes loud for a walk starting shortly', () => {
    expect(pickUpNext([pack('a', walk({ scheduled_for: at(22 * MIN) }))], NOW).state)
      .toBe('planned');
  });

  it('stays loud for a walk days away, because a date is a date', () => {
    // The whole point of the feature is an agreed walk on Wednesday. Painting
    // that as a muted outline said the screen had nothing on it.
    expect(pickUpNext([pack('a', walk({ scheduled_for: at(3 * 24 * 60 * MIN) }))], NOW).state)
      .toBe('planned');
  });

  it('goes quiet only when nobody has agreed a day', () => {
    expect(pickUpNext([pack('a', walk({ scheduled_for: null }))], NOW).state)
      .toBe('undated');
  });

  it('picks the soonest of several dated walks', () => {
    const result = pickUpNext(
      [
        pack('a', walk({ id: 'later', scheduled_for: at(5 * 60 * MIN) })),
        pack('b', walk({ id: 'sooner', scheduled_for: at(90 * MIN) })),
      ],
      NOW,
    );
    expect(result.candidate?.walk.id).toBe('sooner');
  });

  it('keeps a late walk leading through its grace period', () => {
    // People are late. A plan that vanishes at its own start time takes the
    // meeting point with it, which is the moment it is most needed.
    const result = pickUpNext(
      [pack('a', walk({ scheduled_for: at(-OVERDUE_GRACE_MS + MIN) }))],
      NOW,
    );
    expect(result.state).toBe('planned');
  });

  it('drops it once the grace period is over', () => {
    expect(pickUpNext([pack('a', walk({ scheduled_for: at(-OVERDUE_GRACE_MS - MIN) }))], NOW).state)
      .toBe('empty');
  });

  it('sorts an undated walk behind a dated one', () => {
    const result = pickUpNext(
      [
        pack('a', walk({ id: 'undated', scheduled_for: null })),
        pack('b', walk({ id: 'dated', scheduled_for: at(48 * 60 * MIN) })),
      ],
      NOW,
    );
    expect(result.candidate?.walk.id).toBe('dated');
  });

  it('still shows an undated walk when it is all there is', () => {
    const result = pickUpNext([pack('a', walk({ scheduled_for: null }))], NOW);
    expect(result.state).toBe('undated');
    expect(result.candidate?.walk.id).toBe('w1');
  });

  it('ignores completed and cancelled walks', () => {
    expect(pickUpNext([pack('a', walk({ state: 'completed' }))], NOW).state).toBe('empty');
    expect(pickUpNext([pack('a', walk({ state: 'cancelled' }))], NOW).state).toBe('empty');
  });
});

describe('upNextEyebrow', () => {
  const live = (startedAt: string | null) => ({
    state: 'live' as const,
    candidate: { pack: pack('a', null), walk: walk({ state: 'active', started_at: startedAt }) } as UpNextCandidate,
  });

  it('counts a live walk up, not down', () => {
    expect(upNextEyebrow(live(at(-12 * MIN)), NOW)).toBe('LIVE — 12 MIN IN');
  });

  it('has a phrase for the first minute', () => {
    expect(upNextEyebrow(live(at(-20_000)), NOW)).toBe('LIVE — JUST STARTED');
  });

  it('survives a live walk with no start time', () => {
    expect(upNextEyebrow(live(null), NOW)).toBe('WALKING NOW');
  });

  it('counts minutes below the hour', () => {
    const up = pickUpNext([pack('a', walk({ scheduled_for: at(22 * MIN) }))], NOW);
    expect(upNextEyebrow(up, NOW)).toBe('STARTS IN 22 MIN');
  });

  it('switches to hours, singular and plural', () => {
    const one = pickUpNext([pack('a', walk({ scheduled_for: at(62 * MIN) }))], NOW);
    expect(upNextEyebrow(one, NOW)).toBe('STARTS IN 1 HOUR');
    const many = pickUpNext([pack('a', walk({ scheduled_for: at(5 * 60 * MIN) }))], NOW);
    expect(upNextEyebrow(many, NOW)).toBe('STARTS IN 5 HOURS');
  });

  it('says the day once it is more than a day out', () => {
    const up = pickUpNext([pack('a', walk({ scheduled_for: at(48 * 60 * MIN) }))], NOW);
    expect(upNextEyebrow(up, NOW)).toMatch(/^NEXT — /);
  });

  it('does not count backwards for a walk past its time', () => {
    const up = pickUpNext([pack('a', walk({ scheduled_for: at(-30 * MIN) }))], NOW);
    expect(upNextEyebrow(up, NOW)).toBe('STARTING NOW');
  });

  it('is honest about an undated walk', () => {
    const up = pickUpNext([pack('a', walk({ scheduled_for: null }))], NOW);
    expect(upNextEyebrow(up, NOW)).toBe('DATE TO BE CONFIRMED');
  });

  it('says nothing is planned when nothing is', () => {
    expect(upNextEyebrow({ state: 'empty', candidate: null }, NOW)).toBe('NOTHING PLANNED');
  });
});

describe('upNextSubtitle', () => {
  it('names the host and the place', () => {
    expect(upNextSubtitle(walk(), 'Mira', false)).toBe('Mira hosts · Riverside Park');
  });

  it('speaks to the host in the second person', () => {
    expect(upNextSubtitle(walk(), 'Mira', true)).toBe('You host · Riverside Park');
  });

  it('drops the separator rather than leaving it dangling', () => {
    // " · Riverside Park" is how a missing name announces itself as a bug.
    expect(upNextSubtitle(walk(), null, false)).toBe('Riverside Park');
    expect(upNextSubtitle(walk({ meeting_label: '' }), 'Mira', false)).toBe('Mira hosts');
    expect(upNextSubtitle(walk({ meeting_label: '   ' }), null, false)).toBe('');
  });
});
