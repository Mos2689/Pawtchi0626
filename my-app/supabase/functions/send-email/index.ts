import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rateLimit.ts";
import { isValidUUID, safeParseBody } from "../_shared/validate.ts";
import { errorResponse, logInternal } from "../_shared/errors.ts";
import { isAuthorisedCronRequest } from "../_shared/notifications/cronAuth.ts";
import React from "npm:react@18.2.0";
import { render } from "npm:@react-email/render@0.0.10";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Import our custom email templates
import { WelcomeEmail } from "../_shared/emails/WelcomeEmail.tsx";
import { WeeklySummaryEmail } from "../_shared/emails/WeeklySummaryEmail.tsx";
import { CampaignEmail } from "../_shared/emails/CampaignEmail.tsx";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Security: machine sender path ──
    // Cron-driven senders (notify-weekly-digest, notify-monitor) have no user
    // session, so verifyAuth can never pass for them. The retired
    // run_weekly_summaries() tried anyway with a legacy anon JWT and got a 401
    // on every run — which is why the weekly summary email has never once been
    // delivered. They authenticate with the fail-closed Vault cron secret
    // instead, and skip the per-user rate limit and the same-recipient guard
    // (both of which exist to stop a *user* using this as an open relay).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const isCronSender = await isAuthorisedCronRequest(req, admin);

    let authedUserId: string | null = null;
    if (!isCronSender) {
      // ── Security: Authenticate caller ──
      const auth = await verifyAuth(req, corsHeaders);
      if (auth.error) return auth.error;
      authedUserId = auth.userId;

      // ── Security: Rate limit (5 requests/hour) ──
      const rateLimited = await checkRateLimit(auth.userId, 'send-email', RATE_LIMITS['send-email'], corsHeaders);
      if (rateLimited) return rateLimited;
    }

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      logInternal('send-email', parsed.error.detail, 'body validation');
      return errorResponse(parsed.error.code, corsHeaders);
    }

    const {
      to,
      subject,
      template,
      templateData,
      html,
      text,
      // Set by campaign senders. Absent on transactional mail (a reply to a
      // letter somebody wrote) and on the internal team digests, neither of
      // which is a list anyone can leave — RFC 8058 exempts both.
      unsubscribeToken,
      unsubscribeScope,
    } = parsed.data as Record<string, any>;

    if (!to || (!template && !html)) {
      logInternal('send-email', "missing 'to' or template/html");
      return errorResponse('invalid_input', corsHeaders);
    }

    // ── Security: Validate recipient ──
    // Only allow sending to the authenticated user's own email to prevent open
    // relay abuse. Cron senders are exempt: they legitimately address other
    // people (the weekly digest goes to each owner), and they already proved
    // themselves with the cron secret above.
    if (!isCronSender && authedUserId) {
      const { data: userData } = await admin.auth.admin.getUserById(authedUserId);
      const userEmail = userData?.user?.email;

      if (userEmail && to.toLowerCase() !== userEmail.toLowerCase()) {
        logInternal('send-email', 'recipient does not match authenticated user');
        return errorResponse('forbidden', corsHeaders);
      }
    }

    let emailHtml = html;
    let emailSubject = subject;

    // Render React Email templates to HTML string based on template ID
    // Subjects follow Copy Spec v1 like every other user-facing string: no
    // exclamation marks, no emoji, no "your pet".
    if (template === "welcome") {
      emailHtml = render(React.createElement(WelcomeEmail, templateData || {}));
      emailSubject = subject || "Welcome to Pawtchi";
    } else if (template === "weekly_summary") {
      emailHtml = render(React.createElement(WeeklySummaryEmail, templateData || {}));
      emailSubject = subject || "Your weekly recap";
    } else if (template === "campaign") {
      // Every owner-facing campaign renders through this one template. The
      // subject always comes from lib/email/copy.ts, so there is deliberately
      // no fallback string here — a campaign send with no subject is a bug in
      // the dispatcher, and inventing one would hide it.
      emailHtml = render(React.createElement(CampaignEmail, templateData || {}));
      emailSubject = subject;
      if (!emailSubject) {
        logInternal('send-email', 'campaign template called without a subject');
        return errorResponse('invalid_input', corsHeaders);
      }
    }

    // ── One-click unsubscribe (RFC 8058) ──
    // Gmail and Yahoo require bulk senders to expose a machine-readable
    // unsubscribe that completes in a single POST. Both headers are required:
    // List-Unsubscribe alone is the older, ambiguous form, and it is
    // List-Unsubscribe-Post that tells the client it may POST without asking
    // the user to confirm. A visible link in the footer is still needed too,
    // and the templates carry one built from the same token.
    //
    // Omitted entirely for transactional mail. Attaching it there would invite
    // someone to "unsubscribe" from replies to their own support request.
    const headers: Record<string, string> = {};
    if (typeof unsubscribeToken === 'string' && isValidUUID(unsubscribeToken)) {
      const scope = typeof unsubscribeScope === 'string' ? unsubscribeScope : 'all';
      const unsubUrl =
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-unsubscribe` +
        `?t=${encodeURIComponent(unsubscribeToken)}&s=${encodeURIComponent(scope)}`;
      headers['List-Unsubscribe'] = `<${unsubUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    const data = await resend.emails.send({
      from: "Pawtchi <hello@pawtchi.com>",
      to: [to],
      subject: emailSubject,
      html: emailHtml,
      text: text || "Please view this email in an HTML-compatible client.",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    logInternal('send-email', error, 'unhandled');
    return errorResponse('server_error', corsHeaders);
  }
});
