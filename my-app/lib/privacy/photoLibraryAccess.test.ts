/**
 * The photo-library invariant: Pawtchi never asks to READ the camera roll.
 *
 * The whole photo architecture rests on one claim — the app keeps its own copy
 * (lib/walk/keepsakeFile.ts) and therefore never needs the user's library. Two
 * lines of code would quietly end that:
 *
 *   • `ImagePicker.requestMediaLibraryPermissionsAsync()` before a picker call.
 *     Unnecessary on iOS, where `launchImageLibraryAsync` opens Apple's picker
 *     out of process and needs no permission at all — but adding it produces the
 *     full "Allow Access to All Photos / Select Photos…" sheet, which is exactly
 *     the prompt this design exists to avoid. It is a natural thing for someone
 *     to add while debugging a picker that failed for an unrelated reason.
 *
 *   • A `MediaLibrary` permission request without `writeOnly`. Add-only has no
 *     limited state and no read; drop the flag and the same sheet appears.
 *
 * Neither would fail a build, crash, or look wrong in review — the app would
 * work, and only a user would ever see the difference. So it is asserted here,
 * against the source, where the rule is cheap to keep and impossible to lose
 * silently.
 *
 * ── Why the scan drops comment lines ──
 * Because it reads source as text, and text cannot tell a CALL from a MENTION.
 * The rule is worth explaining at its call sites, and every doc comment that
 * explains it has to name the thing it is forbidding — which used to trip the
 * guard, teaching the next person that the way past a privacy assertion is to
 * delete the paragraph explaining it.
 *
 * The masking direction is the more dangerous one, and it was live: the
 * `writeOnly` assertion clears a file that merely CONTAINS the text
 * `writeOnly: true`, so a prose sentence about add-only access sitting near a
 * request that had lost the flag would have hidden a real regression.
 *
 * So whole-line comments are removed before matching. Only whole-line — a
 * trailing comment on a line of code stays, which can only ever produce a false
 * ALARM, and a guard that occasionally cries wolf is the safe failure for this.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const SEARCHED = ['app', 'components', 'hooks', 'lib', 'store', 'providers'];
const CODE = new Set(['.ts', '.tsx']);

function sourceFiles(dir: string, prefix: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) return sourceFiles(full, rel);
    if (!CODE.has(extname(entry)) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      return [];
    }
    return [rel];
  });
}

/**
 * Drop lines that are nothing but comment, keep everything else verbatim.
 *
 * Deliberately line-based rather than a real tokenizer. A tokenizer would have
 * to reason about regex literals versus division to know whether `//` opens a
 * comment, and getting that wrong would silently swallow a line of real code —
 * the one failure mode this file cannot afford.
 */
export function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t === '*/');
    })
    .join('\n');
}

const files = SEARCHED.flatMap((dir) => sourceFiles(join(ROOT, dir), dir)).map((path) => ({
  path,
  text: codeOnly(readFileSync(join(ROOT, path), 'utf8')),
}));

function find(suffix: string) {
  const file = files.find((f) => f.path.endsWith(suffix));
  expect(file).toBeDefined();
  return file!;
}

describe('photo library access', () => {
  it('scans a real source tree', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.path.endsWith('components/walk/WalkCamera.tsx'))).toBe(true);
  });

  it('strips prose without stripping code', () => {
    // Guards the guard again, and this one matters more: over-stripping would
    // make every assertion below quietly stop looking at anything.
    expect(codeOnly('// a\n * b\n/* c */\nconst x = 1; // d\n')).toBe('const x = 1; // d\n');
    expect(find('components/walk/WalkCamera.tsx').text).toContain('takePictureAsync');
  });

  it('never requests read access through expo-image-picker', () => {
    const offenders = files
      .filter((f) => f.text.includes('requestMediaLibraryPermissionsAsync'))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('only ever requests the media library write-only', () => {
    const offenders = files
      .filter((f) => /MediaLibrary\.usePermissions\(|MediaLibrary\.requestPermissionsAsync\(/.test(f.text))
      .filter((f) => !/writeOnly:\s*true/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * Import is a picker, not a permission.
   *
   * `launchImageLibraryAsync` runs out of process on both platforms — Apple's
   * PHPickerViewController and Android's system photo picker — so the user
   * chooses one photo and hands it over without granting the app anything. That
   * is the whole reason a walk can take an existing photo at all while
   * READ_MEDIA_IMAGES stays blocked in app.config.ts.
   *
   * It lives on the walk SUMMARY, not in the camera: mid-walk, "add an existing
   * photo" is a question nobody is asking, and putting it beside the shutter
   * turned a one-purpose surface into a menu.
   */
  it('imports through the system picker alone', () => {
    const walk = find('app/walk.tsx');
    expect(walk.text).toContain('ImagePicker.launchImageLibraryAsync');
  });

  /**
   * The camera does not touch the photo library, in either direction.
   *
   * It is the one surface where a system sheet about photos would be read as
   * the app reaching for the camera roll — which is the precise impression the
   * app-container copy (lib/walk/keepsakeFile.ts) exists to prevent. There is
   * no longer anything on that screen that could raise one: the opt-in
   * camera-roll copy and its permission request went with the rest of its
   * chrome.
   */
  it('keeps the camera clear of the photo library', () => {
    const camera = find('components/walk/WalkCamera.tsx');
    expect(camera.text).toContain('takePictureAsync');
    expect(camera.text).not.toMatch(/MediaLibrary|ImagePicker/);
  });
});
