import { TRAIL_NAME_CAP, liveEyebrow, trackingNotification } from './liveCopy';

/**
 * The Android foreground-service notification.
 *
 * Worth its own tests because of what it is: the ONLY thing on screen while a
 * walk runs with the phone in a pocket, and therefore the only place some
 * owners will ever read what tracking is actually doing. A wrong sentence here
 * is a privacy claim nobody can check against the app.
 */
describe('trackingNotification', () => {
  it('describes a solo walk without mentioning anyone else', () => {
    const { title, body } = trackingNotification({ petName: 'Momo' });
    expect(title).toBe("Momo's walk is being tracked");
    expect(body).not.toMatch(/pack|shar|position/i);
  });

  it('says the pack can see you, when the pack can see you', () => {
    const { body } = trackingNotification({
      petName: 'Momo',
      packName: 'Sunday run club',
      sharingLocation: true,
    });
    expect(body).toContain('showing the pack where you are');
  });

  it('never claims sharing when sharing is off', () => {
    const { body } = trackingNotification({
      petName: 'Momo',
      packName: 'Sunday run club',
      sharingLocation: false,
    });
    // The inverse of the test above, and the one that actually matters: a
    // walker who declined location sharing must not read that they are
    // broadcasting it.
    expect(body).not.toContain('showing the pack');
    expect(body).toContain('stays private');
  });

  it('treats a missing sharing answer as not sharing', () => {
    // `shareLocation` is optional on the descriptor, and the safe reading of
    // "we do not know" is the one that promises less.
    const { body } = trackingNotification({ petName: 'Momo', packName: 'Sunday run club' });
    expect(body).toContain('stays private');
  });

  it('names the trail so the notification is not mistaken for a solo walk', () => {
    const { title } = trackingNotification({ petName: 'Momo', packName: 'Sunday run club' });
    expect(title).toBe('Momo is walking Sunday run club');
  });

  it('promises the self-ending walk in every variant', () => {
    // The reassurance that stops people opening the app to check, so it cannot
    // be the thing that gets dropped to make room for the pack.
    const variants = [
      trackingNotification({ petName: 'Momo' }),
      trackingNotification({ petName: 'Momo', packName: 'Pack', sharingLocation: true }),
      trackingNotification({ petName: 'Momo', packName: 'Pack', sharingLocation: false }),
    ];
    for (const { body } of variants) expect(body).toContain('ends on its own');
  });

  it('keeps every variant inside the brand voice', () => {
    const variants = [
      trackingNotification({ petName: 'Momo' }),
      trackingNotification({ petName: 'Momo', packName: 'Pack', sharingLocation: true }),
      trackingNotification({ petName: 'Momo', packName: 'Pack', sharingLocation: false }),
    ];
    for (const { title, body } of variants) {
      expect(title).not.toContain('!');
      expect(body).not.toContain('!');
      // Three sentences max.
      expect(body.split('.').filter(Boolean).length).toBeLessThanOrEqual(3);
    }
  });

  it('whitespace in a pack name does not make a solo walk look shared', () => {
    const { title } = trackingNotification({ petName: 'Momo', packName: '   ' });
    expect(title).toBe("Momo's walk is being tracked");
  });
});

describe('liveEyebrow', () => {
  it('is unchanged for a solo walk', () => {
    expect(liveEyebrow('walking')).toBe('WALKING');
    expect(liveEyebrow('sniffing')).toBe('SNIFFING');
    expect(liveEyebrow('starting')).toBe('STARTING');
  });

  it('appends the pack, uppercased', () => {
    expect(liveEyebrow('sniffing', 'Sunday run club')).toBe('SNIFFING · SUNDAY RUN CLUB');
  });

  it('treats an empty or blank pack name as no pack', () => {
    expect(liveEyebrow('walking', '')).toBe('WALKING');
    expect(liveEyebrow('walking', '   ')).toBe('WALKING');
    expect(liveEyebrow('walking', null)).toBe('WALKING');
  });

  it('clips on a word boundary when one is close enough', () => {
    // "Thursday morning beach crew" — cut at 18 lands mid-"beach", and the
    // space before it is near enough that dropping the partial word reads
    // better than a broken one.
    const eyebrow = liveEyebrow('walking', 'Thursday morning beach crew');
    expect(eyebrow).toBe('WALKING · THURSDAY MORNING…');
  });

  it('clips mid-word when the only space is too far back', () => {
    // One very long token: there is no boundary to fall back to, so a hard cut
    // is the honest outcome rather than returning almost nothing.
    const eyebrow = liveEyebrow('walking', 'Northumberlandwalkers');
    expect(eyebrow).toBe('WALKING · NORTHUMBERLANDWALK…');
  });

  it('never lets the pack name exceed its cap', () => {
    const names = [
      'a'.repeat(80),
      'Thursday morning beach crew and friends',
      'The very long name of a pack',
    ];
    for (const name of names) {
      const pack = liveEyebrow('walking', name).replace('WALKING · ', '');
      // The cap plus the ellipsis is the most it may ever be.
      expect(pack.length).toBeLessThanOrEqual(TRAIL_NAME_CAP + 1);
    }
  });

  it('leaves a name exactly at the cap alone', () => {
    const name = 'a'.repeat(TRAIL_NAME_CAP);
    expect(liveEyebrow('walking', name)).toBe(`WALKING · ${name.toUpperCase()}`);
  });
});
