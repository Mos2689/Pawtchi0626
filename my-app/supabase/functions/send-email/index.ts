import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend";
import { corsHeaders } from "../_shared/cors.ts";
import React from "npm:react@18.2.0";
import { render } from "npm:@react-email/render@0.0.10";

// Import our custom email templates
import { WelcomeEmail } from "../_shared/emails/WelcomeEmail.tsx";
import { WeeklySummaryEmail } from "../_shared/emails/WeeklySummaryEmail.tsx";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, subject, template, templateData, html, text } = await req.json();

    if (!to || (!template && !html)) {
      return new Response(
        JSON.stringify({ error: "Missing required fields. Provide 'to' and either a 'template' or raw 'html'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
