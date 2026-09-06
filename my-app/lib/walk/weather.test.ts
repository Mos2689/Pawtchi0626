import { labelForWeatherCode, weatherCellKey } from './weather';

describe('weatherCellKey', () => {
  it('collapses coordinates that produce the same request', () => {
    // Home paints a cached centre and then revalidates it. A few hundred metres
    // apart is the same ~1 km cell, and therefore the same forecast — asking
    // twice would spend a request to receive the first answer again.
    expect(weatherCellKey(-33.8688, 151.2093)).toBe(weatherCellKey(-33.8691, 151.2095));
  });

  it('separates coordinates that would be different requests', () => {
    expect(weatherCellKey(-33.86, 151.2)).not.toBe(weatherCellKey(-33.9, 151.2));
    expect(weatherCellKey(-33.86, 151.2)).not.toBe(weatherCellKey(-33.86, 151.25));
  });

  it('rounds to the same 2 decimals the request itself uses', () => {
    expect(weatherCellKey(-33.8688, 151.2093)).toBe('-33.87,151.21');
  });

  it('is null for anything that could never be asked about', () => {
    expect(weatherCellKey(null, 151.2)).toBeNull();
    expect(weatherCellKey(-33.86, undefined)).toBeNull();
    expect(weatherCellKey(NaN, 151.2)).toBeNull();
    expect(weatherCellKey(-33.86, Infinity)).toBeNull();
  });

  it('treats 0,0 as a real coordinate rather than a missing one', () => {
    expect(weatherCellKey(0, 0)).toBe('0,0');
  });
});

describe('labelForWeatherCode', () => {
  it('reads calmly — no urgency, no capitals', () => {
    expect(labelForWeatherCode(0)).toBe('clear');
    expect(labelForWeatherCode(63)).toBe('rain');
    expect(labelForWeatherCode(95)).toBe('a thunderstorm');
  });

  it('falls back rather than inventing a condition', () => {
    // 30 is a real gap in the WMO table we map — better a vague true word than
    // a specific invented one.
    expect(labelForWeatherCode(30)).toBe('clouds');
  });
});
