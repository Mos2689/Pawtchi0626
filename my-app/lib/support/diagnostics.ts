// The blob that turns "it broke" into a fixable report.
//
// The premise of the whole support design is that the owner should only have to
// describe what happened. Everything an engineer would otherwise ask for —
// which build, which phone, which screen, what failed just before — the app
// already knows, so the app attaches it.
//
// ── Why this module is pure ─────────────────────────────────────────────────
//
// It reads no Expo module and touches no store. It takes a plain input object
// and returns a plain object, which means the redaction rules below are covered
// by a unit test under ts-jest with no native mocking. The device reads live in
// `deviceContext.ts` and the store reads happen at the call site.
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
//   • Analytics props. See lib/support/breadcrumbs.ts — event names only.
//   • Anything the owner logged: meals, weights, walks, scan results.
//   • Location, of any precision. Walks record routes; support never needs one.
//   • The auth token, the user's email, or any header.
//
// `pet_id` is included and `pet_name` is not. The id lets the team open the
// right row when an owner says "the plan looks wrong"; the name would be
// decoration in an inbox, and the id is already reachable from it.

import { getBreadcrumbs, type Breadcrumb } from './breadcrumbs';
import type { AppErrorKind, ErrorContext } from '../appError';
import type { SupportArea, SupportEntrySource, SupportTopic } from './copy';

/** Device facts, gathered by `deviceContext.ts`. */
export interface DeviceContext {
  app_version: string | null;
  build: string | null;
  os: string | null;
  os_version: string | null;
  device_model: string | null;
  /** False in an emulator/simulator — worth knowing before chasing a report. */
  is_device: boolean | null;
  locale: string | null;
  timezone: string | null;
}

export interface DiagnosticsInput {
  device: DeviceContext;
  topic: SupportTopic;
  area: SupportArea;
  entrySource: SupportEntrySource;
  /** Route the owner came from, e.g. '/(tabs)/meal'. */
  screen?: string | null;
  /** Set when the owner arrived via a failure's "Contact support" action. */
  errorKind?: AppErrorKind | null;
  errorContext?: ErrorContext | null;
  petId?: string | null;
  species?: string | null;
  subscriptionStatus?: string | null;
  isPro?: boolean | null;
  /** Feature identifiers, when the entry route carried one. */
  walkId?: string | null;
  scanId?: string | null;
  /** Injected for tests; defaults to the live buffer. */
  breadcrumbs?: Breadcrumb[];
  /** Injected for tests; defaults to now. */
  now?: number;
}

export interface SupportDiagnostics {
  schema: number;
  submitted_at: string;
  app_version: string | null;
  build: string | null;
  os: string | null;
  os_version: string | null;
  device_model: string | null;
  is_device: boolean | null;
  locale: string | null;
  timezone: string | null;
  screen: string | null;
  topic: SupportTopic;
  area: SupportArea;
  entry_source: SupportEntrySource;
  error_kind: string | null;
  error_context: string | null;
  pet_id: string | null;
  species: string | null;
  subscription_status: string | null;
  is_pro: boolean | null;
  walk_id: string | null;
  scan_id: string | null;
  breadcrumbs: Breadcrumb[];
}

/**
 * Bumped when the shape changes in a way the team's reading of old rows should
 * account for. Stored rows are never migrated — a diagnostics blob is a record
 * of what the client knew at that moment, and rewriting it later would be a
 * lie about a past event.
 */
export const DIAGNOSTICS_SCHEMA = 1;

/** Trim and null out empties, so the blob has no `""` masquerading as a value. */
function clean(v: string | null | undefined, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Shape the blob. Deterministic given its input — pass `now` and `breadcrumbs`
 * to make it fully so.
 */
export function buildDiagnostics(input: DiagnosticsInput): SupportDiagnostics {
  const { device } = input;
  const at = input.now ?? Date.now();

  return {
    schema: DIAGNOSTICS_SCHEMA,
    submitted_at: new Date(at).toISOString(),

    app_version: clean(device.app_version),
    build: clean(device.build),
    os: clean(device.os),
    os_version: clean(device.os_version),
    device_model: clean(device.device_model),
    is_device: typeof device.is_device === 'boolean' ? device.is_device : null,
    locale: clean(device.locale),
    timezone: clean(device.timezone),

    screen: clean(input.screen),
    topic: input.topic,
    area: input.area,
    entry_source: input.entrySource,

    error_kind: clean(input.errorKind, 32),
    error_context: clean(input.errorContext, 32),

    pet_id: clean(input.petId, 64),
    species: clean(input.species, 16),
    subscription_status: clean(input.subscriptionStatus, 32),
    is_pro: typeof input.isPro === 'boolean' ? input.isPro : null,

    walk_id: clean(input.walkId, 64),
    scan_id: clean(input.scanId, 64),

    breadcrumbs: input.breadcrumbs ?? getBreadcrumbs(),
  };
}

/**
 * The plain-language list shown behind "What we send with this".
 *
 * Built from the same object that is actually submitted, so the disclosure
 * cannot drift from reality — which is the only thing that makes showing it
 * worth doing. A disclosure that lists fields we no longer send, or omits ones
 * we added, is worse than no disclosure.
 */
export function describeDiagnostics(d: SupportDiagnostics): string[] {
  const lines: string[] = [];

  const version = [d.app_version, d.build ? `(${d.build})` : null].filter(Boolean).join(' ');
  if (version) lines.push(`Pawtchi ${version}`);

  const device = [d.device_model, d.os && d.os_version ? `${d.os} ${d.os_version}` : d.os]
    .filter(Boolean)
    .join(' · ');
  if (device) lines.push(device);

  if (d.screen) lines.push(`Screen: ${d.screen}`);
  if (d.error_kind) lines.push(`The failure you saw: ${d.error_kind.replace(/_/g, ' ')}`);
  if (d.subscription_status) lines.push(`Subscription: ${d.subscription_status}`);
  if (d.pet_id) lines.push('Your pet’s profile id, so we can find the right record');
  if (d.breadcrumbs.length > 0) {
    lines.push(`The last ${d.breadcrumbs.length} things the app did, by name`);
  }

  return lines;
}
