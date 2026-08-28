# Privacy Policy — REVISED DRAFT

> **Working draft.** Rewritten to match what the app actually does, verified against the codebase
> at iOS build 74 / Android versionCode 33. Items in `[SQUARE BRACKETS]` are business or legal
> decisions that must be resolved before publication. Notes marked **[FIX-OR-SOFTEN]** describe
> wording that can be strengthened if the corresponding Track B code change is made.

---

**Company:** Hey Living Club Pty Ltd
**Address:** 128 Tallawong Road, Rouse Hill, NSW 2152, Australia
**Contact:** privacy@heylivingclub.com
**Last updated:** `[PUBLICATION DATE]`

This Privacy Policy explains how Hey Living Club Pty Ltd (ABN registered in Australia), trading as
"Pawtchi" ("we", "us", "our"), collects, uses, stores, discloses and protects personal information
when you use the Pawtchi mobile application and related services (the "App").

We handle personal information in accordance with the Australian Privacy Act 1988 (Cth) and the
Australian Privacy Principles (APPs), the New Zealand Privacy Act 2020 and the Information Privacy
Principles (IPPs), and the developer privacy requirements of the Apple App Store and Google Play.
This policy is written to be read together with the Pawtchi Terms of Service.

> `[VERIFY]` The original policy said "the 13 Australian Privacy Principles" and "the 13
> Information Privacy Principles". The IPP count is no longer 13 — the NZ Privacy Amendment Act
> 2025 inserted IPP 3A, in force 1 May 2026. The numbers have been dropped above rather than
> restated incorrectly. Confirm with counsel.

---

## 1. Who we are and how to contact us

Hey Living Club Pty Ltd is the data controller for personal information collected through the App.

Our Privacy Officer is `[NAME / ROLE TITLE]`, contactable at privacy@heylivingclub.com or at the
postal address above. For any privacy question, access request, correction request or complaint,
please contact us there. We aim to respond within 30 days.

> `[DECISION]` Section 201 of the NZ Privacy Act 2020 requires an appointed Privacy Officer. A role
> title ("the Privacy Officer") is sufficient; a named individual is not required.

## 2. Information we collect

We only collect information that is reasonably necessary to run the features you use. We do not
collect sensitive information about *you* as defined in the Privacy Act — we do not ask for your
health information, race, religion, political views, sexual orientation or biometric data. Some of
what we hold is health information about *your pet*, which we treat carefully but which is not
"sensitive information" about a person.

**Account information.** When you create an account we collect your email address and a password,
which is stored only in hashed form by our authentication provider. We do not ask for your legal
name, date of birth or government identifiers. We do create a display name for your account by
taking the part of your email address before the "@" — this appears on vet reports you export. If
you ever sign in through a third-party identity provider, that provider may supply your name and
profile picture to us.

**Pet profile information you provide.** Your pet's name, species, breed, sex, whether they are
neutered, date of birth or age, current weight, body condition score, activity level, life stage,
reproductive status, allergies or intolerances you record, medical conditions you record, diet type,
and an optional pet profile photo. This is used to calculate feeding, hydration and activity targets
and to personalise guidance.

**Photos you submit.** Photos of pet food, meals, treats, packaging labels and veterinary reports
that you capture with the camera or select from your photo library, so the App can analyse them and
return a verdict or extract structured information. If you add a photo of your pet, the App may also
analyse that photo to estimate your pet's body condition and suggest a starting point, which you can
always change. Food and veterinary photos are sent for analysis and are not retained in our file
storage; your pet's profile photo is stored so it can be displayed in the App.

**Activity and health logs.** Meals logged, water logged, walks and other activities logged, weight
entries and weight-plan assessments, milestones, streaks, ideal-weight estimates, AI-generated
verdicts and vet-style answers, saved foods in your pantry, and vet-check-in responses.

**Your daily routine.** If you set up a personalised schedule we collect your usual wake time,
bedtime, work start and finish times, preferred walk windows, how far your weekend shifts, your
quiet hours, how much notification you want, and how many people in your household walk your pet.
This is information about you, not your pet, and it is used only to place reminders at times that
suit you.

**Walk location data.** Tracked walks are an optional feature you start deliberately. While a walk
is running we collect your device's precise location continuously — roughly one reading every three
seconds or every five metres — to measure the route, distance, moving time, pace and rest stops.

  * *What we keep.* A simplified version of the route path, the places where your pet paused or
    stopped to sniff, short place-name labels for the start, end and farthest points of the walk
    (obtained by reverse-geocoding those coordinates through your phone's operating system), the
    weather at the time, and the walk's timing and speed.
  * *Please be aware.* Because a walk usually begins and ends at home, a stored route and its start
    label can indicate where you live, and a series of walks can show your usual routine. Only you
    can see your walks in the App.
  * *Background behaviour.* So a walk is not lost when your screen locks, tracking continues in the
    background — on Android through a visible ongoing notification, and on iOS through the system
    background-location mode with the status indicator showing. Tracking continues even if you close
    the App, until the walk ends or you end it. We never request "always allow" background location
    permission.
  * *One reading outside a walk.* If you have not yet recorded a walk, the App's home screen can
    centre its map on your neighbourhood. With your permission it takes a single location reading
    for that purpose. To show the current temperature and walk outlook on Home, the map centre is
    rounded to roughly one kilometre and sent directly to Open-Meteo; it is not sent to Pawtchi's
    servers for this purpose. We stop taking a device reading once any walk of yours has recorded a
    location. Apart from this, we do not collect your location when a walk is not running.
  * *On your device.* A high-detail trace is held on your device only while the walk is running and
    is erased when the walk finishes. If a finished walk cannot be uploaded straight away it waits
    on your device until it can be.

**Insights we derive.** From your walk history the App works out patterns — how often you repeat a
route, roughly what time of day you head out, how many different places you visit, and how often you
loop back home — and uses them to give your pet a "Walksign", a character reading that can change
over time. These are conclusions drawn from your movements, and we treat them as personal
information.

**Purchase information.** If you subscribe, the payment itself is completed by Apple or Google and
we never see your card details. We receive subscription entitlement status, plan identifier,
purchase and renewal dates, and a subscriber identifier that is linked to your account so we can
unlock premium features and restore purchases.

**Rewards.** Streak counts and paw-coin balances earned by logging activity.

**Device and diagnostic information.** Device model, operating system version, app version,
language, time zone, an installation identifier, crash reports and IP-derived country. This is used
for stability, security, fraud prevention and analytics. On Android, the App can also detect whether
Instagram is installed, so it can offer to share a card there.

**Product analytics.** We record which screens you view and which actions you take — for example
that onboarding was completed, that the paywall was viewed, or that a walk was started. These
records are **linked to your account identifier**, not anonymous. Our analytics tool also captures
interactions automatically, which means text shown on a screen you tap can be recorded. Some events
deliberately include pet attributes such as breed, species, weight, body condition score and
individual allergens, because we use them to improve guidance quality.

> **[FIX-OR-SOFTEN]** The previous policy claimed a PII allowlist strips this data "before events
> are sent to third-party analytics or advertising SDKs". That allowlist exists for Meta and
> Firebase but **not** for PostHog, and automatic interaction capture bypasses it entirely. The
> paragraph above states the true position. If Track B1 is completed (route the PostHog sink
> through the existing allowlist and disable autocapture), replace the last two sentences with the
> original stripping claim.

**Push notification token.** If you grant notification permission we store a push token against your
account so we can deliver reminders and check-ins. You can revoke notification permission at any
time in your device settings.

**Advertising identifier.** On iOS we present Apple's App Tracking Transparency prompt, and the
advertising identifier is used only if you tap "Allow". On Android the advertising identifier is
collected by our marketing measurement provider `[when the App starts / only after you consent —
depends on Track B5]`.

> **[FIX-OR-SOFTEN]** The previous policy said the advertising identifier was "iOS only, with
> consent". The Android manifest declares `com.google.android.gms.permission.AD_ID` and the Meta SDK
> is configured to auto-initialise and collect the advertiser ID with no Android consent gate. Either
> complete Track B5 and restore the consent wording, or state the current position plainly.

## 3. How we collect information (APP 3, IPP 2–4)

We collect information directly from you when you create an account, complete onboarding, log meals,
log walks, submit photos, set your routine, ask a question or subscribe. Diagnostic and analytics
data is collected automatically from your device as you use the App. Location is collected from your
device while a tracked walk is running, and — with your permission, and only until your first walk
records a location — as a single reading that centres the home screen map on your device. We do not
buy personal information from data brokers.

## 4. Why we use your information (APP 6, IPP 10)

We use information for the primary purpose for which it was collected and for directly related
secondary purposes you would reasonably expect, including:

* operating the food scanner, verdict engine, portion and hydration maths, activity tracking, walk
  tracking and vet-style Q&A;
* generating personalised feeding, hydration and activity plans, a current weather-based walk
  outlook, vet-ready PDF reports, walk stories and share cards;
* deriving the pattern-based insights described in section 2;
* delivering reminders, check-ins and streak notifications you have opted in to;
* processing subscriptions, restoring purchases and preventing subscription fraud;
* measuring product performance, crashes, funnel drop-off and marketing attribution so we can
  improve the App;
* complying with our legal obligations, including under the Privacy Act 1988 (Cth) and the Privacy
  Act 2020 (NZ).

## 5. Third parties we share information with (APP 6, IPP 11)

We do not sell your personal information. We share the minimum information necessary with the
following providers, each of which is bound by contract to protect it:

| Provider | What it handles |
|---|---|
| **Supabase** | Hosted database, authentication and file storage for your account, pet profiles, logs, walks, reports and pet profile photos. |
| **Google (Gemini API)** | Server-to-server analysis of photos and text so the App can return food verdicts, estimate body condition, parse veterinary reports and answer vet-style questions. When you ask a question, your pet's profile — including recorded allergies, medical conditions, and diagnoses and medications extracted from any vet report you scanned — is included so the answer is specific to your animal. We use the paid Gemini API tier, under which content sent through the API is not used to train Google's foundation models. |
| **Google (Firebase Analytics)** | Measurement of key milestones such as sign-up, profile completion and purchases, linked to your account identifier. |
| **PostHog** | Product analytics and diagnostics, linked to your account identifier. |
| **Meta (Facebook App Events)** | Marketing attribution and measurement. A per-event property allowlist and a PII blocklist strip email, user id, pet name, breed and allergies before any event reaches Meta. |
| **RevenueCat** | Subscription entitlement, receipt validation and restore-purchase support, using an identifier linked to your account. |
| **Apple and Google (Play Billing)** | Payment processing for in-app subscriptions. |
| **Expo, Apple (APNs) and Google (FCM)** | Delivery of push notifications. Notification content can include your pet's name and the reason for a health check-in. |
| **Resend** | Transactional email such as account confirmations. |
| **OpenStreetMap Foundation** | Map tiles for the walk map. Tile requests reveal the approximate area you are viewing. |
| **Open-Meteo** | Weather at the time of a walk and the current temperature and walk outlook shown on Home. Coordinates are rounded to roughly one kilometre before they leave your device. |
| **Apple / Google (operating system geocoding)** | Converting walk coordinates into short place names. This uses your phone's built-in service. |
| **Unsplash** | Stock images used as placeholder pet pictures. |

We may also disclose information if required by law, to enforce our Terms of Service, or to protect
the rights, property or safety of Pawtchi, our users or the public.

> `[VERIFY — ONE RESIDUAL RISK]` The paid-tier no-training claim was restored on confirmation that
> billing is enabled. It is safe for the functions on GA models (`gemini-2.5-flash`). But `ask-vet`
> calls `gemini-3.1-pro-preview` (`supabase/functions/ask-vet/index.ts:10`), and Google's pre-GA /
> preview offerings are governed by separate terms that can carve out the no-training commitment
> even on a paid account — and `ask-vet` carries the richest health payload of any call. Confirm the
> preview terms, or move `ask-vet` to a GA model.

## 6. Cross-border disclosure (APP 8, IPP 12)

Some providers listed above store or process personal information outside Australia and New Zealand.
The countries in which recipients are likely to be located are: `[UNITED STATES, IRELAND, GERMANY,
UNITED KINGDOM — CONFIRM AGAINST ACTUAL VENDOR REGIONS]`. Our primary database and file storage are
hosted in the `[SUPABASE PROJECT REGION]` region.

Before disclosing personal information overseas we take reasonable steps to ensure the recipient
handles it in a manner consistent with the APPs and the IPPs, including through written
data-processing agreements.

## 7. Direct marketing (APP 7)

We do not send unsolicited marketing emails. Email from us is transactional — account confirmation,
password reset and similar. Push notifications are used for the reminders and check-ins you opted in
to and can be turned off at any time in your device settings. We do not use your pet's health
information for advertising targeting.

> `[DECISION]` A weekly summary email template exists in the codebase but is not currently sent. If
> it is switched on it will be a commercial electronic message under the Spam Act 2003 (Cth) and
> will need express or inferred consent, sender identification and a working unsubscribe link — and
> this section will need rewriting.

## 8. Device permissions

The App may request the following permissions. All are optional and can be revoked at any time in
your device settings:

* **Camera** — to scan pet food and veterinary documents.
* **Photo library** — to select a pet profile photo or an existing food photo. The App may also save
  a scanned food image back to your library.
* **Location (while in use)** — to record tracked walks, and to take a single reading that centres
  the home screen map before your first walk. Tracking continues in the background while a walk is
  active, shown by an ongoing notification on Android and the status indicator on iOS. We do not
  request "always allow" background location.
* **Notifications** — to deliver reminders, activity nudges and vet check-ins.
* **App Tracking Transparency (iOS)** — required by Apple before any cross-app tracking identifier is
  used.

> **[FIX-OR-SOFTEN]** The Android manifest also declares `RECORD_AUDIO` (confirmed unused),
> `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`. Track B4/B9 removes
> the unused ones; anything that remains must be listed here and answered in the Play Data Safety
> form.

## 9. Anonymity and pseudonymity (APP 2)

Wherever it is lawful and practicable, you may deal with us anonymously or under a pseudonym. In
practice the App requires an email address so your pet's records can be kept securely, synced to
your devices and restored if you reinstall — so an account cannot be anonymous. You are welcome to
use a pseudonymous email address and a nickname for your pet. You can contact us anonymously with a
general privacy enquiry, though we may be unable to action an access or correction request without
verifying who you are.

## 10. Data quality (APP 10, IPP 8)

We take reasonable steps to ensure the personal information we hold is accurate, up to date,
complete and relevant. You can review and update your account, pet and routine information at any
time from the Profile tab.

## 11. Security (APP 11, IPP 5)

We use technical and organisational measures to protect your information, including encryption in
transit (TLS), encryption at rest on our infrastructure providers, hashed passwords, row-level
security so each account can only reach its own records, restricted staff access on a need-to-know
basis, and rate limiting on our server functions.

You should also know:

* Your pet's profile photo is served from a public web address. The address is long and effectively
  unguessable, but anyone you give it to can open it without signing in.
* Some information — your sign-in session, an unsent walk and vet reports you have exported to PDF —
  is held in your device's own storage, protected by your device's security rather than by ours.

No system is perfectly secure. If we become aware of an eligible data breach likely to result in
serious harm, we will notify affected users and the Office of the Australian Information
Commissioner (OAIC) as required under the Notifiable Data Breaches scheme, and the Office of the
Privacy Commissioner (NZ) as required under the Privacy Act 2020.

> **[FIX-OR-SOFTEN]** "Audit logging" has been removed from this list because none is implemented.
> The two bullets above become unnecessary if Track B3 (private photo bucket + signed URLs),
> B10 (secure-store session) and B9 (delete cached PDFs) are completed.

## 12. Retention and deletion

We keep personal information only for as long as we need it to provide the App or as required by
law.

* **Account deletion.** When you delete your account from the Profile screen we permanently delete
  your account, pet profiles, logs, photos, walks and routes, saved foods, veterinary documents and
  reports from our operational data stores.
* **Individual records.** You can delete individual food scans, saved pantry foods and veterinary
  reports from within the App at any time. Walks cannot currently be deleted individually; they are
  removed when the pet or the account is deleted.
* **Retention periods.** We do not currently apply a fixed retention period. Walk routes and
  location detail, and your other pet records, are kept for the life of the account and are deleted
  when you delete the pet or the account.
* **What survives deletion.** Financial records we must keep for tax and audit purposes are retained
  for the period required by law. Analytics and marketing records held by our providers are keyed to
  your account identifier and are removed on request — contact us if you want them erased at the
  same time as your account.

> **[FIX-OR-SOFTEN]** The last bullet reflects reality: account deletion does not currently fan out
> to PostHog, Firebase, Meta or RevenueCat. If Track B2 is completed, replace it with a statement
> that those records are deleted automatically.
>
> `[DECISION — STILL OPEN]` **A retention period for walk location data is still needed.** The
> "Retention periods" bullet above states the current position: indefinite retention for the life of
> the account. That is honest, but it is **difficult to defend under APP 11.2 / IPP 9**, which
> require personal information to be destroyed or de-identified once it is no longer needed for a
> permitted purpose — and a walk route whose start point identifies a home address is exactly the
> kind of data that argument bites on.
>
> **Do not restore a fixed period here until the purge job exists.** An earlier edit of this file
> asserted "kept for 12 months, after which the route path, pause and sniff points and place labels
> are deleted". No such job is implemented — there is no `pg_cron` schedule and nothing in
> `supabase/migrations/` that deletes aged walk geometry. Track B8 in the remediation handover is the
> work item; it was never built because this decision was never made. Publishing that sentence would
> have been a deletion promise the code does not keep, which is precisely the class of defect this
> review exists to remove.
>
> Sequence: pick a period → build the purge (Track B8) → then update this bullet, the `.docx` build
> script and `app/privacy.tsx` **together**.

## 13. Your rights — access, correction and complaints (APP 12/13, IPP 6/7)

You have the right to ask for access to the personal information we hold about you and to ask that
it be corrected. Most information is directly viewable and editable inside the App. For anything
else, email privacy@heylivingclub.com.

* We do not charge for making a request, or for correcting information.
* We will ask you to verify your identity — normally by writing from the email address on the
  account — before we release or change anything.
* We will respond within 30 days.
* If we refuse a request in whole or in part we will tell you why in writing and explain how to
  complain.

If you believe we have breached the Australian Privacy Principles or the New Zealand Information
Privacy Principles, please contact us first so we can try to resolve it. If you are not satisfied you
may complain to:

* Office of the Australian Information Commissioner (OAIC) — oaic.gov.au or 1300 363 992.
* Office of the Privacy Commissioner (New Zealand) — privacy.org.nz or 0800 803 909.

## 14. Automated processing and AI

Pawtchi uses automated processing, including AI models, to produce food verdicts, estimate body
condition from a photo, calculate feeding and weight plans, generate vet-style answers and derive the
insights described in section 2. These outputs are guidance for you to consider — they are not
veterinary advice, they do not make decisions about you, and they do not affect your legal rights or
your access to any service. You can always override a suggestion, and you should consult a
veterinarian for anything clinical.

> `[DECISION]` From 10 December 2026, APP 1.7 (inserted by the Privacy and Other Legislation
> Amendment Act 2024) requires privacy policies to disclose automated decision-making that
> significantly affects an individual's rights or interests. Our assessment is that Pawtchi's
> automated processing falls outside that threshold because it concerns pet care and is advisory
> only. Record that assessment before the deadline.

## 15. Sharing content from the App

The App lets you share walk stories, milestone cards and invitations to friends and to social apps
such as Instagram. When you choose to share:

* a walk or story card can include your pet's name, a drawing of your walking route and a place-name
  label — and, because walks usually start at home, this can indicate the area you live in;
* an invitation message includes your pet's name;
* once shared, that content is handled by whichever app or service you sent it to, under their
  privacy policy, not ours.

Sharing is always your choice — nothing is posted anywhere on your behalf.

## 16. Subscriptions and billing

All subscription purchases are processed by Apple or Google. Financial data (card number, billing
address) is handled directly by them and is never received by Hey Living Club Pty Ltd. You can manage
or cancel subscriptions from your device: on iOS via Settings → Apple ID → Subscriptions; on Android
via Google Play Store → Payments & subscriptions → Subscriptions.

## 17. Children

Pawtchi is not directed to children under 13, and we do not knowingly collect personal information
from children. If you believe a child has provided us with personal information, please contact
privacy@heylivingclub.com and we will delete it.

## 18. Apple App Store and Google Play disclosures

We publish an Apple Privacy Nutrition Label and a Google Play Data Safety declaration alongside this
policy. Those disclosures reflect the same data categories described here: contact info (email);
user content (photos of food and veterinary reports, pet profile photo); health & fitness (pet
weight, body condition, activity); identifiers (installation and subscriber identifiers linked to
your account); purchases; location (precise, while a walk is active and for a single reading that
centres the home screen map before your first walk); app activity; and
diagnostics. We do not sell your data.

> **[FIX-OR-SOFTEN]** The previous policy also claimed "We do not use your data for third-party
> advertising" and "we do not use it for tracking as defined by Apple unless you grant App Tracking
> Transparency consent". The first sits badly against the ATT prompt string, which tells users the
> identifier "will be used to deliver personalized ads to you", and the second is not true on
> Android. Resolve via Track B5, then restore whichever claims are then accurate.

## 19. Changes to this policy

We may update this policy from time to time. If we make a material change we will notify you inside
the App and update the "Last updated" date above. Continued use of the App after a change means you
accept the updated policy.
