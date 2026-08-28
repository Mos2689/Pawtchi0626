import { assessWalkWeather } from './walkWeatherSafety';

const weather = (tempC: number, code = 0) => ({ tempC, code, label: 'clear' });

describe('assessWalkWeather', () => {
  test('comfortable, calm conditions are good to go', () => {
    expect(assessWalkWeather(weather(20))).toEqual({ level: 'good', label: 'Good to go' });
    expect(assessWalkWeather(weather(5))).toEqual({ level: 'good', label: 'Good to go' });
  });

  test('warm or cold conditions ask the owner to take care', () => {
    expect(assessWalkWeather(weather(21)).level).toBe('caution');
    expect(assessWalkWeather(weather(4)).level).toBe('caution');
  });

  test('extreme temperatures advise staying in', () => {
    expect(assessWalkWeather(weather(30)).level).toBe('avoid');
    expect(assessWalkWeather(weather(0)).level).toBe('avoid');
  });

  test('weather hazards can raise the outlook independently of temperature', () => {
    expect(assessWalkWeather(weather(15, 61)).level).toBe('caution');
    expect(assessWalkWeather(weather(15, 95)).level).toBe('avoid');
    expect(assessWalkWeather(weather(15, 82)).level).toBe('avoid');
    expect(assessWalkWeather(weather(2, 56)).level).toBe('avoid');
  });
});
