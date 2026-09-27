import {
  inviteSelectedLabel,
  inviteeSubtitle,
  inviteeTitle,
  isMissingFunction,
  previousInviteError,
  toPreviousInvitee,
} from './previousInvitees';

const row = {
  user_id: 'u1',
  username: 'samandolive',
  full_name: 'Sam Carter',
  avatar_url: null,
  dogs: [{ id: 'd1', name: 'Olive', image_url: null }],
  last_invited_at: '2026-09-20T10:00:00Z',
  pending_here: false,
};

describe('toPreviousInvitee', () => {
  it('maps a server row', () => {
    expect(toPreviousInvitee(row)).toEqual({
      id: 'u1',
      username: 'samandolive',
      full_name: 'Sam Carter',
      avatar_url: null,
      dogs: [{ id: 'd1', name: 'Olive', image_url: null }],
      lastInvitedAt: '2026-09-20T10:00:00Z',
      pendingHere: false,
    });
  });

  it('drops a row without an id rather than rendering a person who cannot be invited', () => {
    expect(toPreviousInvitee({ ...row, user_id: null })).toBeNull();
  });

  it('treats anything but true as not pending', () => {
    expect(toPreviousInvitee({ ...row, pending_here: 'true' })?.pendingHere).toBe(false);
    expect(toPreviousInvitee({ ...row, pending_here: true })?.pendingHere).toBe(true);
  });

  it('survives a malformed dogs field', () => {
    expect(toPreviousInvitee({ ...row, dogs: null })?.dogs).toEqual([]);
  });
});

describe('row copy', () => {
  const person = toPreviousInvitee(row)!;

  it('leads with the dogs, then the owner’s first name and handle', () => {
    expect(inviteeTitle(person)).toBe('Olive');
    expect(inviteeSubtitle(person)).toBe('Sam · @samandolive');
  });

  it('falls back to the owner when there are no dogs', () => {
    const noDogs = { ...person, dogs: [] };
    expect(inviteeTitle(noDogs)).toBe('Sam Carter');
    expect(inviteeSubtitle(noDogs)).toBe('@samandolive');
  });

  it('never renders an empty line', () => {
    const bare = { ...person, dogs: [], full_name: null, username: null };
    expect(inviteeTitle(bare)).toBe('A Pawtchi owner');
    expect(inviteeSubtitle(bare)).toBe('Invited before');
  });
});

describe('inviteSelectedLabel', () => {
  it('counts the selection', () => {
    expect(inviteSelectedLabel(0, false)).toBe('Choose who to invite');
    expect(inviteSelectedLabel(1, false)).toBe('Invite 1 person');
    expect(inviteSelectedLabel(5, false)).toBe('Invite 5 people');
    expect(inviteSelectedLabel(5, true)).toBe('Inviting…');
  });
});

describe('errors', () => {
  it('turns server codes into sentences', () => {
    expect(previousInviteError('invite_rate_limited')).toMatch(/hour/);
    expect(previousInviteError('pack_host_required')).toMatch(/Only the host/);
    expect(previousInviteError('not_a_previous_invitee')).toMatch(/no longer be invited/);
    expect(previousInviteError('boom')).toMatch(/could not be sent/);
  });

  it('never uses an exclamation mark', () => {
    for (const code of ['invite_rate_limited', 'pack_host_required', 'not_a_previous_invitee', 'x']) {
      expect(previousInviteError(code)).not.toContain('!');
    }
  });

  it('recognises a database that does not have the function yet', () => {
    expect(isMissingFunction('Could not find the function public.community_previous_invitees(p_pack_id) in the schema cache')).toBe(true);
    expect(isMissingFunction('pack_host_required')).toBe(false);
  });
});
