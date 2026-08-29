import {
  HEARTBEAT_MS,
  LiveWalkContent,
  MIN_PUSH_INTERVAL_MS,
  ROUTE_POINT_BUDGET,
  SIGNAL_LOST_MS,
  buildLiveWalkContent,
  finalContent,
  shouldPushUpdate,
} from './liveActivity';
import {
  ENDS_AT_HOME,
  LIVE_EYEBROW,
  SEE_THE_MAP,
  WALK_STATUS_COPY,
  WAITING_FOR_SIGNAL,
} from './liveCopy';
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

/** `now` defaults to just after the last fix, so nothing looks stale. */
function contentFor(session: WalkSessionState | null, now?: number): LiveWalkContent {
  const lastFix = session?.lastAccepted?.timestamp ?? START;
  return buildLiveWalkContent({
    petName: 'Momo',
    startedAt: START,
    session,
    now: now ?? lastFix + 1000,
  });
}

describe('buildLiveWalkContent', () => {
  it('shows the starting card before any fix is accepted', () => {
    const content = contentFor(createSession(START));
    expect(content.state).toBe('starting');
    expect(content.eyebrow).toBe(LIVE_EYEBROW.starting);
    expect(content.title).toBe("Momo's walk");
    expect(content.subtitle).toBe(WALK_STATUS_COPY.acquiring);
    expect(content.route).toEqual([]);
    expect(content.head).toBeNull();
    // No geofence promise until there is a walk with a shape.
    expect(content.endsAtHomeLabel).toBe('');
  });

  it('tolerates a null session (the walk record exists, the replay has not run)', () => {
    const content = contentFor(null);
    expect(content.state).toBe('starting');
    expect(content.distanceKm).toBe(0);
    expect(content.sniffCount).toBe(0);
  });

  it('shows the dog’s name and the geofence pill once fixes land', () => {
    const content = contentFor(walkedSession(40));
    expect(content.state).toBe('walking');
    expect(content.eyebrow).toBe(LIVE_EYEBROW.walking);
    expect(content.title).toBe('Momo');
    // The timer owns that space while walking.
    expect(content.subtitle).toBe('');
    expect(content.endsAtHomeLabel).toBe(ENDS_AT_HOME);
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
    expect(content.eyebrow).toBe(LIVE_EYEBROW.sniffing);
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

  describe('lost signal', () => {
    it('stays quiet while fixes are arriving', () => {
      expect(contentFor(walkedSession(40)).signalLostLabel).toBe('');
    });

    it('admits it once the last fix is minutes old', () => {
      const session = walkedSession(40);
      const stale = session.lastAccepted!.timestamp + SIGNAL_LOST_MS;
      expect(contentFor(session, stale).signalLostLabel).toBe(WAITING_FOR_SIGNAL);
    });

    it('never fires on the starting card, which has no fix to go stale', () => {
      const content = contentFor(createSession(START), START + 10 * SIGNAL_LOST_MS);
      expect(content.signalLostLabel).toBe('');
    });
  });
});

describe('finalContent', () => {
  const live = contentFor(walkedSession(40));

  const wrapUp = (saved: boolean, durationMs = 18 * 60_000) =>
    finalContent({
      previous: live,
      endedAt: START + durationMs,
      distanceKm: 1.4,
      sniffCount: 6,
      durationMs,
      saved,
      walkSessionId: 'walk-123',
    });

  it('reads as a memory: minutes together, then the numbers', () => {
    const final = wrapUp(true);
    expect(final.state).toBe('finished');
    expect(final.title).toBe('18 min together');
    expect(final.subtitle).toBe('1.4 km · 6 sniffs');
  });

  it('claims SAVED only when the walk actually reached the server', () => {
    expect(wrapUp(true).eyebrow).toBe('HOME · WALK SAVED');
    expect(wrapUp(false).eyebrow).toBe('HOME · WALK FINISHED');
  });

  it('offers the map only when there is a saved walk behind it', () => {
    expect(wrapUp(true).ctaLabel).toBe(SEE_THE_MAP);
    expect(wrapUp(true).ctaUrl).toBe('pawtchi://walk-story?id=walk-123');
    // A queued walk has no row to open — a CTA to an empty screen is worse
    // than no CTA.
    expect(wrapUp(false).ctaUrl).toBe('');
  });

  it('uses the summary’s duration, not wall-clock, so an auto-stop is not padded', () => {
    // Stillness auto-stop rewinds past the ten-minute confirmation wait; the
    // card must show the walk, not the wait.
    const final = finalContent({
      previous: live,
      endedAt: START + 28 * 60_000,
      durationMs: 18 * 60_000,
      saved: true,
      walkSessionId: 'walk-123',
    });
    expect(final.title).toBe('18 min together');
  });

  it('falls back to the live numbers when no summary was handed over', () => {
    const final = finalContent({
      previous: live,
      endedAt: START + 60_000,
      saved: false,
      walkSessionId: 'walk-123',
    });
    expect(final.distanceKm).toBe(live.distanceKm);
    expect(final.sniffCount).toBe(live.sniffCount);
  });

  it('keeps the route so the last frame still shows where the walk went', () => {
    expect(wrapUp(true).route).toEqual(live.route);
  });

  it('drops the geofence pill — the walk is already home', () => {
    expect(wrapUp(true).endsAtHomeLabel).toBe('');
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

  it('pushes a signal change immediately — it is the one thing to act on', () => {
    const lost: LiveWalkContent = { ...base, signalLostLabel: WAITING_FOR_SIGNAL };
    expect(shouldPushUpdate(base, lost, START, START + 100)).toBe(true);
    expect(shouldPushUpdate(lost, base, START, START + 100)).toBe(true);
  });

  it('holds back inside the 30s floor the handoff asks for', () => {
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
