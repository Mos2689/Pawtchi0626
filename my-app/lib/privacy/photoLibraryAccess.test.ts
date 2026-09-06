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

const files = SEARCHED.flatMap((dir) => sourceFiles(join(ROOT, dir), dir)).map((path) => ({
  path,
  text: readFileSync(join(ROOT, path), 'utf8'),
}));

describe('photo library access', () => {
  it('scans a real source tree', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.path.endsWith('components/walk/WalkCamera.tsx'))).toBe(true);
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
   * The shutter must not be what summons a system sheet. Permission is asked
   * for by the control the owner taps to turn the camera-roll copy ON, and used
   * — never requested — at capture time.
   */
  it('does not request photo permission from the capture path', () => {
    const camera = files.find((f) => f.path.endsWith('components/walk/WalkCamera.tsx'));
    expect(camera).toBeDefined();

    const capture = camera!.text.slice(
      camera!.text.indexOf('const handleCapture'),
      camera!.text.indexOf('if (!visible) return null'),
    );
    expect(capture.length).toBeGreaterThan(200);
    expect(capture).not.toMatch(/requestLibraryPermission|requestPermissionsAsync/);
  });
});
