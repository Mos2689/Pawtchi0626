/**
 * Central failure handling — the client half of the app's error contract.
 *
 * Everything that can fail funnels through here:
 *   toAppError(err)      → classify any thrown thing into a typed AppError
 *   errorCopy(appError)  → the ONLY source of user-facing failure copy
 *   reportError(appError, context) → developer-side logging (PostHog + console)
 *
 * Invariants:
 *  - `technical` is for logs only. No string returned by errorCopy may name
 *    internal technology (models, APIs, JSON, status codes) — enforced by
 *    lib/appError.test.ts.
 *  - Copy follows the brand voice: calm, plainspoken, pet's name where
 *    natural, no exclamation marks, always a next step.
 *  - Kept free of React Native / Expo imports so it runs under jest.
 */

import { track } from './analytics';

export type AppErrorKind =
  | 'offline'
  | 'timeout'
  | 'server'
  | 'ai_unavailable'
  | 'ai_unreadable'
  | 'rate_limited'
  | 'auth'
  | 'validation'
  | 'permission'
  | 'not_found'
  | 'purchase'
  | 'unknown';

export interface AppError {
  kind: AppErrorKind;
  /** Whether an immediate retry is a sensible primary action. */
  retryable: boolean;
  /** Diagnostic detail — log it, never render it. */
  technical: string;
  /** Fine-grained copy key (e.g. a Supabase auth error code). */
  detailKey?: string;
}

const RETRYABLE: Record<AppErrorKind, boolean> = {
  offline: true,
  timeout: true,
  server: true,
  ai_unavailable: true,
  ai_unreadable: false, // retrying the same photo reproduces the failure
  rate_limited: false, // retrying immediately is exactly the wrong move
  auth: false,
  validation: false,
  permission: false,
  not_found: false,
  purchase: true,
  unknown: true,
};

function makeError(kind: AppErrorKind, technical: string, detailKey?: string): AppError {
  return { kind, retryable: RETRYABLE[kind], technical, detailKey };
}

/**
 * Construct a typed AppError directly — for call sites that already know the
 * failure class (e.g. a hand-rolled fetch that saw an empty body).
 */
export function appError(kind: AppErrorKind, technical: string, detailKey?: string): AppError {
  return makeError(kind, technical, detailKey);
}

/** Guard for call sites that throw AppErrors alongside native errors. */
export function isAppError(v: unknown): v is AppError {
  return !!v && typeof v === 'object'
    && typeof (v as AppError).kind === 'string'
    && typeof (v as AppError).technical === 'string'
    && typeof (v as AppError).retryable === 'boolean';
}

// ── Classification ──────────────────────────────────────────────────────────

/** Edge function error_code → AppErrorKind (see _shared/errors.ts). */
const EDGE_CODE_TO_KIND: Record<string, AppErrorKind> = {
  invalid_input: 'validation',
  image_too_large: 'validation',
  unreadable_image: 'ai_unreadable',
  ai_unavailable: 'ai_unavailable',
  rate_limited: 'rate_limited',
  auth_required: 'auth',
  forbidden: 'not_found', // to the owner, "not yours" and "gone" read the same
  not_found: 'not_found',
  server_error: 'server',
};

/**
 * Build an AppError from a 200-status edge body with `success: false`
 * (e.g. scan-vet-report's unreadable result). Null when the body isn't a
 * failure — callers keep their happy path untouched.
 */
export function fromEdgeBody(data: unknown): AppError | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  if (body.success !== false) return null;
  const code = typeof body.error_code === 'string' ? body.error_code : null;
  const kind = (code && EDGE_CODE_TO_KIND[code]) || 'server';
  return makeError(kind, `edge body error_code=${code ?? 'none'}`);
}

/**
 * Pull the error_code out of a FunctionsHttpError (non-2xx invoke result).
 * Async because the response body must be read; safe to call on anything.
 */
export async function extractInvokeErrorCode(err: unknown): Promise<string | null> {
  const context = (err as { context?: { json?: () => Promise<unknown> } })?.context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    const code = (body as Record<string, unknown>)?.error_code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

// Legacy scrub: messages produced by edge functions deployed BEFORE error
// codes existed, or by any path that still stitches internals into a message.
// These must never surface — classify by content, discard the wording.
const LEGACY_AI_PATTERN = /gemini|api error|api key|not configured|parse|json/i;
const OFFLINE_PATTERN = /network request failed|failed to fetch|networkerror|fetch failed|could not connect/i;

/** Map legacy code-less auth error messages onto detail keys. */
function sniffAuthDetail(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'invalid_credentials';
  if (m.includes('already registered') || m.includes('already exists')) return 'user_already_exists';
  if (m.includes('password should be') || m.includes('at least 6')) return 'weak_password';
  if (m.includes('valid email') || m.includes('invalid format') || m.includes('is invalid')) return 'validation_failed';
  if (m.includes('rate limit') || m.includes('too many')) return 'over_email_send_rate_limit';
  return undefined;
}

/**
 * Classify anything thrown into a typed AppError.
 * Pass `opts.errorCode` when you already extracted an edge error_code
 * (extractInvokeErrorCode) — it takes precedence over message sniffing.
 */
export function toAppError(err: unknown, opts?: { errorCode?: string | null }): AppError {
  // 1. Explicit edge error code — the primary, unambiguous path.
  if (opts?.errorCode && EDGE_CODE_TO_KIND[opts.errorCode]) {
    return makeError(EDGE_CODE_TO_KIND[opts.errorCode], `edge error_code=${opts.errorCode}`);
  }

  if (err instanceof Error) {
    const msg = err.message || '';
    const name = err.name || '';

    // 2. Our own withTimeout() rejections.
    if (msg.startsWith('Timed out after')) {
      return makeError('timeout', msg);
    }

    // 3. Connectivity — the reactive offline strategy (no NetInfo dep).
    if (OFFLINE_PATTERN.test(msg) || name === 'FunctionsFetchError') {
      return makeError('offline', `${name}: ${msg}`);
    }

    // 4. Supabase auth errors carry a stable `code` the login screen maps
    //    to precise copy (invalid_credentials, user_already_exists, ...).
    //    Older client versions omit `code` — sniff the message as fallback.
    const authCode = (err as { code?: unknown }).code;
    if (name === 'AuthApiError' || name === 'AuthError' || (err as { __isAuthError?: boolean }).__isAuthError) {
      const detailKey = typeof authCode === 'string' ? authCode : sniffAuthDetail(msg);
      return makeError('auth', `${name} code=${String(authCode ?? 'none')}: ${msg}`, detailKey);
    }

    // 5. Edge invoke failures without a readable code.
    if (name === 'FunctionsHttpError' || name === 'FunctionsRelayError') {
      return makeError('server', `${name}: ${msg}`);
    }

    // 6. Legacy internal messages — never let the wording through.
    if (LEGACY_AI_PATTERN.test(msg)) {
      return makeError('ai_unavailable', `legacy message scrubbed: ${msg}`);
    }

    return makeError('unknown', `${name}: ${msg}`);
  }

  // PostgrestError is a plain object: { message, code, details, hint }.
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && typeof obj.code === 'string') {
      return makeError('server', `postgrest ${obj.code}: ${obj.message}`);
    }
  }

  return makeError('unknown', String(err));
}

// ── User-facing copy ────────────────────────────────────────────────────────

export type RecoveryActionId =
  | 'retry'
  | 'dismiss'
  | 'pick_again'
  | 'go_back'
  | 'open_settings'
  | 'contact_support';

export interface RecoveryAction {
  label: string;
  action: RecoveryActionId;
}

export interface ErrorCopy {
  title: string;
  message: string;
  actions: RecoveryAction[];
}

export type ErrorContext =
  | 'vet_scan'
  | 'food_scan'
  | 'ask_vet'
  | 'pet_save'
  | 'schedule'
  | 'report'
  | 'auth'
  | 'purchase'
  | 'account'
  | 'log'
  | 'render_crash'
  | 'generic';

const retryAction: RecoveryAction = { label: 'Try again', action: 'retry' };
const dismissAction: RecoveryAction = { label: 'Not now', action: 'dismiss' };
const okAction: RecoveryAction = { label: 'OK', action: 'dismiss' };

interface CopyInput {
  petName: string;
}

/** Base copy per kind — context overrides below refine the moments that matter. */
const BASE_COPY: Record<AppErrorKind, (i: CopyInput) => ErrorCopy> = {
  offline: ({ petName }) => ({
    title: 'No connection right now',
    message: `Looks like the internet dropped. ${petName}'s data is safe — try again once you're back online.`,
    actions: [retryAction, dismissAction],
  }),
  timeout: () => ({
    title: 'That took too long',
    message: 'The request didn’t come back in time. It usually works on a second try.',
    actions: [retryAction, dismissAction],
  }),
  server: () => ({
    title: 'Something went wrong on our side',
    message: 'Not you — us. Give it a moment and try again.',
    actions: [retryAction, dismissAction],
  }),
  ai_unavailable: () => ({
    title: 'The analysis couldn’t finish',
    message: 'Pawtchi’s reading service is briefly busy. A retry in a moment usually does it.',
    actions: [retryAction, dismissAction],
  }),
  ai_unreadable: () => ({
    title: 'Couldn’t read that photo',
    message: 'A clearer, well-lit photo usually does it — get the whole thing in frame.',
    actions: [{ label: 'Try another photo', action: 'pick_again' }, dismissAction],
  }),
  rate_limited: () => ({
    title: 'Taking a short breather',
    message: 'That’s a lot of requests in a short time. Give it a little while and try again.',
    actions: [okAction],
  }),
  auth: () => ({
    title: 'Please sign in again',
    message: 'Your session ended. Sign in to pick up where you left off.',
    actions: [okAction],
  }),
  validation: () => ({
    title: 'That didn’t look right',
    message: 'Double-check the details and try again.',
    actions: [okAction],
  }),
  permission: () => ({
    title: 'Permission needed',
    message: 'Pawtchi needs your permission for this. You can switch it on in Settings.',
    actions: [{ label: 'Open Settings', action: 'open_settings' }, dismissAction],
  }),
  not_found: () => ({
    title: 'That’s no longer available',
    message: 'It may have been removed. Head back and try again.',
    actions: [{ label: 'Go back', action: 'go_back' }, dismissAction],
  }),
  purchase: () => ({
    title: 'The purchase didn’t complete',
    message: 'Nothing was charged. Try again, or restore purchases if you’ve subscribed before.',
    actions: [retryAction, dismissAction],
  }),
  unknown: () => ({
    title: 'Something hiccuped',
    message: 'It’s not you. Try again — if it keeps happening, we want to know.',
    actions: [retryAction, { label: 'Contact support', action: 'contact_support' }],
  }),
};

/**
 * Supabase auth error codes → precise, friendly copy for the login screen.
 * Anything unmapped falls back to the generic auth copy.
 */
const AUTH_DETAIL_COPY: Record<string, (i: CopyInput) => ErrorCopy> = {
  invalid_credentials: () => ({
    title: 'That didn’t match',
    message: 'That email and password don’t match. Try again, or reset it below.',
    actions: [okAction],
  }),
  user_already_exists: () => ({
    title: 'You already have an account',
    message: 'That email is registered. Try signing in instead.',
    actions: [okAction],
  }),
  email_exists: () => ({
    title: 'You already have an account',
    message: 'That email is registered. Try signing in instead.',
    actions: [okAction],
  }),
  email_not_confirmed: () => ({
    title: 'One step left',
    message: 'Check your inbox — the confirmation link is waiting.',
    actions: [okAction],
  }),
  weak_password: () => ({
    title: 'That password is a little short',
    message: 'Six characters or more keeps the account safe.',
    actions: [okAction],
  }),
  over_email_send_rate_limit: () => ({
    title: 'Taking a short breather',
    message: 'A few too many emails in a row. Give it a minute and try again.',
    actions: [okAction],
  }),
  validation_failed: () => ({
    title: 'That didn’t look right',
    message: 'Double-check the email address and try again.',
    actions: [okAction],
  }),
};

/**
 * Context overrides — the high-stakes moments get copy written for the flow,
 * not the failure class. Keyed context → kind → copy.
 */
const CONTEXT_COPY: Partial<Record<ErrorContext, Partial<Record<AppErrorKind, (i: CopyInput) => ErrorCopy>>>> = {
  vet_scan: {
    ai_unreadable: () => ({
      title: 'Couldn’t read that report',
      message: 'The photo needs to be a little clearer — good light and the whole page in frame usually does it.',
      actions: [{ label: 'Try another photo', action: 'pick_again' }, dismissAction],
    }),
    ai_unavailable: () => ({
      title: 'The scan couldn’t finish',
      message: 'Nothing was lost — try the scan again in a moment.',
      actions: [retryAction, dismissAction],
    }),
    timeout: () => ({
      title: 'The scan is taking too long',
      message: 'Nothing was lost — try the scan again in a moment.',
      actions: [retryAction, dismissAction],
    }),
  },
  food_scan: {
    ai_unreadable: () => ({
      title: 'Couldn’t make out the food',
      message: 'Get the label or the bowl fully in frame and try again.',
      actions: [{ label: 'Try another photo', action: 'pick_again' }, dismissAction],
    }),
    ai_unavailable: ({ petName }) => ({
      title: 'The scan couldn’t finish',
      message: `${petName}'s meal isn’t lost — try the scan again in a moment.`,
      actions: [retryAction, dismissAction],
    }),
  },
  ask_vet: {
    ai_unavailable: () => ({
      title: 'The answer didn’t come through',
      message: 'Your question wasn’t spent. Ask again in a moment.',
      actions: [retryAction, dismissAction],
    }),
    rate_limited: () => ({
      title: 'Taking a short breather',
      message: 'A few too many questions in a row. Give it a little while and ask again.',
      actions: [okAction],
    }),
  },
  pet_save: {
    server: ({ petName }) => ({
      title: `${petName}'s profile didn’t save`,
      message: 'Everything you entered is still here — try saving again.',
      actions: [retryAction],
    }),
    offline: ({ petName }) => ({
      title: 'No connection right now',
      message: `Everything you entered for ${petName} is still here — try again once you're back online.`,
      actions: [retryAction],
    }),
  },
  schedule: {
    ai_unavailable: ({ petName }) => ({
      title: 'The plan couldn’t be built',
      message: `${petName}'s schedule generator is briefly busy. Try again in a moment.`,
      actions: [retryAction, dismissAction],
    }),
  },
  report: {
    server: () => ({
      title: 'The report didn’t generate',
      message: 'Nothing was lost — try again in a moment.',
      actions: [retryAction, dismissAction],
    }),
  },
};

/** The single source of user-facing failure copy. */
export function errorCopy(
  error: AppError,
  opts?: { context?: ErrorContext; petName?: string | null },
): ErrorCopy {
  const input: CopyInput = { petName: opts?.petName?.trim() || 'Your pet' };

  if (error.kind === 'auth' && error.detailKey && AUTH_DETAIL_COPY[error.detailKey]) {
    return AUTH_DETAIL_COPY[error.detailKey](input);
  }

  const override = opts?.context ? CONTEXT_COPY[opts.context]?.[error.kind] : undefined;
  if (override) return override(input);

  return BASE_COPY[error.kind](input);
}

// ── Developer-side reporting ────────────────────────────────────────────────

/**
 * Log a failure for developers: a typed analytics event (PostHog) carrying
 * the kind/context/technical detail, plus a console.error in dev builds.
 * Call once per user-visible failure, right where it's caught.
 */
export function reportError(error: AppError, context: ErrorContext): void {
  track('app_error', {
    context,
    kind: error.kind,
    retryable: error.retryable,
    detail_key: error.detailKey ?? null,
    technical: error.technical.slice(0, 500),
  });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.error(`[appError] ${context}/${error.kind}: ${error.technical}`);
  }
}

// Exported for the copy-invariant tests.
export const ALL_ERROR_KINDS: AppErrorKind[] = Object.keys(BASE_COPY) as AppErrorKind[];
export const ALL_ERROR_CONTEXTS: ErrorContext[] = [
  'vet_scan', 'food_scan', 'ask_vet', 'pet_save', 'schedule', 'report',
  'auth', 'purchase', 'account', 'log', 'render_crash', 'generic',
];
export const ALL_AUTH_DETAIL_KEYS: string[] = Object.keys(AUTH_DETAIL_COPY);
