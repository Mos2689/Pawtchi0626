# Pawtchi auth email templates

Branded HTML for the Supabase auth emails. All share one visual shell (navy
`#07202A` header with the `PAWTCHI` wordmark + electric-yellow accent, white
body, a large `{{ .Token }}` code chip on warm paper `#F8F7F4`, "Notice
everything" footer). Voice follows the brand copy spec: calm, plainspoken, no
exclamation marks, always a next step.

Paste each into **Supabase Dashboard → Authentication → Email Templates →
[template] → Message (HTML)**, and set the Subject as listed.

## Why code-based (`{{ .Token }}`), not links

The default templates use `{{ .ConfirmationURL }}` — a link to the project Site
URL (currently `http://localhost:3000`) that lands nowhere in a mobile app. We
switched the whole set to **6-digit codes** verified in-app with
`supabase.auth.verifyOtp(...)`, matching the reset-password flow. A code-only
email (no bare link) also scores better against spam filters.

## Template map

| Template | Subject | Variable | `verifyOtp` type | App support today |
|---|---|---|---|---|
| **Reset Password** (`reset-password.html`) | Your Pawtchi reset code | `{{ .Token }}` | `recovery` | ✅ **Live** — `app/(auth)/reset-password.tsx` |
| **Confirm signup** (`confirm-signup.html`) | Confirm your Pawtchi email | `{{ .Token }}` | `signup` | 💤 Dormant fallback — confirmation is OFF (see below) |
| **Magic Link** (`magic-link.html`) | Your Pawtchi sign-in code | `{{ .Token }}` | `email` | ⚠️ Not used — app is email+password |
| **Change Email** (`change-email.html`) | Confirm your new Pawtchi email | `{{ .Token }}` | `email_change` | ⚠️ Needs an in-app change-email flow |
| **Reauthentication** (`reauthentication.html`) | Your Pawtchi confirmation code | `{{ .Token }}` | `reauthentication` | ⚠️ Only sent if `reauthenticate()` is called |

## Confirm signup — intentionally OFF (Jul 2026 product decision)

**Auth → Providers → Email → "Confirm email" is OFF** to keep signup
frictionless: `signUp` returns a session immediately and the auth gate routes
straight to onboarding. No confirmation email is sent.

`app/(auth)/confirm-email.tsx` stays in the codebase as a **dormant safety
net**: if the toggle is ever re-enabled, `signUp` returns
`data.session === null`, login.tsx routes to the code-entry screen
(`verifyOtp({ type: 'signup' })`, re-marks the freshSignup latch → onboarding),
and resend uses `supabase.auth.resend({ type: 'signup', email })`. If you do
re-enable it, ALSO paste `confirm-signup.html` ({{ .Token }}) into the
dashboard — with the stock link template, users get a localhost link and no
code to enter.

## Testing

Send a test from the Supabase template editor (or paste into
[mail-tester.com](https://www.mail-tester.com)) to check rendering across
Gmail / Apple Mail / Outlook and to get the SPF/DKIM/DMARC spam score for
`pawtchi.com` in one shot.
