import fs from 'fs';
import path from 'path';
import { inflateSync } from 'zlib';

import { BRAND_YELLOW, brandYellowAlpha, color } from '../constants/design';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.jsx', '.json', '.svg', '.ts', '.tsx']);
const RETIRED_BRAND_YELLOW = /#(?:F7F602|FFFF00|FFFC00|FFE14D|FACC15|D9D600|E6E300)\b|rgba\(\s*247\s*,\s*246\s*,\s*2\s*,/i;

const CUSTOMER_FACING_ROOTS = [
  'app',
  'components',
  'constants',
  'lib',
  'providers',
  'store',
  'supabase/email-templates',
  'supabase/functions',
];

function sourceFiles(entry: string): string[] {
  const absolute = path.join(ROOT, entry);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [absolute];

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((child) => {
    const relative = path.join(entry, child.name);
    if (child.isDirectory()) return sourceFiles(relative);
    if (!SOURCE_EXTENSIONS.has(path.extname(child.name))) return [];
    return [path.join(ROOT, relative)];
  });
}

function paeth(a: number, b: number, c: number): number {
  const estimate = a + b - c;
  const distanceA = Math.abs(estimate - a);
  const distanceB = Math.abs(estimate - b);
  const distanceC = Math.abs(estimate - c);
  if (distanceA <= distanceB && distanceA <= distanceC) return a;
  return distanceB <= distanceC ? b : c;
}

function decodedPixels(relativePath: string): { pixels: Buffer; bytesPerPixel: number } {
  const png = fs.readFileSync(path.join(ROOT, relativePath));
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed: Buffer[] = [];
  let offset = 8;

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  expect(bitDepth).toBe(8);
  expect([2, 6]).toContain(colorType);
  const encoded = inflateSync(Buffer.concat(compressed));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const decoded = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y += 1) {
    const encodedRow = y * (rowBytes + 1);
    const filter = encoded[encodedRow];
    expect(filter).toBeLessThanOrEqual(4);
    const row = y * rowBytes;
    const previousRow = row - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = encoded[encodedRow + 1 + x];
      const left = x >= bytesPerPixel ? decoded[row + x - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[previousRow + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel
        ? decoded[previousRow + x - bytesPerPixel]
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : paeth(left, up, upLeft);
      decoded[row + x] = (raw + predictor) & 0xff;
    }
  }

  return { pixels: decoded, bytesPerPixel };
}

describe('Pawtchi brand yellow', () => {
  test('all public brand aliases resolve to the canonical value', () => {
    expect(BRAND_YELLOW).toBe('#F4F600');
    expect(color.yellow).toBe(BRAND_YELLOW);
    expect(color.letter.yellow).toBe(BRAND_YELLOW);
    expect(color.viz.move).toBe(BRAND_YELLOW);
    expect(color.moment.yellow).toBe(BRAND_YELLOW);
    expect(color.moment.yellowOnPhoto).toBe(BRAND_YELLOW);
    expect(color.yellowSoft).toBe('rgba(244, 246, 0, 0.14)');
    expect(brandYellowAlpha(0.3)).toBe('rgba(244, 246, 0, 0.3)');
  });

  test('customer-facing source contains no retired brand-yellow shade', () => {
    const files = [
      path.join(ROOT, 'app.json'),
      path.join(ROOT, 'expo-introspect-check.json'),
      ...CUSTOMER_FACING_ROOTS.flatMap(sourceFiles),
    ];
    const offenders = files
      .filter((file) => path.basename(file) !== 'brandYellow.test.ts')
      .filter((file) => RETIRED_BRAND_YELLOW.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  test('semantic yellow-adjacent colors remain deliberately distinct', () => {
    expect(color.alert).toBe('#d97706');
    expect(color.viz.amber).toBe('#FFC400');
    expect(color.marker.butter).toBe('#FBE2A7');
    expect(color.moment.gold).toBe('#C9A227');
  });

  test.each([
    'assets/images/icon.png',
    'assets/images/splash-icon.png',
    'assets/images/notification-icon.png',
  ])('%s uses the canonical yellow as its dominant yellow pixel', (asset) => {
    const { pixels, bytesPerPixel } = decodedPixels(asset);
    const yellows = new Map<string, number>();
    let retiredPixels = 0;

    for (let index = 0; index < pixels.length; index += bytesPerPixel) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const alpha = bytesPerPixel === 4 ? pixels[index + 3] : 255;
      if (red === 247 && green === 246 && blue === 2 && alpha > 0) retiredPixels += 1;
      if (red > 180 && green > 170 && blue < 100 && alpha > 0) {
        const key = `${red},${green},${blue}`;
        yellows.set(key, (yellows.get(key) ?? 0) + 1);
      }
    }

    const dominant = [...yellows.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(dominant).toBe('244,246,0');
    expect(retiredPixels).toBe(0);
  });
});
