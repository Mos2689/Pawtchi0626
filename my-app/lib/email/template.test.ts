import {
  renderEmailHtml,
  renderEmailText,
  type EmailBlock,
  type PhotoIntent,
  type TemplateInput,
} from './template';
import {
  healthInsightBlocks,
  replyFallbackBlocks,
  walkReportBlocks,
  milestoneBlocks,
  reactivationBlocks,
  weeklySummaryBlocks,
} from './compositions';

const photos: Record<PhotoIntent, string> = {
  pet: 'https://pawtchi.com/email/default-together.jpg',
  mood: 'https://pawtchi.com/email/default-together.jpg',
};

function render(blocks: EmailBlock[], extra: Partial<TemplateInput> = {}): string {
  return renderEmailHtml({
    preheader: 'preheader',
    kicker: 'Kicker',
    unsubscribeUrl: 'https://pawtchi.com/u/tok',
    unsubscribeLabel: 'these emails',
    baseUrl: 'https://pawtchi.com',
    blocks,
    photos,
    ...extra,
  });
}

describe('email client constraints', () => {
  const html = render(weeklySummaryBlocks({
    petName: 'Bella', walks: 7, walksDelta: 2, distanceKm: 18.4,
    distanceDeltaPct: 23, totalMinutes: 165, hasOwnPhoto: true, insight: 'A line.',
  }));

  // Gmail strips SVG on every platform, so a diagram that ships as SVG simply
  // vanishes. Anything drawn has to be a hosted raster or built from cells.
  test('contains no SVG', () => {
    expect(html).not.toMatch(/<svg/i);
  });

  // Outlook renders through Word, which supports neither.
  test('uses no flexbox or grid', () => {
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/display:\s*grid/i);
  });

  // Gmail clips past ~102 KB and hides everything after — including the
  // unsubscribe link, which is a compliance problem and not just a visual one.
  test('stays well under the Gmail clipping threshold', () => {
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(60_000);
  });

  test('every image carries alt text', () => {
    const imgs = html.match(/<img[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img).toMatch(/\salt="/);
  });

  // A relative href has no origin to resolve against inside a mail client.
  test('every link is absolute', () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toMatch(/^https?:\/\//);
  });

  test('the webfont is hidden from Outlook', () => {
    expect(html).toContain('<!--[if !mso]><!-->');
    expect(html).toMatch(/fonts\.googleapis\.com[^]*?<!--<!\[endif\]-->/);
  });

  // Georgia is the design face, not a fallback — its old-style figures are what
  // make the numerals read as editorial.
  test('display type is the Georgia stack', () => {
    expect(html).toMatch(/font-family:Georgia,'Times New Roman',Times,serif;font-size:38px/);
  });
});

describe('graceful degradation', () => {
  const rows = [
    { label: 'Activity', value: '8.2 / 10', pct: 82, icon: 'activity' as const },
    { label: 'Weight', value: 'Needs a reading', pct: 30, icon: 'weight' as const },
  ];

  test('icons vanish when no iconBase is configured', () => {
    const html = render(healthInsightBlocks({
      petName: 'Bella', headline: 'Good.', rows, tip: null,
    }));
    expect(html).not.toContain('<img src="undefined');
    expect(html).not.toMatch(/alt=""/);
  });

  test('icons appear when it is', () => {
    const html = render(
      healthInsightBlocks({ petName: 'Bella', headline: 'Good.', rows, tip: null }),
      { iconBase: 'https://pawtchi.com/email/icons' },
    );
    expect(html).toContain('https://pawtchi.com/email/icons/activity.png');
    // Decorative: the label beside it already carries the meaning.
    expect(html).toContain('alt=""');
  });

  test('a transactional email has no unsubscribe link', () => {
    const html = render([{ kind: 'text', text: 'A reply.' }], { unsubscribeUrl: null });
    expect(html).not.toContain('Stop these emails');
    expect(html).toContain('Hey Living Club');
  });
});

// The composition layer's one job beyond ordering: never render a slot whose
// data is absent. The retired digest shipped a hardcoded "Good" to every owner
// for four months, and a confident chart is a worse lie than a plain sentence.
describe('missing data is dropped, never filled', () => {
  test('a week with no insight renders no quote', () => {
    const blocks = weeklySummaryBlocks({
      petName: 'Bella', walks: 3, walksDelta: null, distanceKm: 5,
      distanceDeltaPct: null, totalMinutes: 40, hasOwnPhoto: false, insight: null,
    });
    expect(blocks.some((b) => b.kind === 'quote')).toBe(false);
  });

  test('deltas are omitted rather than shown as a decline', () => {
    const blocks = weeklySummaryBlocks({
      petName: 'Bella', walks: 3, walksDelta: -2, distanceKm: 5,
      distanceDeltaPct: -18, totalMinutes: 40, hasOwnPhoto: true, insight: null,
    });
    const stats = blocks.find((b) => b.kind === 'photoStats');
    const deltas = stats && stats.kind === 'photoStats' ? stats.stats.map((s) => s.delta) : [];
    expect(deltas.every((d) => d === undefined)).toBe(true);
  });

  test('a milestone with no computed facts still renders', () => {
    const blocks = milestoneBlocks({
      petName: 'Bella', count: 10, totalKm: null, distinctStreets: null, hasOwnPhoto: false,
    });
    expect(blocks.some((b) => b.kind === 'bignum')).toBe(true);
    expect(blocks.some((b) => b.kind === 'text')).toBe(false);
  });

  test('a health card with two signals renders two rows, not four', () => {
    const blocks = healthInsightBlocks({
      petName: 'Bella', headline: 'Good.',
      rows: [{ label: 'Activity', value: '8 / 10', pct: 80 }], tip: null,
    });
    const bars = blocks.find((b) => b.kind === 'bars');
    expect(bars && bars.kind === 'bars' ? bars.rows.length : 0).toBe(1);
  });

  test('no composition mentions rest or sleep, which Pawtchi does not track', () => {
    const all = [
      ...weeklySummaryBlocks({ petName: 'B', walks: 1, walksDelta: null, distanceKm: 1,
        distanceDeltaPct: null, totalMinutes: 10, hasOwnPhoto: true, insight: null }),
      ...milestoneBlocks({ petName: 'B', count: 10, totalKm: 1, distinctStreets: 2, hasOwnPhoto: true }),
      ...reactivationBlocks({ petName: 'B', daysQuiet: 16 }),
    ];
    expect(JSON.stringify(all).toLowerCase()).not.toMatch(/\b(rest|sleep)\b/);
  });
});

// Alt text is read by anyone with images blocked, which is a large share of
// first opens. Telling them a stock photo is their dog is a lie aimed precisely
// at the people who cannot check.
describe('photo honesty', () => {
  test('alt text does not name the pet when the photo is a default', () => {
    const blocks = weeklySummaryBlocks({
      petName: 'Bella', walks: 3, walksDelta: null, distanceKm: 5,
      distanceDeltaPct: null, totalMinutes: 40, hasOwnPhoto: false, insight: null,
    });
    const stats = blocks.find((b) => b.kind === 'photoStats');
    const alt = stats && stats.kind === 'photoStats' ? stats.photo.alt : '';
    expect(alt).not.toContain('Bella');
  });

  test('alt text names the pet when the photo is theirs', () => {
    const blocks = weeklySummaryBlocks({
      petName: 'Bella', walks: 3, walksDelta: null, distanceKm: 5,
      distanceDeltaPct: null, totalMinutes: 40, hasOwnPhoto: true, insight: null,
    });
    const stats = blocks.find((b) => b.kind === 'photoStats');
    const alt = stats && stats.kind === 'photoStats' ? stats.photo.alt : '';
    expect(alt).toContain('Bella');
  });

  // Reactivation is the one composition with no data to report, so it leans
  // hardest on imagery — and therefore must never imply the photo is theirs.
  test('reactivation asks for mood imagery, never the pet slot', () => {
    const blocks = reactivationBlocks({ petName: 'Bella', daysQuiet: 16 });
    const overlay = blocks.find((b) => b.kind === 'photoOverlay');
    expect(overlay && overlay.kind === 'photoOverlay' ? overlay.intent : null).toBe('mood');
  });
});

// The hero photo is frequently the owner's own upload, so its aspect ratio is
// not ours to assume. Unconstrained, a portrait shot rendered 833px tall at
// 536px wide and took the milestone email to 1314px — the photo became the
// whole email. Capped, portrait and landscape both land at 340px.
describe('owner photos cannot blow out the layout', () => {
  test('the full-bleed photo block caps its height', () => {
    const html = render([{ kind: 'photo', intent: 'pet', alt: 'A dog' }]);
    expect(html).toContain('max-height:340px');
    expect(html).toContain('object-fit:cover');
  });

  // The stat composition bounds aspect a different way — a fixed column width —
  // so it must not also carry a cap that would fight it.
  test('the stat photo is bounded by its column instead', () => {
    const html = render(
      weeklySummaryBlocks({
        petName: 'B', walks: 1, walksDelta: null, distanceKm: 1,
        distanceDeltaPct: null, totalMinutes: 10, hasOwnPhoto: true, insight: null,
      }),
    );
    expect(html).toContain('max-width:232px');
  });
});

describe('walk report', () => {
  const base = {
    petName: 'Bella', petIsMale: false, monthLabel: 'July',
    walkCount: 17, totalKm: 23.4, longestKm: 4.2,
    sniffStops: 61, favouritePlace: 'Enmore Park', hasOwnPhoto: true,
  };

  // sniff_points exists on 7 walks in the entire database, so this is the
  // normal case, not the edge case.
  test('drops the sniff line when there is no sniff data', () => {
    const blocks = walkReportBlocks({ ...base, sniffStops: null });
    expect(JSON.stringify(blocks)).not.toContain('sniff');
    const stats = blocks.find((b) => b.kind === 'photoStats');
    const labels = stats && stats.kind === 'photoStats' ? stats.stats.map((s) => s.label) : [];
    expect(labels).not.toContain('Sniff stops');
  });

  test('drops the route line when no place recurred', () => {
    const blocks = walkReportBlocks({ ...base, favouritePlace: null });
    expect(JSON.stringify(blocks)).not.toContain('One route came up');
  });

  // The place name is the payoff and the reason to open the app. Printing it
  // here spends it, exactly as it would in a push.
  test('never names the favourite place', () => {
    const blocks = walkReportBlocks(base);
    expect(JSON.stringify(blocks)).not.toContain('Enmore');
  });

  test('a report with only walks and distance still renders', () => {
    const blocks = walkReportBlocks({
      ...base, longestKm: null, sniffStops: null, favouritePlace: null,
    });
    const stats = blocks.find((b) => b.kind === 'photoStats');
    expect(stats && stats.kind === 'photoStats' ? stats.stats.length : 0).toBe(1);
    expect(blocks.some((b) => b.kind === 'cta')).toBe(true);
  });
});

describe('reply fallback', () => {
  // The point is that the answer is in the email. Somebody who wrote in and
  // waited should not have to open an app to find out what was said.
  test('carries the reply body itself', () => {
    const blocks = replyFallbackBlocks({
      kind: 'founder', body: 'We read it twice. Thank you.', entityId: 'abc',
    });
    expect(JSON.stringify(blocks)).toContain('We read it twice');
  });

  // The two senders must sound like different people — that separation is what
  // keeps the letter feeling personal. Neither prints a founder's name any
  // more; the letter is unsigned in the app and stays unsigned here too.
  test('the letter and support voices stay distinct', () => {
    const letter = JSON.stringify(replyFallbackBlocks({ kind: 'founder', body: 'x', entityId: 'a' }));
    const support = JSON.stringify(replyFallbackBlocks({ kind: 'support', body: 'x', entityId: 'a' }));
    expect(letter).not.toContain('Pra');
    expect(letter).not.toContain('Mos');
    expect(letter).not.toContain('Pawtchi team');
    expect(support).not.toContain('Pra');
    expect(support).toContain('Pawtchi team');
  });

  test('links to the specific thread, never the list', () => {
    const blocks = replyFallbackBlocks({ kind: 'support', body: 'x', entityId: 'tick-9' });
    const cta = blocks.find((b) => b.kind === 'cta');
    expect(cta && cta.kind === 'cta' ? cta.url : '').toBe('/app/support/tick-9');
  });

  test('renders with no unsubscribe link', () => {
    const html = render(
      replyFallbackBlocks({ kind: 'founder', body: 'x', entityId: 'a' }),
      { unsubscribeUrl: null },
    );
    expect(html).not.toContain('unsubscribe.html');
  });
});

describe('formatting', () => {
  test('whole numbers carry no trailing decimal', () => {
    const blocks = weeklySummaryBlocks({
      petName: 'B', walks: 2, walksDelta: null, distanceKm: 12,
      distanceDeltaPct: null, totalMinutes: 120, hasOwnPhoto: true, insight: null,
    });
    const stats = blocks.find((b) => b.kind === 'photoStats');
    const values = stats && stats.kind === 'photoStats' ? stats.stats.map((s) => s.value) : [];
    expect(values).toContain('12');
    expect(values).toContain('2h');
  });

  test('bar widths are clamped into range', () => {
    const html = render([{ kind: 'bars', rows: [
      { label: 'Over', value: 'x', pct: 250 },
      { label: 'Under', value: 'y', pct: -40 },
    ] }]);
    expect(html).toContain('width="100%"');
    expect(html).toContain('width="2%"');
  });
});

// ── The emailed CTA ─────────────────────────────────────────────────────────
//
// The bug: every CTA pointed at https://pawtchi.com/app/<slug>, a path the
// website does not serve, so the tap opened a browser on a blank page. These
// pin both halves of the fix — the link in the message is https and goes to the
// click endpoint, and the custom scheme never appears in the markup, because
// Gmail and Outlook strip it.
describe('CTA links', () => {
  const click = {
    functionsBase: 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1',
    sendId: '3f1c2b6e-9a4d-4c1f-8b2a-7e5d0c9a1b34',
  };

  const blocks = healthInsightBlocks({
    petName: 'Bella',
    headline: 'A steady week.',
    rows: [{ label: 'Walks', value: '4', pct: 60 }],
    tip: null,
  });

  test('point at the click endpoint with a destination key', () => {
    const html = render(blocks, { click });
    expect(html).toContain(
      `href="${click.functionsBase}/engagement-click?s=${click.sendId}&amp;t=health"`,
    );
  });

  test('never contain the custom scheme', () => {
    const html = render(blocks, { click });
    expect(html).not.toContain('pawtchi://');
  });

  test('the plain-text part carries the same URL', () => {
    const text = renderEmailText({
      preheader: 'p', kicker: 'K', unsubscribeUrl: null, unsubscribeLabel: '',
      baseUrl: 'https://pawtchi.com', blocks, photos, click,
    });
    expect(text).toContain(`${click.functionsBase}/engagement-click?s=${click.sendId}&t=health`);
    expect(text).not.toContain('pawtchi.com/app/');
    expect(text).not.toContain('pawtchi://');
  });

  test('carry the resource id when the destination needs one', () => {
    const html = render(
      replyFallbackBlocks({ kind: 'support', body: 'x', entityId: 'tick-9' }),
      { click },
    );
    expect(html).toContain('t=support&amp;r=tick-9');
  });

  // Without a ledger row to attribute to — the preview server, these tests —
  // the CTA stays an ordinary website link rather than a click URL naming a
  // send that does not exist.
  test('fall back to the website when no send is being attributed', () => {
    expect(render(blocks)).toContain('href="https://pawtchi.com/app/health"');
  });
});
