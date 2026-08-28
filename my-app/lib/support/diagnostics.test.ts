import { __resetBreadcrumbs, __recordForTest } from './breadcrumbs';
import {
  DIAGNOSTICS_SCHEMA,
  buildDiagnostics,
  describeDiagnostics,
  type DeviceContext,
  type DiagnosticsInput,
} from './diagnostics';

const DEVICE: DeviceContext = {
  app_version: '1.0.7',
  build: '71',
  os: 'ios',
  os_version: '18.2',
  device_model: 'iPhone 15 Pro',
  is_device: true,
  locale: 'en-AU',
  timezone: 'Australia/Sydney',
};

function input(over: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    device: DEVICE,
    topic: 'bug',
    area: 'meals',
    entrySource: 'error_state',
    breadcrumbs: [],
    now: Date.parse('2026-08-08T04:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  __resetBreadcrumbs();
});

describe('buildDiagnostics', () => {
  test('is deterministic given now and breadcrumbs', () => {
    expect(buildDiagnostics(input())).toEqual(buildDiagnostics(input()));
  });

  test('stamps the schema so old rows stay readable as new fields arrive', () => {
    expect(buildDiagnostics(input()).schema).toBe(DIAGNOSTICS_SCHEMA);
    expect(buildDiagnostics(input()).submitted_at).toBe('2026-08-08T04:00:00.000Z');
  });

  test('carries the failure through so the owner need not describe it', () => {
    const d = buildDiagnostics(input({ errorKind: 'timeout', errorContext: 'food_scan' }));

    expect(d.error_kind).toBe('timeout');
    expect(d.error_context).toBe('food_scan');
  });

  test('normalises blank strings to null rather than shipping empties', () => {
    const d = buildDiagnostics(
      input({
        screen: '   ',
        petId: '',
        device: { ...DEVICE, device_model: '  ', build: null },
      }),
    );

    expect(d.screen).toBeNull();
    expect(d.pet_id).toBeNull();
    expect(d.device_model).toBeNull();
    expect(d.build).toBeNull();
  });

  test('keeps false as false — a simulator report must not read as unknown', () => {
    const d = buildDiagnostics(
      input({ isPro: false, device: { ...DEVICE, is_device: false } }),
    );

    expect(d.is_device).toBe(false);
    expect(d.is_pro).toBe(false);
  });

  test('falls back to the live breadcrumb buffer when none is injected', () => {
    __recordForTest('walk_completed');
    __recordForTest('app_error', { kind: 'server' });

    const d = buildDiagnostics({ ...input(), breadcrumbs: undefined });

    expect(d.breadcrumbs.map((c) => c.e)).toEqual(['walk_completed', 'app_error:server']);
  });

  test('never carries anything the owner logged, or any location', () => {
    __recordForTest('walk_completed', { distance_km: 4.1, lat: -33.86, lng: 151.2 });

    const serialised = JSON.stringify(
      buildDiagnostics({ ...input(), breadcrumbs: undefined, petId: 'pet-1' }),
    );

    for (const leak of ['lat', 'lng', '-33.86', '151.2', 'distance_km', '4.1']) {
      expect(serialised).not.toContain(leak);
    }
  });

  test('records the pet id but never the pet name', () => {
    const d = buildDiagnostics(input({ petId: 'pet-123', species: 'dog' }));

    expect(d.pet_id).toBe('pet-123');
    expect(Object.keys(d)).not.toContain('pet_name');
  });
});

describe('describeDiagnostics', () => {
  test('describes what is actually in the object it is given', () => {
    const lines = describeDiagnostics(
      buildDiagnostics(input({ screen: '/(tabs)/meal', errorKind: 'timeout' })),
    );

    expect(lines).toContain('Pawtchi 1.0.7 (71)');
    expect(lines).toContain('iPhone 15 Pro · ios 18.2');
    expect(lines).toContain('Screen: /(tabs)/meal');
    // Underscores are an implementation detail; owners read words.
    expect(lines.some((l) => l.includes('time out') || l.includes('timeout'))).toBe(true);
  });

  test('omits lines for absent fields rather than printing blanks', () => {
    const bare = buildDiagnostics(
      input({
        device: {
          app_version: null, build: null, os: null, os_version: null,
          device_model: null, is_device: null, locale: null, timezone: null,
        },
      }),
    );

    expect(describeDiagnostics(bare)).toEqual([]);
  });

  test('counts breadcrumbs without naming them', () => {
    __recordForTest('walk_completed');
    __recordForTest('moment_card_viewed');

    const lines = describeDiagnostics(buildDiagnostics({ ...input(), breadcrumbs: undefined }));

    expect(lines).toContain('The last 2 things the app did, by name');
    expect(lines.join(' ')).not.toContain('walk_completed');
  });
});
