import { createClient } from 'jsr:@supabase/supabase-js@2'

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
    return {
      error: new Response(
        JSON.stringify({ success: false, error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[auth] SUPABASE_URL or SUPABASE_ANON_KEY not configured');
    return {
      error: new Response(
        JSON.stringify({ success: false, error: 'Server misconfiguration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      error: new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      ),
    };
  }

  return { userId: user.id };
}
