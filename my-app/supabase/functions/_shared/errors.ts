/**
 * Shared error responses for Edge Functions — the server half of the app's
 * failure-handling contract.
 *
 * Rules:
 *  - `error_code` is the machine contract the client maps to friendly copy
 *    (lib/appError.ts). Codes are stable — add new ones, never rename.
 *  - `error` is a safe, generic human string kept ONLY for backward
 *    compatibility with clients shipped before error codes existed. It must
 *    never contain internal details (model names, API errors, stack traces).
 *  - Real diagnostic detail goes to console.error → Supabase function logs,
 *    never into the response body. Use `logInternal` before returning.
 */

export type EdgeErrorCode =
  | 'invalid_input'
  | 'image_too_large'
  | 'unreadable_image'
  | 'ai_unavailable'
  | 'rate_limited'
  | 'auth_required'
  | 'forbidden'
  | 'not_found'
  | 'server_error';

/** Generic back-compat strings — deliberately vague; the client owns copy. */
const FALLBACK_MESSAGE: Record<EdgeErrorCode, string> = {
  invalid_input: 'That request could not be processed.',
  image_too_large: 'That photo is too large to process.',
  unreadable_image: 'That photo could not be read clearly.',
  ai_unavailable: 'The analysis service is briefly unavailable. Please try again.',
  rate_limited: 'Too many requests right now. Please try again shortly.',
  auth_required: 'Please sign in again.',
  forbidden: 'You do not have access to that.',
  not_found: 'That could not be found.',
  server_error: 'Something went wrong on our side. Please try again.',
};

const DEFAULT_STATUS: Record<EdgeErrorCode, number> = {
  invalid_input: 400,
  image_too_large: 400,
  unreadable_image: 422,
  ai_unavailable: 502,
  rate_limited: 429,
  auth_required: 401,
  forbidden: 403,
  not_found: 404,
  server_error: 500,
};

export function errorResponse(
  code: EdgeErrorCode,
  corsHeaders: Record<string, string>,
  opts?: { status?: number; extraHeaders?: Record<string, string>; extraBody?: Record<string, unknown> },
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error_code: code,
      error: FALLBACK_MESSAGE[code],
      ...(opts?.extraBody ?? {}),
    }),
    {
      status: opts?.status ?? DEFAULT_STATUS[code],
      headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(opts?.extraHeaders ?? {}) },
    },
  );
}

/**
 * Log the real failure for developers. `err` may be anything thrown; the
 * message lands in Supabase function logs and NEVER in a response body.
 */
export function logInternal(fn: string, err: unknown, note?: string): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error(`[${fn}]${note ? ` ${note}:` : ''} ${detail}`);
}
