/**
 * keepsakeExif — what an imported photo is willing to say about itself.
 *
 * ── Why this exists ──
 * A photo brought in from the library was taken at some other moment, possibly
 * somewhere else. The one thing the import path must never do is hand it the
 * walker's CURRENT time and coordinate: that would pin a photo of the kitchen
 * to a tree three streets away, and — worse — write a `place_key` for a spot
 * the dog has never stood, so months later the app would "remember" a place
 * that never happened. lib/walk/keepsakeImport.ts calls this placement honesty;
 * this module is how the picker path keeps it.
 *
 * So: read the photo's own EXIF, and where the EXIF is silent, return null and
 * let the caller record null. A missing coordinate costs the keepsake a map pin.
 * A wrong one costs the place index its meaning.
 *
 * ── The two platform shapes ──
 * expo-image-picker flattens Core Graphics' `{GPS}` dictionary into `GPS<tag>`
 * keys on iOS, where the value is UNSIGNED degrees plus an `N`/`S`/`E`/`W` ref.
 * On Android it writes ExifInterface's `latLong`, already SIGNED, and the ref
 * tags alongside it. Taking the magnitude and re-applying the ref is correct on
 * both, and correct again if a future version changes its mind about the sign.
 *
 * Pure — no picker, no filesystem — so the parsing that decides where a
 * photograph is remembered is testable without a device.
 */

/** Loosely typed on purpose: this is a native bundle, not a contract. */
export type ExifBag = Record<string, unknown> | null | undefined;

/**
 * Sanity bounds for an EXIF timestamp, ms since epoch.
 *
 * A camera with a dead clock reports 1970 or 2001; a corrupt tag can report
 * anything. Either would be handed to `elapsedSecondsInto` and produce a
 * keepsake claiming to be forty years into a twenty-minute walk. Anything
 * outside these bounds is treated as no answer at all.
 */
const EARLIEST_PLAUSIBLE = Date.UTC(2000, 0, 1);
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function readString(bag: ExifBag, key: string): string | null {
  const value = bag?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(bag: ExifBag, key: string): number | null {
  const value = bag?.[key];
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * "2026:09:06 09:56:12" → ms since epoch, in the phone's own timezone.
 *
 * EXIF carries no zone, and the walk's clock is local, so local is the reading
 * that puts a photo at the right point in the walk. Parsed by hand rather than
 * handed to `Date.parse`, which treats the colon-separated date as invalid on
 * some engines and as a UTC ISO string on others — a silent hours-wide error.
 */
export function parseExifDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const ms = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When the photo was taken, or null.
 *
 * `DateTimeOriginal` is the shutter; `DateTimeDigitized` and `DateTime` are
 * when the file was written or last touched, so they are only consulted after
 * it. A screenshot or a downloaded image typically has none of the three, which
 * is the honest null the caller falls back to `now` for.
 */
export function exifCapturedAt(exif: ExifBag, now: number = Date.now()): number | null {
  for (const key of ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime']) {
    const at = parseExifDate(readString(exif, key));
    if (at == null) continue;
    if (at < EARLIEST_PLAUSIBLE || at > now + FUTURE_TOLERANCE_MS) continue;
    return at;
  }
  return null;
}

export interface ExifCoordinate {
  lat: number;
  lng: number;
}

/**
 * Where the photo was taken, or null.
 *
 * Both halves or neither: a latitude without a longitude is not half a place,
 * it is no place, and storing one would put a pin on the prime meridian.
 */
export function exifCoordinate(exif: ExifBag): ExifCoordinate | null {
  const rawLat = readNumber(exif, 'GPSLatitude');
  const rawLng = readNumber(exif, 'GPSLongitude');
  if (rawLat == null || rawLng == null) return null;

  const latRef = readString(exif, 'GPSLatitudeRef')?.trim().toUpperCase();
  const lngRef = readString(exif, 'GPSLongitudeRef')?.trim().toUpperCase();

  const lat = latRef === 'S' || latRef === 'N' ? Math.abs(rawLat) * (latRef === 'S' ? -1 : 1) : rawLat;
  const lng = lngRef === 'W' || lngRef === 'E' ? Math.abs(rawLng) * (lngRef === 'W' ? -1 : 1) : rawLng;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Null Island is what a camera writes when it has a GPS chip and no fix. A
  // real photograph taken there is a rounding error against the number of
  // photos wrongly stamped with it.
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}
