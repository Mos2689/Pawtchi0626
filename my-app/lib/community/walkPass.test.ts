import { distanceFromYou, passEyebrow, passTime, pickNextOpenWalk, rosterBadge } from './walkPass';

describe('passEyebrow', () => {
  it('speaks to the guest who has not answered', () => {
    expect(passEyebrow({ state: 'planned', isHost: false, myStatus: 'invited' }).text).toBe('YOU ARE INVITED');
    expect(passEyebrow({ state: 'planned', isHost: false, myStatus: null }).text).toBe('YOU ARE INVITED');
  });
  it('reflects an answer, the host, and a running walk', () => {
    expect(passEyebrow({ state: 'planned', isHost: false, myStatus: 'coming' }).text).toBe('YOU’RE GOING');
    expect(passEyebrow({ state: 'planned', isHost: true, myStatus: 'coming' }).text).toBe('YOU’RE HOSTING');
    expect(passEyebrow({ state: 'active', isHost: false, myStatus: 'invited' })).toEqual({ text: 'WALKING NOW', live: true });
  });
  it('says nothing before the walk has loaded', () => {
    expect(passEyebrow({ state: null, isHost: false, myStatus: null }).text).toBe('');
  });
});

describe('passTime', () => {
  const at = (time: string, date = 'Wednesday, 7 October') => ({ time: () => time, date: () => date });
  it('splits a 12-hour time into number and period', () => {
    expect(passTime('2026-10-07T01:30:00Z', at('07:00 AM'))).toEqual({ time: '07:00', period: 'AM', date: 'WEDNESDAY 7 OCTOBER' });
  });
  it('handles the narrow no-break space and lower-case periods', () => {
    expect(passTime('2026-10-07T01:30:00Z', at('07:00 am')).period).toBe('AM');
    expect(passTime('2026-10-07T01:30:00Z', at('7:00 p.m.')).period).toBe('P.M.');
  });
  it('leaves a 24-hour time alone', () => {
    expect(passTime('2026-10-07T01:30:00Z', at('19:00'))).toMatchObject({ time: '19:00', period: '' });
  });
  it('is honest about a walk with no date', () => {
    expect(passTime(null, at('x'))).toEqual({ time: 'TBC', period: '', date: 'DATE TO BE CONFIRMED' });
  });
});

describe('rosterBadge', () => {
  const base = { isOrganizer: false, isMe: false, walkState: 'planned' as const };
  it('marks the host and my own undecided seat', () => {
    expect(rosterBadge({ ...base, status: 'coming', isOrganizer: true }).label).toBe('HOST');
    expect(rosterBadge({ ...base, status: 'invited', isMe: true })).toEqual({ ring: 'decide', label: 'DECIDE' });
  });
  it('labels everyone else by their answer', () => {
    expect(rosterBadge({ ...base, status: 'invited' }).label).toBe('ASKED');
    expect(rosterBadge({ ...base, status: 'coming' }).label).toBe('COMING');
    expect(rosterBadge({ ...base, status: 'cant_make_it' }).label).toBe('CAN’T');
    expect(rosterBadge({ ...base, status: 'walking', walkState: 'active' }).label).toBe('WALKING');
  });
  it('does not ask me to decide on a walk that has already started', () => {
    expect(rosterBadge({ ...base, status: 'invited', isMe: true, walkState: 'active' }).label).toBe('ASKED');
  });
});

describe('distanceFromYou', () => {
  it('rounds to what a straight line can honestly say', () => {
    expect(distanceFromYou(812)).toBe('800 m from you');
    expect(distanceFromYou(10)).toBe('50 m from you');
    expect(distanceFromYou(1840)).toBe('1.8 km from you');
    expect(distanceFromYou(23_400)).toBe('23 km from you');
  });
});

describe('pickNextOpenWalk', () => {
  it('prefers a walk that is running', () => {
    expect(pickNextOpenWalk([
      { id: 'p', state: 'planned', scheduled_for: '2026-10-07T01:30:00Z' },
      { id: 'a', state: 'active', scheduled_for: null },
    ])).toBe('a');
  });
  it('then the soonest planned, with undated last', () => {
    expect(pickNextOpenWalk([
      { id: 'undated', state: 'planned', scheduled_for: null },
      { id: 'later', state: 'planned', scheduled_for: '2026-10-09T01:30:00Z' },
      { id: 'soon', state: 'planned', scheduled_for: '2026-10-07T01:30:00Z' },
    ])).toBe('soon');
  });
  it('is null when there is nothing to answer', () => {
    expect(pickNextOpenWalk([])).toBeNull();
  });
});
