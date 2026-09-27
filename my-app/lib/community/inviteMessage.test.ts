import {
  buildInviteMessage,
  inviteFirstName,
  inviteShareTitle,
  walkLine,
} from './inviteMessage';

const LINK = 'https://pawtchi.com/app/community-invite?code=abc-123';

const base = {
  hostName: 'Sam',
  trailName: 'Sept Salty Walk',
  when: 'Sunday 7:15 AM',
  where: 'Baga beach',
  link: LINK,
};

describe('inviteFirstName', () => {
  it('takes the first name', () => {
    expect(inviteFirstName('Samantha Okafor', 'sam_o')).toBe('Samantha');
  });

  it('falls back to the handle', () => {
    expect(inviteFirstName(null, 'sam_o')).toBe('@sam_o');
    expect(inviteFirstName('   ', 'sam_o')).toBe('@sam_o');
  });

  it('returns null when there is nothing to call them', () => {
    expect(inviteFirstName(null, null)).toBeNull();
    expect(inviteFirstName('', '')).toBeNull();
  });
});

describe('walkLine', () => {
  it('joins a time and a place', () => {
    expect(walkLine('Sunday 7:15 AM', 'Baga beach')).toBe('Sunday 7:15 AM at Baga beach');
  });

  it('survives having only one of them', () => {
    expect(walkLine('Sunday 7:15 AM', null)).toBe('Sunday 7:15 AM');
    expect(walkLine(null, 'Baga beach')).toBe('at Baga beach');
  });

  it('says nothing rather than dangling an "at"', () => {
    expect(walkLine(null, null)).toBeNull();
    expect(walkLine('  ', '  ')).toBeNull();
  });
});

describe('buildInviteMessage', () => {
  it('names the host, so it reads as a person', () => {
    expect(buildInviteMessage(base)).toContain('Sam is inviting you to walk together on Pawtchi.');
  });

  it('says what the walk actually is', () => {
    expect(buildInviteMessage(base)).toContain('Sept Salty Walk — Sunday 7:15 AM at Baga beach.');
  });

  it('describes the trail when the walk has no details yet', () => {
    expect(buildInviteMessage({ ...base, when: null, where: null }))
      .toContain('The meetup is Sept Salty Walk.');
  });

  it('still works with no host name', () => {
    const text = buildInviteMessage({ ...base, hostName: null });
    expect(text).toContain('You have been invited');
    // Never a dangling name, an "undefined", or a double space where one went.
    expect(text).not.toMatch(/undefined|null|\s{3,}/);
  });

  it('carries the link', () => {
    expect(buildInviteMessage(base)).toContain(LINK);
  });

  it('never prints a bare invitation code', () => {
    // A raw UUID on its own line is the most effective way to make a message
    // from a friend look like spam. The code travels in the link.
    const text = buildInviteMessage(base);
    expect(text).not.toMatch(/invitation code/i);
    expect(text.replace(LINK, '')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it('sets the expectation about what the link does', () => {
    const text = buildInviteMessage(base);
    expect(text).toMatch(/opens Pawtchi if you have it/i);
    expect(text).toMatch(/app store if you do not/i);
  });

  it('keeps the safety promise the host is relying on', () => {
    expect(buildInviteMessage(base)).toMatch(/Nobody is added without the host confirming them/i);
  });

  describe('brand voice', () => {
    const samples = [
      buildInviteMessage(base),
      buildInviteMessage({ ...base, hostName: null, when: null, where: null }),
      buildInviteMessage({ ...base, trailName: '', where: null }),
    ];

    it('never shouts', () => {
      for (const text of samples) expect(text).not.toContain('!');
    });

    it('never guilts', () => {
      for (const text of samples) {
        expect(text).not.toMatch(/don'?t miss|hurry|last chance|before it'?s too late/i);
      }
    });

    it('stays short enough to read in a chat preview', () => {
      for (const text of samples) {
        const firstLine = text.split('\n')[0];
        expect(firstLine.length).toBeLessThanOrEqual(72);
      }
    });

    it('survives an unnamed trail without printing an empty gap', () => {
      const text = buildInviteMessage({ ...base, trailName: '   ', when: null, where: null });
      expect(text).toContain('The meetup is a meetup.');
      expect(text).not.toMatch(/\s{3,}/);
    });
  });
});

describe('inviteShareTitle', () => {
  it('names the host when it can', () => {
    expect(inviteShareTitle('Sam', 'Sept Salty Walk')).toBe('Sam invited you to Sept Salty Walk');
  });

  it('falls back to the trail', () => {
    expect(inviteShareTitle(null, 'Sept Salty Walk')).toBe('Join Sept Salty Walk on Pawtchi');
  });
});
