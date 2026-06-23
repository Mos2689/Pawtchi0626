import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { verifyAuth } from '../_shared/auth.ts'
import { checkRateLimit, RATE_LIMITS } from '../_shared/rateLimit.ts'
import { safeParseBody } from '../_shared/validate.ts'

// Coin economy constants
const COIN_REWARDS: Record<string, number> = {
  food_log: 5,
  activity_complete: 10,
  weight_log: 15,
  vet_report_log: 25,
};

const MILESTONE_BONUSES: Record<number, number> = {
  3: 25,
  7: 75,
  14: 150,
  30: 500,
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Security: Authenticate caller ──
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    // ── Security: Rate limit (60 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'update-streak', RATE_LIMITS['update-streak'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      return new Response(
        JSON.stringify({ success: false, error: parsed.error }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const body = parsed.data as Record<string, any>;
    const { action, referenceId } = body;

    // ── Security: Force userId to the authenticated caller ──
    // Prevents users from manipulating other users' streaks/coins
    const userId = auth.userId;

    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: 'action is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch or create streak row
    let { data: streak, error: fetchErr } = await supabase
      .from('streaks')
      .select('*')
      .eq('owner_id', userId)
      .single();

    if (fetchErr && fetchErr.code === 'PGRST116') {
      const { data: newStreak, error: createErr } = await supabase
        .from('streaks')
        .insert({ owner_id: userId, paw_coins: 50, current_streak: 0, longest_streak: 0 })
        .select()
        .single();
      if (createErr) throw createErr;
      streak = newStreak;
    } else if (fetchErr) {
      throw fetchErr;
    }

    const today = new Date().toISOString().split('T')[0];
    const lastLogged = streak.last_logged_date;
    let currentStreak = streak.current_streak || 0;
    let longestStreak = streak.longest_streak || 0;
    let pawCoins = streak.paw_coins || 0;
    let streakBroken = false;
    let milestoneHit: number | null = null;
    let totalCoinsEarned = 0;
    const transactions: { amount: number; reason: string; reference_id?: string }[] = [];

    // 2. Determine streak update
    if (lastLogged === today) {
      // Already logged today — no streak change
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (lastLogged === yesterdayStr) {
        currentStreak += 1;
      } else if (lastLogged === null) {
        currentStreak = 1;
      } else {
        streakBroken = true;
        currentStreak = 1;
      }

      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }

      // 3. Check milestone bonuses
      if (MILESTONE_BONUSES[currentStreak]) {
        milestoneHit = currentStreak;
        const bonus = MILESTONE_BONUSES[currentStreak];
        pawCoins += bonus;
        totalCoinsEarned += bonus;
        transactions.push({
          amount: bonus,
          reason: `streak_milestone_${currentStreak}`,
          reference_id: referenceId || undefined,
        });
      }
    }

    // 4. Award action coins
    const actionCoins = COIN_REWARDS[action] || 5;
    pawCoins += actionCoins;
    totalCoinsEarned += actionCoins;
    transactions.push({
      amount: actionCoins,
      reason: action,
      reference_id: referenceId || undefined,
    });

    // 5. Update streaks table
    const { error: updateErr } = await supabase
      .from('streaks')
      .update({
        current_streak: currentStreak,
        longest_streak: longestStreak,
        paw_coins: pawCoins,
        last_logged_date: today,
        last_coin_award_date: today,
      })
      .eq('owner_id', userId);
    if (updateErr) throw updateErr;

    // 6. Insert coin transactions
    if (transactions.length > 0) {
      const rows = transactions.map(t => ({
        owner_id: userId,
        amount: t.amount,
        reason: t.reason,
        reference_id: t.reference_id || null,
      }));
      const { error: txnErr } = await supabase
        .from('coin_transactions')
        .insert(rows);
      if (txnErr) {
        console.error('[update-streak] Transaction insert error:', txnErr);
      }
    }

    console.log(`[update-streak] User ${userId} | Action: ${action} | Streak: ${currentStreak} | Coins: ${pawCoins} (+${totalCoinsEarned})`);

    return new Response(
      JSON.stringify({
        success: true,
        currentStreak,
        longestStreak,
        pawCoins,
        coinsEarned: totalCoinsEarned,
        milestoneHit,
        streakBroken,
        previousStreak: streakBroken ? streak.current_streak : null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[update-streak] Error:', message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
