/**
 * Capture-prompt gating, and the live sniff signal it reads.
 *
 * Almost every test here asserts silence. That is the design: the prompt is
 * only valuable while it is rare, and the failure mode of getting this wrong is
 * not a crash — it is a user who learns to dismiss Pawtchi without reading it.
 */

import {
  CAPTURE_PROMPT_COOLDOWN_MS,
  CAPTURE_PROMPT_DWELL_MS,
  CAPTURE_PROMPT_MIN_ELAPSED_MS,
  MAX_CAPTURE_PROMPTS_PER_WALK,
  initialCapturePromptState,
  markCapturePrompted,
  shouldPromptCapture,
  type CapturePromptState,
} from './capturePrompt';
import { createSession, liveSniffState, type LiveSniff } from './walkSession';

const WALK_START = Date.parse('2026-08-20T07:00:00.000Z');
/** Comfortably past the settling-in window. */
const NOW = WALK_START + 10 * 60_000;

function sniff(overrides: Partial<LiveSniff> = {}): LiveSniff {
  return {
    anchor: { lat: 51.5071, lng: -0.1657 },
    since: NOW - CAPTURE_PROMPT_DWELL_MS,
    dwellMs: CAPTURE_PROMPT_DWELL_MS,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof shouldPromptCapture>[0]> = {}) {
  return {
    sniff: sniff(),
    now: NOW,
    walkStartedAt: WALK_START,
    state: initialCapturePromptState,
    ...overrides,
  };
}

describe('liveSniffState', () => {
  it('reports nothing when no episode is open', () => {
    expect(liveSniffState(createSession(WALK_START), NOW)).toBeNull();
  });

  it('reports the open episode with its dwell', () => {
    const live = liveSniffState(
      {
        sniffAnchor: { lat: 51.5071, lng: -0.1657 },
        sniffAnchorSince: NOW - 45_000,
        sniffLastInsideTs: NOW,
      },
      NOW,
    );
    expect(live?.dwellMs).toBe(45_000);
    expect(live?.since).toBe(NOW - 45_000);
  });

  it('stops the clock at the last fix inside the radius, not at now', () => {
    // GPS went quiet, or the dog moved off. Dwell must not keep growing.
    const live = liveSniffState(
      {
        sniffAnchor: { lat: 51.5071, lng: -0.1657 },
        sniffAnchorSince: NOW - 120_000,
        sniffLastInsideTs: NOW - 90_000,
      },
      NOW,
    );
    expect(live?.dwellMs).toBe(30_000);
  });

  it('never reports a negative dwell', () => {
    const live = liveSniffState(
      {
        sniffAnchor: { lat: 51.5071, lng: -0.1657 },
        sniffAnchorSince: NOW,
        sniffLastInsideTs: NOW - 5_000,
      },
      NOW,
    );
    expect(live?.dwellMs).toBe(0);
  });
});

describe('shouldPromptCapture — when it speaks', () => {
  it('offers at a long sniff, mid-walk, having said nothing yet', () => {
    expect(shouldPromptCapture(input())).toBe(true);
  });

  it('fires exactly at the dwell threshold', () => {
    expect(shouldPromptCapture(input({ sniff: sniff({ dwellMs: CAPTURE_PROMPT_DWELL_MS }) }))).toBe(
      true,
    );
  });
});

describe('shouldPromptCapture — when it stays quiet', () => {
  it('says nothing when the dog is walking', () => {
    expect(shouldPromptCapture(input({ sniff: null }))).toBe(false);
  });

  it('ignores a brief investigation', () => {
    // The detector records this one; it is still not worth interrupting for.
    expect(
      shouldPromptCapture(input({ sniff: sniff({ dwellMs: CAPTURE_PROMPT_DWELL_MS - 1 }) })),
    ).toBe(false);
  });

  it('leaves the first minutes of a walk alone', () => {
    const doorstep = WALK_START + CAPTURE_PROMPT_MIN_ELAPSED_MS - 1;
    expect(shouldPromptCapture(input({ now: doorstep }))).toBe(false);
  });

  it('offers only once per investigation, however long it runs', () => {
    const current = sniff({ dwellMs: 5 * 60_000 });
    const state: CapturePromptState = {
      lastPromptedEpisode: current.since,
      lastPromptAt: NOW - 60_000,
      promptCount: 1,
    };
    expect(shouldPromptCapture(input({ sniff: current, state }))).toBe(false);
  });

  it('holds its tongue during the cooldown, even at a new sniff', () => {
    const state: CapturePromptState = {
      lastPromptedEpisode: NOW - 600_000,
      lastPromptAt: NOW - (CAPTURE_PROMPT_COOLDOWN_MS - 1),
      promptCount: 1,
    };
    expect(shouldPromptCapture(input({ state }))).toBe(false);
  });

  it('speaks again once the cooldown has passed', () => {
    const state: CapturePromptState = {
      lastPromptedEpisode: NOW - 600_000,
      lastPromptAt: NOW - CAPTURE_PROMPT_COOLDOWN_MS,
      promptCount: 1,
    };
    expect(shouldPromptCapture(input({ state }))).toBe(true);
  });

  it('stops entirely once the walk has had its share', () => {
    const state: CapturePromptState = {
      lastPromptedEpisode: NOW - 900_000,
      lastPromptAt: NOW - 10 * CAPTURE_PROMPT_COOLDOWN_MS,
      promptCount: MAX_CAPTURE_PROMPTS_PER_WALK,
    };
    expect(shouldPromptCapture(input({ state }))).toBe(false);
  });

  it('respects an explicit disable', () => {
    expect(shouldPromptCapture(input({ enabled: false }))).toBe(false);
  });
});

describe('markCapturePrompted', () => {
  it('records the episode so it is never offered twice', () => {
    const current = sniff();
    const next = markCapturePrompted(initialCapturePromptState, current, NOW);

    expect(next.lastPromptedEpisode).toBe(current.since);
    expect(next.promptCount).toBe(1);
    expect(shouldPromptCapture(input({ sniff: current, state: next }))).toBe(false);
  });

  it('reaches the per-walk cap after the allowed number of prompts', () => {
    let state = initialCapturePromptState;
    for (let i = 0; i < MAX_CAPTURE_PROMPTS_PER_WALK; i++) {
      state = markCapturePrompted(state, sniff({ since: NOW + i }), NOW + i);
    }
    expect(state.promptCount).toBe(MAX_CAPTURE_PROMPTS_PER_WALK);

    const muchLater = NOW + 10 * CAPTURE_PROMPT_COOLDOWN_MS;
    expect(
      shouldPromptCapture(
        input({ sniff: sniff({ since: muchLater - 60_000 }), now: muchLater, state }),
      ),
    ).toBe(false);
  });

  it('does not mutate the state it was given', () => {
    const before = { ...initialCapturePromptState };
    markCapturePrompted(initialCapturePromptState, sniff(), NOW);
    expect(initialCapturePromptState).toEqual(before);
  });
});
