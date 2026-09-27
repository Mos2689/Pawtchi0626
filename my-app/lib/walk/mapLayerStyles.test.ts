/**
 * No MapLibre layer style may carry a present-but-undefined value.
 *
 * ── The crash this pins ─────────────────────────────────────────────────────
 *
 * MapLibre converts every key of a layer's `style` into a native BridgeValue.
 * A key that exists but holds `undefined` cannot be converted, and the render
 * throws: "[type - undefined] BridgeValue must be a primitive/array/object".
 *
 * `WalkMap.android.tsx` shipped with
 *
 *     lineDasharray: route.dashed ? [2.2, 1.5] : undefined,
 *
 * on the shared-route layer. Walker one is never dashed, and the memory draws
 * every route solid, so every shared map on Android crashed — Home's Together
 * map, the live walk and the memory. iOS renders with Apple Maps and never runs
 * this file, which is why nothing caught it: the bug is invisible on the
 * platform most of the testing happened on.
 *
 * A conditional style key must be spread in or left out, never set to
 * `undefined`. This scans every Layer's inline style block for the pattern.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['components/walk/WalkMap.android.tsx'];

/** Every `<XxxLayer ... style={{ ... }}` block, as source text. */
function layerStyleBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /<\w*Layer\b[^>]*?style=\{\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    // Walk forward to the matching `}}` so nested arrays and ternaries are kept.
    let depth = 2;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push(source.slice(match.index, i));
  }
  return blocks;
}

describe.each(FILES)('MapLibre layer styles in %s', (file) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const blocks = layerStyleBlocks(source);

  it('finds the layers it is meant to check', () => {
    // If the extraction ever silently matches nothing, every assertion below
    // passes vacuously. There are several line layers in this file.
    expect(blocks.length).toBeGreaterThan(4);
  });

  it('never sets a style key to undefined', () => {
    const offenders = blocks.filter(block =>
      block.split('\n').some(line => !line.trim().startsWith('//') && /\bundefined\b/.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});
