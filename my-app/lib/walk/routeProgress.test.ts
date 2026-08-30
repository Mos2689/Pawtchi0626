import { routeProgressPresentation } from './routeProgress';

describe('routeProgressPresentation', () => {
  it('uses the approved, reassuring loading copy', () => {
    expect(
      routeProgressPresentation({ ready: false, destinationName: 'Sallys Pets' }),
    ).toEqual({
      title: 'Finding the best route',
      subtitle: 'To Sallys Pets · usually a few seconds',
      accessibilityLabel: 'Finding the best route to Sallys Pets',
    });
  });

  it('turns the same card into a concise ready confirmation', () => {
    expect(
      routeProgressPresentation({
        ready: true,
        destinationName: 'Sallys Pets',
        distanceLabel: '1.7 km',
        etaLabel: 'about 25 min',
      }),
    ).toEqual({
      title: 'Route ready',
      subtitle: 'Sallys Pets · 1.7 km · about 25 min',
      accessibilityLabel: 'Route ready to Sallys Pets · 1.7 km · about 25 min',
    });
  });

  it('does not leave dangling separators while GPS details are pending', () => {
    expect(
      routeProgressPresentation({ ready: true, destinationName: 'The park' }).subtitle,
    ).toBe('The park');
  });
});
