// Builds "Terms of Service - REVISED DRAFT.docx" from terms-and-conditions-draft.md.
//
// Same conventions as build-privacy-docx.js, so the two review copies look alike:
//   - [BRACKETED] text renders red + bold  -> an open business or legal decision
//   - shaded callouts explain why a clause changed and are NOT part of the contract
//
// `docx` is not a dependency of this project. Install it wherever you run this:
//   npm i docx && node docs/build-terms-docx.js "Terms of Service - REVISED DRAFT.docx"
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, convertInchesToTwip,
} = require('docx');

const INK = '1F1F1F';
const PLACEHOLDER = 'B00020';   // decisions still open
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

const h2 = (text) =>
  new Paragraph({
    children: [new TextRun({ text, bold: true, size: 23, color: INK })],
    spacing: { before: 220, after: 120 },
  });

const bullet = (text) =>
  new Paragraph({
    children: richRuns(text),
    numbering: { reference: 'tos-bullets', level: 0 },
    spacing: { after: 100, line: 276 },
  });

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

// ── Open-items table ───────────────────────────────────────────────────────
const T_WIDTH = 9026, O1 = 520, O2 = 6706, O3 = 1800;
const cell = (children, width, opts = {}) =>
  new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    ...opts,
  });

const th = (text, width) =>
  cell([new Paragraph({ children: [new TextRun({ text, bold: true, color: INK })] })], width,
    { shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' } });

const openItems = [
  ['1', 'Registered ABN, and the entity / trading-name construction', 'Header, 1, 25'],
  ['2', 'One contact address for legal notices, consistent with the Privacy Policy', 'Header, 6, 25'],
  ['3', "Minimum contracting age, reconciled with the Policy's under-13 statement and the store age ratings", '2'],
  ['4', 'Distribution territories', '2'],
  ['5', 'Confirm the Animal Poisons Helpline numbers are current', '4'],
  ['6', 'Confirm exactly what an unsubscribed user retains after day 30, and that logged records remain reachable in the UI', '12.1'],
  ['7', 'Liability cap quantum', '16'],
  ['8', 'Governing-law State and the New Zealand carve-out wording', '22'],
  ['9', 'Whether material changes need affirmative re-acceptance or notice alone', '23'],
  ['10', 'Published URLs for the Terms and the Privacy Policy', '19, 23'],
  ['11', 'Confirm the NZ Information Privacy Principle count — the Privacy Amendment Act 2025 inserted IPP 3A in force 1 May 2026, so "the 13 IPPs" is likely wrong', '19, and Privacy Policy'],
];

const openItemsTable = new Table({
  columnWidths: [O1, O2, O3],
  width: { size: T_WIDTH, type: WidthType.DXA },
  rows: [
    new TableRow({
      tableHeader: true,
      children: [th('#', O1), th('Item', O2), th('Clause', O3)],
    }),
    ...openItems.map(([n, item, clause]) => new TableRow({
      children: [
        cell([new Paragraph({ children: [new TextRun({ text: n, color: INK })], spacing: { line: 264 } })], O1),
        cell([new Paragraph({ children: [new TextRun({ text: item, color: INK })], spacing: { line: 264 } })], O2),
        cell([new Paragraph({ children: [new TextRun({ text: clause, color: INK })], spacing: { line: 264 } })], O3),
      ],
    })),
  ],
});

// ── Document body ──────────────────────────────────────────────────────────
const body = [];

body.push(new Paragraph({
  children: [new TextRun({ text: 'Pawtchi Terms of Service', bold: true, size: 40, color: INK })],
  spacing: { after: 80 },
}));
body.push(new Paragraph({
  children: [new TextRun({ text: 'REVISED DRAFT — not yet published', bold: true, size: 22, color: PLACEHOLDER })],
  spacing: { after: 240 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
}));

body.push(note('ABOUT THIS DRAFT',
  'Rewritten so every clause matches what the Pawtchi app actually does, verified against the codebase at iOS build 74 / Android versionCode 33 / app version 1.0.18. This replaces the 13-section page currently live at pawtchi.com/terms, which was written for a much smaller product. Text in red is a business or legal decision that must be resolved before publication. Shaded notes explain why a clause was added or changed and are NOT part of the contract — delete them before publishing. The companion gap register, terms-gap-review.md, explains the exposure each clause is closing. Read together with the revised Privacy Policy: where the two touch the same subject, the Privacy Policy governs.'));

[
  '**Company:** Hey Living Club Pty Ltd [ABN], trading as “Pawtchi”',
  '**Address:** 128 Tallawong Road, Rouse Hill, NSW 2152, Australia',
  '**Contact:** [SINGLE LEGAL/SUPPORT ADDRESS]',
  '**Effective date:** [PUBLICATION DATE]',
  '**Version:** [VERSION]',
].forEach(t => body.push(p(t, { spacing: { after: 60, line: 276 } })));

body.push(note('DECISION',
  'The live Terms name no legal entity at all — only “Pawtchi”, which is a trading name, with support@pawtchi.com. The Privacy Policy contracts as Hey Living Club Pty Ltd with privacy@heylivingclub.com. A consumer contract that does not identify its counterparty is difficult to enforce and inconsistent with the policy published beside it. Confirm the registered ABN, and settle on one contact address used in both documents.'));

// 1
body.push(h1('1. These terms, and how you accept them'));
body.push(p('These Terms of Service (“**Terms**”) are an agreement between you and Hey Living Club Pty Ltd [ABN] (“**we**”, “**us**”, “**our**”), trading as Pawtchi. They govern your use of the Pawtchi mobile application, the Pawtchi website, and everything we provide through them (together, the “**App**”).'));
body.push(p('When you create a Pawtchi account, the sign-up screen tells you that these Terms and our Privacy Policy apply and links you to both. By creating an account, or by continuing to use the App, you accept these Terms. If you do not accept them, please do not use the App.'));
body.push(p('If you do not have an account, these Terms still apply to any part of the App you use — for example browsing the website.'));
body.push(note('NOTE',
  'This describes the acceptance mechanism that actually exists: a collection notice with two links, shown on the sign-up form only. There is no tick-box. A conspicuous sign-in-wrap of this kind is generally enforceable, but for a contract carrying a liability cap it is the weaker option — see gap review item 30.'));

// 2
body.push(h1('2. Who can use Pawtchi'));
body.push(p('To hold a Pawtchi account you must be at least [MINIMUM AGE] years old and able to enter into a binding contract where you live. If you are under that age, you may use the App only with the involvement of a parent or guardian who accepts these Terms on your behalf and is responsible for your use of it.'));
body.push(p('Pawtchi is offered to people in Australia and New Zealand [CONFIRM DISTRIBUTION TERRITORIES]. We make no claim that the App is appropriate or available anywhere else, and you are responsible for complying with your local law if you use it from elsewhere.'));
body.push(p('The App is for your own personal, non-commercial use in caring for animals in your household. You may not use it to run a commercial animal operation — including a breeding, boarding, kennel, cattery, rescue, shelter, grooming, training or veterinary business — or to provide services to other people’s animals, without a separate written agreement with us.'));
body.push(note('DECISION',
  'The Privacy Policy says Pawtchi “is not directed to children under 13”. The Terms currently set no age at all. These two need to agree, and the number also has to match the App Store and Play age ratings. 13 aligns with the policy but leaves contracting-capacity problems in both AU and NZ; 16 or 18 is cleaner contractually.'));

// 3
body.push(h1('3. What Pawtchi is — and what it is not'));
body.push(p('Pawtchi is an **informational pet-care tracking tool** for dog and cat owners. It helps you record meals, water, weight, activity and health notes, and it produces guidance, estimates and summaries from what you record.'));
body.push(p('**Pawtchi is not a veterinary service.** We are not a veterinary practice. We do not employ veterinarians to review your animal, and no vet–client–patient relationship is created by your use of the App. Nothing in the App is a diagnosis, a treatment plan, a prescription, or a medical device. Pawtchi does not examine your animal — it only works from what you tell it and the photos you give it.'));
body.push(p('Feature availability varies. Some features are available only on one platform, only for one species, or only to subscribers. Walk tracking and everything built on it — walk stories, route galleries, Walksigns — are currently available for dogs only.'));
body.push(note('NOTE',
  'The live Terms describe Pawtchi as serving “dog and cat owners” with no qualification. Walk features are gated to dogs, so a cat owner who paid partly for walk tracking has a straightforward misleading-conduct complaint.'));

// 4
body.push(h1('4. Not veterinary advice — please read this clause'));
body.push(p('This is the most important clause in these Terms.'));
body.push(p('**Everything Pawtchi produces is general information, not veterinary advice.** That includes, without limitation:'));
[
  'food and treat verdicts produced from a scan of a product, label or meal;',
  'allergen and toxic-ingredient warnings, and the absence of such warnings;',
  'calorie targets, portion sizes, hydration targets and weight-change plans;',
  'body condition score estimates, whether suggested from a photo or from the hands-on check;',
  'answers produced by the Ask-a-Vet feature;',
  'information extracted from veterinary documents you scan, including diagnoses, medications and test results;',
  'the vet-ready PDF summary you can export;',
  'activity, walk and routine recommendations, reminders and check-ins;',
  'Walksigns, milestones, insights and any other characterisation of your animal.',
].forEach(t => body.push(bullet(t)));
body.push(p('**You must not rely on the App to decide whether something is safe for your animal.** Our ingredient and allergen screening works from lists and from text the App reads off a label or photo. It can miss things. A product may contain an ingredient that is not listed, that is listed under a name we do not recognise, that the App misreads, or that is harmful to your particular animal for reasons the App cannot know. **The absence of a warning is not a statement that a food is safe.** Always read the label yourself, and check with your veterinarian if you are unsure.'));
body.push(p('**Do not use Pawtchi in an emergency.** If your animal is unwell, injured, in distress, or has eaten something that may be harmful, contact your veterinarian or an emergency animal hospital immediately. Do not wait for the App, and do not use the App instead of calling. In Australia, the Animal Poisons Helpline is available on 1300 869 738; in New Zealand, on 0800 869 738. [VERIFY THESE NUMBERS ARE CURRENT BEFORE PUBLICATION]'));
body.push(p('**Consult a veterinarian before acting on nutrition or weight guidance**, particularly if your animal is very young, elderly, pregnant or nursing, has any diagnosed condition, is taking medication, or is significantly over or under weight. Calorie restriction carries real risks — including, in cats, hepatic lipidosis — and an underlying illness can make a plan that would otherwise be sensible actively harmful. Where the App itself tells you to confirm a plan with your vet, you agree to do so before relying on the target it has produced.'));
body.push(p('**The exported vet report is your document, not ours.** It is a summary assembled from the records you entered and from documents you scanned. It is not a clinical record, it has not been reviewed by a veterinarian, and it may contain errors or omissions. If you give it to a veterinarian, you are responsible for checking it first, and your vet should treat it as owner-reported history only.'));
body.push(p("**You remain responsible for your animal.** Decisions about your animal's diet, exercise, weight and health are yours, made with your veterinarian. You accept that you make them at your own risk."));
body.push(note('NOTE',
  'The live section 5 covers only “nutritional and activity guidance based on publicly available veterinary science”. It does not reach AI answers, OCR of clinical documents, the exported PDF, or — most seriously — allergen and toxin screening, where a false negative can kill an animal. This clause is the single largest change in the draft. See gap review items 4 to 8.'));

// 5
body.push(h1('5. Automated processing and AI'));
body.push(p('Pawtchi uses automated systems, including third-party AI models, to read photos and documents, produce verdicts and answers, estimate body condition, and derive patterns from your records.'));
body.push(p('You should understand that:'));
[
  '**These systems are probabilistic and can be wrong.** They can misread a label, misidentify a product, misjudge a body condition, miss an ingredient, or produce an answer that sounds confident and is not correct.',
  "**Text extracted from documents may be inaccurate.** When you scan a veterinary report, the App reads it automatically. A misread medication name, dose, date or diagnosis can carry through into your pet's profile, into the guidance you are given, and into the report you export. Check extracted information against the original document.",
  '**Suggestions are starting points.** Where the App suggests a value — a body condition score, a weight, an ingredient — you can change it, and you should change it if you think it is wrong.',
  '**Outputs are not decisions about you.** They do not affect your legal rights or your access to any service. They concern the care of an animal and are advisory only.',
].forEach(t => body.push(bullet(t)));
body.push(p('You must not use the App, or anything it produces, to develop, train, evaluate or improve any machine-learning model or competing product, or to extract our content or outputs in bulk by any automated means.'));
body.push(note('NOTE',
  'The final paragraph protects a commercial interest the live Terms leave open. The “not decisions about you” wording is drafted to be consistent with the position recorded at section 14 of the Privacy Policy on APP 1.7 (automated decision-making, in force 10 December 2026). If that assessment changes, both documents change together.'));

// 6
body.push(h1('6. Your account'));
body.push(p('You need an account to use most of the App. You agree to:'));
[
  'give accurate information when you sign up, and keep it up to date;',
  'keep your password confidential, and not share your account or let anyone else sign in as you;',
  'tell us promptly at [CONTACT ADDRESS] if you believe your account has been accessed without your permission.',
].forEach(t => body.push(bullet(t)));
body.push(p('One account is for one person. Other members of your household are welcome to help care for the animals recorded in your account, but you remain responsible for everything done through it.'));
body.push(p('You can delete your account at any time from the Profile screen. What happens to your information when you do is set out in our Privacy Policy.'));

// 7
body.push(h1('7. Acceptable use'));
body.push(p('You may use the App only lawfully and as these Terms allow. You agree not to:'));
[
  'use the App for any unlawful, fraudulent or harmful purpose;',
  'use the App in connection with animal cruelty or neglect, or to support any unlawful treatment of an animal;',
  'reverse-engineer, decompile or disassemble any part of the App, except to the extent that restriction is unenforceable by law;',
  'transmit malware, or interfere with or place unreasonable load on the App or our infrastructure;',
  'scrape, harvest, crawl or bulk-collect data or content from the App;',
  'circumvent, disable or interfere with security features, rate limits, usage caps or paywalls, or access the App by any means other than the published interface;',
  'use the Ask-a-Vet feature or any other AI feature to seek advice about a human being, including medical, legal or financial advice;',
  'attempt to manipulate an AI feature into producing content that is unlawful, deceptive, or outside the purpose of the App, including by embedding instructions in text, photos or documents you submit;',
  'impersonate anyone, or misrepresent your relationship with an animal or a person;',
  'resell, sublicense or commercially exploit the App or its outputs.',
].forEach(t => body.push(bullet(t)));
body.push(p('We apply usage limits to protect the service and control cost. These are described in clause 12 and may change.'));

// 8
body.push(h1('8. Content you provide'));
body.push(p('You keep ownership of the photos, documents, notes and other content you put into the App (“**your content**”).'));
body.push(p('You grant us a non-exclusive, royalty-free, worldwide licence to host, store, copy, transmit, analyse, adapt and display your content, and to send it to the service providers listed in our Privacy Policy, **only so that we can operate the App and provide the features you use**. This licence ends when you delete the content or your account, except for copies we are required to keep by law or that remain in routine backups until they expire.'));
body.push(p('You promise that, for everything you upload:'));
[
  'you own it or have the right to provide it;',
  "it does not infringe anyone's copyright, trade mark or other rights;",
  "**if it shows a person other than you, you have that person's permission** for you to upload it and for us to process it as described above; and",
  'it is not unlawful, abusive, deceptive or obscene.',
].forEach(t => body.push(bullet(t)));
body.push(p('We do not routinely review your content. We may remove content, or suspend access to it, if we reasonably believe it breaches these Terms or the law, or if we are required to.'));
body.push(note('NOTE',
  'The live section 7 licence is granted “for the purpose of providing the Service” but has no user warranty at all. Users upload food photos, pet photos and scanned veterinary documents; those photos routinely contain other people, and the veterinary documents are authored by a third party.'));

// 9
body.push(h1('9. Sharing what you create'));
body.push(p('The App can build shareable images and messages — walk stories, moment and milestone cards, route gallery images, and invitations. Sharing is always something you start. **We never post anything on your behalf, to any platform, at any time.**'));
body.push(p('Before you share, please understand:'));
[
  "a walk or story card can include your pet's name, a drawing of your route, and a place-name label for where the walk started or ended. Because walks usually begin and end at home, **sharing one can indicate roughly where you live**;",
  "an invitation message includes your pet's name and a link to pawtchi.com;",
  'once you have shared something, it is handled by whichever app or platform you sent it to, under that platform’s terms and privacy policy — not ours. We cannot recall it for you.',
].forEach(t => body.push(bullet(t)));
body.push(p('You are responsible for what you choose to share, including making sure you have the right to share anything in it that involves another person or their property.'));

// 10
body.push(h1('10. Walk tracking, and staying safe'));
body.push(p('Walk tracking records your location while a walk is running, so the App can measure the route, distance, time and pace. It is optional, you start it deliberately, and you can end it at any time. Location is not collected when a walk is not running.'));
body.push(p("**Your safety and your animal's safety are your responsibility.** When you use walk tracking you agree that:"));
[
  'you will pay attention to your surroundings — traffic, roads, other people, other animals and hazards — and not to your phone;',
  'you are responsible for complying with local laws and council rules about leashing, off-leash areas, access, and cleaning up after your animal;',
  "you will judge for yourself whether a walk is appropriate for your animal's age, breed, health and the weather on the day, regardless of what the App suggests;",
  'you will not use tracking to follow, monitor or record another person.',
].forEach(t => body.push(bullet(t)));
body.push(p("**Measurements are estimates.** Distance, pace, elevation, route shape, rest stops and sniff stops are derived from your device's location sensors. Accuracy depends on your phone, its settings, the weather, and how much sky your device can see. Readings can be wrong, sometimes substantially, and should not be relied on for anything that matters."));
body.push(p("**A walk can be lost.** Tracking continues in the background while a walk is active — on Android through an ongoing notification, on iOS through the system background-location mode. Even so, your device's operating system can stop the App to save battery, your phone can run out of charge, and a finished walk may not upload until you are back online. We do our best to recover walks, but we cannot promise that every walk will be recorded, completed or saved."));
body.push(note('NOTE',
  'The live Terms have no walk clause of any kind. This is a feature that puts a person on a road looking at a phone, records where they live, and runs a foreground service. See gap review item 9.'));

// 11
body.push(h1('11. Streaks and PawCoins'));
body.push(p('The App awards streaks and PawCoins when you log activity. These are a progress feature, nothing more.'));
body.push(p('PawCoins and streaks:'));
[
  '**have no monetary value** and are not currency, credit, a gift card, a financial product, or property;',
  'cannot be bought, sold, transferred, exchanged, withdrawn or redeemed for money or anything of value outside the App;',
  'may be earned, adjusted, reduced, expired or removed by us at any time, including where we reasonably believe they were obtained by error, abuse or manipulation;',
  'are forfeited when your account is closed, by you or by us, and are not compensable.',
].forEach(t => body.push(bullet(t)));
body.push(p('We may change how they are earned, what they do, or discontinue them entirely, at any time.'));
body.push(note('NOTE',
  'PawCoins are live — awarded server-side and shown in the Home header on every earn — and are currently governed by nothing at all. This clause is deliberately drafted so it also covers a future in-app spend, without describing a store that does not yet exist.'));

// 12
body.push(h1('12. Free access, subscriptions and payment'));

body.push(h2('12.1 Your first 30 days'));
body.push(p('When you create an account you get **full access to Pawtchi’s paid features free for 30 days**. You do not need to enter payment details, there is nothing to cancel, and it does not become a paid subscription by itself.'));
body.push(p('When those 30 days end, paid features stop being available unless you subscribe. [DECISION — CONFIRM WHAT REMAINS AVAILABLE: the current build sends unsubscribed users to the paywall from the Meal, Health, Activity and Walk surfaces, which is effectively the whole App.]'));
body.push(p('**Your records stay yours.** Ending the free period, or letting a subscription lapse, does not delete anything you have logged. If you subscribe later, your history is still there. You can request a copy of your information at any time under our Privacy Policy, whether or not you are a subscriber.'));
body.push(note('DECISION',
  'This describes FREEMIUM_DAYS = 30 in providers/SubscriptionProvider.tsx. The live Terms mention only “a free tier and a paid subscription” and never say the free window ends — the misleading-conduct exposure at gap review item 10. Two things need confirming before publication: (a) exactly what an unsubscribed user can still do after day 30, and (b) whether access to previously logged records is genuinely preserved in the UI, not just in the database. Do not publish the sentence about records staying available until (b) is confirmed in the build.'));

body.push(h2('12.2 Pawtchi Plus'));
body.push(p('Pawtchi Plus is an auto-renewing subscription, offered as a monthly or annual plan.'));
[
  'The price, plan length, renewal date and any introductory offer are shown in the App before you confirm. Pricing is set per region and may differ from the examples in any marketing material.',
  'Payment is charged to your Apple App Store or Google Play account when you confirm the purchase.',
  'Your subscription renews automatically at the then-current price for the same period, unless you cancel at least 24 hours before the end of the current period.',
  'You can cancel at any time in your store account: on iOS, Settings → Apple ID → Subscriptions; on Android, Google Play → Payments & subscriptions → Subscriptions. Cancelling stops the next renewal; you keep access until the end of the period you have paid for.',
  'If an offer includes a free trial period, any unused part of it is forfeited when you purchase a subscription, where the store applies that rule.',
].forEach(t => body.push(bullet(t)));
body.push(p('**We never see your card details.** All payments are processed by Apple or Google.'));

body.push(h2('12.3 Price changes'));
body.push(p('If we change the price of a subscription, the new price will not apply to your renewals until we have given you notice and, where the App Store or Google Play requires it, you have agreed to the new price. If you do not agree, your subscription will not renew at the new price and will end at the close of your current period.'));
body.push(note('NOTE',
  'The live section 8 says only “Prices may change with notice”, which does not meet the store rules for auto-renewing subscriptions and reads as an unfair contract term.'));

body.push(h2('12.4 Refunds'));
body.push(p('Purchases are made through the App Store or Google Play, and refunds are handled by them under their own policies. We cannot process a store refund for you, but tell us if something has gone wrong and we will help where we can.'));
body.push(p('**This does not affect your rights under clause 15.** If you are entitled to a remedy under the Australian Consumer Law or the New Zealand Consumer Guarantees Act, you have that remedy regardless of the store’s refund policy.'));

body.push(h2('12.5 Usage limits'));
body.push(p('Some features have limits, so the service stays available and affordable for everyone:'));
[
  '**Ask-a-Vet** — up to **4 new assessments per calendar month**, resetting on the first of the month. Each assessment allows up to **3 follow-up questions**, which do not count against your monthly total. Questions are limited to 500 characters.',
  'Scanning, report parsing and other AI features are subject to hourly limits to prevent abuse.',
].forEach(t => body.push(bullet(t)));
body.push(p('Current limits are shown in the App. We may change them, and we will not reduce them materially during a period you have already paid for without telling you first.'));
body.push(note('NOTE',
  'These are the real numbers from supabase/functions/ask-vet/index.ts plus the hourly guards in _shared/rateLimit.ts. Selling a feature and capping it without disclosure is an ACL s29 risk.'));

// 13
body.push(h1('13. Availability and changes to the App'));
body.push(p('We work to keep Pawtchi available, but we do not promise it will be uninterrupted or error-free. We may need to suspend it for maintenance, and it depends on services we do not control — your device, your network, and the providers listed in our Privacy Policy.'));
body.push(p('We may add, change, limit or remove features. Some features are released progressively or as trials, and may be changed or withdrawn without notice. Where a change materially reduces what a paid subscription provides, we will tell you before it takes effect and, if you are not willing to continue, you may cancel and ask us for a pro-rata refund of the unused part of your current period.'));

// 14
body.push(h1('14. Our intellectual property'));
body.push(p('The App — its software, design, branding, text, illustrations and the Pawtchi name and marks — is owned by us or our licensors and is protected by intellectual property law. We grant you a personal, limited, non-exclusive, non-transferable, revocable licence to use the App for the purposes set out in these Terms. Nothing else is granted.'));
body.push(p('You may keep and share the cards, stories and reports the App generates for you, for your own non-commercial use.'));

// 15
body.push(h1('15. Your rights as a consumer — Australia and New Zealand'));
body.push(p('**Nothing in these Terms excludes, restricts or modifies any right or remedy you have that cannot be excluded, restricted or modified by law.**'));
body.push(p('**In Australia**, our services come with guarantees that cannot be excluded under the Australian Consumer Law (Schedule 2 to the Competition and Consumer Act 2010 (Cth)) — including that services will be supplied with due care and skill and will be fit for the purpose disclosed. For a major failure you are entitled to cancel your service contract and to a refund for the unused portion, or to compensation for the reduced value of the service. You are also entitled to be compensated for any other reasonably foreseeable loss or damage. If the failure is not major, you are entitled to have the problem fixed in a reasonable time and, if it is not, to cancel and get a refund for the unused portion.'));
body.push(p('**In New Zealand**, if you acquire the App as a consumer, the Consumer Guarantees Act 1993 applies and nothing in these Terms limits it. If you acquire the App for business purposes, the Consumer Guarantees Act and sections 9, 12A and 13 of the Fair Trading Act 1986 do not apply, and you agree it is fair and reasonable that they are excluded.'));
body.push(p('Where we are permitted by law to limit our liability for a failure to comply with a consumer guarantee, our liability is limited, at our option, to re-supplying the service or paying the cost of having it re-supplied.'));
body.push(note('NOTE',
  'The live Terms have no clause of this kind. Their section 9 excludes liability “to the fullest extent permitted by law” with nothing preserving the consumer guarantees. That exclusion is void as against the guarantees under ACL s64, and stating it may itself be a false or misleading representation about a consumer’s rights under ACL s29(1)(m) — with equivalents in CGA s43 and FTA s13(i). This clause is not optional.'));

// 16
body.push(h1('16. Limitation of liability'));
body.push(p('**This clause operates subject to clause 15 and does not limit anything clause 15 preserves.**'));
body.push(p('To the extent the law allows:'));
[
  'we are not liable for indirect, incidental, special or consequential loss, or for loss of profit, revenue, data, goodwill or anticipated savings, however caused;',
  'we are not liable for loss you suffer because of something outside our reasonable control, including your device or its operating system, your network, or a third-party service the App relies on;',
  "we are not liable for a decision you make about your animal's diet, exercise, weight, treatment or care, whether or not the App informed it; and",
  'our total aggregate liability to you for all claims arising out of or in connection with these Terms or the App is limited to [LIABILITY CAP — e.g. the total amount you paid us in the 12 months before the event giving rise to the claim, or AUD $X if you have paid us nothing].',
].forEach(t => body.push(bullet(t)));
body.push(p('Nothing in these Terms limits our liability for death or personal injury caused by our negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot be limited by law.'));
body.push(note('DECISION',
  'The cap needs a number. A 12-month-fees cap is the usual position for a consumer subscription, but it needs to be a deliberate choice, and counsel should sanity-check it against the unfair-contract-terms regime given the sums involved are small.'));

// 17
body.push(h1('17. Indemnity'));
body.push(p('You agree to indemnify us against loss we suffer arising from **your** breach of clause 7 (Acceptable use), clause 8 (Content you provide) or clause 9 (Sharing what you create), or from your unlawful use of the App.'));
body.push(p('This does not apply to the extent the loss was caused by our own breach, negligence or wrongful act, and we will tell you promptly about any claim, let you participate in its defence, and not settle it without your consent (not to be unreasonably withheld).'));
body.push(note('NOTE',
  'The live Terms have no indemnity. An unqualified one would be a strong candidate for an unfair contract term under the penalty-backed regime, so this is deliberately narrow and carries the usual conduct-of-claims protections.'));

// 18
body.push(h1('18. Suspension and termination'));
body.push(p('**You** can stop using the App and delete your account at any time.'));
body.push(p('**We** may suspend or terminate your access if:'));
[
  'you materially breach these Terms;',
  'we reasonably suspect fraud, abuse, or unlawful use of the App;',
  'we are required to by law; or',
  'we discontinue the App or the part of it you use.',
].forEach(t => body.push(bullet(t)));
body.push(p('We will give you reasonable notice before suspending or terminating, and tell you why, unless we are prevented by law or the delay would cause harm or serious risk. Where practicable we will give you a chance to fix the problem first.'));
body.push(p('If we terminate your access other than for your breach, or if we discontinue the App, we will refund the unused portion of any subscription period you have paid for. If we suspend or terminate you for breach, you are not entitled to a refund, except where the law requires one.'));
body.push(p('Clauses 4, 5, 8, 14, 15, 16, 17, 19 and 22 survive termination.'));
body.push(note('NOTE',
  'The live section 10 reserves the right to terminate “at any time, with or without cause” and says nothing about refunds. That is the clearest unfair-contract-terms candidate in the document.'));

// 19
body.push(h1('19. Privacy'));
body.push(p('Our **Privacy Policy** explains what we collect, why, who we share it with, how long we keep it, and how to access, correct or delete it. It forms part of these Terms and is available in the App and at [PRIVACY POLICY URL].'));
body.push(p('In short: we handle personal information under the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles, and the New Zealand Privacy Act 2020 and the Information Privacy Principles. Your rights of access and correction, our retention periods, and our overseas disclosure practices are all set out there — **not here** — and the Privacy Policy governs if the two ever appear to differ.'));
body.push(note('IMPORTANT',
  'Deliberately short, and deliberately does NOT contain a “by accepting these Terms you consent to your information being transferred overseas” clause. Blanket consent buried in a T&C does not meet the informed-and-specific standard in APP 8.2(b), and including one would weaken the APP 8 / IPP 12 position the Privacy Policy currently takes on its own footing. See gap review items 26 and 27.'));

// 20
body.push(h1('20. Third-party services and attributions'));
body.push(p('The App depends on services we do not control, including Apple, Google, Supabase, RevenueCat, Google Gemini, and the mapping and weather providers named in our Privacy Policy. Their terms apply to their services, and we are not responsible for them.'));
body.push(p('The App includes and relies on the following, with thanks:'));
[
  '**Map data** © OpenStreetMap contributors, available under the Open Database Licence (ODbL). Map rendering uses MapLibre.',
  '**Weather data** from Open-Meteo.',
  '**Placeholder imagery** from Unsplash, used under the Unsplash Licence.',
  'Open-source components, used under their respective licences. A full list is available on request at [CONTACT ADDRESS].',
].forEach(t => body.push(bullet(t)));
body.push(note('NOTE',
  'No attribution appears anywhere in the live Terms or the App. The OpenStreetMap ODbL attribution obligation is a live licence-compliance gap, not a formality — and it also needs to appear on or near the walk map itself, not only here.'));

// 21
body.push(h1('21. If you downloaded Pawtchi from the App Store or Google Play'));
body.push(p('These Terms are between you and us, not with Apple or Google. You acknowledge that:'));
[
  'Apple and Google have no obligation to provide any maintenance or support for the App;',
  'if the App fails to conform to any applicable warranty, you may notify Apple, and Apple may refund the purchase price; to the maximum extent permitted by law, Apple has no other warranty obligation in relation to the App;',
  'Apple and Google are not responsible for addressing any claim you or a third party has relating to the App, including product liability, regulatory non-compliance, or consumer protection claims;',
  'if a third party claims the App infringes their intellectual property, we, not Apple, are responsible for investigating and resolving that claim;',
  'you comply with applicable export laws, and you are not located in an embargoed country or on a prohibited-parties list; and',
  '**Apple and its subsidiaries are third-party beneficiaries of these Terms and may enforce them against you.** The same applies to Google in respect of the App distributed through Google Play.',
].forEach(t => body.push(bullet(t)));
body.push(p('Your use of the App may also be subject to the Apple Media Services Terms and Conditions, including the standard EULA at https://www.apple.com/legal/internet-services/itunes/dev/stdeula/, and to the Google Play Terms of Service.'));
body.push(note('NOTE',
  'The live Terms link to Apple’s EULA but include none of the acknowledgements Apple’s guidelines require, in particular the third-party-beneficiary provision.'));

// 22
body.push(h1('22. Governing law, disputes and complaints'));
body.push(p('These Terms are governed by the laws of [NEW SOUTH WALES], Australia. You and we submit to the **non-exclusive** jurisdiction of the courts of that State and the courts able to hear appeals from them.'));
body.push(p('**If you are in New Zealand**, nothing in this clause prevents you from bringing proceedings in New Zealand or relying on New Zealand consumer law, and nothing requires you to litigate in Australia.'));
body.push(p('**Please talk to us first.** If something has gone wrong, contact us at [CONTACT ADDRESS] and we will try to sort it out. Most problems are quicker to fix this way.'));
body.push(p('If we cannot resolve it, you may be able to take the matter to:'));
[
  'the Australian Competition and Consumer Commission (accc.gov.au) or your State or Territory fair trading or consumer affairs office;',
  'in New Zealand, the Commerce Commission (comcom.govt.nz) or the Disputes Tribunal.',
].forEach(t => body.push(bullet(t)));
body.push(p('Privacy complaints follow a different path — see our Privacy Policy, which explains how to complain to us, to the Office of the Australian Information Commissioner, and to the New Zealand Office of the Privacy Commissioner.'));
body.push(note('DECISION',
  '“The laws of Australia” in the live section 11 is not a jurisdiction — Australian contract law is State-based. NSW matches the registered address. The exclusive-jurisdiction wording is also hostile to NZ consumers and is exposed under both unfair-contract-terms regimes; it has been made non-exclusive with an express NZ carve-out.'));

// 23
body.push(h1('23. Changes to these Terms'));
body.push(p('We may update these Terms as the App changes or the law changes.'));
body.push(p('If a change is **material** — for example a change to fees, to your rights, to our liability, or to how we use your content — we will give you reasonable notice in the App or by email before it takes effect, and [DECISION: ask you to accept the new Terms before you continue / treat your continued use after the effective date as acceptance]. If you do not accept a material change, you may stop using the App and cancel your subscription, and we will refund the unused portion of your current period.'));
body.push(p('For minor changes we will update the effective date and the version above. The current Terms are always available in the App and at [TERMS URL].'));
body.push(note('DECISION',
  'The live section 12 says only that continued use constitutes acceptance, which is a textbook unfair-term candidate for a standard-form consumer contract. Requiring affirmative re-acceptance for material changes is the safer position but needs an in-app mechanism that does not exist yet.'));

// 24
body.push(h1('24. General'));
[
  '**Severability.** If any part of these Terms is unenforceable, it is severed and the rest continues to apply.',
  '**Waiver.** If we do not enforce a right straight away, we do not give it up.',
  '**Assignment.** You may not transfer your rights under these Terms. We may transfer ours to a related company or in connection with a sale or reorganisation of our business, provided your rights are not adversely affected.',
  '**Force majeure.** Neither of us is liable for failure to perform caused by something genuinely beyond our reasonable control, but this does not excuse payment obligations.',
  '**Notices.** We may contact you at the email address on your account or through the App. You can contact us at [CONTACT ADDRESS] or at our postal address above.',
  '**Entire agreement.** These Terms and the Privacy Policy are the whole agreement between us about the App, and replace anything said or written beforehand. This does not exclude liability for fraud, or any statutory right you have.',
  '**No third-party rights**, except as set out in clause 21.',
].forEach(t => body.push(bullet(t)));

// 25
body.push(h1('25. Contact us'));
body.push(p('Hey Living Club Pty Ltd [ABN], trading as Pawtchi'));
body.push(p('128 Tallawong Road, Rouse Hill, NSW 2152, Australia'));
body.push(p('[CONTACT ADDRESS]'));

// Open items
body.push(h1('Open items for legal — consolidated'));
body.push(p('Every item below must be resolved before publication. Each corresponds to red text in the clause named.'));
body.push(openItemsTable);

// ── Assemble ───────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [{
      reference: 'tos-bullets',
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
if (!OUT) {
  console.error('usage: node docs/build-terms-docx.js "<output>.docx"');
  process.exit(1);
}
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('wrote', OUT, buf.length, 'bytes');
});
