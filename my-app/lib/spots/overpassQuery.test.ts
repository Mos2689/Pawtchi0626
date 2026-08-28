/**
 * The query is the one thing here that touches somebody else's servers, so
 * these tests are mostly about *bounds* — that no code path can emit an
 * unbounded or uncapped query — rather than about exact string shape.
 */

import { CATEGORY_RULES, SPOT_TRAILS_ENABLED, queryableCategories } from './osmTags';
import {
  DEFAULT_OVERPASS_ENDPOINT,
  OVERPASS_ENDPOINTS,
  OVERPASS_MAX_ELEMENTS,
  OVERPASS_TIMEOUT_S,
  buildOverpassQuery,
  isRetriableStatus,
  roundForQuery,
} from './overpassQuery';

describe('buildOverpassQuery', () => {
  const query = buildOverpassQuery(51.5, -0.12, 4800);

  it('always carries a timeout', () => {
    expect(query).toContain(`[out:json][timeout:${OVERPASS_TIMEOUT_S}]`);
  });

  it('caps EVERY category separately, so none can starve another', () => {
    // A single global cap looked equivalent and was not: a live probe of
    // central London filled the whole limit with drinking fountains and
    // silently truncated away every dog park and pet shop.
    const outs = query.split('\n').filter(l => l.startsWith('out center tags'));
    expect(outs.length).toBe(queryableCategories().length);
    for (const rule of CATEGORY_RULES) {
      if (!queryableCategories().includes(rule.category)) continue;
      expect(query).toContain(`out center tags ${rule.limit};`);
    }
  });

  it('never emits a single unbounded out', () => {
    expect(query).not.toMatch(/^out center tags;$/m);
    expect(query).not.toMatch(/^out;$/m);
  });

  it('bounds the total response by the sum of the per-category caps', () => {
    const outs = [...query.matchAll(/out center tags (\d+);/g)].map(m => Number(m[1]));
    expect(outs.reduce((a, b) => a + b, 0)).toBe(OVERPASS_MAX_ELEMENTS);
    // Sanity: still a payload a phone can hold.
    expect(OVERPASS_MAX_ELEMENTS).toBeLessThanOrEqual(200);
  });

  it('gives off-leash parks a bigger budget than drinking water', () => {
    // Budgets are sized by value, not by density. Off-leash parks are what the
    // feature is for; nobody needs the 40th nearest tap.
    const byCat = Object.fromEntries(CATEGORY_RULES.map(r => [r.category, r.limit]));
    expect(byCat.off_leash_park).toBeGreaterThan(byCat.drinking_water);
  });

  it('bounds every clause with an around filter — never an open area query', () => {
    const clauses = query
      .split('\n')
      .filter(l => /^\s+(node|way|relation)/.test(l));
    expect(clauses.length).toBeGreaterThan(0);
    for (const clause of clauses) {
      expect(clause).toContain('(around:4800,51.5,-0.12);');
    }
  });

  it('never emits a bare bbox or global filter', () => {
    expect(query).not.toMatch(/\(\s*-?\d+\s*,\s*-?\d+\s*,/); // bbox form
    expect(query).not.toContain('area');
  });

  it('asks for center so ways and relations get a usable coordinate', () => {
    // normalize.ts depends on this; without it every park would be dropped.
    expect(query).toContain('out center');
  });

  it('requests tags but not full geometry — geometry is most of the payload', () => {
    expect(query).toContain('tags');
    expect(query).not.toContain('out geom');
  });

  it('covers the categories we actually classify', () => {
    expect(query).toContain('["leisure"="dog_park"]');
    expect(query).toContain('["amenity"="veterinary"]');
    expect(query).toContain('["shop"="pet"]');
    expect(query).toContain('["amenity"="drinking_water"]');
    expect(query).toContain('["natural"="beach"]');
    expect(query).toContain('["leisure"="park"]');
  });

  it('omits trails while they are disabled', () => {
    expect(SPOT_TRAILS_ENABLED).toBe(false);
    expect(queryableCategories()).not.toContain('walking_trail');
    expect(query).not.toContain('["route"="hiking"]');
  });

  it('can be narrowed to specific categories', () => {
    const vetsOnly = buildOverpassQuery(51.5, -0.12, 3000, ['veterinary']);
    expect(vetsOnly).toContain('["amenity"="veterinary"]');
    expect(vetsOnly).not.toContain('["leisure"="park"]');
  });

  it('ignores unknown categories rather than widening the query', () => {
    const bogus = buildOverpassQuery(51.5, -0.12, 3000, ['not_a_category' as never]);
    expect(bogus).not.toMatch(/^\s+(node|way|relation)/m);
  });

  it('rounds the radius so a float never reaches the endpoint', () => {
    expect(buildOverpassQuery(51.5, -0.12, 4800.7)).toContain('around:4801,');
  });

  it('is deterministic', () => {
    expect(buildOverpassQuery(51.5, -0.12, 4800)).toBe(query);
  });
});

describe('mirrors', () => {
  it('offers more than one instance', () => {
    // Overpass rate-limits by IP and Edge Functions egress from shared
    // infrastructure, so the main instance can refuse us for reasons that have
    // nothing to do with our own traffic. One endpoint makes that a hard outage.
    expect(OVERPASS_ENDPOINTS.length).toBeGreaterThan(1);
  });

  it('leads with the main instance', () => {
    expect(OVERPASS_ENDPOINTS[0]).toBe(DEFAULT_OVERPASS_ENDPOINT);
  });

  it('lists independent deployments — a refusal from one says nothing about the next', () => {
    const hosts = OVERPASS_ENDPOINTS.map(u => new URL(u).host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('is all https', () => {
    for (const url of OVERPASS_ENDPOINTS) expect(url.startsWith('https://')).toBe(true);
  });
});

describe('isRetriableStatus', () => {
  it('retries the statuses that mean "busy"', () => {
    for (const s of [429, 502, 503, 504]) expect(isRetriableStatus(s)).toBe(true);
  });

  it('does NOT retry a rejected query', () => {
    // A 400 is our query being wrong. Re-asking elsewhere spends someone
    // else's capacity to get the same answer.
    for (const s of [400, 401, 403, 404]) expect(isRetriableStatus(s)).toBe(false);
  });

  it('does not treat success as retriable', () => {
    expect(isRetriableStatus(200)).toBe(false);
  });
});

describe('roundForQuery', () => {
  it('cuts precision to ~11 m before anything leaves the device', () => {
    expect(roundForQuery(51.50371234567)).toBe(51.5037);
    expect(roundForQuery(-0.11951234567)).toBe(-0.1195);
  });

  it('handles negatives and zero without drift', () => {
    expect(roundForQuery(0)).toBe(0);
    expect(roundForQuery(-33.86881234)).toBe(-33.8688);
  });
});
