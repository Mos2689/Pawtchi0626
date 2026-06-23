import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// Cron-driven proactive check-ins for Second Opinion cases.
// Finds assessments whose check-in is due, sends a calm push, and marks them
// sent. Mirrors check-reminders (Expo Push + cron-secret guard).
serve(async (req) => {
  try {
    // ── Security: cron secret guard ──
    const cronSecret = req.headers.get('x-cron-secret') || '';
    const expectedSecret = Deno.env.get('CRON_SECRET') || '';
    if (expectedSecret && cronSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized — invalid or missing cron secret' }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const nowISO = new Date().toISOString();

    // 1. Cases with a due, unsent check-in.
    const { data: due, error: dueErr } = await sb
      .from('vet_questions')
      .select('id, pet_id, user_id, question, answer, checkin_count')
      .lte('checkin_due_at', nowISO)
      .is('checkin_sent_at', null)
      .eq('status', 'open')
      .limit(500);
    if (dueErr) throw dueErr;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // 2. Resolve pet names + owner push tokens in batch.
    const petIds = [...new Set(due.map((d) => d.pet_id))];
    const userIds = [...new Set(due.map((d) => d.user_id))];
    const [{ data: pets }, { data: profiles }] = await Promise.all([
      sb.from('pets').select('id, name').in('id', petIds),
      sb.from('profiles').select('id, push_token').in('id', userIds),
    ]);
    const petName = new Map((pets || []).map((p) => [p.id, p.name]));
    const tokenFor = new Map((profiles || []).map((p) => [p.id, p.push_token]));

    // 3. Build notifications.
    const messages: any[] = [];
    const sentIds: string[] = [];
    for (const c of due) {
      const token = tokenFor.get(c.user_id);
      const name = petName.get(c.pet_id) || 'your companion';
      const reason = c.answer?.checkInReason ? String(c.answer.checkInReason) : null;
      sentIds.push(c.id); // mark sent even without a token, so it doesn't re-fire forever
      if (token && String(token).startsWith('ExponentPushToken')) {
        messages.push({
          to: token,
          sound: 'default',
          title: `How is ${name} doing?`,
          body: reason
            ? `Pawtchi is checking in ${reason}. Tap to update.`
            : `Pawtchi is checking in on ${name}. Tap to share how things are going.`,
          data: { type: 'vet_checkin', questionId: c.id },
        });
      }
    }

    // 4. Send via Expo Push API.
    let expoResponse = null;
    if (messages.length > 0) {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      expoResponse = await res.json();
    }

    // 5. Mark sent + bump count so it won't re-fire (an extension sets a new due later).
    if (sentIds.length > 0) {
      // Per-row update so checkin_count increments correctly.
      await Promise.all(due.map((c) =>
        sb.from('vet_questions').update({
          checkin_sent_at: nowISO,
          checkin_due_at: null,
          checkin_count: (c.checkin_count ?? 0) + 1,
        }).eq('id', c.id)
      ));
    }

    return new Response(
      JSON.stringify({ success: true, due: due.length, pushed: messages.length, expoResponse }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as any).message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});
