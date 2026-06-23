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
