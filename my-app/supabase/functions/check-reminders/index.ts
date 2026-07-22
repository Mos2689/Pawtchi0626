import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

serve(async (req: Request) => {
  try {
    // ── Security: Cron secret guard ──
    // This function is called by Supabase cron scheduler, not by users.
    // Protect it with a shared secret to prevent unauthorized invocations.
    const cronSecret = req.headers.get('x-cron-secret') || '';
    const expectedSecret = Deno.env.get('CRON_SECRET') || '';

    // If CRON_SECRET is configured, enforce it. Otherwise allow (backward compat).
    if (expectedSecret && cronSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized — invalid or missing cron secret' }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Initialize Supabase Admin Client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "" // Important: Use Service Role for backend access
    );

    const now = new Date();
    // Use UTC date as the standard for 'today' log_date matching
    const todayDateStr = now.toISOString().split('T')[0];
    
    // 2. Fetch pets with pagination to avoid unbounded queries
    const { data: pets, error: petsError } = await supabaseClient
      .from('pets')
      .select('id, name, owner_id')
      .limit(1000); // Cap to prevent full-table scan at scale
      
    if (petsError) throw petsError;
    
    // 3. Fetch all daily logs for today
    const { data: dailyLogs, error: logsError } = await supabaseClient
      .from('daily_logs')
      .select('pet_id, calories_consumed, water_ml')
      .eq('log_date', todayDateStr);
      
    if (logsError) throw logsError;

    // 4. Fetch user profiles to get push tokens
    // Note: Assuming push_token was added to profiles table by the register_push_token RPC.
    // If it's stored in a different table (e.g. 'devices'), update the FROM clause.
    const { data: profiles, error: profilesError } = await supabaseClient
      .from('profiles')
      .select('id, push_token')
      .limit(1000); // Cap to prevent full-table scan
      
    if (profilesError) console.warn("Could not fetch profiles push_tokens. Make sure the column exists.");

    const pushTokensMap = new Map();
    if (profiles) {
      profiles.forEach((p: any) => {
        if (p.push_token) {
          pushTokensMap.set(p.id, p.push_token);
        }
      });
    }

    // 5. Determine which pets missed logs (inaction)
    const unloggedMeals: any[] = [];
    const unloggedWater: any[] = [];

    pets.forEach((pet: any) => {
      const log = dailyLogs?.find((l: any) => l.pet_id === pet.id);
      
      // If no log exists for today, or calories = 0 -> Missed Meal
      if (!log || log.calories_consumed === 0) {
        unloggedMeals.push(pet);
      }
      
      // If no log exists for today, or water = 0 -> Missed Water
      if (!log || log.water_ml === 0) {
        unloggedWater.push(pet);
      }
    });

    const notifications = [];

    // Bundle notifications for missed meals
    for (const pet of unloggedMeals) {
      const token = pushTokensMap.get(pet.owner_id);
      // Valid tokens look like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
      if (token && token.startsWith('ExponentPushToken')) {
        notifications.push({
          to: token,
          sound: 'default',
          title: `Did ${pet.name} eat yet?`,
          body: `Log ${pet.name}'s meal to keep your health streak going!`,
          data: { action: 'meal', petId: pet.id },
        });
      }
    }

    // You can bundle water notifications similarly if desired, ensuring you don't spam 
    // the user with 5 notifications at once.

    // 6. Send to Expo Push API
    let pushResponse = null;
    if (notifications.length > 0) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notifications),
      });
      pushResponse = await res.json();
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Processed ${pets.length} pets. Sent ${notifications.length} notifications.`,
      expoResponse: pushResponse 
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    // Cron-invoked — the "caller" is the scheduler, but keep the same
    // no-internal-details contract as the user-facing functions.
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    console.error(`[check-reminders] ${detail}`);
    return new Response(JSON.stringify({ success: false, error_code: 'server_error', error: 'Something went wrong on our side.' }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
