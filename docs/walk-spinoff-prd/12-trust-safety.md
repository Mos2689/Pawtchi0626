# §12 — Trust & Safety

Location + routines + family + a social graph is the highest-stakes data combination in consumer software. Trot's stance (P4): **privacy is the product**, safety is designed before features ship, and one prevented incident is worth more than any engagement metric. This section is resourced from day one — a named T&S owner exists from Q2 (when UGC and the graph arrive), not after the first incident.

## 12.1 The privacy covenant (user-facing, plain language)

Published in-app (S-71) and kept true:

1. **Your exact route never leaves your phone.** We store a simplified sketch (≤200 points) — enough for your map art, useless for surveillance. (Architecture inherited and verified: on-device simplification, §13.2.)
2. **Home stays hidden.** Your Home Zone is clipped out *at capture time* — those points are never stored anywhere, not even on your device's sync queue (§7.8.1).
3. **Nothing about you is ever live.** Every social feature is retrospective (Crossed Paths: next morning, date-only) or aggregate (Pulse: fuzzy bands, k≥5). Nobody — including a Best Mate — can see where your dog is right now.
4. **Every visibility is a choice.** Defaults are private; each opt-in is separate, explained, and revocable; opting out is invisible to others (§7.4's ruling generalizes).
5. **Your archive is yours.** Full export, one tap, free, forever. Deletion is real deletion (30-day grace, then purge including derived rows; aggregates already k-anonymous are irreversibly detached).

## 12.2 Location privacy engineering

- **Capture-side clipping:** Home Zones (multiple; home, work, school) drop points pre-storage; walks re-stitch across the gap with distance credited (§7.8.1).
- **Rendering rules:** own walks render fully (minus zones); shared/feed renders clip zones *and* trim 200m from route ends by default; public web artifacts render community objects only (§8.3).
- **Derived-data discipline:** crossing presence buckets are coarse (H3-10 × 5min), consent-gated, TTL-deleted ≤14 days (§7.1); Pulse aggregates enforce k≥5 with hysteresis (§7.6); Spot visit data exposes only k-floored aggregates (§7.3).
- **Public Dog Card field matrix (S-61):** visible by default — name, photo, breed, age-bracket, badge highlights; opt-in — lifetime stats, Regular chips, gallery presence; never public — routes, Spots history, schedule-inferable anything.
- **Threat-model reviews:** every geo feature ships with a written adversarial review (stalker, abusive ex-partner, burglar, dog thief personas) — the §7.6 "adversarial quiet-seeker" analysis is the template. Re-reviewed on any mechanic change.

## 12.3 Consent & data rights

Layered consent, never bundled: recording (OS permission, contextual ask §6.2/S-05) ≠ crossing participation ≠ presence aggregates ≠ gallery visibility ≠ contacts matching (hashed, match-only, no upload without explicit action, no auto-invites — §7.9.6). GDPR/CCPA-native from day one (export, deletion, access, portability); privacy policy written at a reading level a tired dog owner actually reads; changes to data use are opt-in re-consent, never silent ToS drift. Data minimization as default: if a feature can work with coarser data, it must (the §7.1 date-not-timestamp decision is the norm, not the exception).

## 12.4 Child safety

- **17+ age gate at signup; no accounts for minors in v1.** Family participation happens through Household Packs under a parent's account with a supervision flag (§4.4) — the walk is attributed "Cooper's family."
- Photos: face detection auto-flags images with children for human review before any community surface (Spot walls, event galleries — §10.4); feed-scope (mates-only) photos are exempt from pre-review but reportable.
- Events: public Pack Walks state that minors attend as families; organizer guidelines cover it; no feature ever connects an adult to a specific child (no per-person tagging of humans exists anywhere in the product).

## 12.5 Community safety: abuse prevention & moderation

- **Structural prevention first** (the cheapest moderation is surface area that doesn't exist): no open-text posts in v1 (§7.2), no DMs in v1 (mate-scoped comments only — private messaging waits for Y2 and arrives with its own T&S review), no people-pins (§7.5), mutual-only graph, bounded pack sizes.
- **Pipeline:** classifier gate pre-publication for public-surface text/photos (§10.4) → human review queues (SLA: reports touched <24h, safety-class <2h) → graduated enforcement (warn → content removal → feature restriction → suspension → ban) → appeal path with human decision.
- **Block cascade:** block removes the pair from feeds, crossings (retroactively), galleries, events, and future computation, in both directions, invisibly (§7.2).
- **Real-world conflict protocol:** disputes that begin offline (dog fights, park altercations) get a dedicated report category; Trot's role is bounded — remove harassing content, separate the parties digitally (mutual invisibility), surface local animal-control resources — and explicitly *not* adjudicating what happened at the park.
- **Community guidelines** written in the brand voice, dog-first ("Be the person your dog thinks you are"), with named examples of the gray areas (breed commentary, training-method debates — the two known flame-war generators in dog communities; both get "no unsolicited advice" norms).

## 12.6 Fraud & integrity

- **The walk validator is the integrity root** (§13.2, ported): only `valid` walks feed anything community-visible (crossings, Regular, challenges, contribution gating) — GPS-spoof/vehicle/junk sessions are quarantined at the source with honest private labeling (§6.6).
- **Trust scores** (internal, never displayed): per-account contribution reliability from confirmation agreement rates, presence verification, account age; weights pin confidence (§7.5) and review queues. Low-trust ≠ punished — just less amplified until earned.
- **Velocity & anomaly detection:** visit-farming for Regular (§7.4), coordinated pin vandalism (§7.5), challenge-completion spikes; anomalies queue for review, never auto-punish (§10.4 rule).
- **Sponsored-challenge integrity** (§15.3): sponsor-facing metrics count only validated activity; the validator's existence is a sales asset ("your challenge results are real dogs on real walks").

## 12.7 The end of a dog's life (designed, not defaulted)

A memorial state exists because the alternative — streak reminders after a dog dies — is unforgivable. Owner-initiated only (S-74; never inferred, never suggested by the app): recording and prompts stop instantly; the archive converts to a memorial Dog Card ("Duke, 2014–2026 · 2,847 walks together"); Memories resurface only by explicit opt-in (§5.15); mates may light candles (§7.2); data export offered gently; the account can hold the memorial and a new dog simultaneously without either erasing the other. **No monetization surface may ever appear adjacent to memorial content** (binding, §15.2). This flow gets design and QA priority equal to onboarding — it is rare per-user and defining per-brand.

## 12.8 Emergency features (bounded scope)

- **Emergency info card** (S-75): dog's photo, key details, owner contact — exportable/printable; useful the day a dog bolts.
- **Lost-dog broadcast (Q3+, carefully fenced):** owner-triggered alert to opt-in users who walk the relevant Spots ("Duke was last seen near Riverside — if walking there, keep an eye out"), auto-expiring, location-coarse, rate-limited (abuse of the channel = fastest ban in the product). This is the single acceptable use of the network for urgent reach, and the fence around it is what keeps it acceptable.
- **Walk-still-recording guard** (§9.2 T4) doubles as a safety touch: a tracker running for hours may mean a phone — or a person — in trouble; copy stays neutral ("Still walking?").
- **Explicit non-goals:** no SOS/personal-emergency features (liability and false-confidence risks belong to dedicated products); no live "walking alone" tracking (violates covenant §12.1.3).

## 12.9 Governance & readiness

- T&S review is a launch gate in the feature process (template: data touched, visibility created, adversarial review, abuse vectors, moderation load estimate).
- Incident response runbook (severity ladder, comms templates, user-notification thresholds) exists before Q2 social launch; tabletop-exercised quarterly.
- Transparency: annual safety report once scale warrants (Y2), including moderation volumes and government-request policy (we hold little of value by design — the minimization architecture is also the subpoena posture).
- Metrics (§14.5): reports per 1k WAU (with taxonomy), median action time, block rate, appeal overturn rate, permission-retention (§9.8) as the ambient trust gauge, and the quarterly trust survey ("I trust Trot with my location" ≥85% agree).
