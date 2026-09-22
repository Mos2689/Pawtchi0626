/**
 * A style rule that only fails on a device, so it is checked here instead.
 *
 * React Native clips a glyph to its line box. CSS does not — it lets the glyph
 * overflow — so a heading copied from a web mockup with `line-height: .94`
 * looks right in a browser and arrives on a phone with the tops sliced off
 * every letter. It is invisible in review, invisible in a typecheck, and
 * invisible in every test that does not actually rasterise text.
 *
 * It has already happened twice in this codebase: both display headings on the
 * Trails screens, reported from a device with "the heading is getting cut at
 * the top". A third instance was sitting unused in the shared type scale
 * (`type.displayLg`, 52px text in a 50px line box) waiting for whoever reached
 * for it next.
 *
 * The rule is simply `lineHeight >= fontSize` wherever a style sets both. That
 * is the boundary where clipping starts; it is not a claim that equal is
 * generous, only that below it is broken. Tall faces with deep descenders still
 * want more room, and this says nothing about those.
 *
 * Same shape as brandYellow.test.ts, and for the same reason: a convention
 * nobody checks is a convention that drifts.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/** Everywhere a React Native style object can be written. */
const SOURCE_ROOTS = ['app', 'components', 'constants', 'hooks', 'lib', 'providers', 'store'];

function sourceFiles(entry: string): string[] {
  const absolute = path.join(ROOT, entry);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) {
    // Tests are excluded, and not as a loophole: no style object ships from a
    // test file, and this file in particular writes deliberately-broken
    // fixtures that the scan would otherwise report as real offences.
    if (/\.test\.tsx?$/.test(absolute)) return [];
    return absolute.endsWith('.ts') || absolute.endsWith('.tsx') ? [absolute] : [];
  }
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(child => {
    if (child.name === 'node_modules' || child.name.startsWith('.')) return [];
    return sourceFiles(path.join(entry, child.name));
  });
}

interface Offence {
  file: string;
  line: number;
  fontSize: number;
  lineHeight: number;
}

/**
 * Innermost braces only. A style object is a flat `{ ... }` with no nesting, so
 * matching non-brace runs keeps `fontSize` and `lineHeight` paired to the same
 * declaration rather than to two different ones in the same StyleSheet.
 */
const STYLE_BLOCK = /\{[^{}]*\}/g;

function offencesIn(file: string): Offence[] {
  const source = fs.readFileSync(file, 'utf8');
  const found: Offence[] = [];
  for (const match of source.matchAll(STYLE_BLOCK)) {
    const block = match[0];
    const size = /\bfontSize:\s*([\d.]+)/.exec(block);
    const height = /\blineHeight:\s*([\d.]+)/.exec(block);
    if (!size || !height) continue;
    const fontSize = Number(size[1]);
    const lineHeight = Number(height[1]);
    if (lineHeight >= fontSize) continue;
    found.push({
      file: path.relative(ROOT, file),
      line: source.slice(0, match.index).split('\n').length,
      fontSize,
      lineHeight,
    });
  }
  return found;
}

describe('text is never clipped by its own line box', () => {
  const files = SOURCE_ROOTS.flatMap(sourceFiles);

  test('the scan actually reaches the source', () => {
    // A guard that silently matches nothing passes forever.
    expect(files.length).toBeGreaterThan(100);
  });

  test('no style sets lineHeight below fontSize', () => {
    const offences = files.flatMap(offencesIn);
    const report = offences
      .map(o => `${o.file}:${o.line} — fontSize ${o.fontSize} in lineHeight ${o.lineHeight}`)
      .join('\n');
    expect(report).toBe('');
  });
});

describe('the rule catches what it is meant to catch', () => {
  test('flags a block where the line box is shorter than the text', () => {
    const file = path.join(ROOT, 'lib', '__clipping_fixture__.tsx');
    fs.writeFileSync(file, 'const s = { a: { fontSize: 42, lineHeight: 40 } };\n');
    try {
      expect(offencesIn(file)).toHaveLength(1);
    } finally {
      fs.unlinkSync(file);
    }
  });

  test('allows an equal line box, which is the tightest safe setting', () => {
    const file = path.join(ROOT, 'lib', '__clipping_fixture__.tsx');
    fs.writeFileSync(file, 'const s = { a: { fontSize: 40, lineHeight: 40 } };\n');
    try {
      expect(offencesIn(file)).toHaveLength(0);
    } finally {
      fs.unlinkSync(file);
    }
  });

  test('does not pair a fontSize and a lineHeight from different styles', () => {
    const file = path.join(ROOT, 'lib', '__clipping_fixture__.tsx');
    fs.writeFileSync(file, 'const s = { a: { fontSize: 42 }, b: { lineHeight: 18 } };\n');
    try {
      expect(offencesIn(file)).toHaveLength(0);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
