/**
 * .easignore — the file that decides what EAS is even allowed to compile.
 *
 * On 5 Sep 2026 a bare `ios/` was added to it. In gitignore matching — which is
 * what .easignore uses — a pattern with no leading slash matches a directory of
 * that name at ANY depth, so it took out modules/pawtchi-live-activity/ios along
 * with the prebuild output at the root: the podspec and the Swift module behind
 * the walk Live Activity.
 *
 * The build went green. `expo-module.config.json` and `index.ts` were still
 * uploaded, so autolinking found a module declaration with no implementation,
 * `requireOptionalNativeModule` returned null, and every wrapper in that module
 * resolves a missing native module to a harmless `false` on purpose. The Lock
 * Screen card simply stopped existing, in an app that otherwise ran perfectly.
 *
 * That is the failure mode worth a test: not a crash, but a native feature
 * quietly absent from a build nobody had reason to distrust. So this asserts the
 * thing that actually matters — every native source we hand-wrote outside the
 * generated /ios and /android folders survives the upload filter.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');

/**
 * The subset of gitignore syntax .easignore actually uses, implemented here
 * rather than pulled in: the matching rule IS the thing under test, and a
 * transitive dependency is a poor place to keep it.
 */
function toRegExp(pattern: string): RegExp {
  let body = pattern;
  if (body.endsWith('/')) body = body.slice(0, -1);
  // Anchored when the pattern says where it is — a leading slash, or any
  // interior slash. Otherwise it floats and matches at every depth, which is
  // the behaviour that caused the incident.
  const anchored = body.startsWith('/') || body.includes('/');
  if (body.startsWith('/')) body = body.slice(1);

  const escaped = body
    .split('/')
    .map((segment) =>
      segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]'),
    )
    .join('/');

  // `(?:/.*)?$` — a matched directory takes everything under it with it.
  return new RegExp(`${anchored ? '^' : '^(?:.*/)?'}${escaped}(?:/.*)?$`);
}

interface Rule {
  regex: RegExp;
  negated: boolean;
  source: string;
}

function loadRules(): Rule[] {
  return readFileSync(join(ROOT, '.easignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ({
      regex: toRegExp(line.startsWith('!') ? line.slice(1) : line),
      negated: line.startsWith('!'),
      source: line,
    }));
}

/** Last matching rule wins, as git does it. Returns the rule, for the message. */
function matchingRule(rules: Rule[], path: string): Rule | null {
  let hit: Rule | null = null;
  for (const rule of rules) hit = rule.regex.test(path) ? rule : hit;
  return hit && !hit.negated ? hit : null;
}

function filesUnder(dir: string, prefix: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    return statSync(full).isDirectory() ? filesUnder(full, rel) : [rel];
  });
}

describe('.easignore', () => {
  const rules = loadRules();

  /**
   * The matcher has to be able to fail, or the assertions below prove nothing.
   * A regex that never matches would make every other test in this file pass.
   */
  it('excludes what it is meant to exclude', () => {
    expect(matchingRule(rules, 'node_modules/react/index.js')).not.toBeNull();
    expect(matchingRule(rules, 'ios/Podfile')).not.toBeNull();
    expect(matchingRule(rules, 'android/build.gradle')).not.toBeNull();
    expect(matchingRule(rules, 'app/_layout.tsx')).toBeNull();
  });

  /**
   * `/ios` and `/android` are prebuild output and are regenerated on the worker.
   * A nested one is hand-written source — and the only nested one in this repo
   * is the Live Activity's.
   */
  it('does not exclude a nested ios/ or android/ directory', () => {
    expect(matchingRule(rules, 'modules/pawtchi-live-activity/ios/PawtchiLiveActivity.podspec')).toBeNull();
    expect(matchingRule(rules, 'modules/pawtchi-live-activity/ios/PawtchiLiveActivityModule.swift')).toBeNull();
    expect(matchingRule(rules, 'some/native/module/android/build.gradle')).toBeNull();
  });

  /**
   * Everything hand-written that the native build consumes: the local Expo
   * modules, the widget extension targets, and the config plugins. Walked from
   * disk rather than listed, so a file added tomorrow is covered too.
   */
  it.each(['modules', 'targets', 'plugins'])('uploads every file under %s/', (dir) => {
    const files = filesUnder(join(ROOT, dir), dir);
    expect(files.length).toBeGreaterThan(0);

    const excluded = files
      .map((file) => ({ file, rule: matchingRule(rules, file) }))
      .filter((entry) => entry.rule)
      .map((entry) => `${entry.file}  ← matched by "${entry.rule!.source}"`);

    expect(excluded).toEqual([]);
  });
});
