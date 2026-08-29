import {
  HEARTBEAT_MS,
  LiveWalkContent,
  MIN_PUSH_INTERVAL_MS,
  ROUTE_POINT_BUDGET,
  buildLiveWalkContent,
  finalContent,
  shouldPushUpdate,
} from './liveActivity';
import { WALK_STATUS_COPY } from './liveCopy';
import { projectRouteToSvg } from './routeSvg';
import { simplifyRoute } from './geo';
import {
  DEFAULT_SESSION_CONFIG,
  WalkSessionState,
  createSession,
  ingestPoint,
} from './walkSession';

const START = 1_700_000_000_000;

/** A straight-ish walk east from a fixed origin, one fix every 3s at ~1.4 m/s. */
function walkedSession(fixes: number, startedAt = START): WalkSessionState {
  let session = createSession(startedAt);
  for (let i = 0; i < fixes; i++) {
    session = ingestPoint(
      session,
      {
        lat: 51.5 + i * 0.00002,
        lng: -0.12 + i * 0.00006,
        accuracy: 8,
        timestamp: startedAt + i * 3000,
      },
      DEFAULT_SESSION_CONFIG,
    );
  }
  return session;
}

function contentFor(session: WalkSessionState | null): LiveWalkContent {
  return buildLiveWalkContent({ petName: 'Bruno', startedAt: START, session });
}

describe('buildLiveWalkContent', () => {
  it('reports the acquiring state before any fix is accepted', () => {
    const content = contentFor(createSession(START));
    expect(content.state).toBe('acquiring');
    expect(content.statusLine).toBe(WALK_STATUS_COPY.acquiring);
    expect(content.route).toEqual([]);
    expect(content.head).toBeNull();
  });

  it('tolerates a null session (the walk record exists, the replay has not run)', () => {
    const content = contentFor(null);
    expect(content.state).toBe('acquiring');
    expect(content.distanceKm).toBe(0);
    expect(content.sniffCount).toBe(0);
  });

  it('reports walking with a route and a head once fixes land', () => {
    const content = contentFor(walkedSession(40));
    expect(content.state).toBe('walking');
    expect(content.statusLine).toBe(WALK_STATUS_COPY.walking);
    expect(content.route.length).toBeGreaterThan(0);
    expect(content.route.length % 2).toBe(0);
    expect(content.head).not.toBeNull();
  });

  it('keeps every projected coordinate inside the normalized canvas', () => {
    const content = contentFor(walkedSession(120));
    for (const value of content.route) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(content.head![0]).toBeGreaterThanOrEqual(0);
    expect(content.head![0]).toBeLessThanOrEqual(1);
  });

  it('projects with the SAME transform the share card uses', () => {
    // The guarantee that a walk on the Lock Screen and the same walk in its
    // keepsake are one shape, not two that merely resemble each other.
    const session = walkedSession(60);
    const content = contentFor(session);

    const simplified = simplifyRoute(session.path, ROUTE_POINT_BUDGET);
    const svg = projectRouteToSvg(simplified, 1000, 1000, 60);
    const expected = svg.points
      .split(' ')
      .flatMap(pair => pair.split(',').map(n => Math.round((Number(n) / 1000) * 1e4) / 1e4));

    expect(content.route).toEqual(expected);
  });

  it('never exceeds the route point budget', () => {
    const content = contentFor(walkedSession(3600));
    expect(content.route.length / 2).toBeLessThanOrEqual(ROUTE_POINT_BUDGET);
  });

  it('stays an order of magnitude under ActivityKit’s 4KB ContentState budget', () => {
    const bytes = Buffer.byteLength(JSON.stringify(contentFor(walkedSession(3600))), 'utf8');
    expect(bytes).toBeLessThan(4096);
  });

  it('mirrors the walk screen’s sniff-break state, not the 15s episode detector', () => {
    const session = { ...walkedSession(40), status: 'auto_paused' as const };
    const content = contentFor(session);
    expect(content.state).toBe('sniffing');
    expect(content.statusLine).toBe(WALK_STATUS_COPY.sniffing);
  });

  it('counts only closed sniff episodes, so the number never revises downward', () => {
    const session = walkedSession(40);
    const withOpenEpisode: WalkSessionState = {
      ...session,
      sniffAnchor: { lat: 51.5, lng: -0.12 },
      sniffAnchorSince: START + 1000,
      sniffPoints: [{ lat: 51.5, lng: -0.12, dwellS: 22 }],
    };
    expect(contentFor(withOpenEpisode).sniffCount).toBe(1);
  });
});

describe('finalContent', () => {
  it('states what happened and never claims the walk was saved', () => {
    const final = finalContent(contentFor(walkedSession(40)), START + 600_000);
    expect(final.state).toBe('finished');
    expect(final.statusLine).toBe(WALK_STATUS_COPY.finished);
    expect(final.endedAt).toBe(START + 600_000);
    expect(final.statusLine.toLowerCase()).not.toContain('saved');
  });

  it('takes the authoritative distance from the finalized summary when given one', () => {
    const final = finalContent(contentFor(walkedSession(40)), START + 600_000, 2.4149);
    expect(final.distanceKm).toBe(2.4149);
  });

  it('keeps the route so the last frame still shows where the walk went', () => {
    const live = contentFor(walkedSession(40));
    expect(finalContent(live, START + 600_000).route).toEqual(live.route);
  });
});

describe('shouldPushUpdate', () => {
  const base = contentFor(walkedSession(40));

  it('always pushes the first frame', () => {
    expect(shouldPushUpdate(null, base, 0, START)).toBe(true);
  });

  it('pushes a state change immediately, ignoring the interval floor', () => {
    const sniffing: LiveWalkContent = { ...base, state: 'sniffing' };
    expect(shouldPushUpdate(base, sniffing, START, START + 100)).toBe(true);
  });

  it('holds back inside the interval floor', () => {
    const moved: LiveWalkContent = { ...base, distanceKm: base.distanceKm + 0.5 };
    expect(shouldPushUpdate(base, moved, START, START + MIN_PUSH_INTERVAL_MS - 1)).toBe(false);
  });

  it('pushes a new sniff stop', () => {
    const next: LiveWalkContent = { ...base, sniffCount: base.sniffCount + 1 };
    expect(shouldPushUpdate(base, next, START, START + MIN_PUSH_INTERVAL_MS)).toBe(true);
  });

  it('pushes once distance moves by a hundredth of a kilometre', () => {
    const next: LiveWalkContent = { ...base, distanceKm: base.distanceKm + 0.01 };
    expect(shouldPushUpdate(base, next, START, START + MIN_PUSH_INTERVAL_MS)).toBe(true);
  });

  it('ignores a distance change too small for the card to show', () => {
    const next: LiveWalkContent = { ...base, distanceKm: base.distanceKm + 0.002 };
    expect(shouldPushUpdate(base, next, START, START + MIN_PUSH_INTERVAL_MS)).toBe(false);
  });

  it('pushes when the head dot has visibly moved', () => {
    const next: LiveWalkContent = { ...base, head: [base.head![0] + 0.05, base.head![1]] };
    expect(shouldPushUpdate(base, next, START, START + MIN_PUSH_INTERVAL_MS)).toBe(true);
  });

  it('heartbeats so staleDate stays ahead of the clock when GPS goes quiet', () => {
    expect(shouldPushUpdate(base, base, START, START + HEARTBEAT_MS - 1)).toBe(false);
    expect(shouldPushUpdate(base, base, START, START + HEARTBEAT_MS)).toBe(true);
  });
});
