# §10 — AI Opportunities

AI at Trot follows three rules before any feature:

1. **On-device first.** Raw location and movement never leave the phone (P4); models that need raw signal run locally, and only conclusions (features, scores) sync — the same architecture stance as the route-simplification pipeline we inherited (§13.2).
2. **Observations, never diagnoses.** Trot notices and suggests; it does not diagnose, treat, or alarm. Health-adjacent outputs are phrased as observations with a "worth mentioning to your vet" ceiling, and the wellness lane stays deliberately shallow — health depth is Pawtchi's covenant, not ours (§1.8).
3. **Confidence is worn on the sleeve.** Every AI surface displays its basis ("based on 47 walks") and degrades honestly when thin (P3/P7). A wrong "quiet park" prediction that surprises Luna's owner costs more trust than fifty right ones earn.

Each opportunity below states: value, signals, model approach, phase, and its guardrail.

---

## 10.1 Personalized walk recommendations *(Q3 heuristic → Y2 learned)*

**Value:** answer the daily micro-decision — where/when/how long today? "It'll hit 31°C by 10am; Elm Trail is 70% shade and quiet until 9." **Signals:** dog profile + calibration baseline (10.2), weather, Pulse histograms, Sniff Map layers, past route choices and skips. **Approach:** v1 is transparent scoring (weather × suitability × pulse × novelty) with a "why this" chip on every suggestion; v2 learns per-dog preference weights from accept/skip behavior. **Guardrail:** suggestions never moralize; declining is signal, not failure. Max one suggestion surface per day (Home module), zero pushes unless it qualifies as a T2 opportunity (§9.2).

## 10.2 Per-dog calibration & behavior insights *(Q1 foundation — port and extend)*

**Value:** every other AI feature depends on knowing what's *normal for this dog*. Pawtchi's `dogCalibration` module (per-dog pace/effort baselining) ports directly and extends into a rolling behavioral baseline: typical pace distribution, sniff-stop rate, rest frequency, route-length tolerance by weather. **Product surfaces:** the P2-critical effort framing ("a big walk *for Duke*"), enrichment insights ("Bruno sniffs 3× more on new routes — variety seems to be his thing"), and the input to 10.6. **Approach:** classical statistics on-device (EWMA baselines, deviation scoring) — no neural net needed, fully interpretable. **Guardrail:** baselines never surface as comparisons between dogs.

## 10.3 Route & trail matching *(Q3)*

**Value:** rank Trail Tails per dog (§7.7) — senior-appropriate, reactive-visibility-weighted, puppy-duration-capped. **Approach:** v1 rule-based on trail `attrs` × dog profile; v2 gradient-boosted ranker on completion/skip/review outcomes. **Guardrail:** safety attributes (visibility, hazard adjacency) are hard filters, never soft ranking weights, for Quiet Hours users.

## 10.4 Community moderation *(Q2, grows with surface area)*

**Value:** keep a small team ahead of UGC (pin notes, photos, comments, names). **Approach:** layered — text classifiers (toxicity, PII, harassment) gate pre-publication; image models screen photos (explicit content, faces of minors auto-flag for human review, license plates auto-blur); anomaly detection for coordinated pin vandalism (§7.5). Escalation to human review; user reports always route to humans within SLA (§12.5). **Guardrail:** moderation models never auto-ban — they queue, humans decide; appeals exist (§12.5).

## 10.5 Safety alerts *(Q3, conservative)*

**Value:** community-sourced, model-verified condition awareness on routes: "3 reports of broken glass on the canal path this morning." **Approach:** hazard-pin clustering + recency weighting + (later) photo verification; severity taxonomy decides surface (map-only → route-overlay → T2 push for imminent-route intersection only). **Guardrail:** alerts are about *conditions*, never people or specific animals (§7.5 ruling); no crime-adjacent inference — we are not a fear product, and fear-based engagement is banned inventory (§9.1).

## 10.6 Wellness observations *(Y2, the most carefully fenced feature in the product)*

**Value:** longitudinal gait/pace/behavior change detection — the observation that a dog's moving pace has drifted −15% over six weeks against season-adjusted baseline is genuinely valuable and invisible to daily human perception. **Approach:** on-device time-series deviation on 10.2 baselines; multi-week persistence + effect-size thresholds before *ever* surfacing; output is one gentle observation with basis, framed for a vet conversation ("Duke's walking pace has gradually changed this season — the kind of thing vets like to hear about"). **Guardrails (all binding):** no urgency framing, no symptom speculation, no breed-risk scare content, frequency-capped (max ~2/year/dog), opt-out prominent, and the entire feature ships only after a false-positive audit against real vet-visit outcomes in beta. If Pawtchi integration ever deepens, this signal hands off there rather than growing a health product inside Trot.

## 10.7 Photo memories & curation *(Q3)*

**Value:** the archive's emotional payoff — auto-select the best walk photos (sharpness, dog-detection, composition), auto-build Memories and recap reels, "Ziggy's first snow" moment detection (weather + calendar + photo joins). **Approach:** on-device photo scoring (standard mobile vision kits); dog-recognition per household (which dog is in frame) trained per-account, on-device. **Guardrail:** memorial-state accounts get curated-with-consent only (§12.7); no face-recognition of humans, ever; photos never train shared models.

## 10.8 Predictive Park Pulse *(Y2)*

**Value:** upgrade Pulse from "typical + live" to "expected at 5pm today" — weather-adjusted, event-aware, seasonal (§7.6). **Approach:** per-Spot temporal model (histogram prior + weather covariates + trend); honest confidence bands; trains only on k-anonymous aggregates. **Guardrail:** predictions display sample basis; below data thresholds the feature *says so* rather than guessing (the anti-fake-liveness ruling, P3).

---

## 10.9 What we deliberately do not build

- **No generative social content** (AI-written posts, AI dog voices in the feed): the network's value is that everything in it is real (§5.12's "all social proof is real" extends to all content).
- **No engagement-optimizing feed ranking:** the feed stays chronological-finite (§7.2); a learned ranker optimizing session length would violate §5.9's closed-loop doctrine.
- **No cross-user behavioral profiling for ads** (§15's covenant) and no location-derived audience products — the aggregate-intelligence business (§15.6) is places, never people.
- **No AI chat companion in v1:** an "ask about dog stuff" bot invites health questions we've fenced off (rule 2) and dilutes the product's focus; revisit only with a partner whose liability posture fits (§16).

## 10.10 Sequencing summary

| Phase | Ships | Depends on |
|---|---|---|
| Q1 | 10.2 calibration foundation (ported), photo scoring basics | walk pipeline |
| Q2 | 10.4 moderation stack | UGC surfaces |
| Q3 | 10.1 recommendations v1, 10.3 matching v1, 10.5 safety alerts, 10.7 memories | Spots/Pulse/Trails data |
| Y2 | 10.6 wellness observations (post-audit), 10.8 predictive pulse, learned rankers | 12+ months longitudinal data |

The pattern: **Q1–Q3 AI is mostly honest statistics with good manners; the learned layer arrives only when longitudinal data makes it trustworthy.** That ordering is itself a competitive position — every insight Trot surfaces is explainable, and users learn that when Trot says something, it's earned.
