import { resolveSlots, type OwnerPrefs } from './scheduleSlots';

const noPrefs: OwnerPrefs = {
  wake_time: null,
  bedtime: null,
  work_start: null,
  work_end: null,
  weekend_shifts_hours: null,
};

describe('resolveSlots — species defaults', () => {
  test('dog with no prefs uses 07:00 wake / 22:30 bedtime defaults', () => {
    const slots = resolveSlots(noPrefs, false, 'dog');
    expect(slots.breakfast).toBe('07:30:00');
    expect(slots.windDown).toBe('21:30:00');
    expect(slots.lunch).toBeNull(); // dogs default to 2 meals
  });

  test('cat with no prefs uses 06:30 wake and gets a lunch slot', () => {
    const slots = resolveSlots(noPrefs, false, 'cat');
    expect(slots.breakfast).toBe('07:00:00');
    expect(slots.lunch).not.toBeNull();
  });
});

describe('resolveSlots — wake-time anchoring', () => {
  test('early riser (05:00) gets early breakfast and morning walk', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '05:00' },
      false,
      'dog',
    );
    expect(slots.breakfast).toBe('05:30:00');
    expect(slots.morningActivity).toBe('05:45:00'); // wake + 45 when no work
  });

  test('late riser (10:00) gets late breakfast', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '10:00' },
      false,
      'dog',
    );
    expect(slots.breakfast).toBe('10:30:00');
    expect(slots.morningActivity).toBe('10:45:00');
  });
});

describe('resolveSlots — work window', () => {
  test('morning walk anchors 75 min before work_start, not wake', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '06:00', work_start: '09:00', work_end: '17:30' },
      false,
      'dog',
    );
    // 09:00 - 75min = 07:45
    expect(slots.morningActivity).toBe('07:45:00');
    // breakfast still anchored to wake
    expect(slots.breakfast).toBe('06:30:00');
  });

  test('dinner anchors to work_end + 60', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '07:00', work_start: '09:00', work_end: '17:30' },
      false,
      'dog',
    );
    expect(slots.dinner).toBe('18:30:00');
    // eveningActivity = dinner + 75 = 19:45
    expect(slots.eveningActivity).toBe('19:45:00');
  });

  test('midday hydration is midpoint of work window', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '07:00', work_start: '09:00', work_end: '17:00' },
      false,
      'dog',
    );
    // midpoint of 09:00 and 17:00 = 13:00
    expect(slots.middayHydration).toBe('13:00:00');
  });

  test('no work window → midday defaults to noon', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '07:00' },
      false,
      'dog',
    );
    expect(slots.middayHydration).toBe('12:00:00');
    expect(slots.dinner).toBe('18:30:00');
  });
});

describe('resolveSlots — weekend shift', () => {
  test('shift +2h applies uniformly when isWeekend', () => {
    const prefs: OwnerPrefs = {
      wake_time: '07:00',
      bedtime: '22:30',
      work_start: null,
      work_end: null,
      weekend_shifts_hours: 2,
    };
    const weekday = resolveSlots(prefs, false, 'dog');
    const weekend = resolveSlots(prefs, true, 'dog');
    expect(weekday.breakfast).toBe('07:30:00');
    expect(weekend.breakfast).toBe('09:30:00');
    expect(weekday.dinner).toBe('18:30:00');
    expect(weekend.dinner).toBe('20:30:00');
  });

  test('shift -1h pulls weekend earlier', () => {
    const prefs: OwnerPrefs = {
      ...noPrefs,
      wake_time: '07:00',
      weekend_shifts_hours: -1,
    };
    const weekend = resolveSlots(prefs, true, 'dog');
    expect(weekend.breakfast).toBe('06:30:00');
  });

  test('shift is ignored on weekdays', () => {
    const prefs: OwnerPrefs = {
      ...noPrefs,
      wake_time: '07:00',
      weekend_shifts_hours: 2,
    };
    const weekday = resolveSlots(prefs, false, 'dog');
    expect(weekday.breakfast).toBe('07:30:00');
  });

  test('shift clamped to [-2, +4] — malformed +10 caps at +4', () => {
    const prefs: OwnerPrefs = {
      ...noPrefs,
      wake_time: '07:00',
      weekend_shifts_hours: 10,
    };
    const weekend = resolveSlots(prefs, true, 'dog');
    expect(weekend.breakfast).toBe('11:30:00'); // 07:30 + 4h, not + 10h
  });
});

describe('resolveSlots — edge cases', () => {
  test('bedtime 01:00 (next-day wrap) produces wind-down at 00:00', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '08:00', bedtime: '01:00' },
      false,
      'dog',
    );
    // bedtime - 60 = 00:00
    expect(slots.windDown).toBe('00:00:00');
  });

  test('seconds in input (07:00:00) parsed correctly', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '07:00:00' },
      false,
      'dog',
    );
    expect(slots.breakfast).toBe('07:30:00');
  });

  test('output strings are always HH:MM:SS with leading zeros', () => {
    const slots = resolveSlots(
      { ...noPrefs, wake_time: '06:00' },
      false,
      'dog',
    );
    Object.values(slots).forEach((v) => {
      if (v !== null) {
        expect(v).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }
    });
  });

  test('all slots present and ordered chronologically for typical day', () => {
    const slots = resolveSlots(
      { wake_time: '07:00', bedtime: '22:30', work_start: '09:00', work_end: '17:30', weekend_shifts_hours: 0 },
      false,
      'dog',
    );
    const order = [
      slots.breakfast,
      slots.morningActivity,
      slots.middayHydration,
      slots.middayActivity,
      slots.eveningHydration,
      slots.dinner,
      slots.eveningActivity,
      slots.windDown,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i] > order[i - 1]).toBe(true);
    }
  });
});
