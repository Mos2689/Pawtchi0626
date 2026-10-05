import { requestedLine, requesterDogs, requesterName } from './joinRequest';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('join request copy', () => {
  it('names the person the way the host knows them', () => {
    expect(requesterName({ full_name: '  Myu  ', username: 'brll' })).toBe('Myu');
    expect(requesterName({ full_name: '', username: 'brll' })).toBe('@brll');
    expect(requesterName({ full_name: null, username: null })).toBe('Someone');
  });

  it('says when they opened the link', () => {
    expect(requestedLine(ago(30_000), NOW)).toBe('Opened your invite link just now');
    expect(requestedLine(ago(12 * 60_000), NOW)).toBe('Opened your invite link 12 min ago');
    expect(requestedLine(ago(3 * 3_600_000), NOW)).toBe('Opened your invite link 3 h ago');
    expect(requestedLine(ago(30 * 3_600_000), NOW)).toBe('Opened your invite link yesterday');
    expect(requestedLine(ago(5 * 86_400_000), NOW)).toBe('Opened your invite link 5 days ago');
  });

  it('never claims a time it does not have, or one in the future', () => {
    expect(requestedLine(null, NOW)).toBe('Opened your invite link');
    expect(requestedLine('nonsense', NOW)).toBe('Opened your invite link');
    expect(requestedLine(new Date(NOW + 60_000).toISOString(), NOW)).toBe('Opened your invite link just now');
  });

  it('lists their dogs', () => {
    const dog = (name: string) => ({ id: name, name, image_url: null });
    expect(requesterDogs({ dogs: [dog('Olive'), dog('Max')] })).toBe('Walks with Olive & Max');
    expect(requesterDogs({ dogs: [] })).toBe('No dog profile yet');
  });

  it('keeps to the copy rules: no exclamation marks', () => {
    const lines = [requestedLine(ago(0), NOW), requesterDogs({ dogs: [] }), requesterName({ full_name: null, username: null })];
    for (const line of lines) expect(line).not.toContain('!');
  });
});
