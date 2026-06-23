/* One-time codemod: replace hardcoded hex colors in screens with design
 * tokens from constants/design.ts. Dark fills map to the navy brand surface,
 * gray borders map to the hairline token, and the slate/gray family snaps to
 * the nearest text/surface token. Semantic soft tints (amber banners, soft
 * reds/greens) are left alone — they have no token equivalents yet.
 *
 * Run: node scripts/token-sweep.js
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  'app/(tabs)/index.tsx',
  'app/(tabs)/activity.tsx',
  'app/(tabs)/health.tsx',
  'app/(tabs)/meal.tsx',
  'app/owner.tsx',
  'app/privacy.tsx',
  'app/achievements.tsx',
  'app/community/best-mates.tsx',
  'app/health/index.tsx',
];

// Context-sensitive first: near-black fills are navy brand surfaces (not ink),
// and the gray border family is always the hairline recipe.
const CONTEXTUAL = [
  [/backgroundColor:\s*'#(041015|000407|1e293b)'/gi, 'backgroundColor: color.navy'],
  [/borderColor:\s*'#(f1f5f9|e5e7eb|e2e8f0)'/gi, 'borderColor: color.hairline'],
];

// [hex (no #, lowercase), replacement expression]
const MAP = [
  ['ffffff', 'color.surface'],
  ['fff', 'color.surface'],
  ['f7f602', 'color.yellow'],
  ['ebea00', 'color.yellow'],
  ['07202a', 'color.navy'],
  ['f4f1ec', 'color.cream'],
  ['1e293b', 'color.navyRaised'],
  // Ink family — near-black text/icons
  ['0f172a', 'color.ink'],
  ['1a1a1a', 'color.ink'],
  ['2e2f2d', 'color.ink'],
  ['000000', 'color.ink'],
  ['000407', 'color.ink'],
  ['041015', 'color.ink'],
  ['243036', 'color.ink'],
  // Slate text scale
  ['475569', 'color.slate'],
  ['42474b', 'color.slate'],
  ['334155', 'color.slate'],
  ['515d64', 'color.slate'],
  ['64748b', 'color.slateMuted'],
  ['6b7280', 'color.slateMuted'],
  ['94a3b8', 'color.slateFaint'],
  ['9ca3af', 'color.slateFaint'],
  ['cbd5e1', 'color.slateFaint'],
  ['a1a1aa', 'color.slateFaint'],
  ['a3a3a3', 'color.slateFaint'],
  ['d1d5db', 'color.slateFaint'],
  // Light gray surfaces / tracks
  ['f1f5f9', 'color.track'],
  ['f3f4f6', 'color.track'],
  ['f5f5f5', 'color.track'],
  ['e5eeff', 'color.track'],
  ['eff4ff', 'color.track'],
  ['dee2e6', 'color.track'],
  ['ebebeb', 'color.track'],
  ['cccccc', 'color.track'],
  ['ccc', 'color.track'],
  ['ddd', 'color.track'],
  ['e5e7eb', 'color.hairline'],
  ['e2e8f0', 'color.hairline'],
  ['eef2f6', 'color.hairline'],
  ['f8fafc', 'color.surfaceSubtle'],
  ['f9fafb', 'color.surfaceSubtle'],
  // Semantic — data states only
  ['16a34a', 'color.success'],
  ['15803d', 'color.success'],
  ['22c55e', 'color.success'],
  ['dc2626', 'color.error'],
  ['ef4444', 'color.error'],
  ['b91c1c', 'color.error'],
  ['991b1b', 'color.error'],
  ['7f1d1d', 'color.error'],
  ['d97706', 'color.alert'],
  ['f59e0b', 'color.alert'],
  ['fef2f2', 'color.errorSoft'],
  ['fee2e2', 'color.errorSoft'],
  // Data-viz accents
  ['f97316', 'color.viz.calories'],
  ['ea580c', 'color.viz.calories'],
  ['3091f9', 'color.viz.hydrate'],
  ['60a5fa', 'color.viz.hydrate'],
  ['b2cad7', 'color.viz.hydrate'],
  ['ffc400', 'color.viz.amber'],
  ['fac129', 'color.viz.amber'],
  ['755700', 'color.viz.amber'],
  ['4ade80', 'color.viz.green'],
];

function relImport(file) {
  const depth = file.split('/').length - 1; // segments under app root
  return depth >= 2 ? '../../constants/design' : '../constants/design';
}

function migrateFile(file) {
  const abs = path.join(__dirname, '..', file);
  let src = fs.readFileSync(abs, 'utf8');
  const before = src;

  for (const [re, to] of CONTEXTUAL) {
    src = src.replace(re, to);
  }

  for (const [hex, expr] of MAP) {
    // JSX attribute: color="#0f172a" → color={color.ink}
    src = src.replace(new RegExp(`=\\s*["']#${hex}["']`, 'gi'), `={${expr}}`);
    // String literal in style objects / arrays
    src = src.replace(new RegExp(`["']#${hex}["']`, 'gi'), expr);
  }

  if (src !== before) {
    if (!src.includes('constants/design')) {
      src = src.replace(/^import /m, `import { color, font, radius, shadow, space } from '${relImport(file)}';\nimport `);
    }
    fs.writeFileSync(abs, src);
    return true;
  }
  return false;
}

let changed = 0;
for (const f of FILES) {
  if (migrateFile(f)) {
    changed++;
    console.log('updated', f);
  }
}
console.log(`done — ${changed} files updated`);
