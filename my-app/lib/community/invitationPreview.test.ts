import {
  previewErrorMessage,
  previewGoing,
  previewPeopleLine,
  previewWhen,
  toInvitationPreview,
} from './invitationPreview';

const raw = {
  packName: 'Sunday crew',
  hostName: 'Sam',
  memberCount: 4,
  dogs: [{ id: 'd1', name: 'Olive', image_url: null }, { id: 'd2', name: 'Bruno', image_url: null }],
  nextWalk: {
    title: 'Beach loop',
    state: 'planned',
    scheduledFor: null,
    meetingLabel: 'Baga beach steps',
    note: 'Bring water',
    goingCount: 2,
  },
};

describe('toInvitationPreview', () => {
  it('shapes the server answer', () => {
    const preview = toInvitationPreview(raw)!;
    expect(preview.packName).toBe('Sunday crew');
    expect(preview.nextWalk).toMatchObject({ title: 'Beach loop', live: false, meetingLabel: 'Baga beach steps', goingCount: 2 });
  });

  it('refuses a malformed answer rather than rendering a blank card', () => {
    expect(toInvitationPreview(null)).toBeNull();
    expect(toInvitationPreview({})).toBeNull();
  });

  it('copes with a meetup that has no walk yet and a host with no name', () => {
    const preview = toInvitationPreview({ ...raw, hostName: ' ', nextWalk: null })!;
    expect(preview.nextWalk).toBeNull();
    expect(preview.hostName).toBeNull();
  });
});

describe('preview copy', () => {
  const preview = toInvitationPreview(raw)!;

  it('says who is in it', () => {
    expect(previewPeopleLine(preview)).toBe('Sam hosts · 4 people · 2 dogs');
    expect(previewPeopleLine({ ...preview, hostName: null, memberCount: 1, dogs: [] })).toBe('1 person');
  });

  it('says when, honestly', () => {
    expect(previewWhen(preview.nextWalk!)).toBe('Date to be confirmed');
    expect(previewWhen({ ...preview.nextWalk!, live: true })).toBe('Walking now');
  });

  it('only counts people who said yes', () => {
    expect(previewGoing(preview.nextWalk!)).toBe('2 going');
    expect(previewGoing({ ...preview.nextWalk!, goingCount: 0 })).toBeNull();
  });

  it('explains a closed invitation plainly, without shouting', () => {
    expect(previewErrorMessage('invitation_not_available')).toBe('This invitation is no longer open.');
    expect(previewErrorMessage('boom')).not.toContain('!');
  });
});
