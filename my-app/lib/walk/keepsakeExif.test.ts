/**
 * What an imported photo is allowed to claim about itself.
 *
 * These assertions are the difference between a walk archive that means
 * something and one that quietly fills up with places the dog has never been:
 * every case below is one where the tempting answer is a plausible-looking
 * guess and the correct answer is null.
 */

import { exifCapturedAt, exifCoordinate, parseExifDate } from './keepsakeExif';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');

describe('parseExifDate', () => {
  it('reads the EXIF format as local time', () => {
    // EXIF carries no zone and the walk's clock is local, so the two must agree
    // — an hours-wide error here would place a photo in the wrong walk.
    const at = parseExifDate('2026:09:06 09:56:12');
    expect(at).toBe(new Date(2026, 8, 6, 9, 56, 12).getTime());
  });

  it('accepts the ISO-ish separator some cameras write', () => {
    expect(parseExifDate('2026:09:06T09:56:12')).toBe(
      new Date(2026, 8, 6, 9, 56, 12).getTime(),
    );
  });

  it('refuses anything that is not that shape', () => {
    expect(parseExifDate('2026-09-06T09:56:12Z')).toBeNull();
    expect(parseExifDate('yesterday')).toBeNull();
    expect(parseExifDate('')).toBeNull();
    expect(parseExifDate(undefined)).toBeNull();
  });
});

describe('exifCapturedAt', () => {
  it('prefers the shutter over the file', () => {
    const at = exifCapturedAt(
      {
        DateTimeOriginal: '2026:09:06 09:00:00',
        DateTime: '2026:09:06 11:00:00',
      },
      NOW,
    );
    expect(at).toBe(new Date(2026, 8, 6, 9, 0, 0).getTime());
  });

  it('falls back through the lesser tags', () => {
    const at = exifCapturedAt({ DateTime: '2026:09:06 11:00:00' }, NOW);
    expect(at).toBe(new Date(2026, 8, 6, 11, 0, 0).getTime());
  });

  it('rejects a dead camera clock', () => {
    // A camera that lost its battery reports the start of its own epoch. The
    // floor is only a sanity bound, though — an old photo is a real thing, and
    // whether one belongs in THIS walk is a question for isWithinWalkWindow,
    // not for a year threshold.
    expect(exifCapturedAt({ DateTimeOriginal: '1980:01:01 00:00:00' }, NOW)).toBeNull();
  });

  it('accepts a genuinely old photograph', () => {
    expect(exifCapturedAt({ DateTimeOriginal: '2011:06:04 14:30:00' }, NOW)).toBe(
      new Date(2011, 5, 4, 14, 30, 0).getTime(),
    );
  });

  it('rejects a timestamp from the future', () => {
    expect(exifCapturedAt({ DateTimeOriginal: '2030:01:01 00:00:00' }, NOW)).toBeNull();
  });

  it('says nothing when the photo says nothing — a screenshot, a download', () => {
    expect(exifCapturedAt({}, NOW)).toBeNull();
    expect(exifCapturedAt(null, NOW)).toBeNull();
  });
});

describe('exifCoordinate', () => {
  it('applies the hemisphere refs iOS sends alongside unsigned degrees', () => {
    expect(
      exifCoordinate({
        GPSLatitude: 33.8688,
        GPSLatitudeRef: 'S',
        GPSLongitude: 151.2093,
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it('leaves an already-signed value alone when Android agrees with itself', () => {
    // ExifInterface.latLong is signed AND carries the refs; taking the
    // magnitude and reapplying the ref has to land on the same answer.
    expect(
      exifCoordinate({
        GPSLatitude: -33.8688,
        GPSLatitudeRef: 'S',
        GPSLongitude: -70.6483,
        GPSLongitudeRef: 'W',
      }),
    ).toEqual({ lat: -33.8688, lng: -70.6483 });
  });

  it('keeps a signed value when no ref is present at all', () => {
    expect(exifCoordinate({ GPSLatitude: -33.8688, GPSLongitude: 151.2093 })).toEqual({
      lat: -33.8688,
      lng: 151.2093,
    });
  });

  it('parses string-valued degrees', () => {
    expect(
      exifCoordinate({ GPSLatitude: '51.5074', GPSLatitudeRef: 'N', GPSLongitude: '0.1278', GPSLongitudeRef: 'W' }),
    ).toEqual({ lat: 51.5074, lng: -0.1278 });
  });

  it('refuses half a coordinate', () => {
    expect(exifCoordinate({ GPSLatitude: 51.5074 })).toBeNull();
    expect(exifCoordinate({ GPSLongitude: 0.1278 })).toBeNull();
  });

  it('refuses Null Island — what a camera writes when it has no fix', () => {
    expect(exifCoordinate({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
  });

  it('refuses impossible degrees', () => {
    expect(exifCoordinate({ GPSLatitude: 91, GPSLongitude: 0.1 })).toBeNull();
    expect(exifCoordinate({ GPSLatitude: 51, GPSLongitude: 181 })).toBeNull();
  });

  it('says nothing about a photo with no GPS', () => {
    expect(exifCoordinate({ DateTimeOriginal: '2026:09:06 09:56:12' })).toBeNull();
    expect(exifCoordinate(undefined)).toBeNull();
  });
});
