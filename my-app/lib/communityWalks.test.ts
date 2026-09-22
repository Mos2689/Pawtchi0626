import { isValidUsername, normalizeUsername } from './communityUsername';

describe('community usernames', () => {
  it('normalizes an exact username without broadening the lookup', () => {
    expect(normalizeUsername('  @Bella_Walks  ')).toBe('bella_walks');
  });

  it('accepts only the public username format', () => {
    expect(isValidUsername('@bella_walks')).toBe(true);
    expect(isValidUsername('be')).toBe(false);
    expect(isValidUsername('bella walks')).toBe(false);
    expect(isValidUsername('bella-walks')).toBe(false);
  });
});
