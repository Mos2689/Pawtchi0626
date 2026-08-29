/**
 * The walk Live Activity's ActivityAttributes struct exists twice on disk — once
 * in the widget extension's folder, once in the app module's pod. That is forced
 * by the toolchain: they are separate binaries, and CocoaPods silently drops
 * `source_files` that point outside the podspec's directory, so one file cannot
 * serve both.
 *
 * This test is the thing that makes the duplication safe. ActivityKit encodes
 * ContentState in the app process and decodes it in the widget process, so a
 * field renamed on one side and not the other does not fail to compile — it
 * produces a Lock Screen card that quietly stops updating mid-walk. A silent
 * failure needs a loud guard, and `npm test` already runs on every change.
 */

import fs from 'fs';
import path from 'path';
import { buildLiveWalkContent } from './liveActivity';

const ROOT = path.resolve(__dirname, '..', '..');

const WIDGET_COPY = path.join(ROOT, 'targets', 'walk-activity', 'WalkActivityAttributes.swift');
const MODULE_COPY = path.join(
  ROOT,
  'modules',
  'pawtchi-live-activity',
  'ios',
  'WalkActivityAttributes.swift',
);

describe('WalkActivityAttributes.swift', () => {
  it('exists in both the widget target and the app module', () => {
    expect(fs.existsSync(WIDGET_COPY)).toBe(true);
    expect(fs.existsSync(MODULE_COPY)).toBe(true);
  });

  it('is byte-identical in both places', () => {
    // Compared as text so a failure prints a readable diff rather than
    // "Buffer !== Buffer". Line endings are normalized because git may check
    // these out with CRLF on Windows, which Swift does not care about.
    const widget = fs.readFileSync(WIDGET_COPY, 'utf8').replace(/\r\n/g, '\n');
    const module = fs.readFileSync(MODULE_COPY, 'utf8').replace(/\r\n/g, '\n');
    expect(module).toBe(widget);
  });

  it('still declares the type both targets compile against', () => {
    const source = fs.readFileSync(WIDGET_COPY, 'utf8');
    expect(source).toContain('public struct PawtchiWalkAttributes: ActivityAttributes');
    expect(source).toContain('public struct ContentState');
  });

  it('declares every field the TypeScript payload actually sends', () => {
    // Derived from a real payload rather than a hand-copied list, so adding a
    // field to LiveWalkContent automatically requires adding it in Swift. A
    // field the payload sends but the struct does not declare is dropped
    // silently at decode time — it does not fail to compile.
    const payload = buildLiveWalkContent({
      petName: 'Momo',
      startedAt: Date.now(),
      session: null,
    });

    const source = fs.readFileSync(WIDGET_COPY, 'utf8');
    for (const field of Object.keys(payload)) {
      // `startedAt` rides on the attributes (immutable for the walk) and
      // `staleAfterMs` never reaches ContentState — it becomes the update's
      // staleDate in the native module.
      if (field === 'staleAfterMs') continue;
      expect(source).toContain(`var ${field}`);
    }

    // The attributes half: identity, fixed for the life of the walk.
    for (const field of ['walkId', 'petName', 'startedAt']) {
      expect(source).toContain(`public var ${field}`);
    }
  });
});
