import { color } from '../../constants/design';
import {
  dogsLine,
  meetingPoint,
  minutesTogether,
  orderWalkers,
  pickStoryPhotos,
  storyDateChip,
  storyDogNames,
  storyHeadline,
  storyLineColor,
  storySubline,
} from './packStory';

// Friday 25 Sep 2026, 6:40 pm local.
const friday = new Date(2026, 8, 25, 18, 40);

describe('line colours', () => {
  it('goes yellow, electric blue, navy, black first', () => {
    expect([0, 1, 2, 3].map(storyLineColor)).toEqual([
      color.yellow, color.electric, color.navy, '#000000',
    ]);
  });

  it('keeps going for bigger packs and wraps rather than failing', () => {
    expect(storyLineColor(4)).toBe(color.packStoryLines[4]);
    expect(storyLineColor(color.packStoryLines.length)).toBe(color.yellow);
  });
});

describe('walkers and dogs', () => {
  const walkers = [
    { userId: 'b', dogNames: ['Bruno'] },
    { userId: 'me', dogNames: ['Sma'] },
    { userId: 'c', dogNames: ['Olive', ' ', 'bruno'] },
  ];

  it('puts the viewer first so their dog leads and gets the yellow line', () => {
    expect(orderWalkers(walkers, 'me').map(w => w.userId)).toEqual(['me', 'b', 'c']);
  });

  it('lists every dog once, skipping blanks and repeats', () => {
    expect(storyDogNames(orderWalkers(walkers, 'me'))).toEqual(['Sma', 'Bruno', 'Olive']);
  });

  it('reads naturally at every count', () => {
    expect(dogsLine([])).toBe('');
    expect(dogsLine(['Sma'])).toBe('Sma');
    expect(dogsLine(['Sma', 'Bruno'])).toBe('Sma and Bruno');
    expect(dogsLine(['Sma', 'Bruno', 'Olive'])).toBe('Sma, Bruno and Olive');
    expect(dogsLine(['Sma', 'Bruno', 'Olive', 'Rex'])).toBe('Sma, Bruno and 2 more');
  });
});

describe('storyHeadline', () => {
  const base = { at: friday, fallbackTitle: 'Hmmm' };

  it('is built from the walk, in the dogs’ names', () => {
    expect(storyHeadline({ ...base, dogNames: ['Sma'] })).toBe('Sma’s Friday walk');
    expect(storyHeadline({ ...base, dogNames: ['Sma', 'Bruno'] })).toBe('Sma and Bruno, side by side');
    expect(storyHeadline({ ...base, dogNames: ['Sma', 'Bruno', 'Olive'] })).toBe('Sma, Bruno and Olive');
    expect(storyHeadline({ ...base, dogNames: ['Sma', 'Bruno', 'Olive', 'Rex', 'Ivy'] })).toBe('Sma and the pack of 5');
  });

  it('falls back to the meetup title rather than a placeholder', () => {
    expect(storyHeadline({ ...base, dogNames: [] })).toBe('Hmmm');
  });

  it('never shouts', () => {
    for (const names of [['Sma'], ['Sma', 'Bruno'], ['A', 'B', 'C'], ['A', 'B', 'C', 'D']]) {
      expect(storyHeadline({ ...base, dogNames: names })).not.toMatch(/!/);
    }
  });
});

describe('storySubline', () => {
  it('says when, how long and how many moments', () => {
    expect(storySubline({ at: friday, seconds: 360, moments: 4 })).toBe('Friday evening · 6 min together · 4 moments');
  });

  it('drops what it does not know', () => {
    expect(storySubline({ at: null, seconds: null, moments: 1 })).toBe('1 moment');
    expect(storySubline({ at: new Date(2026, 8, 26, 7, 0), seconds: 20, moments: 0 })).toBe('Saturday morning');
  });

  it('has no sticker for a walk under a minute', () => {
    expect(minutesTogether(30)).toBeNull();
    expect(minutesTogether(372)).toBe(6);
  });

  it('dates the chip briefly', () => {
    expect(storyDateChip(friday)).toBe('Fri, 25 Sep');
  });
});

describe('pickStoryPhotos', () => {
  const photos = [5, 1, 9, 3, 7].map(capturedAt => ({ capturedAt }));

  it('spreads three photos across the walk', () => {
    expect(pickStoryPhotos(photos).map(p => p.capturedAt)).toEqual([1, 5, 9]);
  });

  it('keeps all of a small set, in order', () => {
    expect(pickStoryPhotos(photos.slice(0, 2)).map(p => p.capturedAt)).toEqual([1, 5]);
  });
});

describe('meetingPoint', () => {
  it('marks where two lines come together', () => {
    const a = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }];
    const b = [{ x: 100, y: 0 }, { x: 54, y: 50 }, { x: 0, y: 100 }];
    expect(meetingPoint(a, b)).toEqual({ x: 52, y: 50 });
  });

  it('claims no meeting when the lines never came close', () => {
    expect(meetingPoint([{ x: 0, y: 0 }], [{ x: 200, y: 200 }])).toBeNull();
  });
});
