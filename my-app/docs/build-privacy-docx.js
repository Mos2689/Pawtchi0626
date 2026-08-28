// Builds "Privacy Policy - REVISED DRAFT.docx" from the approved revised text.
// The original "Privacy Policy.docx" is left untouched.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, convertInchesToTwip,
} = require('docx');

const INK = '1F1F1F';
const PLACEHOLDER = 'B00020';   // business decisions still open
const NOTE = '5F4B00';          // editorial note text
const NOTE_BG = 'FFF6D5';
const RULE = 'D9D9D9';

// Split on [BRACKETED] segments so open decisions render red + bold.
function runs(text, base = {}) {
  return text.split(/(\[[^\]]+\])/g).filter(Boolean).map(part =>
    part.startsWith('[') && part.endsWith(']')
      ? new TextRun({ text: part, bold: true, color: PLACEHOLDER, ...base })
      : new TextRun({ text: part, color: INK, ...base })
  );
}

// Inline **bold** lead-ins, plus bracket handling.
function richRuns(text) {
  const out = [];
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).forEach(seg => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      out.push(new TextRun({ text: seg.slice(2, -2), bold: true, color: INK }));
    } else {
      out.push(...runs(seg));
    }
  });
  return out;
}

const p = (text, opts = {}) =>
  new Paragraph({ children: richRuns(text), spacing: { after: 160, line: 276 }, ...opts });

const h1 = (text) =>
  new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, color: INK })],
    spacing: { before: 320, after: 160 },
  });

const bullet = (text) =>
  new Paragraph({ children: richRuns(text), numbering: { reference: 'pp-bullets', level: 0 }, spacing: { after: 100, line: 276 } });

// Shaded editorial callout — why this clause changed / what must be decided.
const note = (label, text) =>
  new Paragraph({
    children: [
      new TextRun({ text: `${label}  `, bold: true, color: NOTE }),
      ...text.split(/(\[[^\]]+\])/g).filter(Boolean).map(part =>
        part.startsWith('[')
          ? new TextRun({ text: part, bold: true, color: PLACEHOLDER, italics: true })
          : new TextRun({ text: part, color: NOTE, italics: true })),
    ],
    shading: { type: ShadingType.CLEAR, fill: NOTE_BG },
    border: {
      top: { style: BorderStyle.SINGLE, size: 2, color: NOTE_BG },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: NOTE_BG },
      left: { style: BorderStyle.SINGLE, size: 12, color: NOTE },
      right: { style: BorderStyle.SINGLE, size: 2, color: NOTE_BG },
    },
    spacing: { before: 120, after: 200, line: 264 },
    indent: { left: 180, right: 120 },
  });

// ── Third-party table ──────────────────────────────────────────────────────
const T_WIDTH = 9026, C1 = 2500, C2 = 6526;
const cell = (children, width, opts = {}) =>
  new TableCell({ children, width: { size: width, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, ...opts });

const headerRow = new TableRow({
  tableHeader: true,
  children: [
    cell([new Paragraph({ children: [new TextRun({ text: 'Provider', bold: true, color: INK })] })], C1, { shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' } }),
    cell([new Paragraph({ children: [new TextRun({ text: 'What it handles', bold: true, color: INK })] })], C2, { shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' } }),
  ],
});

const providers = [
  ['Supabase', 'Hosted database, authentication and file storage for your account, pet profiles, logs, walks, reports and pet profile photos.'],
  ['Google (Gemini API)', "Server-to-server analysis of photos and text so the App can return food verdicts, estimate body condition, parse veterinary reports and answer vet-style questions. When you ask a question, your pet's profile — including recorded allergies, medical conditions, and diagnoses and medications extracted from any vet report you scanned — is included so the answer is specific to your animal."],
  ['Google (Firebase Analytics)', 'Measurement of key milestones such as sign-up, profile completion and purchases, linked to your account identifier.'],
  ['PostHog', 'Product analytics and diagnostics, linked to your account identifier.'],
  ['Meta (Facebook App Events)', 'Marketing attribution and measurement. A per-event property allowlist and a PII blocklist strip email, user id, pet name, breed and allergies before any event reaches Meta.'],
  ['RevenueCat', 'Subscription entitlement, receipt validation and restore-purchase support, using an identifier linked to your account.'],
  ['Apple and Google (Play Billing)', 'Payment processing for in-app subscriptions.'],
  ['Expo, Apple (APNs) and Google (FCM)', "Delivery of push notifications. Notification content can include your pet's name and the reason for a health check-in."],
  ['Resend', 'Transactional email such as account confirmations.'],
  ['OpenStreetMap Foundation', 'Map tiles for the walk map. Tile requests reveal the approximate area you are viewing.'],
  ['Open-Meteo', 'Weather at the time of a walk and the current temperature and walk outlook shown on Home. Coordinates are rounded to roughly one kilometre before they leave your device.'],
  ['Apple / Google (operating system geocoding)', "Converting walk coordinates into short place names. This uses your phone's built-in service."],
  ['Unsplash', 'Stock images used as placeholder pet pictures.'],
];

const providerTable = new Table({
  columnWidths: [C1, C2],
  width: { size: T_WIDTH, type: WidthType.DXA },
  rows: [
    headerRow,
    ...providers.map(([name, desc]) => new TableRow({
      children: [
        cell([new Paragraph({ children: [new TextRun({ text: name, bold: true, color: INK })], spacing: { line: 264 } })], C1),
        cell([new Paragraph({ children: [new TextRun({ text: desc, color: INK })], spacing: { line: 264 } })], C2),
      ],
    })),
  ],
});

// ── Document body ──────────────────────────────────────────────────────────
const body = [];

body.push(new Paragraph({
  children: [new TextRun({ text: 'Privacy Policy', bold: true, size: 40, color: INK })],
  spacing: { after: 80 },
}));
body.push(new Paragraph({
  children: [new TextRun({ text: 'REVISED DRAFT — not yet published', bold: true, size: 22, color: PLACEHOLDER })],
  spacing: { after: 240 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
}));

body.push(note('ABOUT THIS DRAFT',
  'Rewritten so every statement matches what the Pawtchi app actually does, verified against the codebase at iOS build 74 / Android versionCode 33. Text in red is a business or legal decision that must be resolved before publication. Shaded notes explain why a clause changed and are not part of the policy — delete them before publishing.'));

[
  '**Company:** Hey Living Club Pty Ltd',
  '**Address:** 128 Tallawong Road, Rouse Hill, NSW 2152, Australia',
  '**Contact:** privacy@heylivingclub.com',
  '**Last updated:** [PUBLICATION DATE]',
].forEach(t => body.push(p(t, { spacing: { after: 60, line: 276 } })));

body.push(p('This Privacy Policy explains how Hey Living Club Pty Ltd (ABN registered in Australia), trading as “Pawtchi” (“we”, “us”, “our”), collects, uses, stores, discloses and protects personal information when you use the Pawtchi mobile application and related services (the “App”).', { spacing: { before: 200, after: 160, line: 276 } }));
body.push(p('We handle personal information in accordance with the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs), the New Zealand Privacy Act 2020 and the Information Privacy Principles (IPPs), and the developer privacy requirements of the Apple App Store and Google Play. This policy is written to be read together with the Pawtchi Terms of Service.'));
body.push(note('VERIFY',
  'The previous policy said “the 13 Australian Privacy Principles” and “the 13 Information Privacy Principles”. The IPP count is no longer 13 — the NZ Privacy Amendment Act 2025 inserted IPP 3A, in force 1 May 2026. The numbers have been dropped above rather than restated incorrectly. Confirm with counsel.'));

body.push(h1('1. Who we are and how to contact us'));
body.push(p('Hey Living Club Pty Ltd is the data controller for personal information collected through the App.'));
body.push(p('Our Privacy Officer is [NAME / ROLE TITLE], contactable at privacy@heylivingclub.com or at the postal address above. For any privacy question, access request, correction request or complaint, please contact us there. We aim to respond within 30 days.'));
body.push(note('DECISION', 'Section 201 of the NZ Privacy Act 2020 requires an appointed Privacy Officer. A role title (“the Privacy Officer”) is sufficient; a named individual is not required.'));

body.push(h1('2. Information we collect'));
body.push(p('We only collect information that is reasonably necessary to run the features you use. We do not collect sensitive information about you as defined in the Privacy Act — we do not ask for your health information, race, religion, political views, sexual orientation or biometric data. Some of what we hold is health information about your pet, which we treat carefully but which is not “sensitive information” about a person.'));

[
  '**Account information.** When you create an account we collect your email address and a password, which is stored only in hashed form by our authentication provider. We do not ask for your legal name, date of birth or government identifiers. We do create a display name for your account by taking the part of your email address before the “@” — this appears on vet reports you export. If you ever sign in through a third-party identity provider, that provider may supply your name and profile picture to us.',
  "**Pet profile information you provide.** Your pet's name, species, breed, sex, whether they are neutered, date of birth or age, current weight, body condition score, activity level, life stage, reproductive status, allergies or intolerances you record, medical conditions you record, diet type, and an optional pet profile photo. This is used to calculate feeding, hydration and activity targets and to personalise guidance.",
  "**Photos you submit.** Photos of pet food, meals, treats, packaging labels and veterinary reports that you capture with the camera or select from your photo library, so the App can analyse them and return a verdict or extract structured information. If you add a photo of your pet, the App may also analyse that photo to estimate your pet's body condition and suggest a starting point, which you can always change. Food and veterinary photos are sent for analysis and are not retained in our file storage; your pet's profile photo is stored so it can be displayed in the App.",
  '**Activity and health logs.** Meals logged, water logged, walks and other activities logged, weight entries and weight-plan assessments, milestones, streaks, ideal-weight estimates, AI-generated verdicts and vet-style answers, saved foods in your pantry, and vet-check-in responses.',
  '**Your daily routine.** If you set up a personalised schedule we collect your usual wake time, bedtime, work start and finish times, preferred walk windows, how far your weekend shifts, your quiet hours, how much notification you want, and how many people in your household walk your pet. This is information about you, not your pet, and it is used only to place reminders at times that suit you.',
].forEach(t => body.push(p(t)));

body.push(p("**Walk location data.** Tracked walks are an optional feature you start deliberately. While a walk is running we collect your device's precise location continuously — roughly one reading every three seconds or every five metres — to measure the route, distance, moving time, pace and rest stops."));
[
  "**What we keep.** A simplified version of the route path, the places where your pet paused or stopped to sniff, short place-name labels for the start, end and farthest points of the walk (obtained by reverse-geocoding those coordinates through your phone's operating system), the weather at the time, and the walk's timing and speed.",
  '**Please be aware.** Because a walk usually begins and ends at home, a stored route and its start label can indicate where you live, and a series of walks can show your usual routine. Only you can see your walks in the App.',
  '**Background behaviour.** So a walk is not lost when your screen locks, tracking continues in the background — on Android through a visible ongoing notification, and on iOS through the system background-location mode with the status indicator showing. Tracking continues even if you close the App, until the walk ends or you end it. We do not collect your location when a walk is not running, and we never request “always allow” background location permission.',
  '**On your device.** A high-detail trace is held on your device only while the walk is running and is erased when the walk finishes. If a finished walk cannot be uploaded straight away it waits on your device until it can be.',
].forEach(t => body.push(bullet(t)));

body.push(p("**Insights we derive.** From your walk history the App works out patterns — how often you repeat a route, roughly what time of day you head out, how many different places you visit, and how often you loop back home — and uses them to give your pet a “Walksign”, a character reading that can change over time. These are conclusions drawn from your movements, and we treat them as personal information.", { spacing: { before: 160, after: 160, line: 276 } }));

[
  '**Purchase information.** If you subscribe, the payment itself is completed by Apple or Google and we never see your card details. We receive subscription entitlement status, plan identifier, purchase and renewal dates, and a subscriber identifier that is linked to your account so we can unlock premium features and restore purchases.',
  '**Rewards.** Streak counts and paw-coin balances earned by logging activity.',
  '**Device and diagnostic information.** Device model, operating system version, app version, language, time zone, an installation identifier, crash reports and IP-derived country. This is used for stability, security, fraud prevention and analytics. On Android, the App can also detect whether Instagram is installed, so it can offer to share a card there.',
  '**Product analytics.** We record which screens you view and which actions you take — for example that onboarding was completed, that the paywall was viewed, or that a walk was started. These records are linked to your account identifier, not anonymous. Our analytics tool also captures interactions automatically, which means text shown on a screen you tap can be recorded. Some events deliberately include pet attributes such as breed, species, weight, body condition score and individual allergens, because we use them to improve guidance quality.',
].forEach(t => body.push(p(t)));

body.push(note('FIX OR SOFTEN',
  'The previous policy claimed a PII allowlist strips this data “before events are sent to third-party analytics or advertising SDKs”. That allowlist exists for Meta and Firebase but NOT for PostHog, and automatic interaction capture bypasses it entirely. The paragraph above states the true position. If the PostHog sink is routed through the existing allowlist and autocapture is disabled, the original stripping claim can be restored.'));

body.push(p('**Push notification token.** If you grant notification permission we store a push token against your account so we can deliver reminders and check-ins. You can revoke notification permission at any time in your device settings.'));
body.push(p('**Advertising identifier.** On iOS we present Apple’s App Tracking Transparency prompt, and the advertising identifier is used only if you tap “Allow”. On Android the advertising identifier is collected by our marketing measurement provider [WHEN THE APP STARTS / ONLY AFTER YOU CONSENT — DEPENDS ON THE ANDROID CONSENT FIX].'));
body.push(note('FIX OR SOFTEN',
  'The previous policy said the advertising identifier was “iOS only, with consent”. The Android manifest declares com.google.android.gms.permission.AD_ID and the Meta SDK is configured to auto-initialise and collect the advertiser ID with no Android consent gate. Either add an Android consent gate and restore the original wording, or state the current position plainly.'));

body.push(h1('3. How we collect information (APP 3, IPP 2–4)'));
body.push(p('We collect information directly from you when you create an account, complete onboarding, log meals, log walks, submit photos, set your routine, ask a question or subscribe. Diagnostic and analytics data is collected automatically from your device as you use the App. Location is collected from your device only while a tracked walk is running. We do not buy personal information from data brokers.'));

body.push(h1('4. Why we use your information (APP 6, IPP 10)'));
body.push(p('We use information for the primary purpose for which it was collected and for directly related secondary purposes you would reasonably expect, including:'));
[
  'operating the food scanner, verdict engine, portion and hydration maths, activity tracking, walk tracking and vet-style Q&A;',
  'generating personalised feeding, hydration and activity plans, a current weather-based walk outlook, vet-ready PDF reports, walk stories and share cards;',
  'deriving the pattern-based insights described in section 2;',
  'delivering reminders, check-ins and streak notifications you have opted in to;',
  'processing subscriptions, restoring purchases and preventing subscription fraud;',
  'measuring product performance, crashes, funnel drop-off and marketing attribution so we can improve the App;',
  'complying with our legal obligations, including under the Privacy Act 1988 (Cth) and the Privacy Act 2020 (NZ).',
].forEach(t => body.push(bullet(t)));

body.push(h1('5. Third parties we share information with (APP 6, IPP 11)'));
body.push(p('We do not sell your personal information. We share the minimum information necessary with the following providers, each of which is bound by contract to protect it:'));
body.push(providerTable);
body.push(p('We may also disclose information if required by law, to enforce our Terms of Service, or to protect the rights, property or safety of Pawtchi, our users or the public.', { spacing: { before: 200, after: 160, line: 276 } }));

body.push(h1('6. Cross-border disclosure (APP 8, IPP 12)'));
body.push(p('Some providers listed above store or process personal information outside Australia and New Zealand. The countries in which recipients are likely to be located are: [UNITED STATES, IRELAND, GERMANY, UNITED KINGDOM — CONFIRM AGAINST ACTUAL VENDOR REGIONS]. Our primary database and file storage are hosted in the [SUPABASE PROJECT REGION] region.'));
body.push(p('Before disclosing personal information overseas we take reasonable steps to ensure the recipient handles it in a manner consistent with the APPs and the IPPs, including through written data-processing agreements.'));

body.push(h1('7. Direct marketing (APP 7)'));
body.push(p("We do not send unsolicited marketing emails. Email from us is transactional — account confirmation, password reset and similar. Push notifications are used for the reminders and check-ins you opted in to and can be turned off at any time in your device settings. We do not use your pet's health information for advertising targeting."));
body.push(note('DECISION',
  'A weekly summary email template exists in the codebase but is not currently sent. If it is switched on it will be a commercial electronic message under the Spam Act 2003 (Cth) and will need express or inferred consent, sender identification and a working unsubscribe link — and this section will need rewriting.'));

body.push(h1('8. Device permissions'));
body.push(p('The App may request the following permissions. All are optional and can be revoked at any time in your device settings:'));
[
  '**Camera** — to scan pet food and veterinary documents.',
  '**Photo library** — to select a pet profile photo or an existing food photo. The App may also save a scanned food image back to your library.',
  '**Location (while in use)** — to record tracked walks. Tracking continues in the background while a walk is active, shown by an ongoing notification on Android and the status indicator on iOS. We do not request “always allow” background location.',
  '**Notifications** — to deliver reminders, activity nudges and vet check-ins.',
  '**App Tracking Transparency (iOS)** — required by Apple before any cross-app tracking identifier is used.',
].forEach(t => body.push(bullet(t)));
body.push(note('FIX OR SOFTEN',
  'The Android manifest also declares RECORD_AUDIO (confirmed unused), SYSTEM_ALERT_WINDOW, READ_EXTERNAL_STORAGE and WRITE_EXTERNAL_STORAGE. Remove the unused ones; anything that remains must be listed here and answered in the Play Data Safety form.'));

body.push(h1('9. Anonymity and pseudonymity (APP 2)'));
body.push(p("Wherever it is lawful and practicable, you may deal with us anonymously or under a pseudonym. In practice the App requires an email address so your pet's records can be kept securely, synced to your devices and restored if you reinstall — so an account cannot be anonymous. You are welcome to use a pseudonymous email address and a nickname for your pet. You can contact us anonymously with a general privacy enquiry, though we may be unable to action an access or correction request without verifying who you are."));

body.push(h1('10. Data quality (APP 10, IPP 8)'));
body.push(p('We take reasonable steps to ensure the personal information we hold is accurate, up to date, complete and relevant. You can review and update your account, pet and routine information at any time from the Profile tab.'));

body.push(h1('11. Security (APP 11, IPP 5)'));
body.push(p('We use technical and organisational measures to protect your information, including encryption in transit (TLS), encryption at rest on our infrastructure providers, hashed passwords, row-level security so each account can only reach its own records, restricted staff access on a need-to-know basis, and rate limiting on our server functions.'));
body.push(p('You should also know:'));
[
  "Your pet's profile photo is served from a public web address. The address is long and effectively unguessable, but anyone you give it to can open it without signing in.",
  'Some information — your sign-in session, an unsent walk and vet reports you have exported to PDF — is held in your device’s own storage, protected by your device’s security rather than by ours.',
].forEach(t => body.push(bullet(t)));
body.push(p('No system is perfectly secure. If we become aware of an eligible data breach likely to result in serious harm, we will notify affected users and the Office of the Australian Information Commissioner (OAIC) as required under the Notifiable Data Breaches scheme, and the Office of the Privacy Commissioner (NZ) as required under the Privacy Act 2020.'));
body.push(note('FIX OR SOFTEN',
  '“Audit logging” has been removed from this list because none is implemented. The two bullets above become unnecessary if the photo bucket is made private with signed URLs, the session is moved to secure storage, and cached PDFs are deleted after sharing.'));

body.push(h1('12. Retention and deletion'));
body.push(p('We keep personal information only for as long as we need it to provide the App or as required by law.'));
[
  '**Account deletion.** When you delete your account from the Profile screen we permanently delete your account, pet profiles, logs, photos, walks and routes, saved foods, veterinary documents and reports from our operational data stores.',
  '**Individual records.** You can delete individual food scans, saved pantry foods and veterinary reports from within the App at any time. Walks cannot currently be deleted individually; they are removed when the pet or the account is deleted.',
  '**Retention periods.** We do not currently apply a fixed retention period. Walk routes and location detail, and your other pet records, are kept for the life of the account and are deleted when you delete the pet or the account.',
  '**What survives deletion.** Financial records we must keep for tax and audit purposes are retained for the period required by law. Analytics and marketing records held by our providers are keyed to your account identifier and are removed on request — contact us if you want them erased at the same time as your account.',
].forEach(t => body.push(bullet(t)));
body.push(note('FIX OR SOFTEN',
  'The last bullet reflects reality: account deletion does not currently fan out to PostHog, Firebase, Meta or RevenueCat. If that fan-out is built, replace it with a statement that those records are deleted automatically.'));
body.push(note('DECISION — STILL OPEN',
  'A retention period for walk location data is still needed. The “Retention periods” bullet above states the current position — indefinite retention for the life of the account. That is honest, but difficult to defend under APP 11.2 / IPP 9, which require personal information to be destroyed or de-identified once no longer needed, and a walk route whose start point identifies a home address is exactly the data that argument bites on. Do NOT restore a fixed period until the purge job exists: an earlier draft asserted “kept for 12 months”, but no such job is implemented — there is no pg_cron schedule and nothing in supabase/migrations that deletes aged walk geometry. Sequence: pick a period, build the purge, then update the policy source, this script and app/privacy.tsx together.'));

body.push(h1('13. Your rights — access, correction and complaints (APP 12/13, IPP 6/7)'));
body.push(p('You have the right to ask for access to the personal information we hold about you and to ask that it be corrected. Most information is directly viewable and editable inside the App. For anything else, email privacy@heylivingclub.com.'));
[
  'We do not charge for making a request, or for correcting information.',
  'We will ask you to verify your identity — normally by writing from the email address on the account — before we release or change anything.',
  'We will respond within 30 days.',
  'If we refuse a request in whole or in part we will tell you why in writing and explain how to complain.',
].forEach(t => body.push(bullet(t)));
body.push(p('If you believe we have breached the Australian Privacy Principles or the New Zealand Information Privacy Principles, please contact us first so we can try to resolve it. If you are not satisfied you may complain to:'));
[
  'Office of the Australian Information Commissioner (OAIC) — oaic.gov.au or 1300 363 992.',
  'Office of the Privacy Commissioner (New Zealand) — privacy.org.nz or 0800 803 909.',
].forEach(t => body.push(bullet(t)));

body.push(h1('14. Automated processing and AI'));
body.push(p('Pawtchi uses automated processing, including AI models, to produce food verdicts, estimate body condition from a photo, calculate feeding and weight plans, generate vet-style answers and derive the insights described in section 2. These outputs are guidance for you to consider — they are not veterinary advice, they do not make decisions about you, and they do not affect your legal rights or your access to any service. You can always override a suggestion, and you should consult a veterinarian for anything clinical.'));
body.push(note('DECISION',
  "From 10 December 2026, APP 1.7 (inserted by the Privacy and Other Legislation Amendment Act 2024) requires privacy policies to disclose automated decision-making that significantly affects an individual's rights or interests. Our assessment is that Pawtchi's automated processing falls outside that threshold because it concerns pet care and is advisory only. Record that assessment before the deadline."));

body.push(h1('15. Sharing content from the App'));
body.push(p('The App lets you share walk stories, milestone cards and invitations to friends and to social apps such as Instagram. When you choose to share:'));
[
  "a walk or story card can include your pet's name, a drawing of your walking route and a place-name label — and, because walks usually start at home, this can indicate the area you live in;",
  "an invitation message includes your pet's name;",
  'once shared, that content is handled by whichever app or service you sent it to, under their privacy policy, not ours.',
].forEach(t => body.push(bullet(t)));
body.push(p('Sharing is always your choice — nothing is posted anywhere on your behalf.'));

body.push(h1('16. Subscriptions and billing'));
body.push(p('All subscription purchases are processed by Apple or Google. Financial data (card number, billing address) is handled directly by them and is never received by Hey Living Club Pty Ltd. You can manage or cancel subscriptions from your device: on iOS via Settings → Apple ID → Subscriptions; on Android via Google Play Store → Payments & subscriptions → Subscriptions.'));

body.push(h1('17. Children'));
body.push(p('Pawtchi is not directed to children under 13, and we do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact privacy@heylivingclub.com and we will delete it.'));

body.push(h1('18. Apple App Store and Google Play disclosures'));
body.push(p('We publish an Apple Privacy Nutrition Label and a Google Play Data Safety declaration alongside this policy. Those disclosures reflect the same data categories described here: contact info (email); user content (photos of food and veterinary reports, pet profile photo); health & fitness (pet weight, body condition, activity); identifiers (installation and subscriber identifiers linked to your account); purchases; location (precise, only while a walk is active); app activity; and diagnostics. We do not sell your data.'));
body.push(note('FIX OR SOFTEN',
  'The previous policy also claimed “We do not use your data for third-party advertising” and “we do not use it for tracking as defined by Apple unless you grant App Tracking Transparency consent”. The first sits badly against the ATT prompt string, which tells users the identifier “will be used to deliver personalized ads to you”. The second is not true on Android. Resolve the Android consent gate, then restore whichever claims are then accurate.'));

body.push(h1('19. Changes to this policy'));
body.push(p('We may update this policy from time to time. If we make a material change we will notify you inside the App and update the “Last updated” date above. Continued use of the App after a change means you accept the updated policy.'));

// ── Assemble ───────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [{
      reference: 'pp-bullets',
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.18) } } },
      }],
    }],
  },
  styles: { default: { document: { run: { font: 'Calibri', size: 21, color: INK } } } },
  sections: [{
    properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    children: body,
  }],
});

const OUT = process.argv[2];
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('wrote', OUT, buf.length, 'bytes');
});
