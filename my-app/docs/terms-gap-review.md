# Pawtchi Terms of Service — gap and risk review

Companion to `terms-and-conditions-draft.md`. Read that for the proposed clause text; read this for
what is wrong with the Terms currently published and why each change matters.

**Subject of the review:** `pawtchi-website/src/pages/TermsConditions.jsx` — 13 sections, effective
date "April 2026", the only Terms document that exists. It is linked from two places in the app:
`app/(auth)/login.tsx:335` (sign-up collection notice) and `app/paywall.tsx:750`.

**Verified against:** the codebase at iOS build 74 / Android versionCode 33 / app version 1.0.18.

**Scope:** shipped features only. Surfaces that exist in code but cannot be reached — Shop,
Community, Best Mates, Achievements, Explore, the two `dev-*` routes — are out of drafting scope and
appear here only at item 29.

**This is not legal advice.** Statutory references are pointers for counsel, not conclusions.

---

## Summary

| Tier | Count | Character |
|---|---|---|
| 1 — Live legal exposure | 9 | Void clauses, penalty-backed unfair terms, and product-liability surfaces with no contractual coverage at all |
| 2 — Misleading conduct and store compliance | 7 | Things the app does that the Terms do not disclose, or disclose wrongly |
| 3 — Drafting quality and deferred risk | 8 | Missing boilerplate, under-scoped clauses, and work that must precede a future release |
| 4 — Privacy Act interaction | 5 | How the Terms must sit alongside the Privacy Policy without undercutting it |

The three findings to read first, if nothing else: **item 2** (the liability clause is likely void
and may itself be a breach), **item 5** (allergen and toxin screening has no disclaimer), and
**item 10** (the 30-day free period is not disclosed anywhere).

---

## Tier 1 — live legal exposure

### 1. The Terms do not identify a contracting party

**Now:** The document says "Pawtchi" throughout — a trading name — and gives `support@pawtchi.com`.
No legal entity, no ABN, no registered address. The Privacy Policy published beside it contracts as
**Hey Living Club Pty Ltd**, 128 Tallawong Road, Rouse Hill NSW 2152, at
`privacy@heylivingclub.com`.

**Why it matters:** A consumer contract that does not name its counterparty is difficult to enforce
and invites an argument about who the user actually contracted with. The inconsistency with the
Privacy Policy makes it worse, not better. There is also a disclosure dimension — ACL s18 and the
general expectation that a business identifies itself to consumers.

**Fix:** Draft clause 1 and 25. Requires the ABN and a single contact address.

---

### 2. The limitation of liability is void, and stating it may be a breach

**Now:** §9 excludes liability for indirect and consequential loss "to the fullest extent permitted
by law", including expressly for "pet health outcomes". There is no consumer-guarantees savings
clause anywhere in the document.

**Why it matters:** Under **ACL s64** (Schedule 2, *Competition and Consumer Act 2010* (Cth)) a term
that purports to exclude, restrict or modify the consumer guarantees is void. That much only costs
the clause its effect. The larger problem is **ACL s29(1)(m)**: making a false or misleading
representation about the existence or effect of a right or remedy is a contravention in its own
right, and an unqualified exclusion clause presented to consumers is the standard example. This has
been an active ACCC enforcement priority. The New Zealand mirrors are **CGA 1993 s43** and **FTA
1986 s13(i)**.

Note the aggravating factor: a clause that specifically disclaims "pet health outcomes" in an app
that produces health guidance is exactly the representation a regulator would look at.

**Fix:** Draft clause 15 (mandatory savings clause, with the prescribed ACL wording) and a rewritten
clause 16 that operates expressly subject to it.

---

### 3. Four probable unfair contract terms — now penalty-backed

**Now:**

| Live clause | Problem |
|---|---|
| §10 — terminate "at any time, with or without cause" | Unilateral termination, no notice, no cure period, no refund of a paid subscription period |
| §12 — "Continued use … constitutes your acceptance of the revised Terms" | Unilateral variation deemed accepted by silence |
| §8 — "Prices may change with notice" | Unilateral price variation on an auto-renewing subscription |
| §11 — "exclusive jurisdiction of the courts of Australia" | Restricts a consumer's right to sue, and is hostile to NZ users |

**Why it matters:** Since **9 November 2023** the ACL unfair contract terms regime carries **civil
penalties**. For a body corporate the maximum is the greatest of $50 million, three times the value
of the benefit obtained, or 30% of adjusted turnover during the breach period. Penalties attach
per unfair term. These Terms are a standard-form consumer contract offered on a take-it-or-leave-it
basis, so the regime plainly applies. The NZ equivalent is **FTA 1986 s46H**.

The common thread in all four is a right for us with no corresponding right for the user, and no
proportionality to a legitimate interest.

**Fix:** Draft clauses 12.3 (price changes requiring consent), 18 (defined termination grounds,
notice, cure, pro-rata refund), 22 (non-exclusive jurisdiction, NZ carve-out) and 23 (notice plus
re-acceptance for material changes).

---

### 4. Allergen and toxic-ingredient screening has no disclaimer

**Now:** §5 disclaims "general nutritional and activity guidance". It says nothing about safety
screening.

**What the code does:** `lib/allergenMatcher.ts` matches a product's ingredients against the
allergens recorded on the pet profile; `lib/toxicIngredients.ts` screens for substances toxic to
dogs and cats. Both feed the verdict a user sees when they scan a food.

**Why it matters:** This is the highest-severity product-liability surface in the app, and it is the
one the current Terms miss most completely. Screening works from ingredient lists and from text read
off a photographed label. It can fail in at least four ways: the ingredient is not on the label; it
is listed under a synonym the matcher does not hold; the OCR misreads it; or it is harmful to this
particular animal for a reason the app cannot know. **A user will reasonably read "no warning" as
"safe to feed."** A false negative on a toxin can kill an animal, and the owner's reliance would be
entirely foreseeable.

**Fix:** Draft clause 4, specifically the paragraph beginning "You must not rely on the App to
decide whether something is safe" and the sentence "the absence of a warning is not a statement that
a food is safe."

**Beyond the document:** this warning belongs in the verdict UI, not only in the Terms. A disclaimer
a user has to visit a website to read will carry much less weight than one shown next to the result.

---

### 5. AI vet answers are not covered

**Now:** Nothing. §5 predates the feature.

**What the code does:** `supabase/functions/ask-vet/index.ts` sends the pet's profile — including
recorded allergies, medical conditions, and diagnoses and medications extracted from scanned vet
reports — to `gemini-3.1-pro-preview` and returns clinical-sounding guidance. The output can be
escalatory: `components/VetAnswerCard.tsx:28` renders "This is worth a call to {name}'s vet or an
emergency clinic now."

**Why it matters:** A feature called *Ask a Vet* that returns advice framed in clinical language is
a reasonable-reliance problem regardless of what the fine print says. The only protection today is a
single line of in-app copy at `app/ask.tsx:396`. There is also a professional-regulation dimension
worth a look: veterinary practice legislation in the Australian States and the NZ *Veterinarians Act
2005* restrict who may practise veterinary science and hold the title. The feature name is a
question for counsel.

**Fix:** Draft clauses 3 (no vet–client–patient relationship, we are not a veterinary practice),
4 (Ask-a-Vet listed expressly) and 5 (AI outputs are probabilistic).

> Separately: whether the **preview-tier Gemini model** carries the same no-training commitment as
> the GA models is an open item from the privacy review, not a Terms issue. Cross-referenced here so
> it is not lost — see `privacy-remediation-handover.md`, decision 1.

---

### 6. Veterinary-document OCR is not covered

**What the code does:** `supabase/functions/scan-vet-report` and `parse-onboarding-report` extract
structured clinical data — diagnoses, medications, test results — from real veterinary documents the
user photographs.

**Why it matters:** Errors here do not stay put. Extracted data lands on the pet profile, feeds the
calorie and weight plan, is included in the Ask-a-Vet prompt, and is reproduced in the exported PDF.
A misread dose or a missed diagnosis propagates through every downstream feature, and the user has
no obvious signal that it happened.

**Fix:** Draft clause 5, second bullet — including the instruction to check extracted information
against the original document.

---

### 7. The exported vet report PDF is not covered

**What the code does:** `app/vet-report.tsx` and `lib/vetReport/buildVetReportHTML.ts` generate a
PDF the owner shares with a practising veterinarian. It carries an in-document line at
`buildVetReportHTML.ts:259` — "Owner-prepared summary … not a veterinary diagnosis."

**Why it matters:** The in-document disclaimer is good and should stay. But the Terms say nothing
about a document that leaves the app, is presented to a clinician, and may influence a clinical
decision. Note also that the report is headed with a display name derived from the local part of the
user's email address (per the Privacy Policy §2), which is a small accuracy problem of its own.

**Fix:** Draft clause 4, the paragraph beginning "The exported vet report is your document, not
ours."

---

### 8. Weight and calorie plans lack a health-condition qualification

**What the code does:** `lib/weightPlan.ts`, `lib/aafcoMath.ts` and `lib/weightLossRate.ts` produce
calorie targets and weight-change plans. The app already has one safety gate:
`components/SevereObesityVetBanner.tsx` blocks reliance at BCS 8–9 until the owner confirms they
have spoken to a vet, on the stated basis that thyroid and hormonal issues change the right plan.

**Why it matters:** The product has already identified this risk in code but not in the contract.
Calorie restriction is genuinely dangerous in some animals — hepatic lipidosis in cats being the
clearest example — and an undiagnosed condition can make an otherwise sensible plan harmful.

**Fix:** Draft clause 4, the paragraph beginning "Consult a veterinarian before acting on nutrition
or weight guidance", which also makes the existing in-app vet-confirmation gate a contractual term
rather than just a UI affordance.

---

### 9. Walk tracking has no clause of any kind

**What the code does:** `app/walk.tsx` and `lib/walk/` record precise location roughly every three
seconds or five metres while a walk is running, through an Android foreground service and the iOS
background-location mode (`app.config.ts:65-79`). Derived outputs include route geometry, distance,
pace, pause and sniff stops, and reverse-geocoded place labels for the start, end and farthest
points.

**Why it matters:** Four distinct exposures, none addressed:

* **Physical safety.** The feature puts a person on a road, often with an animal, interacting with a
  phone. No allocation of responsibility for traffic awareness, leashing or local council rules.
* **Measurement accuracy.** Distance and pace are consumer-GPS estimates presented as figures.
* **Data loss.** The OS can terminate the app to save battery; a finished walk may sit in
  `walk:sync_queue` until connectivity returns. Users can and will lose walks.
* **Third parties.** Nothing prohibits using tracking to follow or record another person.

**Fix:** Draft clause 10 in full.

---

## Tier 2 — misleading conduct and store compliance

### 10. The 30-day free access period is not disclosed

**Now:** §8 says Pawtchi "offers a free tier and a paid auto-renewing subscription". That is not what
happens.

**What the code does:** `providers/SubscriptionProvider.tsx:37` sets `FREEMIUM_DAYS = 30`. Every new
account gets `hasFullAccess: true` for 30 days from account creation, then is gated. The gate is
comprehensive — `hasFullAccess` routes users to the paywall from Meal, Health, Activity and Walk
(`app/(tabs)/meal.tsx:125`, `health.tsx:103`, `activity.tsx:318`, `index.tsx:203`). There is no
"free tier" in the sense §8 implies; there is a free month.

**Why it matters:** Describing a time-limited full-access window as a "free tier" is a
misrepresentation about the nature of a service under **ACL s29(1)(i)/(m)** and **FTA s13**. A user
who logs a month of meal and weight history reasonably believes they are on a free plan that
continues.

**Two things must be confirmed before this is drafted as fact:**

1. **What actually remains after day 30.** On the current reading, close to nothing.
2. **Whether previously logged records stay reachable in the UI** once gated, or whether the gate
   also hides the history the user created. If it hides it, the claim in draft clause 12.1 that
   "your records stay yours" cannot be published as written, and there is a second problem: APP 12
   gives a right of access to personal information that does not depend on paying a subscription.

**Also note:** `isFreemiumActive` defaults to `true` and fails **open** when account age cannot be
determined. The Terms must not promise gating the code does not reliably perform.

**Fix:** Draft clause 12.1, subject to those two confirmations.

---

### 11. Ask-a-Vet usage caps are not disclosed

**What the code does:** `supabase/functions/ask-vet/index.ts:13` caps new assessments at **4 per
calendar month**. Line 122 caps follow-ups at **3 per case**; line 402 caps check-ins at 2. Questions
are truncated at **500 characters** (line 14). An hourly guard of 5 requests sits in
`_shared/rateLimit.ts:114`.

**Why it matters:** Ask-a-Vet is promoted as a subscription feature. Selling a feature and capping
it without saying so is an ACL s29 risk, and quota exhaustion mid-month is exactly the kind of
surprise that produces complaints and chargebacks.

**Fix:** Draft clause 12.5, with the real numbers.

---

### 12. The price-change clause does not meet store rules or the UCT regime

**Now:** §8 — "Prices may change with notice."

**Why it matters:** Both Apple and Google require, for auto-renewing subscriptions, that a price
increase beyond defined thresholds be affirmatively consented to by the subscriber, failing which
the subscription lapses rather than renews. A term permitting unilateral price variation on a
standing consumer contract is also a listed example of a potentially unfair term.

**Fix:** Draft clause 12.3.

---

### 13. Apple's required acknowledgements are missing

**Now:** §8 links to Apple's standard EULA. That is all.

**Why it matters:** Apple's guidelines require an EULA that includes specific acknowledgements —
Apple has no maintenance or support obligation; Apple's warranty liability is limited to refunding
the purchase price; Apple is not responsible for product-liability, regulatory or consumer-protection
claims; the developer handles IP infringement claims; export compliance; and, critically, **Apple is
a third-party beneficiary entitled to enforce the terms against the user.** None of these appear.
Google Play has a lighter but analogous set.

**Fix:** Draft clause 21.

---

### 14. Feature availability is misdescribed

**Now:** §2 describes Pawtchi as serving "dog and cat owners" without qualification.

**What the code does:** `hooks/useWalkEnabled.ts` gates all walk surfaces on the feature flag **and**
`species === 'dog'`. Cat owners see a plain Activity tab. Walk stories, the Paw Prints gallery and
Walksigns all sit behind the same gate.

**Why it matters:** A cat owner who subscribes partly for walk tracking has a clean
misleading-conduct complaint. Worth checking the App Store and Play listings and any paywall copy
for the same problem — `app/paywall.tsx` is the place to look.

**Fix:** Draft clause 3, final paragraph.

---

### 15. PawCoins have no terms at all

**What the code does:** `store/useStreakStore.ts` awards coins server-side for logging food,
activity, weight, brand setup and vet reports. The balance renders in the Home header
(`app/(tabs)/index.tsx:377`) and a `CoinToast` fires on every earn. `deductCoins` exists; its only
consumer is the hidden Shop.

**Why it matters:** An earned balance displayed as a number, with no statement that it has no value,
is exactly the kind of thing that generates claims when it is reset, expires, or is lost with a
closed account. The right time to say "no monetary value, non-transferable, non-redeemable,
forfeited on closure" is before anyone can spend it — not in the release that turns on the Shop.

**Fix:** Draft clause 11, written to cover a future in-app spend without describing a store that
does not yet exist.

---

### 16. Open-source and content attribution is absent

**What the code does:** the walk map renders OpenStreetMap tiles through MapLibre; weather comes from
Open-Meteo; `lib/petFallbackImage.ts` uses Unsplash images as placeholder pet pictures.

**Why it matters:** OpenStreetMap data carries an **ODbL attribution obligation**. This is a licence
condition, not a courtesy. Unsplash and the various open-source components have their own terms.
Nothing appears in the live Terms or, as far as this review found, in the app.

**Fix:** Draft clause 20. **Note that the OSM attribution must also appear on or near the map view
itself** — a line in the Terms is necessary but not sufficient.

---

## Tier 3 — drafting quality and deferred risk

### 17. "The laws of Australia" is not a jurisdiction

§11 chooses "the laws of Australia" and the "exclusive jurisdiction of the courts of Australia".
Australian contract law is State-based; there is no federal general law of contract to choose. NSW
matches the registered address. The exclusivity is separately problematic — see item 3. **Fix:**
draft clause 22.

### 18. All boilerplate is missing

No severability, waiver, assignment, force majeure, notices, entire-agreement or survival clause. A
contract without severability is especially exposed here, because if clause 16 is read down under
ACL s64 there is nothing preserving the remainder. **Fix:** draft clause 24, plus the survival
sentence in clause 18.

### 19. No indemnity

Nothing shifts loss back to a user who uploads infringing content or misuses the AI features. It has
to be drafted narrowly to survive the UCT regime. **Fix:** draft clause 17.

### 20. The content licence has no user warranty

§7 takes a licence but asks for no promise in return. Users upload photos that routinely contain
other people, and veterinary documents authored by a third party. There is no prohibited-content
list and no removal right. **Fix:** draft clause 8.

### 21. No commercial-use restriction

Nothing prevents a breeder, boarding kennel, shelter or clinic running consumer Terms across dozens
of animals — with the liability profile that implies. **Fix:** draft clause 2, final paragraph.

### 22. No account-sharing clause

`lib/routineDefaults.ts` captures how many household members walk the pet, so shared use is
anticipated by the product but unaddressed by the contract. **Fix:** draft clause 6.

### 23. Termination and deletion are not aligned with the Privacy Policy

§10 points at a `/UserRequest` page for data deletion, while the Privacy Policy describes in-app
account deletion from the Profile screen. Two mechanisms, two documents, no cross-reference.
**Fix:** draft clauses 6 and 19 defer to the Privacy Policy rather than restating it — the drift
between duplicated statements is what produced the original privacy mismatch.

### 24. No clause for staged or withdrawn features

`walkTracking` and `walkStory` are flag-gated (`constants/featureFlags.json`) and have been toggled
before. Nothing reserves the right to change or withdraw a feature, or addresses what a subscriber is
owed when one goes away. **Fix:** draft clause 13.

---

## Tier 4 — how the Terms must sit alongside the Privacy Act

The Privacy Policy is the compliance instrument for the *Privacy Act 1988* (Cth) and the *Privacy Act
2020* (NZ). The Terms' job is to reference it correctly and not undercut it.

### 25. Incorporate the Privacy Policy, do not duplicate it

Draft clause 19 incorporates it by reference and states that it governs on any inconsistency. This
supports the APP 5 / IPP 3 collection notice at `app/(auth)/login.tsx:322-341` rather than competing
with it.

### 26. Do not put overseas-transfer consent in the Terms

**Recommendation: do not add a clause of this kind, even though it is conventional.** APP 8.2(b)
consent must be informed and specific. Blanket consent buried in a T&C does not meet that standard,
and including one would weaken the position the Privacy Policy currently takes on its own footing at
§6 (reasonable steps plus written data-processing agreements). IPP 12 is the NZ analogue. Draft
clause 19 is deliberately short for this reason.

### 27. The Terms must not promise deletion the code does not perform

Per `privacy-remediation-handover.md` (Track B2), account deletion **does not** currently fan out to
PostHog, Firebase, Meta or RevenueCat, and the `delete-account` function is deployed but not
committed to the repo. Draft clause 6 says only that the Privacy Policy governs — it makes no
independent deletion promise. Keep it that way until the fan-out ships.

### 28. Two dated obligations to diarise

* **APP 1.7** (inserted by the *Privacy and Other Legislation Amendment Act 2024*), **in force 10
  December 2026** — privacy policies must disclose automated decision-making that significantly
  affects an individual's rights or interests. Privacy Policy §14 records the assessment that
  Pawtchi falls below the threshold because outputs are advisory and concern animal care. Draft
  clause 5 is worded consistently. **The assessment itself still needs to be written down** — it is
  an open item from the privacy review.
* **NZ IPP 3A**, inserted by the Privacy Amendment Act 2025, **in force 1 May 2026**. This is why
  the reference to "the 13 Information Privacy Principles" should not be restated. The privacy
  review dropped the count rather than repeat it incorrectly, and this draft does the same. **Ask
  counsel to confirm the current count and the indirect-collection notification obligation IPP 3A
  introduces** — it may also affect the Privacy Policy's §3.

### 29. Enabling Shop, Community or Best Mates requires a Terms amendment first

Out of scope for this draft, logged so it is not forgotten. `app/(tabs)/shop.tsx`,
`app/(tabs)/community.tsx`, `app/(tabs)/explore.tsx` are all `href: null`
(`app/(tabs)/_layout.tsx:247-266`); `app/community/best-mates.tsx` and `app/achievements.tsx` run on
mock data and are effectively unreachable. Before any of them ships:

* **Shop** — virtual-goods purchase terms, the relationship between PawCoins and real money, refund
  treatment, and the store rules on virtual currency. Draft clause 11 anticipates this but does not
  discharge it.
* **Community / Best Mates** — a full user-generated-content regime: moderation, reporting and
  takedown, prohibited content, and the **Online Safety Act 2021 (Cth)** basic online safety
  expectations. Shipping a social feed on the current Terms would be a significant step up in
  exposure. Note the mock data already implies follower relationships, likes, comments and stories.

---

## Beyond the document — things a Terms rewrite cannot fix

These are code and operations items surfaced by the review. They are recorded here because the
document depends on them being true.

1. **`https://pawtchi.com/terms` must actually resolve.** Both in-app references
   (`login.tsx:335`, `paywall.tsx:750`) deep-link out to the browser. If that URL is down, moved or
   blocked, the user has no way to read the contract they are being bound by. Confirming this was
   already an open item in the privacy handover (Track C) and appears still to be open.
2. **There is no in-app Terms screen.** `app/privacy.tsx` exists; there is no `app/terms.tsx`. The
   asymmetry is hard to justify and easy to fix once the text is settled.
3. **Consider an affirmative acceptance control at sign-up.** The current sign-in-wrap is generally
   enforceable when conspicuous, but a contract carrying a liability cap, an indemnity and a
   jurisdiction clause is materially better served by a tick-box recording the version accepted and
   the timestamp. That record is also what makes draft clause 23 (re-acceptance on material change)
   workable.
4. **Surface the safety disclaimers where the risk is.** The allergen and emergency wording in draft
   clause 4 does most of its work in the verdict UI and the Ask-a-Vet result card, not on a website.
5. **Add the OpenStreetMap attribution to the map view** (item 16).
