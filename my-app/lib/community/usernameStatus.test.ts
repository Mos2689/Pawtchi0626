import {
  blocksSave, localStatus, statusFromAnswer, statusMessage, statusTone,
  type UsernameStatus,
} from './usernameStatus';

describe('localStatus', () => {
  it('is idle for an empty field', () => {
    expect(localStatus('')).toBe('idle');
    expect(localStatus('   ')).toBe('idle');
    // A lone @ is the prefix the field paints, not something they typed.
    expect(localStatus('@')).toBe('idle');
  });

  it('is invalid before the value could possibly be a username', () => {
    expect(localStatus('ab')).toBe('invalid');
    expect(localStatus('has space')).toBe('invalid');
    expect(localStatus('no-hyphens')).toBe('invalid');
    expect(localStatus('a'.repeat(25))).toBe('invalid');
  });

  it('asks the network only once the value is well formed', () => {
    expect(localStatus('bella_and_sam')).toBe('checking');
    expect(localStatus('abc')).toBe('checking');
    expect(localStatus('a'.repeat(24))).toBe('checking');
  });

  it('never checks the handle they already own', () => {
    expect(localStatus('bella', 'bella')).toBe('unchanged');
    // Case and the @ are display, not a different name.
    expect(localStatus('@BELLA', 'bella')).toBe('unchanged');
    expect(localStatus('bella', '@Bella')).toBe('unchanged');
  });

  it('checks when the value moves away from the current one', () => {
    expect(localStatus('bella2', 'bella')).toBe('checking');
  });

  it('treats no current username as nothing to match against', () => {
    expect(localStatus('bella', null)).toBe('checking');
    expect(localStatus('bella', '')).toBe('checking');
  });
});

describe('statusFromAnswer', () => {
  it('maps the RPC answer', () => {
    expect(statusFromAnswer(true)).toBe('available');
    expect(statusFromAnswer(false)).toBe('taken');
  });

  it('treats no answer as unknown, never as available', () => {
    expect(statusFromAnswer(null)).toBe('unknown');
    expect(statusFromAnswer(null)).not.toBe('available');
  });
});

describe('blocksSave', () => {
  it('stops only what we have evidence will fail', () => {
    expect(blocksSave('invalid')).toBe(true);
    expect(blocksSave('taken')).toBe(true);
  });

  it('never blocks on a check that could not be made', () => {
    // The whole point: a field nobody could verify must still be savable, or
    // an offline moment becomes a locked onboarding screen.
    expect(blocksSave('unknown')).toBe(false);
  });

  it('never blocks while a check is in flight', () => {
    // A fast typist reaching the button first must not find it dead.
    expect(blocksSave('checking')).toBe(false);
  });

  it('lets the settled good states through', () => {
    expect(blocksSave('idle')).toBe(false);
    expect(blocksSave('available')).toBe(false);
    expect(blocksSave('unchanged')).toBe(false);
  });
});

describe('statusMessage', () => {
  it('says nothing while there is nothing to say', () => {
    expect(statusMessage('idle', '')).toBeNull();
    expect(statusMessage('checking', 'bella')).toBeNull();
    expect(statusMessage('unchanged', 'bella')).toBeNull();
  });

  it('names the handle back when it is free', () => {
    expect(statusMessage('available', 'Bella_2')).toBe('@bella_2 is yours.');
    // Normalised, so the line matches what will actually be saved.
    expect(statusMessage('available', '@BELLA')).toBe('@bella is yours.');
  });

  it('is honest that an unknown answer is not a no', () => {
    const message = statusMessage('unknown', 'bella');
    expect(message).toBe('We could not check that one. You can still try it.');
  });

  it('carries the format rule on invalid', () => {
    expect(statusMessage('invalid', 'ab')).toContain('3–24');
  });

  it('keeps every line inside the brand voice', () => {
    const states: UsernameStatus[] = [
      'idle', 'invalid', 'unchanged', 'checking', 'available', 'taken', 'unknown',
    ];
    for (const state of states) {
      const message = statusMessage(state, 'bella');
      if (message === null) continue;
      expect(message).not.toContain('!');
      // No scolding, no "you should have", no blame for an optional field.
      expect(message.toLowerCase()).not.toMatch(/sorry|oops|error|failed|invalid/);
      // Short enough to sit on one line under a field.
      expect(message.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('statusTone', () => {
  it('paints only the two failures in the error tone', () => {
    expect(statusTone('taken')).toBe('bad');
    expect(statusTone('invalid')).toBe('bad');
  });

  it('paints a free handle as good', () => {
    expect(statusTone('available')).toBe('good');
  });

  it('leaves an unknown answer neutral rather than alarming', () => {
    // Red on "we could not check" reads as "you did something wrong".
    expect(statusTone('unknown')).toBe('neutral');
    expect(statusTone('checking')).toBe('neutral');
    expect(statusTone('idle')).toBe('neutral');
    expect(statusTone('unchanged')).toBe('neutral');
  });
});
