/**
 * CORS configuration for Supabase Edge Functions.
 *
 * - Restricts Access-Control-Allow-Origin to known domains.
 * - For React Native (mobile), CORS doesn't apply to native HTTP — this
 *   protects against browser-scripted attacks only.
 * - Localhost origins are included for Expo dev server.
 */

const ALLOWED_ORIGINS = [
  'https://pawtchi.com',
  'https://www.pawtchi.com',
  // The admin panel. It is a BROWSER client, which makes it the only caller
  // that CORS actually governs — every other consumer of these functions is the
  // native app, where CORS does not apply at all. That is why this omission
  // stayed invisible until the first admin-triggered edge function
  // (grant-creator-comp): the preflight returned 200 but carried
  // `Access-Control-Allow-Origin: https://pawtchi.com` (the fallback below), so
  // the browser refused to send the POST. Three preflights, no request, and a
  // generic "did not go through" in the UI.
  'https://admin.pawtchi.com',
  'http://localhost:8081',   // Expo dev (Metro)
  'http://localhost:19006',  // Expo web dev
  'http://localhost:5173',   // Vite dev server
  'http://localhost:3000',   // Next dev server (if used)
];

/**
 * Build CORS headers dynamically based on the request's Origin.
 * Falls back to the primary production origin for unrecognized callers.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

/**
 * Legacy static export for backward compatibility during migration.
 * @deprecated Use getCorsHeaders(req) instead.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
