import {
  clearActiveDestination,
  readActiveDestination,
  rememberActiveDestination,
} from './activeDestination';

const PARK = { id: 'park', name: 'Park', lat: 15.55, lng: 73.76 };

afterEach(() => clearActiveDestination());

describe('active destination presentation handoff', () => {
  it('restores the destination only for the same active walk', () => {
    rememberActiveDestination('walk-a', PARK);
    expect(readActiveDestination('walk-a')).toEqual(PARK);
    expect(readActiveDestination('walk-b')).toBeNull();
  });

  it('does not let an old walk clear a newer walk', () => {
    rememberActiveDestination('walk-new', PARK);
    clearActiveDestination('walk-old');
    expect(readActiveDestination('walk-new')).toEqual(PARK);
  });

  it('clears once the matching walk is over', () => {
    rememberActiveDestination('walk-a', PARK);
    clearActiveDestination('walk-a');
    expect(readActiveDestination('walk-a')).toBeNull();
  });
});
