import { createClient } from 'jsr:@supabase/supabase-js@2'
import { errorResponse } from './errors.ts'

/**
 * Verify the caller's JWT from the Authorization header.
 * Returns the authenticated user's ID, or an error Response to return immediately.
 *
 * Usage:
 *   const auth = await verifyAuth(req);
 *   if (auth.error) return auth.error;
 *   // auth.userId is now a verified UUID
 */
export async function verifyAuth(req: Request, corsHeaders: Record<string, string>): Promise<
  | { userId: string; error?: never }
  | { userId?: never; error: Response }
> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { error: errorResponse('auth_required', corsHeaders) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[auth] SUPABASE_URL or SUPABASE_ANON_KEY not configured');
    return { error: errorResponse('server_error', corsHeaders) };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: errorResponse('auth_required', corsHeaders) };
  }

  return { userId: user.id };
}
