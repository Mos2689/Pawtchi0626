# §8 — Growth Loops

Growth at Trot is a system of closed loops, each with named steps, a compounding mechanism, the metric that measures the loop's cycle efficiency, and its failure mode. Loops are honest by constitution (P6): every user-facing step must be the genuinely best action for that user, or the loop is redesigned.

**How to read the math.** A loop compounds when `(users in) × (action rate) × (conversion) > users needed to sustain the action rate`. We track each loop's **K-factor contribution** (new activated users per participating user per month) and, because this is a *local* network, all social loops are measured **per metro** — a K of 1.1 nationally means nothing if it's 3.0 in Melbourne and 0.2 everywhere else (the former builds a network; the latter builds churn).

---

## 8.1 Viral loop — the share card

**Walk → beautiful artifact (S-21/22) → off-platform post (IG story, WhatsApp, family chat) → viewer sees dog + route art + deep link → web preview → install → their first walk → their artifact.**

- **Compounds because:** every activated user is a recurring artifact factory (7–21 walks/week), so inventory grows with the user base × frequency — the structural advantage over one-shot referral programs.
- **Cycle math (targets):** 0.35 shares/WAU/week × ~150 median story reach × 0.5% view→tap × 40% tap→install-and-activate ≈ **0.10 activated users/WAU/month** from this loop alone at baseline; milestone and YiR cards convert 3–5× baseline (concentrated in December and milestone days).
- **Design levers:** artifact beauty (the #1 lever — route-art quality is a growth investment, not polish); dog photo prominence (dogs stop thumbs); deep-link preview quality (§8.3); zero share-gating.
- **Failure mode:** generic-looking cards. Counter: template art direction refreshes seasonally; the card must be enviable, not informative.
- **Loop metric:** Shares per WAU (Q1 KPI) × share→activation rate.

## 8.2 Invitation loop — the warm graph

**User meets a dog IRL or wants their feed alive → dog-first invite (link / QR Park Card) → recipient lands on the *inviting dog's* card ("Luna wants to be Bruno's Best Mate") → install → instant first mate → both feeds improve → both invite more.**

- **Compounds because:** each accepted invite improves *both* sides' product (feed content, crossing inventory), raising both sides' propensity to invite again — invites get *easier* with density, not harder.
- **The Park Card is the signature move:** a QR on your phone (or printed tag accessory, §15.5) exchanged at the park in the moment two dogs are already playing. Highest-intent invite channel in the product; measures real-world graph formation directly.
- **Cycle math:** target 0.15 invites/WAU/month at Q2 launch × 25% install-activate (warm) = 0.04; expected to triple as feed value grows with density.
- **Failure mode:** invite fatigue / spam feel. Counter: no bulk invites, no auto-invites from contacts sync (matching only), no rewards to farm (P6).
- **Loop metric:** invites/WAU, accept rate, invited-user D30 (invited users should out-retain organic — if not, the loop is manufacturing weak users).

## 8.3 Content loop — public artifacts as SEO/discovery surface

**Walks, Spots, and Trail Tails generate public web objects (unauth previews: Spot pages, trail pages, anonymized recap cards) → indexed search demand ("dog friendly trails near [park]", "is [park] busy for dogs") → landing page answers honestly + shows the living community → install.**

- **Compounds because:** content inventory (Spots, trails, pulse histograms) grows with usage and *ranks better with age* — SEO is the only channel where the moat itself does the marketing.
- **Privacy rule:** public objects are community-level only (Spot/trail/aggregate); individual walks are never public web content, and dog cards render only opt-in fields (§12.2).
- **Timeline honesty:** this loop yields little before month 9–12 (index maturity + inventory); it is planted in Q1 (URL structure, previews) and harvested in year 2.
- **Loop metric:** organic search installs/month; indexed pages; Spot-page search CTR.

## 8.4 Data loop — the map that markets itself

**Walks generate passive signal + contributions → Sniff Map/Pulse/Trails get more accurate → product is visibly smarter than any alternative → word-of-mouth ("the app knows which fountains work") → more walkers → more signal.**

- **Compounds because:** data quality × coverage compounds with user-days (§2.4); each accuracy increment lifts retention and referral simultaneously.
- **Visible reciprocity is the accelerant** (P5): impact receipts turn contributors into narrators of the loop ("my pin helped 23 neighbors" is a story people tell offline).
- **Loop metric:** contribution rate (§7.5) × pin accuracy × "map was useful this week" (in-app pulse survey, quarterly).

## 8.5 Community loop — packs recruit packs

**User joins/forms a Pack (cohort, lounge, household) → pack activity (feed, challenges) → pack events (Pack Walks) → events are physically visible in parks (a Trot group walk *is* a billboard) → bystander dog owners ask "what's this?" → Park Card → new members → bigger packs → more events.**

- **Compounds because:** events are the rare growth mechanic with *physical-world* impressions; every event is local, recurring, and self-recruiting.
- **Design levers:** organizer tooling quality; post-event recap galleries (the artifact that recruits the next event); event kits for organizers (§15.3 sponsors subsidize).
- **Loop metric:** events/metro/month × avg bystander-conversion (Park Cards issued at events) × attendee→mate conversion.

## 8.6 Retention loop — the deepening archive

**More walks → richer archive/Memories/recaps → higher switching cost (the biography effect, §5.15) → longer retention → more walks.** Not an acquisition loop; the loop that makes every other loop's output *stick*.

- **Compounds because:** the artifact's emotional value grows super-linearly with time (year-two Memories beat year-one; a senior dog's archive is priceless).
- **Loop metric:** M6/M12 retention by archive depth decile; Memories open rate; YiR completion.

## 8.7 Creator loop — cartographers and trail authors

**Power contributors create trails/pins/Spot content → their work gets usage ("142 dogs walked your trail") → reputation (Cartographer tiers, §11.7) → more creation → better inventory → more users consuming → more usage receipts.**

- **Compounds because:** creator output is permanent local inventory; 1% of users creating 80% of trails is fine *if* the 1% is fed status and impact.
- **Design levers:** usage receipts (the creator's variable reward); creation tooling (60-second walk→trail flow); early-metro "founder" framing (§5.12).
- **Loop metric:** creators per metro (≥30 for graduation); creator M6 retention (expect near-100%); inventory per creator.

## 8.8 Local network loop — density begets density (the master loop)

All social loops feed one flywheel per neighborhood:

**More local users → more crossings/week per user → more mates → livelier feed + fuller Pulse + richer map → product visibly better → higher local retention & referral → more local users.**

- **The threshold effect:** below ~1 crossing/user/week the network is invisible ("social features seem dead"); above it, self-evident. This is why *all* growth spend and product gating is metro-scoped until graduation (§8.9): sub-threshold marketing manufactures churned users who are expensive to win back.
- **Loop metric (the one number per metro):** % WAU with ≥1 crossing/week. Graduation = 30% sustained 4 weeks.

## 8.9 The density playbook (city-by-city GTM as product)

1. **Pick 12 wedge metros** (§2.6 list) on dog density, park culture, walkability, and — critically — *neighborhood containment* (river/park-centric cities concentrate walkers; sprawl dilutes them).
2. **Seed each metro at the Spot level, not the city level:** identify the 20 highest-traffic dog parks; recruit 10–20 anchor users per park (local dog instagrammers, trainers, rescue orgs, reactive-dog group admins — the Ranger and Luna personas are the anchors, §4).
3. **Q1 product carries them alone** (single-player excellence needs no density); their share cards recruit the park's periphery.
4. **Flip Q2 social features per metro** when crossing-supply modeling says a median user will hit ≥1 crossing/week — dark features never look dead.
5. **Q3 community layer** launches with founding rituals (Spot christening, founding-pack chips) that convert earliness from a liability into status (§5.12).
6. **Graduate at 30%×4wks**, then adjacent-metro spillover + the next tranche. National marketing only after 8/12 graduate.
7. **Anti-pattern ban:** no national paid acquisition, no press tour before density, no vanity install spikes — installs without local peers are pre-churned (§2.5 weakness, mitigated here).

## 8.10 Loop interaction map & sequencing

```
Q1:  Viral(8.1) ──→ density seed ──→ Retention(8.6) starts banking
Q2:  density → Local(8.8) ignites → Invitation(8.2) cheapens → feed value ↑
Q3:  Community(8.5) + Creator(8.7) + Data(8.4) take over compounding
Y2+: Content/SEO(8.3) harvests; Data(8.4) is the moat narrating itself
```

**Portfolio math (steady-state targets, graduated metro):** viral 0.10 + invitation 0.12 + community/events 0.08 + content 0.05 ≈ **monthly K ≈ 0.35 on top of baseline retention** — sub-viral in isolation, but compounding against a 7–21×/week habit with M12 retention targets of 45% (§14), which is where the growth actually lives. We are not building a K>1 fad; we are building a ratchet: users arrive through loops and *don't leave* because of §8.6.

**The one-sentence version for the board:** Q1 makes artifacts worth sharing, Q2 makes neighbors worth knowing, Q3 makes places worth belonging to — and every quarter's loop output is the next quarter's raw material.
