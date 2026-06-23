import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { checkRateLimit, RATE_LIMITS } from "../_shared/rateLimit.ts";
import { safeParseBody } from "../_shared/validate.ts";
import React from "npm:react@18.2.0";
import { render } from "npm:@react-email/render@0.0.10";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Import our custom email templates
import { WelcomeEmail } from "../_shared/emails/WelcomeEmail.tsx";
import { WeeklySummaryEmail } from "../_shared/emails/WeeklySummaryEmail.tsx";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Security: Authenticate caller ──
    const auth = await verifyAuth(req, corsHeaders);
    if (auth.error) return auth.error;

    // ── Security: Rate limit (5 requests/hour) ──
    const rateLimited = await checkRateLimit(auth.userId, 'send-email', RATE_LIMITS['send-email'], corsHeaders);
    if (rateLimited) return rateLimited;

    // ── Security: Parse body with size limits ──
    const parsed = await safeParseBody(req);
    if (parsed.error) {
      return new Response(
        JSON.stringify({ error: parsed.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { to, subject, template, templateData, html, text } = parsed.data as Record<string, any>;

    if (!to || (!template && !html)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields. Provide 'to' and either a 'template' or raw 'html'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Security: Validate recipient ──
    // Only allow sending to the authenticated user's own email to prevent open relay abuse
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey);
      const { data: userData } = await sb.auth.admin.getUserById(auth.userId);
      const userEmail = userData?.user?.email;

      if (userEmail && to.toLowerCase() !== userEmail.toLowerCase()) {
        return new Response(
          JSON.stringify({ error: "You can only send emails to your own registered email address." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let emailHtml = html;
    let emailSubject = subject;

    // Render React Email templates to HTML string based on template ID
    if (template === "welcome") {
      emailHtml = render(React.createElement(WelcomeEmail, templateData || {}));
      emailSubject = subject || "Welcome to the Pawtchi Pack! 🐾";
    } else if (template === "weekly_summary") {
      emailHtml = render(React.createElement(WeeklySummaryEmail, templateData || {}));
      emailSubject = subject || "Your pet's weekly Paw-gress report! 📊";
    }

    const data = await resend.emails.send({
      from: "Pawtchi <hello@pawtchi.com>",
      to: [to],
      subject: emailSubject,
      html: emailHtml,
      text: text || "Please view this email in an HTML-compatible client.",
    });

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Resend error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
