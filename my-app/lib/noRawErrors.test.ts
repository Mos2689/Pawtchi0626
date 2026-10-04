/**
 * Guard: no screen may render a raw error message again.
 *
 * On 4 Oct 2026 users saw "Timed out after 12000ms: loadOuting" and
 * "TypeError: Network request failed", because 32 call sites passed
 * `cause.message` straight into the UI. They now go through `describeError`
 * (lib/appError.ts). This test fails the build if the pattern comes back.
 *
 * Need the raw text to match a server code or for analytics? Use
 * `rawErrorMessage(cause)` — the name says it is not for display.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCANNED = ['app', 'components', 'hooks'];
const RAW_MESSAGE = /instanceof Error \? \w+\.message/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('no raw error messages in the UI', () => {
  it('app/, components/ and hooks/ never show `cause.message` directly', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (RAW_MESSAGE.test(line)) offenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
