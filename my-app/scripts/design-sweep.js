/* One-time codemod: migrate Plus Jakarta Sans (never loaded) to Montserrat
 * family files, and normalize stray brand colors. Android ignores fontWeight
 * with custom fonts, so each weight must map to its own family file and the
 * fontWeight key must be removed from that style object.
 *
 * Run: node scripts/design-sweep.js
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['app', 'components', 'providers'];
const WEIGHT_TO_FAMILY = {
  '100': 'Montserrat_400Regular',
  '200': 'Montserrat_400Regular',
  '300': 'Montserrat_400Regular',
  '400': 'Montserrat_400Regular',
  normal: 'Montserrat_400Regular',
  '500': 'Montserrat_500Medium',
  medium: 'Montserrat_500Medium',
  '600': 'Montserrat_600SemiBold',
  '700': 'Montserrat_700Bold',
  bold: 'Montserrat_700Bold',
  '800': 'Montserrat_800ExtraBold',
  '900': 'Montserrat_800ExtraBold',
};

const SIMPLE_REPLACEMENTS = [
  // Stray prebuilt PJS family names
  [/'PlusJakartaSans_800ExtraBold'/g, "'Montserrat_800ExtraBold'"],
  [/'PlusJakartaSans_700Bold'/g, "'Montserrat_700Bold'"],
  [/'PlusJakartaSans-Bold'/g, "'Montserrat_700Bold'"],
  [/'PlusJakartaSans-Medium'/g, "'Montserrat_500Medium'"],
  // One yellow
  [/#FFFC00/gi, '#F7F602'],
  // Text-on-yellow ink: brand navy, not near-black
  [/#1a1a00/gi, '#07202A'],
  // Stray tailwind amber used as accent → data-viz amber
  [/#FBBF24/gi, '#FFC400'],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else if (/\.tsx?$/.test(entry.name)) files.push(p);
  }
  return files;
}

// Find the bounds of the innermost { } object containing position `idx`.
function enclosingObject(src, idx) {
  let start = -1;
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const ch = src[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

function migrateFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // Replace each PJS fontFamily with the weight-appropriate Montserrat family,
  // removing the fontWeight key from the same (innermost) style object.
  const NEEDLE = /fontFamily:\s*'Plus Jakarta Sans'/;
  let guard = 0;
  while (NEEDLE.test(src) && guard++ < 500) {
    const m = src.match(NEEDLE);
    const idx = m.index;
    const obj = enclosingObject(src, idx);
    let family = 'Montserrat_400Regular';
    if (obj) {
      const scope = src.slice(obj.start, obj.end + 1);
      const w = scope.match(/fontWeight:\s*'([\w]+)'/);
      if (w && WEIGHT_TO_FAMILY[w[1]]) family = WEIGHT_TO_FAMILY[w[1]];
      // Remove the fontWeight entry (with trailing comma if present)
      const cleaned = scope.replace(/\s*fontWeight:\s*'[\w]+'\s*,?/, '');
      src = src.slice(0, obj.start) + cleaned + src.slice(obj.end + 1);
    }
    src = src.replace(NEEDLE, `fontFamily: '${family}'`);
  }

  for (const [re, to] of SIMPLE_REPLACEMENTS) {
    src = src.replace(re, to);
  }

  if (src !== before) {
    fs.writeFileSync(file, src);
    return true;
  }
  return false;
}

let changed = 0;
for (const root of ROOTS) {
  const dir = path.join(__dirname, '..', root);
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    if (migrateFile(f)) {
      changed++;
      console.log('updated', path.relative(path.join(__dirname, '..'), f));
    }
  }
}
console.log(`done — ${changed} files updated`);
