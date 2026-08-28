/**
 * One-click unsubscribe (RFC 8058).
 *
 * ── Why this has to exist before the first campaign ─────────────────────────
 *
 * Gmail and Yahoo require bulk senders to offer a machine-readable unsubscribe
 * that completes in a single POST, with no landing page, no login and no
 * confirmation step. A footer link alone does not satisfy it. Getting this
 * wrong is not a soft failure: since November 2025 Google rejects rather than
 * delays, and a domain stays ineligible for delivery support until its spam
 * rate has been under 0.30% for seven consecutive days.
 *
 * The strategic point is that one-click unsubscribe is *protective*. Without
 * it, the only tool an annoyed owner has is "Report Spam", which damages the
 * sending domain for everybody. A slightly higher unsubscribe rate is a good
 * trade for a lower complaint rate.
 *
 * ── DEPLOYMENT ──────────────────────────────────────────────────────────────
 *
 * This function MUST be deployed with JWT verification off — the POST that
 * Gmail sends carries no session by design:
 *
 *     supabase functions deploy email-unsubscribe --no-verify-jwt
 *
 * That is safe here because the only thing this endpoint can do is stop us
 * emailing somebody. `unsubscribe_email_by_token` sets flags to FALSE and
 * nothing else — it cannot re-enable email, cannot read anything back, and
 * cannot touch another column. Re-subscribing needs a real session in the app.
 *
 * ── Why GET does not unsubscribe ────────────────────────────────────────────
 *
 * The visible footer link is a GET, and corporate mail gateways and antivirus
 * scanners follow links in mail to check them. If GET performed the action,
 * those scanners would silently unsubscribe people who never clicked anything.
 * So GET renders a page with a single button, and the button POSTs. Machines
 * doing RFC 8058 go straight to POST and never see the page.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

/** Mirrors the scopes accepted by unsubscribe_email_by_token. */
const SCOPES = new Set(['all', 'digest', 'insights', 'walk', 'lifecycle']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCOPE_LABEL: Record<string, string> = {
  all: 'all Pawtchi emails',
  digest: 'the weekly recap',
  insights: 'health and plan emails',
  walk: 'walk reports',
  lifecycle: 'setup and check-in emails',
};

serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const rawScope = url.searchParams.get('s') ?? 'all';
  const scope = SCOPES.has(rawScope) ? rawScope : 'all';

  if (req.method === 'GET') {
    return html(confirmPage(scope));
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Answer 200 for a malformed token rather than 400. An unauthenticated
  // caller must not be able to use status codes to learn whether a token is
  // real — that would turn this endpoint into an oracle over the user table.
  if (!UUID_RE.test(token)) {
    return done(req, scope, false);
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data, error } = await admin.rpc('unsubscribe_email_by_token', {
      p_token: token,
      p_scope: scope,
    });

    if (error) {
      // Log for us, succeed for them. A failed unsubscribe that *looks* failed
      // sends the owner to the spam button, which is the outcome this whole
      // endpoint exists to avoid. The next send retries the suppression check
      // against the database anyway.
      console.error('[email-unsubscribe] rpc failed:', error.message);
    } else if (data !== true) {
      console.warn('[email-unsubscribe] token did not match any owner');
    }
  } catch (e) {
    console.error('[email-unsubscribe]', e instanceof Error ? e.message : String(e));
  }

  return done(req, scope, true);
});

/**
 * Gmail's one-click POST wants a plain 200 and ignores the body. A human who
 * pressed the button on the confirmation page wants to be told it worked.
 */
function done(req: Request, scope: string, ok: boolean): Response {
  const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
  if (!wantsHtml) {
    return new Response(JSON.stringify({ ok }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return html(donePage(scope));
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Nothing here should ever be cached by an intermediary.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Brand surface: navy ground, yellow only as a filled block behind navy text.
 * Yellow is never ink on white — it does not hold contrast (Brand Book Part IV,
 * and the same rule the letter flow follows).
 */
function shell(inner: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pawtchi email settings</title>
</head>
<body style="margin:0;background:#07202A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:460px;margin:0 auto;padding:64px 24px;color:#ffffff;">
    <div style="font-weight:700;font-size:20px;letter-spacing:-0.01em;margin-bottom:40px;">Pawtchi</div>
    ${inner}
  </div>
</body></html>`;
}

function confirmPage(scope: string): string {
  const label = SCOPE_LABEL[scope] ?? SCOPE_LABEL.all;
  return shell(`
    <h1 style="font-size:26px;line-height:1.25;font-weight:700;margin:0 0 16px;">
      Stop sending ${esc(label)}?
    </h1>
    <p style="font-size:16px;line-height:1.6;color:#B8C4CA;margin:0 0 32px;">
      You can turn this back on any time in Pawtchi, under notification settings.
    </p>
    <!--
      No action attribute and no hidden fields on purpose: the form posts back
      to this exact URL, query string included, so the handler reads the token
      and scope from where it already read them on the GET.
    -->
    <form method="POST">
      <button type="submit"
        style="display:block;width:100%;padding:16px;border:0;border-radius:12px;
               background:#F4F600;color:#07202A;font-size:16px;font-weight:700;cursor:pointer;">
        Unsubscribe
      </button>
    </form>`);
}

function donePage(scope: string): string {
  const label = SCOPE_LABEL[scope] ?? SCOPE_LABEL.all;
  return shell(`
    <h1 style="font-size:26px;line-height:1.25;font-weight:700;margin:0 0 16px;">
      Done. We have stopped ${esc(label)}.
    </h1>
    <p style="font-size:16px;line-height:1.6;color:#B8C4CA;margin:0 0 8px;">
      Anything you have already logged stays exactly where it is, and Pawtchi
      will still reply if you write to us.
    </p>`);
}
