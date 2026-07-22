# TROT — Master Product Requirements Document

**The social operating system for dog walking.**

| | |
|---|---|
| Status | Draft v1.1 — consolidated master (strategy + product + design) |
| Date | July 12, 2026 |
| Origin | Spin-off of the Pawtchi tracked-walks feature (`my-app/lib/walk/`, currently gated behind `WALK_TRACKING_ENABLED=false`) |
| Relationship to Pawtchi | Fully independent product — own brand, own database, own accounts. Optional one-way profile import bridge from Pawtchi (§13.9) |
| Audience | Product, design, engineering, growth, investors, and AI coding agents — this document is self-contained and requires no external context |

---

## How to use this document

This is the **single source of truth** for Trot: strategy (§1–§5), product definition (§6–§12), technology (§13), operations (§14–§16), design (§17–§19), and go-to-market (§20) in one portable file. Sections cross-reference each other with `§` numbers; screens are numbered `S-xx` (defined in §6); the seven product principles are `P1–P7` (defined in §3). Read §1 → §3 → §7 → §17 → §20 for the fastest complete picture; everything else deepens those five.

## Contents

| § | Section | Contents |
|---|---|---|
| 1 | Executive Summary | Vision, mission, product thesis, why now, competitive advantage |
| 2 | Market Analysis | TAM/SAM/SOM, competitive landscape, positioning, differentiation, SWOT |
| 3 | Product Principles | The seven principles every future feature must pass |
| 4 | User Personas | Seven personas, jobs-to-be-done, persona-to-feature matrix |
| 5 | User Psychology | Fifteen motivational mechanics, each with an ethics constraint |
| 6 | Information Architecture | Complete screen inventory, navigation, flows, onboarding, settings, notifications, map interactions |
| 7 | Feature Specifications | Six core features + Q1–Q3 roadmap features: objective, UX, edge cases, data model, backend, APIs, permissions, analytics, metrics |
| 8 | Growth Loops | Nine loop types, compounding math, city-by-city density strategy |
| 9 | Notification Strategy | Budgets, tiers, timing intelligence, trust guardrails |
| 10 | AI Opportunities | Eight AI value areas grounded in on-device signals |
| 11 | Gamification System | Achievements, levels, streaks + repair, seasons, collectibles, local reputation |
| 12 | Trust & Safety | Privacy-first location, consent, child & dog safety, abuse, fraud, emergency |
| 13 | Technical Architecture | V1 (ported walk stack) → 100M-user evolution; security; API conventions; delivery plan; Pawtchi bridge; store compliance |
| 14 | Metrics Framework | North Star (VWW) and the full metric tree |
| 15 | Monetization | Subscriptions, sponsored challenges, local partnerships, marketplace, place-intelligence API |
| 16 | Three-Year Vision | Year-by-year path to the category platform; risk register |
| 17 | Design Language: Fieldcraft | The complete design system — principles, tokens, typography, color, motion, iconography, illustration, photography, maps, accessibility, dark mode, notifications, widgets, wearables, AR posture |
| 18 | Feature-Level Design Specs | Per-experience design language: visual identity, interaction, emotional goals, design-as-growth, award bar |
| 19 | Competitive Experience Analysis | The reference class product-by-product + the ten paradigms Trot claims |
| 20 | Go-To-Market Playbook | Zero to 10,000 engaged users, Australia-first: launch phases, acquisition roadmap, loop operating system, social/content/creative/ads/copy, Anchor program, community, flagship campaigns, 100 experiments, GTM measurement, creative asset library |

---

## Working name

All copy in this document uses the working codename **Trot**. It is not final; trademark and app-store screening is required before launch.

| Candidate | Rationale | Risk notes |
|---|---|---|
| **Trot** (recommended) | The dog gait between walk and run — movement-native, one syllable, verbs well ("Bruno trotted 2.4 km"), works globally, no spelling gymnastics | Common English word; needs class-9/42 trademark screening. Short-domain scarcity (`trot.app`, `gettrot.com` likely needed) |
| **Waggle** | Warm, playful, tail-native | Existing Waggle pet-camera/monitor brand in the pet space — likely conflict |
| **Sniff** | The most dog-native word in the category; the "sniffari" community already uses it | Sniffspot is an established adjacent brand (private dog-park rentals); confusion risk is high |
| **Packs** | Social meaning built into the name | Generic dictionary plural — weak trademark, terrible ASO (search noise) |

**Decision needed by:** brand sprint, pre-Q1 development start.

---

## Glossary

Canonical names. Use these exactly, everywhere — code, copy, analytics events, and this document.

| Term | Definition |
|---|---|
| **Walk** | A GPS-tracked session recorded by the app. Has exactly one validation verdict. |
| **Valid Walk** | A walk whose on-device validator verdict is `valid` (not `too_short`, `likely_vehicle`, or `gps_junk`). Only Valid Walks count toward streaks, The Regular, challenges, Crossed Paths, and any community-visible stat. |
| **Sniff Stop** | An auto-paused stationary interval during a walk (the dog is sniffing, not the owner idling). Excluded from moving time, celebrated in copy. |
| **Dog Card** | The dog's public profile card: photo, breed, age, walk stats, badges, Best Mates. The atomic shareable unit of identity. |
| **Best Mate** | A mutual, accepted connection between two dogs (and therefore their owners). The edge of the social graph. |
| **Crossed Paths** | A detected space-time overlap between two dogs' Valid Walks, surfaced to both owners after the fact (never live). |
| **Spot** | A persistent community place created from recurring walk presence (park, trailhead, beach, café corner). Has visit history, regulars, busy hours. |
| **The Regular** | The rotating 90-day consistency champion of a Spot (one per size-class slot; see §7.4). |
| **Sniff Map** | The community-generated map layer: fountains, shade, off-leash zones, hazards, reactive-safe routes. |
| **Park Pulse** | Live and predicted busyness intelligence for a Spot. |
| **Trail Tail** | A community-curated route with dog-specific attributes (shade %, surface, senior-suitability, etc.). |
| **Pack** | A group container: a household's dogs, a friend circle, or a community (breed lounge, puppy cohort). |
| **Pack Feed** | The activity feed scoped to your Best Mates and Packs. |
| **Treat Toss** | The lightweight reaction (Trot's "kudos"): tossing a virtual treat on a walk post. |
| **PawCoins** | The soft currency earned through walks and contributions. (Name carried from Pawtchi; rebrand candidate.) |
| **Quiet Hours** | The reactive-dog mode: quiet-time recommendations, empty-park signals, low-traffic routes. First-class pillar, not a setting. |
| **Home Zone** | The user-defined privacy radius around home (and other sensitive places) inside which route data is never recorded or displayed. |
| **Beacon** | A scheduled, opt-in "I'll be at [Spot] at [time]" signal that seeds Park Pulse before passive density exists. |
| **VWW** | Valid Walks per Week — the North Star Metric (§14). |
| **Fieldcraft** | Trot's design system and language (§17): principles, tokens, motion, map style, photography. |
| **Morning / Dusk** | The light and dark color modes (§17.4/§17.14). |
| **Clay is motion** | The reserved-color rule: terracotta marks only the dog's movement — route, record, live states (§17.4). |
| **The Leash Rule** | Design law: one-handed, outdoor, glanceable ergonomics; primary actions in the bottom 40% of the screen (§17.1). |
| **Gait** | The motion language (§17.9): four signature moves (route draw, breath, settle, heartbeat), one celebration at a time. |
| **Fieldmap** | The custom map style (§17.15): parks-first hierarchy, Clay route line, honest confidence rendering. |

---

## Conventions used in this document

- **Data model sketches** are written in Supabase/Postgres idiom with row-level-security notes, matching the style of the existing `walk_sessions` migration, so engineering can lift them into migrations directly.
- **"What we changed and why"** subsections appear in each core feature spec where this document deliberately improves on the original brief.
- **The Density Test** (§3) is applied to every feature: *what is this worth to the very first user in a city, and why does it get better with each additional user?*
- Analytics event names are `snake_case` and listed per feature; the master metric tree is in §14.
- All prices are USD placeholders; store prices are always fetched from RevenueCat offerings at runtime, never hardcoded (a lesson already learned in Pawtchi).
- Design values (colors, type, spacing, motion timings) are defined once in §17 as tokens and referenced everywhere else; app code consumes them from the `design-tokens` package, never as literals (§17.20).

---

# §1 — Executive Summary

## 1.1 Vision

**Every dog on Earth has a map, a pack, and a story.**

Trot is the social operating system for dog walking. Walking is the entry point — the one behavior every dog owner already performs, one to three times a day, every day, in public space, near other dog owners. The product is the network that forms around those walks: the dogs who cross paths, the parks that become places, the neighbors who become friends, and the compounding location intelligence that no competitor can copy because it is generated by the community itself.

Strava proved that a single tracked activity, wrapped in identity and community, can become a durable global network. But Strava's atom is *performance* — pace, watts, PRs — and its ceiling is the athlete population. Trot's atom is *companionship*. The addressable behavior is not "training"; it is the daily ritual shared by half a billion dog-owning households, most of whom will never care about a personal record but all of whom care, deeply and daily, about their dog.

## 1.2 Mission

Make every walk count — for the dog, for the owner, and for every dog owner who walks after them.

Concretely:

1. **For the dog:** a permanent, beautiful record of a life lived one walk at a time — and healthier routines, because what gets noticed gets done.
2. **For the owner:** pride, belonging, and a neighborhood that feels like a community instead of a place you pass through.
3. **For everyone else:** each walk quietly improves the shared map — which fountain works, which trail is shaded at noon, when the park is calm enough for a nervous rescue.

## 1.3 Product thesis

Our thesis has four claims, each of which the rest of this document defends in detail:

**Claim 1 — Dog walking is the most under-networked high-frequency behavior in consumer tech.**
Dog owners walk 1–3× daily, at recurring times, in recurring public places, physically co-present with other dog owners. Every ingredient of a local social network exists in the offline behavior already — the encounters, the regulars, the small talk at the gate. No product has digitized this graph. Dog-owner apps to date have been either utilities (GPS collars, walk-scheduling for hired walkers) or ghost-town social apps with no recurring behavioral anchor. Trot anchors the network to the walk itself, so the graph is built as a by-product of a habit that already exists. (§2, §7.1)

**Claim 2 — The durable moat is community-generated location intelligence, not features.**
Features are copyable. Ten years of "which park is quiet at 7am for reactive dogs in light rain" is not. Every walk contributes passive signal (routes, presence, dwell points); every engaged user contributes active signal (Spot details, hazards, reviews). This compounds into a proprietary dataset — the *Sniff Map* and *Park Pulse* — that gets harder to replicate with every user-day. This is the OpenStreetMap/Waze playbook applied to a domain nobody has mapped. (§7.5, §7.6, §8)

**Claim 3 — Emotional design beats performance design in this category.**
People do not walk dogs to get faster. They walk because the dog is family. The product language celebrates *consistency, noticing, and companionship*: sniff stops are celebrated rather than subtracted, The Regular rewards showing up rather than speed, and the Year in Review is about a life shared, not a training log. This widens the market from "athletes with dogs" to "everyone with a dog" — and it is a positioning competitors anchored on fitness cannot credibly adopt. (§3, §5)

**Claim 4 — Single-player excellence funds the network.**
Local networks die in the cold-start gap. Trot's Q1 product is deliberately excellent for a user with zero friends in the app: gorgeous tracking, Dog Cards, milestones, streaks, recaps, and share cards worth posting off-platform. Those shares are the acquisition channel that builds neighborhood density; density unlocks Crossed Paths and the social graph; the graph unlocks community intelligence. Each phase pays for the next. (§7 roadmap, §8)

## 1.4 Why now

- **The pet economy has structurally re-rated.** Post-2020 adoption cohorts are now in prime dog-parenthood years; pet spending has proven recession-resilient and continues to shift from goods to services and digital. "Pet parent" is an identity, not a demographic — and identity products are network products.
- **The behavior is already digitized halfway.** GPS collars (Fi, Tractive) normalized tracking a dog's activity; Strava normalized sharing a mapped workout; BeReal and Locket normalized small-graph, low-pressure sharing. Users need no education for any core mechanic — only a product that combines them for dogs.
- **The incumbent networks left the door open.** Strava explicitly serves athletes; Nextdoor is a complaints board; Facebook dog groups are unstructured and unmapped; dedicated dog-social apps failed on cold start because they led with the network instead of the single-player utility. The category-defining position is unclaimed.
- **We start with the hard part already built.** The Pawtchi walk stack is production-grade and store-compliant by design: a battery-aware location engine, a reconciler-guaranteed tracking stop, an anti-junk walk validator, privacy-first on-device route simplification, and a working share-card pipeline (§13.2). Competitors start from zero; we start from a tested tracking core and a hard-won store-compliance playbook.
- **AI makes thin data thick.** On-device models turn modest signals (pace patterns, sniff-stop frequency, route choices) into meaningful insights (gait-change flags, enrichment scores, route recommendations) without shipping raw location to a server — a capability that did not exist cheaply three years ago. (§10)

## 1.5 Competitive advantage

Ranked by durability, least to most:

1. **Execution head start (months).** A ported, production-tested tracking pipeline, validator, and share system; a documented store-compliance path for background location on both stores.
2. **Positioning (years).** "Companionship, not performance" is a brand position incumbents cannot take without abandoning their core identity. Owning the reactive-dog and senior-dog communities (§4, §7.6 Quiet Hours) creates evangelists in the highest-word-of-mouth segments of the dog world.
3. **The local graph (compounding).** Best Mates formed from real-world Crossed Paths are edges no global social network has — verified, hyper-local, recurring, and emotionally loaded. Graph density per neighborhood is the true unit of defensibility.
4. **The data moat (compounding, decisive).** Community-generated, dog-specific location intelligence — Spots, Sniff Map layers, Park Pulse temporal patterns, Trail Tail attributes — created as a by-product of walks. Value per user grows with every additional user; replication cost grows with every user-day. At scale this dataset also becomes the monetization substrate (§15) and the platform for the three-year vision (§16).

## 1.6 The product in one screen

A user opens Trot and sees, in order: their dog (alive, animated, celebrated), one tap to start a walk, their streak and this week's story, the Pack Feed of dogs they know, and the neighborhood — today's Park Pulse, a new water-fountain pin added by a neighbor, and a note that *Bruno crossed paths with Luna at Riverside Park yesterday*. Every element either deepens the habit, strengthens an edge in the graph, or makes the shared map better. Nothing on the screen is there for any other reason.

## 1.7 Roadmap at a glance

| Phase | Theme | Job | Primary KPI |
|---|---|---|---|
| **Q1 — Worth Sharing** | Single-player excellence | Make one user with zero friends love and share the product | Shares per Weekly Active User |
| **Q2 — Bruno Has Friends** | The social graph | Turn real-world encounters into Best Mates and a feed worth returning to | Users with ≥3 Best Mates; Weekly Connected Walks |
| **Q3 — Bruno Has a Tribe** | Communities & intelligence | Packs, events, and the Sniff Map open the network layer | Monthly Active Packs; community contribution rate |

The full sequencing logic, feature specs, and success metrics are in §7; growth mechanics in §8; the three-year arc in §16.

## 1.8 What we are not building

Discipline about non-goals is part of the spec:

- **Not a marketplace for services** (walking, sitting, grooming) in year one. Rover/Wag own that; it poisons the community feel if introduced early. Revisited as a partnership surface in §15/§16.
- **Not a live location-sharing app.** Nothing in Trot ever shows where a dog *is right now* to anyone but the owner. Crossed Paths is retrospective; Park Pulse is aggregate. This is a trust line we never cross (§12).
- **Not a veterinary or health-advice product.** Wellness signals are observations, never diagnoses; Pawtchi remains the health-depth product, and the import bridge is one-way (§13.9).
- **Not a general pet app.** Dogs only, walking first. Cats, birds, and everything else are out of scope until the dog network is won.

---

# §2 — Market Analysis

> Figures below are planning estimates assembled from public industry reporting (AVMA, APPA, Euromonitor, FEDIAF ranges) as of mid-2026. They are directionally reliable and should be re-verified with primary sources before external fundraising use.

## 2.1 Market sizing

### The behavioral market (the number that matters)

Trot monetizes attention and membership, not pet food — so the sizing that matters is *dog-owning households × walk frequency × digital propensity*.

| Layer | Estimate | Basis |
|---|---|---|
| Dogs worldwide (owned) | ~700M | Global estimates range 700M–1B incl. free-roaming; owned-dog figure is conservative |
| Dog-owning households, developed markets (US, CA, UK, EU, AU/NZ, JP) | ~150M households | US ~65M, EU ~90M+ dog-owning households alone |
| Households that walk daily (urban + suburban, leash-culture markets) | ~90M | Walking is near-universal in urban markets; lower in rural/yard cultures |
| Smartphone-carrying walkers open to a tracking app | ~45M near-term serviceable | Strava's own MAU proves >100M people will track a recreational activity |

### TAM / SAM / SOM

| | Definition | Size |
|---|---|---|
| **TAM** | All dog-owning households in leash-culture markets, monetized at blended $12/user/yr (subscription minority + sponsorship/partnership majority) | ~150M households → **$1.8B/yr** attention-market TAM; the adjacent commerce/services layer (§16) expands this to the >$150B global pet-spend pool |
| **SAM** | English-first launch markets — Australia first, then UK, US, CA — urban/suburban daily walkers with smartphones | ~30M households → **$360M/yr** |
| **SOM (36 months)** | 12 launch metros driven to density (§8.9), then national expansion; 2.5M MAU, 6% paid conversion at $39.99/yr + sponsorship revenue | **$70–90M ARR potential** at plan; conservative case $25M |

### Frequency is the hidden multiplier

The category's structural advantage over every other social/fitness vertical: a committed runner trains 3–5×/week; a dog is walked 7–21×/week, year-round, regardless of weather motivation, because the dog insists. Habit products are frequency products. Trot's raw session ceiling per user is 2–4× Strava's.

## 2.2 Competitive landscape

### Direct and adjacent competitors

| Player | What it is | Strength | Why it doesn't win this category |
|---|---|---|---|
| **Strava** | Fitness network, 100M+ registered | The playbook itself; segments; brand | Explicitly athlete-positioned. Pace/PR framing is wrong for dog walking (sniff stops ruin your splits). Dogs are at best a photo tag. Entering "companionship" would dilute its core brand promise. |
| **Fi / Tractive / Whistle** | GPS collar hardware + subscription | Always-on tracking, escape alerts, real revenue | Hardware-gated (<5% of owners), utility-positioned, single-player. Fi's "ranks" show social appetite but the network is thin and hardware-locked. **Partnership target, not enemy** — Trot should ingest collar data (§13.8). |
| **Rover / Wag** (AU: Mad Paws) | Services marketplace (walkers, sitters) | Liquidity, brand, payments | Their user walks *someone else's* dog for money. Marketplace DNA, no owner-community. Their walk-report screens prove demand for walk artifacts. Future distribution partner. |
| **Sniffspot** | Airbnb for private dog parks | Owns the reactive-dog rental niche | Transactional, not social; no tracking, no graph. Validates that reactive-dog owners pay for controlled space — our Quiet Hours wedge (§7.6). Partnership/acquisition candidate. |
| **BarkHappy / Patch / assorted "dog social" apps** | Dog social networks / playdate finders | Proof of intent | All failed the same way: led with the network (empty rooms) instead of single-player utility. No behavioral anchor, no reason to open daily. Their graveyard is our syllabus. |
| **Nextdoor / Facebook Groups** | General local networks | Where dog conversation happens today | Unstructured, unmapped, high-toxicity ambient environment. "Lost dog" posts and park drama prove local dog demand; neither can build walk-anchored structure. |
| **Pawtchi** (parent) | Dog health & nutrition companion | Owns health depth; built our walk stack | Different job (health management vs. social/outdoor). Deliberately separated; import bridge only (§13.9). No cannibalization: Trot walking data can deepen Pawtchi's health picture later. |
| **Apple/Google Fitness, AllTrails** | Generalist activity/outdoor apps | Distribution | Dogs are not a first-class object; no dog identity, no dog graph, no dog map layers. AllTrails' "dog-friendly" filter is one boolean — Trail Tails is that filter turned into a product (§7.7). |

### The empty quadrant

Plotting the field on two axes — **Performance ↔ Companionship** (emotional frame) and **Utility ↔ Network** (product structure):

- Strava: Performance × Network
- Collars: Companionship × Utility
- Rover/Wag: Companionship(hired) × Utility/Marketplace
- Failed dog-social apps: Companionship × Network — *but with no utility anchor, they had no way to get there*

**Companionship × Network, reached through utility** is unoccupied. The strategic insight is not the quadrant — it's the *path*: single-player walk utility is the only proven bridge into it, and we already own a production-grade version of that bridge.

## 2.3 Positioning

**Category:** dog walking companion → dog social network → dog location-intelligence platform (in that order, publicly; we never announce a "social network").

**Positioning statement:**
> For dog owners who walk every day, Trot is the walking companion that turns every walk into part of your dog's story — and your neighborhood into a place you belong. Unlike fitness trackers, Trot celebrates the sniff stops.

**Tagline territory** (brand sprint to finalize): *"Every walk counts."* / *"The best part of their day."* / *"Walk together."*

**Message architecture by audience:**

| Audience | Lead message | Proof |
|---|---|---|
| New user (store listing) | The most beautiful record of your dog's walks | Dog Card, share cards, Year in Review |
| Reactive-dog owner | Finally know when the park is quiet | Quiet Hours, Park Pulse, reactive-safe routes |
| Social sharer | Your dog's story, worth posting | Milestones, recap cards, Crossed Paths moments |
| Investor | Waze for dogs, built on a Strava-grade habit loop | VWW growth, density metrics, contribution rates (§14) |

## 2.4 Differentiation (defensible, not just different)

1. **Walk-anchored graph formation.** Best Mates emerge from verified physical co-presence (Crossed Paths), not from search-and-follow. Nobody else can form these edges without first owning the walk. (§7.1)
2. **Consistency-first status system.** The Regular, streaks, and badges reward showing up — the only metric every dog owner can win. Performance-status products structurally exclude 90% of the market. (§7.4, §11)
3. **Dog-specific map layers.** Shade %, water access, off-leash zones, hazard pins, reactive-safe windows — attributes no general map records, generated as a by-product of walks. (§7.5, §7.7)
4. **Privacy as product, not policy.** Raw GPS never leaves the device (inherited architecture, §13.2); Home Zones; retrospective-only social features. In a category where users walk from *home*, at *routine times*, with *family* — this is a first-order purchase criterion and a direct contrast to Strava's heatmap history. (§12)
5. **The under-served-persona wedge.** Reactive- and senior-dog owners are ignored by every fitness-framed product, over-index on community participation, and evangelize hard. Quiet Hours makes them founders of the community, not an afterthought. (§4.5, §4.6)

## 2.5 SWOT

**Strengths**
- Production-tested tracking core, validator, and share pipeline inherited from Pawtchi; store-compliance playbook for background location already written (§13.2, §13.10)
- Category frequency (7–21 sessions/household/week) exceeds any comparable vertical
- Emotional domain with built-in shareability (dogs are the internet's favorite content)
- Clear, phased path from single-player value to network value

**Weaknesses**
- Local network effects require *neighborhood-level* density — the hardest cold-start class; a national sprinkle of users is worthless (§8.9 is the mitigation and must be treated as core product, not marketing)
- Independent brand starts from zero audience (Pawtchi bridge helps only modestly by design)
- Background-location apps face elevated store scrutiny, battery-complaint risk, and OS-level permission attrition
- Small team vs. a roadmap that spans consumer social, geo infrastructure, and community ops

**Opportunities**
- Collar-hardware partnerships (Fi/Tractive ingest) to become the software layer over dog hardware (§13.8)
- Municipal/parks-department data partnerships once Park Pulse has signal (§15.6, §16)
- Pet-brand sponsorship of challenges and seasonal events — endemic advertisers with no comparable native surface today (§15.3)
- International leash-culture markets (UK, DE, NL, JP) where walking norms are even stronger than the US
- If Strava ever adds a "pet" tag, it validates the category while remaining performance-framed — likely a net acquisition tailwind

**Threats**
- Strava, Fi, or Rover pivoting hard into owner-community (mitigation: speed to density in wedge metros; positioning they can't copy; partnerships that make us complementary)
- OS privacy tightening degrading background tracking UX (mitigation: foreground-first design; the walk is an intentional session, not passive surveillance — we need less permission than a collar app)
- Community toxicity or a single safety incident defining the brand (mitigation: §12 is resourced from day one, not retrofitted)
- Data-moat poisoning (spam pins, fake walks) as the map gains value (mitigation: verified-presence gating via the walk validator, §7.5/§12.6)

## 2.6 Market-entry sequencing

Density beats breadth — and the launch runs **Australia-first**. Launch strategy (detailed in §8.9 and operationalized in §20): 12 wedge metros chosen for dog density, park culture, walkability, and neighborhood containment — beginning at home (Melbourne, Sydney, Brisbane, Perth, Adelaide), then the international tranche (London, Manchester, Amsterdam, Toronto, and US wedge metros such as Seattle, Portland, Denver). Australia is the ideal first market: one of the world's highest dog-ownership rates (roughly half of households), a café-and-park culture already organized around dogs, council-designated off-leash areas that map one-to-one onto Spots, contained walkable inner suburbs, and a quiet-market advantage — the playbook is proven at home before it meets US competitor attention. A metro "graduates" when ≥30% of its weekly active users experience ≥1 Crossed Path per week — the threshold where the network becomes self-evident to a new user. National (and later international) marketing begins only after 8 of 12 metros graduate.

---

# §3 — Product Principles

These seven principles are the constitution. Every feature proposal, design review, and prioritization debate resolves against them. Each principle is stated, made operational with a **decision test** (a question with a pass/fail answer), and illustrated with a live ruling from this PRD.

---

## P1 — The dog is the protagonist

The account belongs to the human; the *identity* belongs to the dog. Profiles, stats, badges, feeds, and celebrations center the dog. Humans appear as "Bruno's human," never the reverse. This is not whimsy: it lowers social risk (posting about your dog is safe in a way posting about yourself is not), raises shareability (dog content outperforms human content everywhere), and makes status non-threatening (nobody resents a corgi).

**Decision test:** *If this screen were shown with the dog's name removed, would it still make sense?* If yes, it's probably human-centered — redesign it.

**Ruling applied:** Crossed Paths notifications read "Bruno crossed paths with Luna," never "You crossed paths with Sarah." The human graph is derived, private plumbing; the dog graph is the product.

---

## P2 — Celebrate showing up, never speed

Consistency is the only performance metric. Pace, splits, and rankings by distance are banned from community-visible surfaces. Sniff stops are celebrated ("Bruno investigated 14 interesting things"), not subtracted as dead time. Effort framing adapts to the dog: a 400m senior-dog shuffle and a 8km husky trek can both be that day's win.

**Decision test:** *Can a three-legged senior chihuahua win this?* If a feature's top state is unreachable for slow, small, old, or reactive dogs, redesign the reward around consistency, contribution, or curiosity instead.

**Ruling applied:** The Regular (§7.4) is awarded on visit count, not distance; leaderboards as a concept are replaced by rotating recognition slots.

---

## P3 — Single-player first, network always

Every feature must be valuable to a user with zero connections in an empty city, *and* must get better with each additional user. Both halves are mandatory: features valuable only at density die in the cold-start gap; features that ignore density build no moat.

**Decision test (The Density Test, run at every spec review):**
1. *What does this deliver to the very first user in Boise?*
2. *State the sentence: "This gets better when one more person joins because ___."*
A feature failing either question is redesigned or resequenced.

**Ruling applied:** Park Pulse fails question 1 at zero density — so V1 ships with time-of-day heuristics from public signals plus opt-in Beacons (§7.6), and honestly labels confidence, rather than shipping an empty "live" map.

---

## P4 — Privacy is the product, not the settings page

Users walk from home, at routine times, often with children. Location intimacy is existential here in a way it isn't for gym selfies. Therefore: raw GPS never leaves the device (simplified ≤200-point polylines only — inherited architecture, §13.2); Home Zones cloak sensitive areas by default; every social feature is retrospective and aggregate, never live; defaults are always the private option; each new visibility is a separate, explained, revocable opt-in.

**Decision test:** *Could a stranger use this feature to locate a specific dog in physical space, now or predictably?* If yes in any state — including adversarial use of defaults — it does not ship.

**Ruling applied:** Crossed Paths reports coarse place + day ("Riverside Park, yesterday"), never timestamps precise enough to reveal a schedule; The Regular displays at Spot granularity with an opt-out that never reveals it was declined (§7.4).

---

## P5 — Every walk feeds the map; the map repays every walk

Data contribution is a by-product of normal use, and the value returned is visible. Passive signal (routes, presence, dwell) accrues automatically within privacy rules; active contributions (pins, reviews, hazard reports) take one tap at the moment of observation. Critically, the loop is closed *visibly*: "Your walks helped 23 neighbors find shade this month." Invisible extraction breeds resentment; visible reciprocity breeds pride and more contribution.

**Decision test:** *Does this feature either add signal to the shared map or visibly return the map's value to the user?* Features that do neither must justify themselves entirely on P1–P4 grounds.

**Ruling applied:** Sniff Map contribution prompts appear contextually at walk end ("You paused at a fountain — does it work?"), not as chores; contribution impact appears in the Monthly Recap (§7.8).

---

## P6 — Growth is a property of the product, not a department

Sharing, inviting, and contributing must each be the genuinely best way to get more value — never a toll. Share cards exist because the moment deserves commemorating; invites exist because a Best Mate makes your feed better; there are no share-gates, invite-walls, or artificial scarcity mechanics. The growth model (§8) is engineered, but every loop's user-facing step must pass an honesty check.

**Decision test:** *If sharing/inviting gave the user zero reward, would a proud owner still plausibly do this?* If no, the artifact isn't good enough yet — improve the artifact, don't sweeten the bribe.

**Ruling applied:** Referral v1 carries no coin reward (a lesson carried from Pawtchi's emotional-share referral); the invite's pitch is "Luna's human should see this," not "get 50 coins."

---

## P7 — Built for 100 million, shipped for one neighborhood

Architecture assumes global scale from day one: horizontally scalable services, geospatially partitioned data, event-driven pipelines (§13). Product assumes hyper-local reality: features launch metro-by-metro, tuned for density, with honest degraded states where density is absent. Never the reverse — no architecture that caps at a city, no product that pretends density it doesn't have.

**Decision test:** *Does this design survive both 100 users in one park and 100M users globally?* Name the failure point at each end before approving.

**Ruling applied:** Spot detection uses H3 cell aggregation that works identically for one park or one planet (§13.5); Park Pulse displays confidence tiers instead of faking liveness in thin markets (§7.6).

---

## Using the principles

- **Conflicts resolve by number.** P1–P4 (identity, dignity, cold-start honesty, privacy) outrank P5–P7 (data, growth, scale). Privacy (P4) is absolute: it wins every conflict.
- **Every feature spec in §7 ends with a principles checklist** — reviewers reject specs with unexplained failures.
- **Amendments** require a written case in this file, not a hallway decision. The principles change rarely; interpretations accumulate as "rulings" under each principle, like the ones above.

---

# §4 — User Personas

Seven personas span the launch market. Two conventions:

- Every persona is named by the **dog first** (per P1), with the human as supporting cast.
- Each persona lists **Jobs-to-be-Done**, **anxieties** (what could make them churn or never install), the **hook feature** that wins them, and the **network role** they play once retained — because in a network product, personas are not just segments to serve but roles in the system.

A persona-to-feature matrix closes the section.

---

## 4.1 "Biscuit" — the first-time dog owner

**Maya, 27, urban renter, adopted Biscuit (mixed-breed, 1 yr) eight months ago.** Chronically online, posts Biscuit constantly, follows dog trainers on TikTok, has never owned a dog as an adult.

- **JTBD:** *Help me feel like I'm doing this right* — am I walking enough? Is this normal? Also: give me things to post.
- **Anxieties:** judgment from experienced owners; not knowing park etiquette; guilt on missed-walk days.
- **Hook:** Dog Card + streaks + Monthly Recap — visible proof she's a good dog parent, in a shareable form. "Is this enough walking?" answered by gentle norms ("dogs like Biscuit typically…"), never red numbers.
- **Network role: the amplifier.** Highest share rate of any persona; her off-platform posts are the top-of-funnel. Also the most notification-tolerant — but we protect her from burnout anyway (§9).
- **Churn risk:** novelty decay at week 6–10. Countered by milestone cadence and the first Crossed Path, which typically lands in her window if metro density exists.

## 4.2 "Ranger" — the experienced owner

**Dave, 44, has had dogs for 25 years; Ranger is his third shepherd.** Walks 6:30am and 6:30pm like clockwork, knows every dog at the park by name (and no human's). Skeptical of apps, hates gimmicks.

- **JTBD:** *Respect my routine and give me something genuinely useful* — a record of Ranger's life, and practical park intel. Zero tolerance for being gamified at.
- **Anxieties:** notification spam; cutesy tone; his data being sold; "another app that'll shut down in a year."
- **Hook:** The Regular. Dave *is* the regular at his park — the app simply makes visible a status he's earned over years. Second hook: the walk archive as Ranger's biography (senior-dog Years in Review hit this persona hardest).
- **Network role: the anchor.** Regulars like Dave give Spots their identity, seed Sniff Map accuracy, and confer legitimacy — when Dave vouches, the park adopts. Low share rate, extremely high retention, high contribution quality.
- **Design consequence:** every gamification surface needs a dignified reading (§11); tone control matters (§9); The Regular must never feel like a game he's too old for — it's recognition, not points.

## 4.3 "Peanut" — the urban walker

**Jess, 33, dense-city apartment, Peanut (French bulldog).** Three short walks a day on sidewalks; the dog park is a social lifeline in a city where making friends is hard.

- **JTBD:** *Turn my block into a neighborhood* — who are these dogs we see every day? Where's a decent third place? Also: variety for short routes.
- **Anxieties:** urban safety (won't share routines publicly); sidewalk hazards (glass, chicken bones — a real brachycephalic-dog hazard); summer pavement heat.
- **Hook:** Crossed Paths. Urban density means her first week produces "Peanut crossed paths with 6 dogs" — instant proof the network is real. Sniff Map hazard pins are the retention layer.
- **Network role: the graph-builder.** Highest Crossed Paths volume and Best Mate conversion; urban users make the social layer light up first. Metro launch strategy (§8.9) is built around this persona.

## 4.4 "Cooper" — the suburban family dog

**The Okafor family: two parents, kids 8 and 11, Cooper (golden retriever).** Walks are split across four people; the kids beg for turns.

- **JTBD:** *Make Cooper's care a family activity* — one dog, many walkers, shared streak, shared pride. Give the kids a safe way to participate.
- **Anxieties:** kids' safety and privacy above all; who-walked-the-dog household disputes; yard time replacing walks in metrics.
- **Hook:** Household Packs (§7.9) — Cooper's streak is a family streak; each member's walks stack. The fridge-door dynamic: "who's getting Cooper his 100th walk badge?"
- **Network role: the multiplier.** One dog, four accounts; family members convert at near-100%. Also the persona that forces multi-walker data modeling (dog-centric, not account-centric — §7.9, §13.4) and the strictest child-safety design (§12.4: no minors' accounts in v1; kids walk under a parent's supervision flag).

## 4.5 "Luna" — the reactive dog ⭐ *wedge persona*

**Sam, 38, and Luna (rescue collie mix, dog-reactive).** Walks at 5:45am and 10pm specifically to avoid other dogs. Has cried in the car after a bad park encounter. Member of three reactive-dog Facebook groups; spends real money on trainers and Sniffspot rentals.

- **JTBD:** *Tell me when and where it's safe* — empty-park windows, wide paths, escape routes, no off-leash surprises. And: let me belong to the dog world I'm otherwise excluded from.
- **Anxieties:** the product being one more place her dog "fails"; social features that broadcast her location or pressure meetups; judgment.
- **Hook:** Quiet Hours (§7.6) — Park Pulse inverted: quiet-time predictions, reactive-safe Trail Tails (visibility, width, exit density), and a mode where all meetup-flavored features go dormant. Luna's streak celebrates *calm* walks, not social ones.
- **Network role: the evangelist.** The most under-served, most community-active, highest-word-of-mouth segment in the dog world. When reactive-dog forums decide Trot is "the app that gets it," the resulting advocacy is unbuyable. Also the persona that keeps us honest: every social feature must have a graceful non-participation mode (P2, P4).
- **Strategic note:** Luna is a *wedge*, not a niche — an estimated 20–30% of dogs show leash reactivity. Serving her well produces features (quiet predictions, path metadata) that improve the product for everyone.

## 4.6 "Duke" — the senior dog

**Priya, 52, and Duke (lab, 12 yrs, arthritic).** Walks have shrunk from 5km hikes to 800m ambles. Every walk is precious; she photographs him constantly, aware of why.

- **JTBD:** *Honor what he can still do, and help me notice change* — flat shaded routes with benches; gentle records of slowing down; memories.
- **Anxieties:** the app making Duke's decline feel like failure (any "you walked less than last month" framing is a delete-the-app event); grief.
- **Hook:** Trail Tails senior-suitability filters + Memories. Effort framing is calibrated to Duke's own baseline (per-dog calibration, §10.2): 800m at 12 is a triumph. The walk archive quietly becomes Duke's biography.
- **Network role: the heart.** Senior-dog and memorial content is the most emotionally resonant sharing in the category; handled with grace (including a designed, dignified end-of-life account state — §12.7), it defines the brand. Handled clumsily, it defines the brand.

## 4.7 "Ziggy" — the puppy

**Tom & Ana, 30s, first eight weeks with Ziggy (spaniel, 14 wks).** Overwhelmed, sleep-deprived, information-hungry, currently deciding which apps become permanent.

- **JTBD:** *Structure this chaos* — age-appropriate exercise (the five-minute rule), socialization tracking, and other puppy people nearby who get it.
- **Anxieties:** over-exercising a growing puppy; vaccination-window rules about where puppy paws may touch ground; doing socialization "wrong."
- **Hook:** Puppy Mode — duration guidance by age, socialization checklist woven into walks ("Ziggy met: a cyclist ✓, an umbrella ✓, a large calm dog ✓"), and Puppy Cohorts (§7.9): a Pack of puppies born the same season in the same metro, growing up together in the feed.
- **Network role: the cohort.** Puppy Cohorts create same-stage bonds with a decade of retention runway ahead of them; the puppy persona is where lifetime value begins. Graduation from Puppy Mode is itself a milestone moment (share card: "Ziggy grew up 🎓").

---

## 4.8 Persona-to-feature matrix

| Feature | Biscuit (new) | Ranger (vet.) | Peanut (urban) | Cooper (family) | Luna (reactive) ⭐ | Duke (senior) | Ziggy (puppy) |
|---|---|---|---|---|---|---|---|
| Dog Card & share cards | **Hook** | ● | ● | ● | ● | ● | **Hook-adjacent** |
| Streaks & milestones | **Hook** | ● (dignified) | ● | **Hook** (shared) | ● (calm-framed) | ● (baseline-framed) | ● |
| Crossed Paths | ●● | ● | **Hook** | ● | opt-out respected | ● | ●● |
| Best Mates / Pack Feed | ●● | ● | ●● | ● | quiet mode | ● | ●● |
| Spots & The Regular | ● | **Hook** | ●● | ● | quiet Spots | ● | ● |
| Sniff Map | ● | ●● (contributor) | ●● (hazards) | ● | **●● (safety layers)** | ● | ● (surface rules) |
| Park Pulse / Quiet Hours | ● | ● | ●● | ● | **Hook** | ● | ● |
| Trail Tails | ● | ● | ● | ●● | ●● (safe routes) | **Hook** (suitability) | ● (duration-capped) |
| Household Packs | – | – | – | **Hook** | – | ● | ● |
| Puppy Cohorts / Mode | – | – | – | ● | – | – | **Hook** |
| Memories / Year in Review | ●● | ●● | ● | ●● | ● | **Hook** | ● |

Legend: **Hook** = acquisition/retention anchor for the persona · ●● strong value · ● value · – not relevant.

**Reading the matrix:** every core feature hooks at least one persona and serves at least five; no persona depends on network density for their hook except Peanut (mitigated by metro launch strategy) — this is the Density Test (P3) holding at the persona level.

---

# §5 — User Psychology

Trot's engagement model is built on a specific ethical stance, stated before any mechanic: **the walk is already good for the user, the dog, and the neighborhood.** We are amplifying an intrinsically healthy behavior, not manufacturing a compulsive one. That privilege comes with rules:

1. **Amplify, never manufacture.** Every mechanic must attach to real-world value (a walk taken, a friend made, a map improved). Mechanics that generate engagement with no offline referent are banned.
2. **The dog is the alibi test.** If a user described the behavior we induced ("I walked Bruno in the rain to keep the streak"), would a veterinarian smile or frown? Frown = redesign.
3. **Graceful exits everywhere.** Every pressure mechanic (streaks, seasons, FOMO-adjacent surfaces) has a designed release valve, because life with dogs includes injury, illness, and loss.
4. **No dark-pattern inventory:** no artificial scarcity, no pay-to-relieve-anxiety, no guilt copy, no fake social activity, no notification bait ("someone looked at Bruno's profile").

Each mechanic below states: **what it is → where it lives in Trot → the ethical constraint.**

---

## 5.1 Intrinsic motivation (autonomy, mastery, relatedness)

Self-determination theory is the foundation; everything else is decoration on it. **Autonomy:** the user chooses routes, goals, visibility; Trot suggests, never prescribes; goals are self-set with smart defaults. **Mastery:** knowing your neighborhood, reading your dog, contributing expertise to the Sniff Map — competence that exists offline and is merely mirrored. **Relatedness:** Best Mates, Packs, and the felt sense of belonging to a place.

*Lives in:* self-set weekly rhythm goals; contribution reputation (§11.7); the entire social layer.
*Constraint:* extrinsic rewards (coins, badges) must never be attached so tightly to intrinsically motivated acts that they crowd out the intrinsic motive (the overjustification effect). Coins reward *contribution*, not *walking itself* — walking's reward is the walk, recorded beautifully.

## 5.2 Identity

The strongest retention force available: products woven into "who I am" don't get deleted. Trot builds *two* identities: the dog's (Dog Card, badges, The Regular, biography) and the owner's derived identity ("good dog parent," "neighborhood regular," "the person who knows the trails").

*Lives in:* Dog Card as the atomic identity object; profile "roles" earned not chosen (Regular of Riverside Park, Sniff Map Cartographer); persona-fit modes (Puppy Mode, Quiet Hours) that say *we know who you are*.
*Constraint:* identity must be additive, never gatekept — no "real dog owners walk 5km" framing. Every identity we mint must be reachable by every persona (P2's chihuahua test).

## 5.3 Progress

Visible advancement toward something. Dogs conveniently supply real progress (puppies grow, training lands, senior dogs hold steady) — the product's job is making invisible progress visible.

*Lives in:* lifetime distance odometer ("Bruno has walked 312 km — Paris to London"); milestone engine (inherited from Pawtchi, §7.8); weekly story arcs; Puppy Mode socialization checklist.
*Constraint:* progress must be **monotonic where life isn't**. Duke (§4.6) walks less each season; his surfaces emphasize cumulative lifetime progress and consistency-vs-own-baseline, never decline deltas. Regression framing ("down 20% from last month") is banned product-wide.

## 5.4 Status

Position in a hierarchy others can see. Toxic when scarce and vertical (one leaderboard, everyone else loses); healthy when plural and horizontal (many small crowns, locally scoped).

*Lives in:* The Regular (per-Spot, per-size-slot, rotating — dozens per neighborhood); contribution reputation tiers; seasonal challenge completions.
*Constraint:* status is **local, plural, and rotating** by design — never a global leaderboard. Status loss is handled with dignity: a departing Regular gets a "thank you for 90 days" moment, not a demotion notice (§7.4).

## 5.5 Belonging

The deepest driver in the category: dog ownership is chronically lonely for many (urban movers, remote workers, reactive-dog owners exiled from parks). Belonging is Trot's emotional endgame and the reason the network retains when novelty fades.

*Lives in:* Best Mates; Packs; Spot pages as clubhouses ("the 7am crew"); Puppy Cohorts; the Quiet Hours community for owners excluded everywhere else.
*Constraint:* belonging must survive non-participation — lurkers belong too. No "your pack misses you" guilt reactivation. And belonging must never be sold: no paid tier ever gates membership in a community (§15.2).

## 5.6 Reciprocity

Receiving creates the urge to give back. Trot receives before it asks: the new user gets the community's accumulated map (fountains, shade, quiet times) on day one, contributed by strangers.

*Lives in:* Sniff Map value delivered pre-contribution; "23 neighbors used your fountain pin" impact receipts (P5); Treat Toss exchanges; welcoming rituals when a new dog joins a Spot's regulars.
*Constraint:* reciprocity is invited, never invoiced. The contribution prompt after benefiting from the map is contextual and dismissible — never a gate ("add a pin to keep using the map" is banned).

## 5.7 Variable rewards

Unpredictable positive surprise sustains attention where fixed rewards habituate. Trot's insight: **the walk itself is already a variable-reward generator** — weather, other dogs, wildlife, the day's serendipity. We surface real variability instead of synthesizing slot machines.

*Lives in:* Crossed Paths (genuinely unpredictable, genuinely delightful); surprise walk-summary details ("longest sniff stop yet: 94 seconds"); occasional bonus recognitions; seasonal discoveries.
*Constraint:* variability comes **only from the world, never from a random-number generator**. No loot boxes, no gacha, no randomized coin drops. If the surprise didn't happen on the walk, it doesn't happen in the app.

## 5.8 Commitment & consistency

Small public commitments drive follow-through (Cialdini). Stated intentions become identity.

*Lives in:* self-set weekly rhythm ("we aim for 5 walks a week"); Beacons ("we'll be at Riverside at 8") — a commitment device that also seeds Park Pulse (§7.6); challenge opt-ins; Puppy Cohort membership.
*Constraint:* commitments are private by default, shared by choice; breaking one produces silence, not shame. The app never reminds a user of a commitment they failed — only celebrates ones they kept.

## 5.9 Habit formation

Cue → routine → reward, until automatic. The dog is the cue (the most reliable trigger in consumer software — it whines at the door); the walk is the routine; Trot's job is inserting itself gracefully (one tap to record) and owning the reward moment (the summary celebration).

*Lives in:* one-tap start with auto-stop (inherited, near-zero friction); walk-summary celebration as the crystallizing reward; streaks as habit scaffolding; notification timing tuned to each household's actual walk windows (§9.4).
*Constraint:* the habit we build is *recording*, not *checking*. Session design optimizes for closed loops (walk → summary → done), not open-ended scrolling. Feed depth is intentionally shallow (§6.4); infinite-scroll engagement is a non-goal — VWW, not minutes-in-app, is the North Star (§14).

## 5.10 Loss aversion

Losses loom larger than gains — the engine inside streaks, and the mechanic most prone to abuse. Trot uses it in strictly bounded doses.

*Lives in:* walk streaks (with a **weekly rhythm** option — N walks/week — as the default framing, gentler than daily); The Regular's rotating tenure; season endings.
*Constraint:* the release valves are product features, not afterthoughts: **Streak Repair** (earnable, free, limited — §11.4), **Rest Notes** (mark injury/illness/heat-wave days as protected — the streak pauses honorably), and **loss framing bans** ("you're about to lose…" push copy is prohibited; §9.6). Streak pressure must never send a dog out in dangerous heat — Rest Notes are auto-suggested on extreme-weather days.

## 5.11 Collection mechanics

Completing sets is inherently satisfying (the Panini-album instinct). Collections give walks variety-seeking missions.

*Lives in:* badge families (§11.2); Spot "passport" (visited all 12 parks in the district); seasonal collectibles (autumn walk set); breed-meet collection ("Bruno has met 23 breeds"); Trail Tails completed.
*Constraint:* collections celebrate the *nearly-complete*, but completion pressure stays whisper-quiet: no countdown timers on collectible availability, no paid completion (coins never buy badges — §11.6, §15.2).

## 5.12 Social proof

People do what visibly similar people do. In a network product, social proof *is* onboarding.

*Lives in:* Spot pages showing real regulars ("14 dogs walk here on weekday mornings"); "dogs like Biscuit typically walk…" norms for anxious new owners (§4.1); challenge participation counts; store-listing social proof loops.
*Constraint:* all social proof is **real**. No inflated counts, no fake activity, no bots seeding feeds, no "Sarah just joined!" fabrications. In thin markets we show honest smallness framed as pioneership ("You're one of the first 50 in Boise — every pin you drop founds the map").

## 5.13 FOMO

Fear of missing out drives action but corrodes trust; it is the mechanic Trot uses *least*, and only in its prosocial form: awareness of real, joinable, nearby happenings.

*Lives in:* Pack Walk event announcements; seasonal challenge windows; Park Pulse "lively right now" states.
*Constraint:* FOMO surfaces must always be **actionable now** (you can still join) — never retrospective regret ("you missed a great meetup"). Missed-event recaps show what happened only if the user can act on the next one, and Quiet Hours users never receive liveliness bait (§4.5).

## 5.14 Anticipation

Looking forward to something is itself pleasurable (the "rosy prospection" effect) and cheaper than any reward. Trot builds calendared anticipation at every timescale.

*Lives in:* the approaching milestone ("3 walks to Bruno's 100th"); weekly recap every Sunday evening; monthly recap; seasonal challenges with opening days; **Year in Review** as the flagship annual moment (§7.8); Puppy Cohort graduation dates.
*Constraint:* anticipated moments must over-deliver on arrival — an over-hyped, thin Year in Review spends trust we can't rebuy. Production quality of recap moments is a P0 engineering commitment, not a marketing garnish.

## 5.15 Nostalgia

The category's emotional superpower and the moat under the moat: **Trot's archive becomes the dog's biography, and leaving means leaving the biography.** Dogs live short lives; owners know it; every walk recorded is a memory banked.

*Lives in:* Memories resurfacing ("One year ago: Ziggy's first snow"); the walk archive as scrollable life story; Year in Review; senior-dog lifetime retrospectives; the memorial state (§12.7) — handled with such care that grieving owners become the brand's most devoted advocates.
*Constraint:* nostalgia is sacred ground: **no monetization surfaces adjacent to memorial or memory content, ever** (§15.2). Resurfaced memories of deceased dogs require explicit opt-in ("Would you like to see memories of Duke?" asked once, respected forever). Full data export is free and permanent — the biography belongs to the owner, not to us (§12.3).

---

## 5.16 How the mechanics compose

The fifteen mechanics are sequenced across the user lifecycle, not sprayed at once:

| Lifecycle stage | Load-bearing mechanics |
|---|---|
| Day 0–7 (activation) | Intrinsic (relatedness w/ dog), progress, social proof (norms), habit scaffolding |
| Week 2–8 (habit) | Streak commitment, variable rewards (Crossed Paths begin), anticipation (first monthly recap), collection starts |
| Month 2–6 (graph) | Belonging, reciprocity, identity (first Regular candidacy), status |
| Month 6+ (moat) | Identity consolidation, nostalgia accumulation, community reputation, seasonal cycles |

The design intent: early mechanics are cheap and individual; late mechanics are deep and social. By the time novelty mechanics fade (they always fade), the user is held by identity, belonging, and an irreplaceable archive — the three forces that don't habituate.

---

# §6 — Information Architecture

Complete screen inventory, navigation model, and canonical flows. Screens are numbered `S-xx` and referenced from feature specs (§7). The app is built in Expo Router; the route sketches below use its file conventions (mirroring the Pawtchi codebase structure the team already knows).

## 6.1 Navigation model

**Five-tab bottom navigation** with a center-prominent record button (the Strava-proven pattern, adapted):

```
┌─────────────────────────────────────────────┐
│                  (screen)                   │
├─────────────────────────────────────────────┤
│  Home    Map      (🐾 WALK)    Pack    Dog  │
└─────────────────────────────────────────────┘
```

| Tab | Route | Job |
|---|---|---|
| **Home** | `app/(tabs)/index` | Today: streak state, weekly rhythm, nearby now (Pulse digest), milestone proximity, Crossed Paths inbox |
| **Map** | `app/(tabs)/map` | The neighborhood: Sniff Map layers, Spots, Park Pulse, Trail Tails discovery |
| **Walk** (center, raised) | `app/walk` (modal-over-tabs) | One tap → recording. The button *is* the brand gesture |
| **Pack** | `app/(tabs)/pack` | Social: Pack Feed, Best Mates, Crossed Paths, Packs & events |
| **Dog** | `app/(tabs)/dog` | Identity: Dog Card, stats, badges, archive/Memories, household |

Phase note: in Q1 (pre-social) the **Pack** tab shows the share-first surface (your moments, invite entry) rather than an empty feed — an honest cold-start state per P3. The tab bar is stable from day one so the mental model never reshuffles.

**Global patterns**

- **Walk-first interruption model:** starting a walk is possible from anywhere in ≤2 taps (tab button always visible; long-press = quick-start with last settings).
- **During an active walk** a persistent tracking pill (port of Pawtchi's `WalkTrackingIndicator`) floats above all tabs; tapping returns to S-20.
- **Modality rule:** recording, onboarding, and share composition are modal (focused, closable); everything else is browsable tabs. Deep stacks capped at 3; anything deeper becomes a modal flow.
- **Deep links:** every entity (walk, Spot, Trail Tail, Dog Card, Pack, event, challenge) has a canonical shareable link with an unauthenticated web preview (growth surface, §8.3).

## 6.2 Screen inventory

### Onboarding & auth (modal flow, `app/onboarding/*`)

| # | Screen | Purpose & key decisions |
|---|---|---|
| S-01 | Welcome | One promise ("Every walk counts"), one visual (living map + dog), Continue. No feature carousel. |
| S-02 | Auth | Apple/Google sign-in (+email fallback). Account = human; identity comes next. |
| S-03 | Dog setup | Name, photo, breed (searchable w/ mixed-breed-first option), birthday-or-age, size. Photo moment is celebratory — this mints the Dog Card. **Pawtchi import** entry point here (§13.9): one tap pre-fills everything. |
| S-04 | Dog context | Optional, skippable: energy level, reactivity ("prefers space from other dogs" — respectful phrasing), puppy/senior auto-detected from age. Sets persona mode (Quiet Hours, Puppy Mode) from minute one. |
| S-05 | Location permission | The make-or-break screen. Pre-permission explainer states the privacy covenant: *tracks only during walks you start; raw GPS never leaves your phone; home stays hidden.* Then the OS prompt (While-Using tier only — see §13.6). Decline path remains functional (manual logging) with a soft re-ask after first manual walk. |
| S-06 | Home Zone setup | Drag a privacy circle around home (default 150m, presented as done-for-you). Frames privacy as a *feature being given*, not a setting being begged. |
| S-07 | First-walk prompt | "Ready when Biscuit is." If plausible walk-time: encourage now. The activation goal is first Valid Walk ≤24h (§14.2). |
| S-08 | Post-first-walk reveal | The full celebration: route art, stats, first badge, Dog Card completed → natural share moment. Onboarding truly ends here, not at S-07. |

### Recording (modal, `app/walk`)

| # | Screen | Purpose |
|---|---|---|
| S-20 | Active walk | Map with live route, elapsed/distance (dog-framed: "sniff stops: 3"), pause/end. Auto-pause indicator during sniff stops. Photo button. Screen-off tracking continues (foreground service / background mode per §13.6). |
| S-21 | Walk summary | The reward moment: animated route draw-in, stats, sniff-stop celebration, photos placed on route, milestone/badge reveals (staged, one at a time), validator verdict handling (invalid walks get honest, gentle copy — "that looked like a car ride, so we kept it off Bruno's record"). CTAs: Share → S-22, contextual map contribution (§7.5), Done. |
| S-22 | Share composer | Card templates (route-art / photo / stats / milestone), Home-Zone-safe route rendering (§12.2), watermark + deep link. Native share sheet. |

### Home tab

| # | Screen | Purpose |
|---|---|---|
| S-30 | Home | Assembles: greeting + dog state, streak/rhythm ring, "right now" digest (Pulse + weather-aware suggestion), Crossed Paths inbox teaser, milestone proximity, seasonal challenge card. Max 5 modules, personalized order. |
| S-31 | Crossed Paths inbox | List of recent crossings (coarse place + day), each → S-32. |
| S-32 | Crossing detail | The other Dog Card (public fields only), crossing context ("you've crossed 3 times at Riverside"), **Send Best Mate request** / dismiss. |
| S-33 | Challenge detail | Current seasonal/sponsored challenge: rules, progress, participants, join/leave. |

### Map tab

| # | Screen | Purpose |
|---|---|---|
| S-40 | Neighborhood map | MapLibre canvas; layer toggles (Sniff Map categories, Spots, Trail Tails, Pulse heat); location search. Long-press anywhere → S-43 add pin. Quiet Hours users get the inverted default lens (§7.6). |
| S-41 | Spot page | The clubhouse: name/photo, Pulse graph (busy-hours histogram + live tier), The Regular(s), regulars gallery, amenities (from Sniff Map), memories wall, check-in. Follow Spot → its events/news in Pack tab. |
| S-42 | Trail Tail detail | Route map, attribute chips (shade %, surface, water, senior-OK, reactive-visibility score…), reviews, elevation, "Walk this" → recording with route overlay. |
| S-43 | Add/edit pin | Category picker (fountain, shade, hazard, bin, off-leash zone, café…), photo, note. One-tap flow ≤10s. Verified-presence badge automatic if user walked here (§7.5). |
| S-44 | Trail Tail composer | Create from a past walk ("turn Tuesday's walk into a route") or draw; attribute tagging with smart pre-fill from walk data. |

### Pack tab

| # | Screen | Purpose |
|---|---|---|
| S-50 | Pack Feed | Walks, milestones, photos, event recaps from Best Mates & Packs. Chronological within day-buckets; **finite** — "You're all caught up" exists by design (§5.9). Treat Toss inline. |
| S-51 | Best Mates list | Manage mates; pending requests; mate profile → S-61. |
| S-52 | Packs home | Your Packs (household, cohorts, lounges, event groups) + discovery. |
| S-53 | Pack detail | Feed scoped to pack, members, events, pack streak (household variant per §7.9). |
| S-54 | Event page | Pack Walk event: when/where (Spot-linked), attendees, RSVP, post-event recap gallery. |
| S-55 | Invite flow | Contact-sync-optional inviter (§8.4): "dogs Bruno knows" framing, share link, QR for at-the-park exchange ("Park Card"). |

### Dog tab

| # | Screen | Purpose |
|---|---|---|
| S-60 | My Dog Card | The identity object: photo, name/breed/age, lifetime odometer, streak, badge shelf, Regular-of chips. Edit; share card export. |
| S-61 | Public Dog Card | What others see (public fields only; §12.2 privacy matrix). Reached from crossings, Spots, feeds. |
| S-62 | Walk archive / Memories | Scrollable biography: calendar heatmap, walk list, Memories resurfacing, monthly/annual recaps library. |
| S-63 | Badges & progress | Badge families w/ progress states, collections (Spot passport, breeds met), PawCoins balance + ledger. |
| S-64 | Household | Dog's humans (multi-walker, §7.9); add household member (QR/link). |
| S-65 | Recap player | Full-screen story-format monthly recap / Year in Review; every frame shareable. |

### Settings (`app/settings/*`, from gear on S-60)

| # | Screen | Contents |
|---|---|---|
| S-70 | Settings home | Account, subscription, dogs, privacy, notifications, support, about. |
| S-71 | **Privacy center** | The covenant page: Home Zones editor (multiple zones), per-feature visibility matrix (Crossed Paths on/off, Regular eligibility, feed audience, Pulse contribution), data export (one tap, free), delete account. Written in human sentences, one screen deep. |
| S-72 | Notifications | Per-category toggles + master quiet hours + weekly digest option (§9.7). Defaults conservative. |
| S-73 | Subscription | Trot+ management; RevenueCat-driven offerings (prices always fetched, never hardcoded). |
| S-74 | Dogs & household | Add/manage dogs, memorial state entry (§12.7), Pawtchi import. |
| S-75 | Safety center | Report/block management, emergency info card (§12.8), community guidelines. |

## 6.3 Canonical flows

**F1 — First run to first share (the activation spine):**
S-01→S-02→S-03(→import)→S-04→S-05→S-06→S-07 → *walk happens* → S-20→S-21→S-22 → share. Target: median ≤8 min in-app time to S-07; ≥60% reach S-21 within 24h (§14.2).

**F2 — Daily loop:** notification-or-dog-cue → Home (S-30 glance) → Walk (S-20) → Summary (S-21) → optional contribution (S-43, one tap) or share (S-22) → done. Designed session: 90 seconds of app time wrapping 30 minutes of walk.

**F3 — Crossing → edge:** post-walk crossing computed → next-morning digest (never real-time; §12.2) → S-31→S-32 → request → other side accepts (their S-32) → both feeds gain a mate; first co-walk suggestion after 3 crossings.

**F4 — Map contribution:** S-21 contextual prompt ("you paused near a fountain — does it work?") or S-40 long-press → S-43 → pin live (trust-weighted, §7.5) → impact receipt in monthly recap.

**F5 — Event loop:** Pack organizer creates S-54 → members RSVP (commitment device) → event day: co-walk auto-detection groups the walks → shared recap gallery → recap shares recruit next event's attendees.

## 6.4 Map interaction spec (S-40)

- **Gestures:** standard pan/zoom/rotate; long-press = add pin; tap pin = preview sheet (half) → full detail; tap Spot polygon = S-41.
- **Layers:** Spots always on; Sniff Map categories toggleable (persisted per user; Quiet Hours persona gets safety layers default-on); Pulse heat as time-scrubbable overlay (now / typical-at-hour); Trail Tails as tappable polylines.
- **Density rendering:** clustering at low zoom; layer auto-thinning by relevance score; in thin markets, "pioneer framing" empty states (§5.12) instead of barren tiles.
- **Privacy rendering rules:** no individual dog's location, ever; routes shown only on own/shared walks with Home-Zone clipping (§12.2); Pulse only renders at Spot granularity with k≥5 anonymity floor (§12.5).
- **Offline:** last-viewed region tiles cached; recording never requires connectivity (§13.7).

## 6.5 Notification surfaces

Full strategy in §9. IA-level inventory: OS push (category-gated), Home inbox module (S-30/S-31 — the demoted-but-visible tier), badge counts (Pack tab only, capped at "9+"), and the weekly digest email (recap + off-platform re-entry). Every push deep-links to its exact object; no push ever lands on a generic screen.

## 6.6 Empty, degraded & error states (first-class IA)

| State | Design |
|---|---|
| Zero-density metro | Pioneer framing throughout Map/Pack; single-player surfaces unaffected (P3). "Found the map empty? You're early — name your first Spot." |
| Location permission denied | Manual walk logging (duration + optional distance); map browsable; social read-only. Re-ask contextually once. |
| Offline | Record fully; queue syncs (inherited `walkSync` pattern); feeds show cache + banner. |
| GPS-degraded walk | Honest summary ("spotty signal today — distance is our best estimate"); validator verdict copy per S-21. |
| Invalid walk | Kept privately visible with verdict explanation; never counts publicly (anti-fraud, §12.6); never shame copy. |
| New dog added / dog passed away | Fresh identity flow; memorial state (§12.7) reachable from S-74, never suggested by inference. |

---

# §7 — Feature Specifications

Each spec contains: **Objective · UX · Edge cases · Data model · Backend · APIs · Permissions · Analytics · Success metrics**, plus a **What we changed and why** subsection where this document deliberately improves on the original brief, and a closing **Density Test** line (P3). Data models are Supabase/Postgres sketches in the idiom of the existing `walk_sessions` migration; RLS intent is noted per table. Screen references (`S-xx`) point to §6.

**Section map:** 7.0 roadmap · 7.1 Crossed Paths · 7.2 Best Mates & Pack Feed · 7.3 Spots · 7.4 The Regular · 7.5 Sniff Map · 7.6 Park Pulse & Quiet Hours · 7.7 Trail Tails · 7.8 Q1 single-player suite · 7.9 Packs, events & invitations

---

## 7.0 Roadmap and sequencing logic

| Quarter | Theme | Ships | Primary KPI |
|---|---|---|---|
| **Q1 — Worth Sharing** | Single-player excellence | Recording (ported stack), Dog Cards, share cards, milestone engine, achievements, streaks + Streak Repair + Rest Notes, seasonal challenge #1, monthly recap, Year-in-Review pipeline (built early, fires in December), PawCoins, privacy-first recording (Home Zones), Pawtchi import bridge | **Shares per WAU** |
| **Q2 — Bruno Has Friends** | The social graph | Crossed Paths, Best Mates, Pack Feed, Treat Toss, Household Packs, invitations + optional contacts sync, public Dog Cards | **Users with ≥3 Best Mates; Weekly Connected Walks** |
| **Q3 — Bruno Has a Tribe** | Communities & intelligence | Spots, The Regular, Sniff Map, Park Pulse v1 + Beacons + Quiet Hours, Trail Tails, Breed Lounges, Puppy Cohorts, Pack Walk events, sponsored challenges | **Monthly Active Packs; contribution rate** |

**Sequencing logic:** each quarter manufactures the precondition for the next. Q1's shares create metro density; density makes Q2's Crossed Paths fire often enough to feel magical; the graph gives Q3's communities founding members and gives the map its first trusted contributors. Shipping social before density, or communities before graph, is how every predecessor died (§2.2). Crucially, **data collection for later phases starts in Q1**: walks recorded in Q1 already produce (locally, then consentfully) the presence aggregates that make Spots and Pulse credible on their launch day.

---

## 7.1 Crossed Paths

### Objective
Convert real-world co-presence into digital edges. When two dogs' Valid Walks overlapped in space and time, both owners learn about it afterward and may connect. This is the graph-formation engine: edges seeded by physical reality, which makes them uniquely trustworthy and uniquely local.

### What we changed and why
The brief's version ("notify both owners when walks overlap") has three failure modes we designed out:

1. **Live or precise timing is a stalking primitive.** Our version is *strictly retrospective and coarse*: crossings are computed after both walks end and surfaced in a **next-morning digest** (single batch, 8–10am local), reporting only *place + day* ("Riverside Park, yesterday") — never times, never route intersections. A determined observer learns nothing actionable about schedules. (P4)
2. **Symmetric notification creates awkward pressure** ("they know that I know"). Ours is *symmetric discovery, asymmetric intent*: both see the crossing, but a Best Mate request is only revealed to the other side when sent — and if ignored, it silently expires in 14 days. No read receipts, no "declined."
3. **One crossing is noise; recurrence is signal.** The system privileges *repeated* crossings ("3rd time crossing Luna this month") — the digital analog of "we keep seeing that collie." First crossings with a given dog are shown quietly; recurring ones get the celebratory treatment and the connect suggestion. This mirrors how real park friendships actually form and halves the request-spam surface.

### UX
- Computation is invisible. Owner experience: morning digest push (respecting §9 budgets) → S-31 inbox → S-32 detail: the other Dog Card (public fields), crossing history with that dog, coarse place chip, [Send Best Mate request] / [Not now]. Quiet Hours users (§7.6) can disable participation entirely — they are then invisible to and excluded from all crossing computation, with no trace shown to others.
- Copy is dog-voiced: "Bruno crossed paths with Luna at Riverside Park — that's three times this month."
- After a request is accepted: both parties' next crossing at the same Spot suggests a Beacon co-walk ("Often there Tuesdays 8am? Toss a Beacon.").

### Edge cases
- **Same household dogs** walking together: suppressed (same `household_id`).
- **Crowded parks:** cap surfaced crossings at 5/day, ranked by recurrence score; the rest silently accrue to history (avoids inbox flooding at density).
- **A dog crossing dozens of dogs daily** (dog-walker professional): pattern-detected, digest collapses to summary; professional accounts are a later product.
- **One-sided privacy:** if either walk had crossing-participation off, no crossing exists for *either* party (computation requires mutual opt-in state at walk time).
- **Blocked users:** never crossed, in either direction, retroactively purged.
- **GPS jitter false positives:** crossing requires ≥N interpolated co-presence points within radius R (tunable; launch R=75m, ≥2 points ≥60s apart) *and* both walks `valid` — the validator (§13.2) is the fraud gate.
- **Delayed sync** (offline walk uploaded days later): crossings computed on late arrival but only surfaced if <72h old; stale crossings accrue silently to history.

### Data model
```sql
-- Consent-gated derived presence: coarse spatio-temporal buckets, not routes.
-- Written by the ingestion pipeline only for walks with crossing_opt_in=true.
CREATE TABLE walk_presence (
  walk_id      UUID REFERENCES walks(id) ON DELETE CASCADE,
  dog_id       UUID NOT NULL,
  h3_cell      TEXT NOT NULL,          -- H3 res 10 (~65m edge) cell
  t_bucket     TIMESTAMPTZ NOT NULL,   -- floored to 5-min bucket
  PRIMARY KEY (walk_id, h3_cell, t_bucket)
);
-- RLS: no client read access at all; service-role pipeline only.

CREATE TABLE crossings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_a         UUID NOT NULL, dog_b UUID NOT NULL,   -- ordered: dog_a < dog_b
  spot_id       UUID REFERENCES spots(id),            -- nullable: non-Spot crossings show locality name
  crossed_on    DATE NOT NULL,                        -- deliberately date, not timestamp (P4)
  recurrence_n  INTEGER NOT NULL DEFAULT 1,           -- nth crossing for this pair
  surfaced_a    BOOLEAN DEFAULT FALSE, surfaced_b BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dog_a, dog_b, crossed_on)
);
-- RLS: owner of dog_a or dog_b may read; no client writes.
```

### Backend
Event-driven: walk ingestion emits `walk.validated` → crossing worker joins the walk's presence buckets against `walk_presence` for the same cells/buckets (cheap indexed equijoin; H3+time bucketing turns geometry into hash lookups — the design that scales to 100M, §13.5). Matches → upsert `crossings` with recurrence increment → morning digest job batches per user. Raw presence buckets are TTL-deleted after 14 days; only `crossings` rows persist.

### APIs
`GET /crossings?since=` (inbox) · `POST /crossings/:id/dismiss` · `GET /dogs/:id/card` (public card) · mate request via §7.2 API. No API exposes presence buckets, coordinates, or timestamps.

### Permissions
Requires: user-level `crossing_opt_in` (default **on**, explained at S-06 with one-tap off; Quiet Hours onboarding defaults it **off**), per-walk override on S-20. Consumes location only via the already-recorded walk — no additional OS permission.

### Analytics
`crossing_computed` (server) · `crossing_digest_sent` · `crossing_viewed` · `crossing_mate_request_sent` · `crossing_opt_out_toggled`.

### Success metrics
% WAU with ≥1 crossing/week (the metro-graduation metric, target 30%); crossing→request rate (health band 8–20%: lower = surfacing noise, higher = inventory too scarce); request accept rate ≥60%; opt-out rate <5% (canary for trust).

**Density Test:** zero-density value = none — which is *why it ships in Q2 into pre-densified metros, dark elsewhere* (feature-flagged per metro until crossing supply exists). Better with each user: quadratically (crossings scale with local pair density).

---

## 7.2 Best Mates & Pack Feed

### Objective
A mutual, small-by-design social graph (the edge) and a finite, warm activity feed over it (the surface). The feed is the daily reason to open Trot between walks; the mates are why the feed matters.

### What we changed and why
- **Mutual-only, capped-scale by design.** No followers, no counts race: Best Mates caps at 150 (Dunbar as product spec, practically ~15 for most). This keeps the feed intimate, kills influencer dynamics, and makes Treat Toss reciprocity meaningful.
- **The feed is finite** ("You're all caught up") and day-bucketed, not an infinite ranked scroll — per §5.9 we optimize closed loops, not minutes.
- **Feed items are walk-anchored artifacts** (walks, milestones, crossings-become-friendships, event recaps), not free-form posts, at launch. No status composer in v1: it eliminates the moderation surface of open text at small-team scale (§12.5) and keeps the feed about dogs, not discourse. Comments are short and on-artifact.

### UX
S-50 feed: cards show route art (Home-Zone-clipped, §12.2), photos, stats framed per P2, Treat Toss button with counter, comment sheet. S-51 mate management. Mate acquisition paths: Crossed Paths (§7.1), invite link (§7.9), QR "Park Card" exchange, Pawtchi-import mutuals. Each new mate's arrival is celebrated in both feeds ("Bruno and Luna are Best Mates 🎉").

### Edge cases
Unfriending is silent (feed simply quiets; no notification). Blocked ≠ unfriended: block cascades (feed, crossings, Spots gallery, events) per §12.5. A mate's dog passing away: memorial-state posts follow §12.7 rules; Treat Toss disabled on memorial content, replaced by 🕯 "light a candle." Feed cold-start (0 mates): the Pack tab shows own moments + invite surface, honestly framed (§6.2 phase note).

### Data model
```sql
CREATE TABLE mate_edges (
  dog_a UUID NOT NULL, dog_b UUID NOT NULL,        -- ordered pair, dog_a < dog_b
  status TEXT NOT NULL CHECK (status IN ('pending_a','pending_b','accepted')),
  requested_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  PRIMARY KEY (dog_a, dog_b)
);
-- RLS: readable/writable only by owners of either dog; accept requires the pending side.

CREATE TABLE feed_items (        -- fan-out-on-write per consumer (§13.5)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_user_id UUID NOT NULL,
  subject_dog_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('walk','milestone','badge','mateship','event_recap','memory')),
  ref_id UUID NOT NULL,          -- polymorphic ref to the artifact
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON feed_items (consumer_user_id, created_at DESC);

CREATE TABLE reactions (
  item_ref UUID NOT NULL, user_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'treat' CHECK (kind IN ('treat','candle')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (item_ref, user_id)
);
```

### Backend
Fan-out-on-write at ≤150 edges is trivially cheap and stays cheap at 100M users (bounded fan-out is the point of the cap). Comment text passes the moderation pipeline (§12.5).

### APIs
`GET /feed?cursor=` · `POST /mates/request` · `POST /mates/:id/accept` · `DELETE /mates/:id` · `POST /reactions` · `POST /comments` (+ report endpoints per §12.5).

### Permissions
Feed visibility = mates-only always (no public feed in v1). Per-walk "keep private" flag on S-21 excludes an artifact from fan-out.

### Analytics
`mate_request_{sent,accepted}` · `feed_session` (depth, caught-up reached) · `treat_tossed` · `comment_posted` · `walk_kept_private`.

### Success metrics
**≥3 Best Mates** among M2 retained users (Q2 primary KPI, target 40%); **Weekly Connected Walks** (walks by users with ≥1 mate that receive ≥1 reaction — target 50% of eligible walks); caught-up rate ≥70% of feed sessions (finiteness is working); D30 retention delta of ≥3-mate users vs 0-mate (the causal story for investing in the graph; expect +15–25pts).

**Density Test:** single-player value = own moments archive on the same surface. Each new mate directly enriches ~15 feeds.

---

## 7.3 Spots

### Objective
Turn recurring walking locations into persistent community places with memory — visit history, regulars, rhythms, amenities, moments. Spots are the *places* layer of the network (Crossed Paths is the *people* layer) and the container for The Regular, Park Pulse, check-ins, and events.

### What we changed and why
- **Spots are born from behavior, not bureaucracy.** The brief implies Spots exist as pages to fill in. Ours *emerge*: the clustering pipeline watches aggregate dwell density (H3 cells where many distinct dogs repeatedly linger); when a cell cluster crosses thresholds (≥5 distinct dogs, ≥3 visits each, 28-day window), a **Spot candidate** is proposed to its most frequent visitors — "You and 11 dogs keep meeting here. Name this place?" Founding is a celebrated community act (founders get a permanent "Founding Pack" chip). OSM park polygons seed obvious candidates so day-one maps aren't blank, but the *community christening* is the activation moment.
- **Visit = presence, not check-in.** Visits are counted from validated walk presence automatically; check-in exists only as an optional social flourish ("say hi to whoever's looking at the Spot page today"), not as the data mechanism. Manual check-in-as-data is a Foursquare-era failure: it decays with novelty.

### UX
S-41 Spot page: hero photo (community-contributed), name, The Regular(s) podium, busy-hours histogram (Pulse, §7.6), amenities chips (Sniff Map pins within the Spot, §7.5), regulars gallery (opt-in), memories wall (photos taken here), events (§7.9), follow button. Personal layer: "Bruno's history here — 47 visits since March."

### Edge cases
- **Boundary disputes / overlapping candidates:** cells merge by contiguity + name-vote; adjacent Spots require ≥1 cell gap or explicit community split.
- **Private property proposed as Spot:** founding flow requires category (park/trail/beach/plaza/café); residential-zone cells are ineligible (zoning heuristic + review queue); §12.5 report path for mistakes.
- **A Spot dies** (construction, closure): auto-dormancy when visits drop >90%; "closed" flag contributable; history preserved.
- **Home-Zone interaction:** cells inside any user's Home Zone never contribute that user's presence; a Spot can't be founded on a cluster of ≤2 households' zones (prevents "my street is a Spot" leakage).
- **Duplicate names / offensive names:** name-vote among founders + moderation filter + rename petition at ≥10 regulars.

### Data model
```sql
CREATE TABLE spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('park','trail','beach','plaza','cafe','other')),
  h3_cells TEXT[] NOT NULL,                -- footprint at res 10
  centroid GEOGRAPHY(POINT) NOT NULL,
  metro_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('candidate','active','dormant','closed')),
  founded_at TIMESTAMPTZ, osm_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON spots USING GIST (centroid);

CREATE TABLE spot_visits (                 -- aggregate, not trajectory
  spot_id UUID REFERENCES spots(id),
  dog_id UUID NOT NULL,
  visited_on DATE NOT NULL,
  dwell_min INTEGER,
  PRIMARY KEY (spot_id, dog_id, visited_on)
);
-- RLS: own rows readable; aggregates exposed only via views with k≥5 floors (§12.5).

CREATE TABLE spot_members (                -- follows, founder chips, regulars opt-in
  spot_id UUID, user_id UUID,
  role TEXT NOT NULL DEFAULT 'follower' CHECK (role IN ('follower','founder')),
  show_in_gallery BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (spot_id, user_id)
);
```

### Backend
Clustering job (daily, per metro): dwell-density over rolling 28d presence aggregates → candidate proposals. Visit attribution inline at walk ingestion (walk cells ∩ spot cells, dwell ≥5min). Histograms materialized nightly.

### APIs
`GET /spots/nearby` · `GET /spots/:id` (page payload with k-anonymous aggregates) · `POST /spots/candidates/:id/found` (name + category vote) · `POST /spots/:id/follow` · `POST /spots/:id/checkin` · photo upload via §7.5 contribution API.

### Permissions
Appearing in a Spot's regulars gallery is **opt-in** (`show_in_gallery`); visit counting into anonymous aggregates follows the user-level `presence_aggregates_opt_in` (default on, disclosed at S-06; Quiet Hours default off). No per-dog visit data is ever publicly attributable unless gallery-opted-in.

### Analytics
`spot_candidate_proposed` · `spot_founded` · `spot_page_viewed` · `spot_followed` · `spot_checkin`.

### Success metrics
% of metro walks touching ≥1 active Spot (target 60% by Q3 end); founding-flow acceptance ≥40% of proposals; Spot-page WAU/metro; regulars-gallery opt-in ≥25% (belonging signal).

**Density Test:** zero-density = OSM-seeded amenity info + personal visit history ("your places"). Each new dog sharpens histograms, enriches galleries, and speeds new-Spot discovery.

---

## 7.4 The Regular

### Objective
A rotating, per-Spot recognition for consistency: the dog with the most visits in the trailing 90 days. Pure P2 — the status system every dog can win — and the emotional crown of the Spots layer.

### What we changed and why
- **Multi-slot, not single champion.** One crown per Spot means one all-consuming winner and silent losers. Ours awards **The Regular per daypart** (Morning / Midday / Evening Regular) and honors size-class where communities are large (small-dog hour is a real social institution). A big park might have six Regulars; a pocket park, one. More crowns, all earned, zero devalued — and it mirrors the truth that the 6am crew and the 6pm crew are different communities.
- **Tenure with dignity, not a treadmill.** Transitions are gentle: the incoming Regular is celebrated without "dethroned" framing; the outgoing gets a thank-you moment and a permanent "Regular of Riverside, Spring '27" archive chip (collection mechanic, §5.11). A 7-day grace buffer prevents flappy handoffs (challenger must exceed incumbent by ≥2 visits to take the slot).
- **Absence protection:** Rest Notes (§7.8) freeze a Regular's clock for up to 21 days (injury/illness/travel) — consistency products must forgive life or they punish exactly the wrong people.

### UX
Spot page podium (photo, "Regular since…"); candidacy is quiet until close ("Bruno's 4 visits from Morning Regular" — shown only to the candidate); award moment is a celebration for the winner and a feed item for Spot followers; opt-out (`regular_eligible=false`) is invisible — the slot simply shows the next eligible dog, and no one can infer a decline (P4).

### Edge cases
Ties → longest current visit streak wins, then earliest first-visit. Multi-dog households: dogs compete individually (it's the dog's crown). Dog-walker professionals: excluded (same account-pattern detection as §7.1). Fraud (fake walks to farm visits): only `valid` walks count, validator + §12.6 velocity checks; Regulars at anomalous accrual rates get silent review. A Spot going dormant retires its Regulars with archive chips.

### Data model
```sql
CREATE TABLE regular_awards (
  spot_id UUID, slot TEXT CHECK (slot IN ('morning','midday','evening')),
  size_class TEXT,                       -- nullable; used only where enabled
  dog_id UUID NOT NULL,
  since DATE NOT NULL, until DATE,       -- null until = current
  visits_90d INTEGER NOT NULL,
  PRIMARY KEY (spot_id, slot, size_class, since)
);
```
Computation is a nightly window over `spot_visits`; awards table is the audit trail and the archive-chip source.

### APIs
Embedded in Spot page payload; `GET /dogs/:id/regular-history`.

### Permissions
`regular_eligible` per dog (default on, disclosed when first candidate). Only gallery-permitted photo/name shown on podium.

### Analytics
`regular_awarded` · `regular_retained` (re-award) · `regular_archived` · `regular_opted_out`.

### Success metrics
Regulars' retention delta vs matched cohort (expect the strongest retention feature in the app); % Spots with ≥1 active Regular; award→share rate; opt-out <3%.

**Density Test:** single-player = your own visit-count history per place. Each new dog makes the crown mean more (more witnesses, more contest).

---

## 7.5 Sniff Map

### Objective
The community-generated dog map: water, shade, bins, off-leash zones, dog-friendly venues, hazards, wildlife warnings, mud, reactive-safe paths. The visible face of the data moat — the layer a user would miss within a week of leaving.

### What we changed and why
- **Contribution is trust-weighted and presence-gated.** Anyone can *see* the map; contributing meaningfully requires having *been there*: pins submitted by users whose validated walks touched the pin's cell get **verified-presence weight**; drive-by pins (no presence) enter at minimal weight pending confirmations. This single rule kills map spam at the root (the poisoning threat, §2.5) using infrastructure we already have — the walk validator.
- **Pins decay; confirmations refresh.** Every pin has a confidence score that decays by category half-life (hazards decay in days, fountains in months). Passers-by get one-tap confirm/deny prompts ("Is the fountain at Elm gate working?") *only when* they walked past it — micro-contributions with zero detour cost. A map that can't forget becomes wrong; wrong maps lose trust faster than empty ones.
- **Safety layers are first-class, not a category dumdump.** Hazards and reactive-relevant attributes (visibility, path width, off-leash-surprise frequency) render distinctly, feed Quiet Hours routing (§7.6), and page §12 rules (dangerous-area pins about *conditions*, never about *people or specific dogs* — "aggressive dog lives here" pins are banned as harassment vectors; the acceptable form is zone-level "frequent off-leash dogs").

### UX
S-40 layers; S-43 add-pin flow ≤10 seconds (category → optional photo/note → done); contextual post-walk prompts (F4, §6.3): the pipeline notices dwell near an unmapped amenity candidate or a stale pin on the route and asks *one* question at S-21. Impact receipts close the loop (P5): monthly recap counts neighbors helped.

### Edge cases
Conflicting reports → confidence blends by trust weight + recency; below threshold, pin shows "reports vary." Duplicate pins → cell-radius dedupe with merge prompt. Malicious/PII pins (photos with faces/addresses, harassment text) → §12.5 pipeline pre-publication for note text and photos. Seasonal truths (stream dries in summer) → seasonality flag after cyclic confirm/deny patterns detected. Vandalism raids (coordinated false pins) → velocity anomaly detection per cell + metro (§12.6).

### Data model
```sql
CREATE TABLE map_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN
    ('fountain','shade','bin','off_leash_zone','dog_friendly_venue','hazard',
     'wildlife','mud','narrow_path','open_view','other')),
  h3_cell TEXT NOT NULL, geom GEOGRAPHY(POINT) NOT NULL,
  note TEXT, photo_url TEXT,
  created_by UUID NOT NULL, verified_presence BOOLEAN NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,       -- maintained by decay/confirm pipeline
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','removed','pending_review')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON map_pins (h3_cell); CREATE INDEX ON map_pins USING GIST (geom);

CREATE TABLE pin_confirmations (
  pin_id UUID REFERENCES map_pins(id), user_id UUID,
  verdict BOOLEAN NOT NULL,                   -- confirm / deny
  verified_presence BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pin_id, user_id, created_at)
);
```

### Backend
Confidence pipeline (decay by category half-life; Bayesian update on confirmations weighted by contributor trust score §12.6); tile assembly into vector-tile layers cached per region; contextual-prompt selector at walk ingestion (route cells ∩ stale/candidate pins → max 1 prompt).

### APIs
`GET /map/tiles/…` (vector tiles, layer-filtered) · `POST /pins` · `POST /pins/:id/confirm` · `POST /pins/:id/report`.

### Permissions
Viewing: everyone. Creating: any account ≥1 Valid Walk (bar low, bot-hostile). Notes/photos: pass moderation. Contribution history is private by default; the "Cartographer" reputation chip (§11.7) is opt-in.

### Analytics
`pin_created` (category, verified_presence) · `pin_confirmed`/`pin_denied` · `map_layer_toggled` · `contextual_prompt_{shown,answered}` · `pin_helped` (a pin within a later-walked route — the impact-receipt source).

### Success metrics
**Contribution rate** (% WAU making ≥1 contribution incl. confirmations / month — target 20%; confirmations do the heavy lifting); pins per km² in graduated metros; confirm-prompt answer rate ≥50%; pin accuracy (audit sampling) ≥90%; % pins verified-presence ≥80%.

**Density Test:** zero-density = OSM-imported basics (fountains, parks) so the map is never blank. Every user adds eyes: coverage, freshness, and trust all scale with walkers.

---

## 7.6 Park Pulse & Quiet Hours

### Objective
Temporal intelligence about places: when is this Spot busy, calm, puppy-heavy, big-dog-heavy — answering both "Bruno wants friends" and "Luna needs an empty park." **Quiet Hours** is the inverted lens for reactive-dog owners and Trot's wedge into its most loyal community (§4.5).

### What we changed and why
- **Prediction first, liveness second.** The brief's "live crowd intelligence" fails cold-start (empty live map = dead feature) and threatens privacy (live counts at small N identify individuals). Ours leads with the **typical-hours histogram** (robust at modest density, useful day one from OSM opening patterns + first weeks of aggregates) and adds a **live tier** only where k≥5 concurrent presence exists, displayed as fuzzy bands (Quiet / Some dogs / Lively), never counts, never identities.
- **Beacons solve the bootstrap.** Opt-in scheduled intent — "We'll be at Riverside ~8am" — visible to Best Mates always and to Spot followers if flagged open. Beacons give thin markets *forward-looking* pulse (better than live for meetups: you can still act on it), act as commitment devices (§5.8), and seed real meetups that create density. **Deliberate asymmetry: there are no "quiet beacons"** — Quiet Hours users read predictions but never broadcast intent, because advertising an empty park with a schedule attached is a safety anti-feature.
- **Quiet Hours is a mode, not a filter** (§4.5): default map lens (quiet windows highlighted), reactive-safe route weighting (§7.7 attributes), meetup-flavored surfaces dormant, crossing participation default-off, streak copy celebrating calm. One toggle at S-04/S-71, no stigma, reversible.

### UX
Spot page: 24h histogram (typical) + live band chip + today's Beacons; Home digest: "Riverside is usually quiet for another hour." Quiet Hours home: "Your quiet window at Elm Trail: now–9:40am." Confidence is honest: thin data renders as "Early estimate — 12 walks so far" (P3/P7).

### Edge cases
Weather shifts everything → live tier weights recent 60min over history; histogram gains weather-adjusted variant when data suffices (§10.8). Events/holidays distort "typical" → event days excluded from histogram training; Beacon-heavy days flagged. k<5 live suppression must not flicker (hysteresis). Adversarial quiet-seeker (predator scouting empty parks): quiet predictions are *aggregate and public-place only*, identical for all users, no individual-presence leak — reviewed in threat model §12.5.

### Data model
```sql
CREATE TABLE spot_pulse_agg (          -- k-anonymous by construction
  spot_id UUID, dow SMALLINT, hour SMALLINT,
  avg_dogs REAL, sample_days INTEGER,
  size_mix JSONB, puppy_share REAL,    -- only where samples ≥ threshold
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (spot_id, dow, hour)
);

CREATE TABLE beacons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id UUID NOT NULL, spot_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
  audience TEXT NOT NULL DEFAULT 'mates' CHECK (audience IN ('mates','spot_followers')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS: read scoped by audience relationship; auto-expire at window_end.
```
Live tier is Redis-resident (ephemeral concurrent-presence counters per Spot from active walk sessions of aggregate-opted-in users; never persisted per-user).

### Backend
Histogram job nightly from `spot_visits`; live counters maintained by walk-session heartbeats (coarse: Spot-level entry/exit only); Beacon fan-out to audience feeds; prediction service blends histogram + live + weather (v2, §10.8).

### APIs
`GET /spots/:id/pulse` · `POST /beacons` · `GET /beacons?scope=mates|spots` · `DELETE /beacons/:id`.

### Permissions
Live-tier contribution follows `presence_aggregates_opt_in`; Beacons are explicit per-creation with audience choice; Quiet Hours toggle governs the whole lens.

### Analytics
`pulse_viewed` (tier shown, confidence) · `quiet_window_followed` (walk started within suggested window) · `beacon_{created,joined}` · `quiet_hours_enabled`.

### Success metrics
Pulse accuracy (predicted vs realized band) ≥75% in graduated metros; `quiet_window_followed` ≥25% of Quiet Hours WAU (the wedge's proof metric); Beacons/week/metro; % Spots with live tier available.

**Density Test:** zero-density = honest typical-hours estimates + Beacons (which *create* signal). Every walker sharpens histograms; every Beacon is forward inventory.

---

## 7.7 Trail Tails

### Objective
Community-curated routes with dog-specific attributes: surface, shade %, water, leash rules, senior/puppy suitability, stroller access, elevation, crowd exposure, reactive-visibility. AllTrails' boolean "dog-friendly" exploded into the twelve dimensions dog owners actually decide by.

### What we changed and why
- **Routes are harvested, then curated — not authored from scratch.** The composer's primary path is "turn a walk you already took into a Trail Tail" (geometry, distance, elevation, and several attributes pre-filled from the recorded walk + map layers). Authoring-from-scratch is the fallback. This yields routes that are *real* (someone walked them) and makes creation a 60-second act.
- **Attributes improve passively** (brief's requirement, made concrete): shade % from time-of-day walk clustering + canopy data; crowd exposure from Pulse aggregates along the route; water access from Sniff Map pins within 50m; surface confirmations via post-walk one-taps. Every completion is a review opportunity but never a review demand.
- **Suitability is matched, not just labeled:** the dog profile (age, size, energy, reactivity, §10.2 calibration) ranks Trail Tails per dog — "good for Duke today" beats a wall of filters (though filters exist).

### UX
S-42 detail (attribute chips, map, reviews, "Walk this"); guided mode overlays the route on S-20 with gentle off-route notice (no turn-by-turn nagging — it's a walk, not a delivery). Completion links the walk to the trail (auto-detected ≥80% overlap), prompts optional review, stamps the passport (§5.11). S-44 composer from archive.

### Edge cases
Route through later-flagged hazard → auto-annotation + creator notification. Creator deletes account → trail persists, attributed "a neighbor" (community property, disclosed at creation). Seasonal trails (mud season) → seasonality from confirmation patterns. Home-Zone leakage: composer refuses routes starting/ending inside creator's Home Zone (nudges to trim ends — protects creators from self-doxxing). Bad-data trolling: same trust-weighting as pins.

### Data model
```sql
CREATE TABLE trails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, metro_id TEXT NOT NULL,
  polyline JSONB NOT NULL,             -- simplified, Home-Zone-safe by construction
  distance_m INTEGER, elevation_gain_m INTEGER,
  attrs JSONB NOT NULL,                -- {shade_pct, surface, water, leash, senior_ok, puppy_ok, stroller_ok, visibility, crowd}
  attr_confidence JSONB,
  created_by UUID, status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trail_completions (
  trail_id UUID, walk_id UUID, dog_id UUID,
  overlap_pct REAL, completed_on DATE,
  PRIMARY KEY (trail_id, walk_id)
);

CREATE TABLE trail_reviews (
  trail_id UUID, user_id UUID,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  attrs_confirmed JSONB, note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (trail_id, user_id)
);
```

### Backend
Overlap detection at ingestion (route cells vs trail cells, Fréchet-ish score); attribute-enrichment job (weekly) blends passive signals; per-dog ranking service (v1 heuristic, v2 learned §10.3).

### APIs
`GET /trails?near&filters&dog_id` · `GET /trails/:id` · `POST /trails` (from walk_id or geometry) · `POST /trails/:id/review`.

### Permissions
Creation requires the source walk be the creator's own; reviews require completion; notes moderated.

### Analytics
`trail_viewed` · `trail_started` · `trail_completed` · `trail_created` (source: walk|drawn) · `trail_reviewed` · `trail_match_shown` (rank position → CTR for the ranker).

### Success metrics
% walks that are trail-guided (target 15% — variety feature, not the default); trails created per graduated metro (≥100); completion→review ≥30%; senior/reactive-filtered search satisfaction (thumb prompt) ≥80%.

**Density Test:** zero-density = your own walks as private routes + OSM path data. Every completion sharpens attributes; every creator adds inventory.

---

## 7.8 Q1 single-player suite

The launch product. Individually smaller specs, collectively the activation engine; several port directly from Pawtchi (§13.2).

### 7.8.1 Recording & privacy-first capture *(port + extend)*
The Pawtchi stack lands wholesale: battery-aware location engine, auto-pause (Sniff Stops), auto-stop (stationary/home/time-cap), reconciler-guaranteed OS-tracking stop, walk validator, on-device Douglas-Peucker simplification (≤200 points server-side, never raw traces), offline queue + sync. **New:** Home Zones (capture-side clipping — points inside a zone are dropped *on device before storage*, walk distance still credited via dead-reckoned segment stitching), multi-dog selection per walk, photo capture pinned to route points.
*Metrics:* crash-free recording ≥99.8%; battery ≤4%/30min walk (§13.6 budget); validator false-invalid <1% (audited).

### 7.8.2 Dog Cards
The identity object (S-60/S-61): photo, name, breed, age, odometer, streak, badge shelf, Regular chips. Public/private field matrix per §12.2. Exportable as a designed image (the "baseball card") — the first share artifact available before any walk.
*Metrics:* % accounts completing card ≥90%; card shares/WAU.

### 7.8.3 Share cards & walk summaries
S-21/S-22: route-art renderer (SVG route → styled card; port of `routeSvg` + `momentCard` pipeline), template families (route-art / photo-forward / stat / milestone / recap), always Home-Zone-safe, watermark + deep link with unauth web preview (§8.3).
*Metrics:* **Shares per WAU (Q1 North-Star input, target 0.35)**; share→install conversion ≥3%.

### 7.8.4 Milestone Engine *(port + reskin)*
Pawtchi's `milestoneEngine` generalized: distance odometer milestones (10/50/100/500/1000 km with landmark equivalences), walk-count, streak landmarks, sniff-stop lifetime counts, breeds-met, Spots-visited. Milestones stage one-at-a-time on S-21 (never a badge dump) and pre-announce at proximity (anticipation, §5.14).
*Metrics:* milestone→share rate ≥25%.

### 7.8.5 Achievements & badges
Families and full progression rules in §11.2. Q1 ships the walking + collection families; social families unlock with Q2.

### 7.8.6 Streaks, Streak Repair & Rest Notes
Default framing = **weekly rhythm** (N walks/week, self-set, default 5); daily streak available for those who want it. **Streak Repair:** earnable tokens (1 granted/30 rhythm-kept days, max 2 held) auto-offered on a miss; free, never purchasable (§15.2). **Rest Notes:** mark days protected (injury/illness/heat/travel) — streak pauses honorably, auto-suggested on extreme-weather days (§5.10).
*Metrics:* rhythm-goal keep rate ≥60%; repair acceptance; churn following streak loss (target: no measurable spike — the whole point).

### 7.8.7 Seasonal challenges
Quarterly themed challenge (Q1 ships one: e.g. "Autumn Sniffari — 30 sniff stops in April" — the seasonal calendar follows the launch market's hemisphere, and April is autumn in the Australia-first launch, §2.6), consistency-framed per P2, opt-in, completion badge + recap segment. Infrastructure doubles for Q3 sponsored challenges (§15.3).
*Metrics:* opt-in ≥30% WAU; completion ≥50% of opt-ins.

### 7.8.8 Monthly Recap & Year in Review
Monthly: story-format (S-65) — km, walks, sniff champion moment, photos, map of the month, contribution impact (P5). **Year in Review pipeline is built in Q1** (data marts accumulate from day one) and fires in December as the flagship share moment; senior-dog and memorial variants get bespoke, grief-aware treatment (§5.15, §12.7).
*Metrics:* recap open ≥60% MAU; recap share ≥15% of opens; December YiR share spike as top acquisition week.

### 7.8.9 PawCoins
Soft currency (ported ledger with idempotent transactions). **Earned by:** contributions (pins, confirmations, reviews, founding), challenge completions, milestones. **Never earned by:** raw distance (overjustification guard, §5.1). **Spent on:** cosmetic Dog Card themes/frames, recap styles, charity micro-donations (§15.5). Never buys badges, repairs, or visibility.
*Metrics:* earn-participation ≥40% WAU; sink utilization (economy health, §11.6).

### 7.8.10 Pawtchi import bridge
One-way, one-tap import at S-03: dog profile (name, photo, breed, birthday, weight) via signed handoff token (§13.9). No health data crosses (different product covenant); no ongoing sync in v1.
*Metrics:* import completion ≥80% of attempts; imported-user D7 vs organic.

---

## 7.9 Packs, events & invitations (Q2–Q3 social containers)

### 7.9.1 Household Packs *(Q2)*
The multi-walker household (§4.4): one dog, several humans; every member's walks stack to the dog's record; household streak is shared. Roles: owner / member; invites via QR/link (S-64). **Data-model consequence (do this in Q2, not as a migration later):** walks belong to a *dog* and a *recording user*; all dog-level stats aggregate across recorders (`walks.dog_id` + `walks.recorded_by`, household join table).
*Edge cases:* divorce/separation splits (dog moves households with history intact — owner role decides); dog-walker guests get time-boxed member roles.
*Metrics:* households with 2+ active members; family-account multiplier on retention.

### 7.9.2 Puppy Cohorts *(Q3)*
Auto-offered Pack: puppies born the same quarter in the same metro. Cohort feed, shared milestones ("the cohort's first birthday"), Puppy Mode integration (§4.7), graduation ceremony at 12 months (share moment). Cohorts age together for a decade — the longest-burn retention asset in the product.
*Metrics:* cohort join ≥50% of eligible puppies; cohort-member M6 retention delta.

### 7.9.3 Breed Lounges *(Q3)*
Metro-scoped breed/type communities (Corgis of Denver), auto-suggested from profile. Lounge = feed + events + lounge challenges. Mixed-breed lounges are first-class ("All-Star Rescues"), not an afterthought.
*Metrics:* lounge MAU; events per lounge-quarter.

### 7.9.4 Pack Walk events *(Q3)*
S-54: Spot-linked scheduled group walks; RSVP (commitment device); day-of co-walk auto-detection groups attendees' walks into a shared recap gallery; recap is the recruitment artifact for the next event (F5 loop, §8.6). Safety rails: public events require organizer account age ≥30d + Spot-follower status; first-time-attendee guidance; report path §12.5.
*Metrics:* **event attendance (Q3 KPI)**; RSVP→show ≥60%; attendee→Best-Mate conversion.

### 7.9.5 Treat Toss *(Q2)*
The reaction primitive (§7.2). One per user per item; occasional streak-of-generosity recognitions (giving is also celebrated, §5.6).

### 7.9.6 Invitations & contacts sync *(Q2)*
Invite framing is always dog-first ("Luna's human should see this"); channels: share link, QR Park Card (in-person exchange at the park — the highest-intent invite in the product), optional contacts sync (hashed matching, no address-book upload without explicit action, no auto-invites ever, §12.3). Referral rewards: none in v1 (P6; the artifact is the pitch).
*Metrics:* invites/WAU; invite→install ≥25% (warm channel); Park Card usage as leading indicator of real-world graph strength.

---

## 7.10 Principles compliance summary

| Feature | P1 dog-first | P2 chihuahua test | P3 density test | P4 privacy | P5 map loop | P6 honest growth | P7 scale/local |
|---|---|---|---|---|---|---|---|
| Crossed Paths | ✓ | ✓ (no perf) | ✓ (metro-gated) | ✓ (coarse, retro, mutual-consent) | ✓ (presence) | ✓ | ✓ |
| Best Mates/Feed | ✓ | ✓ | ✓ | ✓ (mates-only) | – (P1–P4 justified) | ✓ | ✓ (bounded fan-out) |
| Spots | ✓ | ✓ | ✓ (OSM seed) | ✓ (k-floors, opt-in gallery) | ✓ | ✓ | ✓ (H3) |
| The Regular | ✓ | ✓ (visits only) | ✓ | ✓ (invisible opt-out) | ✓ | ✓ | ✓ |
| Sniff Map | ✓ | ✓ | ✓ (OSM seed) | ✓ (no people-pins) | ✓ (is the loop) | ✓ | ✓ |
| Pulse/Quiet Hours | ✓ | ✓ | ✓ (predict-first, Beacons) | ✓ (k≥5, no quiet-beacons) | ✓ | ✓ | ✓ |
| Trail Tails | ✓ | ✓ (suitability-matched) | ✓ | ✓ (Home-Zone-safe by construction) | ✓ | ✓ | ✓ |
| Q1 suite | ✓ | ✓ | ✓ (fully single-player) | ✓ (on-device simplification) | partial (starts data) | ✓ (no reward referrals) | ✓ |
| Packs/events | ✓ | ✓ | ✓ (graph-gated) | ✓ (safety rails) | ✓ (events feed Pulse) | ✓ | ✓ |

---

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

---

# §9 — Notification Strategy

Notifications are the highest-leverage, highest-risk surface in the product: the same channel that sustains a habit can burn permission (OS-level revocation is near-irreversible) and trust (brand-level, fully irreversible). Trot's strategy: **fewer, better, yours** — a hard budget, a strict quality bar, and user-visible control that we honor in spirit, not just settings.

## 9.1 Doctrine

1. **A notification is a promise that opening the app right now is worth it.** Every push must pass: *would a considerate friend interrupt you for this?*
2. **The dog is the only acceptable nag.** The dog at the door is the walk reminder; Trot never needs to be. We remind about *opportunities* (quiet window, mate nearby-Beacon, milestone in reach), never about *obligations*.
3. **Budgeted scarcity.** Hard caps (below) allocated by a priority queue — when the budget is spent, lower-priority items degrade to the Home inbox (S-30/S-31) instead of pushing. Scarcity forces every team to compete for the slot, which keeps quality high permanently.
4. **No dark inventory.** Banned forever: guilt copy ("Bruno misses you"), loss-threat copy ("your streak is about to die"), fake urgency, engagement bait ("someone viewed Bruno's profile"), re-permission nagging, and any push whose true purpose is a DAU metric rather than a user moment. (§5's constraints, enforced here.)

## 9.2 Budget

| Tier | Cap | Contents |
|---|---|---|
| **T1 — Moments** (interrupt-worthy) | ≤1/day, not guaranteed daily | Crossed Paths digest, Best Mate accepted, The Regular awarded, milestone achieved on today's walk (if app not open at S-21), event starting soon (RSVP'd) |
| **T2 — Opportunities** (time-sensitive, useful) | ≤3/week | Quiet window opening (Quiet Hours users), mate's open Beacon at your Spot, challenge closing you're 1 walk from completing, weather-window suggestion |
| **T3 — Rhythms** (scheduled, expected) | user-scheduled | Weekly recap (Sunday evening), monthly recap, seasonal challenge open, Year in Review ready |
| **T4 — System** (uncapped, rare) | as needed | Sync/account/safety/privacy notices; walk-still-recording guard ("Still walking? Bruno's tracker has been on for 3 hours") — a trust feature, not engagement |

Global hard cap: **≤10 pushes/week** regardless of tiers; median target ≤5. Every push deep-links to its exact object (§6.5).

## 9.3 The priority queue

All candidate notifications enter a per-user queue scored by: personal relevance (is this *their* Spot/mate/goal) × freshness × predicted open propensity × novelty (repeat suppression: same template >2 ignores in a row → auto-demote to inbox for 30 days). The queue clears against the budget; losers go to the Home inbox, which displays up to 5 items with honest recency. **The inbox is the pressure-release valve that makes the budget possible** — nothing is lost, only de-escalated.

## 9.4 Timing intelligence

- **Walk-window learning:** each household's actual walk times are learned within ~2 weeks (they are startlingly regular). T2 opportunities fire 20–40 min *before* a learned window — the decision moment — never during (they're walking) or at random.
- **Digest anchoring:** Crossed Paths batch at 8–10am local (§7.1); weekly recap Sunday 6–8pm; no pushes 10pm–7:30am local ever (system tier excepted).
- **Context suppression:** active walk in progress → everything queues; detected travel (metro change) → T2 pauses ("your Spots" are far away); Rest Note day → all rhythm/streak-adjacent content silenced.

## 9.5 Copy system

Dog-voiced, specific, and short — the notification *is* brand surface:

| ✅ | ❌ (banned pattern) |
|---|---|
| "Bruno crossed paths with Luna at Riverside — third time this month." | "You have a new crossing!" (vague) |
| "Elm Trail is usually quiet for the next hour." | "Don't miss your quiet window!" (urgency) |
| "3 walks to Bruno's 100th. It's happening this week, isn't it?" | "Your streak is at risk 😱" (loss threat) |
| "Sunday recap's ready — Bruno had opinions about squirrels this week." | "Bruno misses you 🥺" (guilt) |

Copy variants A/B-tested on *long-run open rate and permission retention*, never on single-push CTR (optimizing CTR selects for manipulation; optimizing permission retention selects for trust).

## 9.6 Streak & loss-aversion boundary (binding ruling)

Streak state may appear in T3 rhythms (recap: "5-walk rhythm kept — 6 weeks running") and on the Home screen. **No push may be triggered by imminent streak loss.** The one permitted adjacent: if the user's learned walk window is still ahead today and a rhythm goal is one walk from kept, a T2 *opportunity* framing may fire ("An evening walk would make this week 5-for-5") — worded as an invitation, capped at once/week, silent on what happens if declined. Rest Notes silence even this (§9.4).

## 9.7 User controls (S-72)

Per-category toggles (Moments / Opportunities / Rhythms, plus fine-grain under each); master quiet hours; **"Weekly digest only" mode** (one Sunday push summarizing everything — the graceful minimum that keeps the relationship alive without the channel); Quiet Hours persona gets a pre-tuned conservative preset. Defaults at install: T1 on, T2 on, T3 recap-only, everything explained in one sentence each at the permission pre-prompt (asked *after* first walk summary, when value is self-evident — never at first launch).

## 9.8 Channel health metrics (§14.5)

Permission grant rate at contextual ask (target ≥75%); permission retention at M6 (≥85% — the single best measure of the whole strategy); open rate by tier (T1 ≥40%, T2 ≥25%); per-category disable rates (canaries: any category >10%/month disable triggers review); "digest-only" adoption (healthy at 5–10%; >20% means the budget is failing); zero tolerance dashboard for banned-pattern regressions (copy lint in CI + quarterly human audit of every live template).

---

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

---

# §11 — Gamification System

The progression system operationalizes §5's psychology under §3's principles: **consistency over performance (P2), plural local status over global hierarchy (§5.4), real-world referents only (§5 rule 1), and dignity for every persona** (a system Ranger doesn't find childish and Duke's owner doesn't find cruel). Nothing here is a points economy bolted on; every element mirrors something true about the dog's life.

## 11.1 The progression stack

| Layer | Cadence | Emotional job |
|---|---|---|
| Streaks & rhythms | daily/weekly | habit scaffolding |
| Milestones | every few weeks | progress made visible |
| Badges & collections | monthly-ish | identity accumulation, variety missions |
| Levels (Journey stages) | quarterly | long-arc narrative |
| Seasonal events | quarterly | freshness, communal anticipation |
| Local reputation (Regular, Cartographer) | 90-day rolling | status & belonging |
| The archive (Memories, YiR) | annual/forever | the moat under it all (§8.6) |

## 11.2 Badge families

Badges are **earned facts, never purchases** (coins cannot buy any badge — binding, §15.2). Families, each with bronze→silver→gold→lifetime tiers where meaningful:

- **Mileage** — lifetime odometer landmarks (10/50/100/250/500/1000 km) with landmark equivalences ("Bruno has walked the length of the Thames").
- **Consistency** — rhythm-kept weeks (4/12/26/52); the family a three-legged chihuahua wins as easily as a husky (P2's test, passed by design).
- **Curiosity** — sniff-stop lifetime counts, new-route ratio, "Sniffari" tiers. Celebrates the dog being a dog.
- **Weather** — rain walks, snow walks, dawn patrol, heat-smart early starts (which *teaches* safe summer habits).
- **Explorer** — Spot passport (districts, metros), Trail Tails completed, breeds met.
- **Community** — pins confirmed, trails authored, events attended, Spot founded, cohort graduated. (Q2/Q3 unlock.)
- **Story** — first walk, 100th walk, gotcha-day walks, birthday walks, first snow. The nostalgia family; several are auto-awarded retrospectively from the archive.

Badge grammar rules: one reveal at a time (§7.8.4); every badge names the *dog's* achievement; no badge for app behaviors (opening, sharing, inviting — P6 bans growth-farming badges); retired badges stay displayed (history is never revoked).

## 11.3 Levels — the Journey

A slow, warm narrative arc rather than an XP grind: **Journey stages** advance on a composite of walks + weeks-active + collections (deliberately un-gameable in a day: time-gated by design). Stage names are dog-life-flavored (Pup Steps → Neighborhood Nose → Street Smart → Park Regular → Trail Wise → Old Soul), tuned so an average dog advances ~1 stage/quarter in year one, slower after. Stages unlock cosmetic breadth (card themes, recap styles) and nothing functional — **capability is never level-gated** (a day-one user gets the whole product). The level's real job is the *label*: identity vocabulary users adopt ("Luna just hit Trail Wise").

## 11.4 Streaks, repair & rest (binding spec, referenced from §5.10/§7.8.6)

- **Default: weekly rhythm** (self-set N/week, default 5). Daily streaks opt-in.
- **Streak Repair tokens:** earned 1 per 30 rhythm-kept days, hold max 2, auto-offered on a miss, free forever, never sold, never gifted-by-purchase.
- **Rest Notes:** protected days (illness/injury/heat/travel/life) — streak pauses honorably; auto-suggested on extreme-weather days; unlimited but pattern-reviewed (a streak that's 50% Rest Notes gently converts to a lower rhythm goal suggestion).
- **Loss handling:** a lost streak archives with respect ("87 weeks — a hell of a run. Starting fresh Monday?") and the *previous best* remains permanently displayed. No push about imminent loss, ever (§9.6).

## 11.5 Seasonal events

One quarterly headline event (challenge + limited badge set + themed recap skin), designed around real seasons of dog life (Autumn Sniffari, Winter Dawn Patrol, Spring Puppy Parade, Summer Early-Bird). Sponsored variants (§15.3) follow identical mechanics with sponsor branding fenced to the event surface. Event collectibles rotate but **never expire from display** once earned, and missing a season produces no gap-shame (collections show what you have, not slots you lack — §5.11/§5.13).

## 11.6 PawCoins economy (with §7.8.9)

**Faucets:** contributions (pins 10, confirmations 2, trail authored 50, Spot founded 100), challenge completions (25–100), milestone bonuses (10–50). **Never from raw distance** (§5.1 overjustification guard). **Sinks:** Dog Card cosmetics (themes/frames/accents: 100–500), recap styles (150), charity micro-donations (any amount; Trot matches during events — §15.5). **Balance discipline:** target faucet:sink utilization 60–80% (hoarding means weak sinks; scarcity means stinginess); economy reviewed quarterly; coins are never purchasable with money in v1 (keeps the economy honest and the store listing clean; revisit only with §15 board-level review).

## 11.7 Local reputation

Two tracks, both rolling and both plural (§5.4):

- **The Regular** (§7.4) — presence-based, per-Spot, per-slot, archived with honor.
- **Cartographer tiers** — contribution-based (Scout → Cartographer → Master Cartographer per metro, on trust-weighted accepted contributions §12.6). Displays as an opt-in profile chip; Master Cartographers get early access to map tooling and event kits — *recognition and capability, never coins* (mixing paid incentives into reputation corrupts both).

Reputation is scoped local (per Spot/metro) so status is winnable everywhere and meaningful somewhere — a design directly opposed to global leaderboards, which this document bans product-wide (P2).

## 11.8 Anti-corruption rules (the "sustained motivation" clause, consolidated)

1. No global leaderboards; no inter-dog comparisons anywhere.
2. No paid advantage in any progression system (coins→cosmetics only; money→coins doesn't exist).
3. No expiring-display collectibles; no countdown-timer scarcity.
4. No engagement-farming badges (app-opens, shares, invites).
5. Every pressure mechanic has a designed exit (repair, rest, rhythm-downshift, quiet modes).
6. Every reward mirrors a real event on a real walk (§5 rule 1) — if the dog didn't do it, the app doesn't award it.
7. Quarterly "gamification audit": one PM + one designer walk every progression surface as Duke's owner and as Luna's owner; anything that stings, ships a fix that quarter.

## 11.9 Success metrics

Rhythm-goal keep rate ≥60%; badge-earn spread (≥80% of M2 users hold ≥3 badges — breadth proves the chihuahua test); Journey stage-2 attainment ≥70% of M3 users; seasonal participation ≥30% WAU with completion ≥50%; coin sink utilization 60–80%; repair-token acceptance vs post-loss churn (the §7.8.6 target: streak loss produces **no measurable churn spike** — the single number that proves the whole system is humane).

---

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

---

# §13 — Technical Architecture

**Strategy (per the approved hybrid decision):** V1 ships on the proven Pawtchi-derived stack — Expo/React Native client with the ported walk pipeline, Supabase (Postgres + PostGIS) backend — because it is tested, cheap, and fast to market. The architecture is *shaped from day one* so that each scaling pressure has a named, incremental escape hatch (event bus, geo-partitioning, dedicated real-time services) rather than a rewrite. P7: built for 100 million, shipped for one neighborhood.

## 13.1 System overview

```
┌────────────────────────── Client (Expo / React Native) ──────────────────────────┐
│ Recording engine (ported) │ Maps (MapLibre+OSM / Apple Maps) │ UI (Expo Router)  │
│ On-device: simplification, validation, Home-Zone clipping, calibration, photo    │
│ scoring │ Offline queue (walkSync pattern) │ Push (Expo Notifications)           │
└──────────────┬────────────────────────────────────────────────────────────────---┘
               │ HTTPS (Supabase client + REST/RPC)
┌──────────────▼──────────────── Backend V1 (Supabase) ────────────────────────────┐
│ Postgres + PostGIS + RLS │ Auth │ Storage (photos) │ Edge Functions │ pg_cron    │
│ Async workers (queue tables → workers): crossing matcher, spot clustering,       │
│ pulse aggregation, pin confidence, feed fan-out, digest builder, moderation      │
└──────────────┬────────────────────────────────────────────────────────────────---┘
               │ (Stage 2+: outbox → event bus)
┌──────────────▼─────────── Scale-out services (Stage 2/3, as pressure demands) ───┐
│ Kafka-class event bus │ Geo services (tiles, pulse-live on Redis) │ Feed service │
│ Notification orchestrator │ Analytics lake │ per-region partitions               │
└───────────────────────────────────────────────────────────────────────────────---┘
```

## 13.2 The inherited client stack (V1's unfair advantage)

Ported from `my-app/lib/walk/` and surrounds — production code with tests, not designs:

| Module | Ported from | Role in Trot |
|---|---|---|
| Location engine | `locationEngine.ts` | Foreground-service/background-mode GPS capture, battery-aware sampling |
| Session lifecycle | `walkSession.ts` | Start/pause/auto-pause (Sniff Stops)/auto-stop (stationary, home, time-cap)/recovery |
| **Tracking reconciler** | `trackingReconciler.ts` | OS location stop is reconciled off walk phase — the *tracking-leak guarantee* (a battery/privacy failure class most competitors ship with); leak banner + hard-stop recovery path |
| **Validator** | `walkValidator.ts` | `valid / too_short / likely_vehicle / gps_junk` verdicts, computed on-device; the integrity root for the entire community layer (§12.6) |
| Geometry | `geo.ts` | Haversine, Douglas-Peucker simplification (≤200 points) — raw traces never leave the device (§12.1) |
| Sync | `walkSync.ts` | Offline-first queue with idempotent upsert; retry-safe (the dedupe patterns are already battle-tested) |
| Place labels | `geoLabels.ts` | Reverse-geocoded start/end labels (expo-location), Spot-name seeding |
| Calibration | `dogCalibration.ts` | Per-dog baselines → §10.2 |
| Route art | `routeSvg.ts` + `momentCard.ts` + share modal | S-21/22 share pipeline (react-native-view-shot) |
| Maps | `WalkMap.ios/android.tsx` | Apple Maps (iOS) + MapLibre/OSM (Android) — **no map-API-key cost at any scale**; MapLibre becomes the Sniff Map canvas on both platforms for layer parity (decision: migrate iOS map to MapLibre in Q1 for one rendering stack) |
| Activity matching | `activityMatcher.ts` | Generalizes into Trail-Tail overlap detection (§7.7) |
| Milestones/coins | `milestoneEngine.ts`, coin ledger + idempotency migration | §7.8.4 / §7.8.9 |

**New client work in Q1:** Home-Zone capture-side clipping with segment stitching (§7.8.1), multi-dog sessions, photo-on-route, on-device photo scoring (§10.7), the new five-tab shell (§6.1).

## 13.3 Backend V1 (Supabase)

- **Postgres + PostGIS + H3 extension** — one database, geo-native, with RLS as the authorization model (every table sketch in §7 states RLS intent; the pattern matches the existing `walk_sessions` policies).
- **Edge Functions** for API surface beyond PostgREST (share-link previews, import handoff, digest assembly).
- **Async work** via queue tables + `pg_cron` + worker processes (crossing matching, clustering, aggregation jobs per §7 specs). Every producer writes to an **outbox table from day one** — the cheap discipline that makes the Stage-2 event-bus migration a consumer swap instead of a re-architecture.
- **Storage** for photos (client-resized; EXIF-stripped on upload — location metadata in photos is a privacy leak the pipeline removes).
- **Known Supabase envelope:** comfortably serves to ~1–2M MAU with read replicas and PgBouncer; the §13.12 table names the exit ramps before each ceiling.

## 13.4 Core data model decisions (get these right in Q1; they're expensive later)

1. **The dog is the identity axis; the account is authentication** (P1 as schema): `users` (auth) ↔ `households` ↔ `dogs`; `walks.dog_id` + `walks.recorded_by` from day one, so Household Packs (§7.9.1) are a feature flag, not a migration.
2. **`walks` extends the proven `walk_sessions` shape** (duration/moving-time/distance/simplified route/verdict/end-reason) + `dog_id`, `recorded_by`, `home_zones_applied`, `crossing_opt_in` (state at record time), photo refs.
3. **Every location-bearing row carries its H3 cells** (res 8 for regional queries, res 10 for presence) — geo queries become index lookups; partitioning key exists from the first row.
4. **`metro_id` on all community entities** (spots, trails, packs, challenges): the product's density gating (§8.9), the ops team's rollout switch, and eventually the sharding key — one column, three jobs.
5. **Aggregates are first-class tables** (pulse, visit histograms), never computed on read paths; k-anonymity floors enforced in the materialization jobs, not in view logic (§12.2).
6. **Derived-data TTLs in the schema** (presence buckets ≤14d) so privacy promises are `pg_cron` jobs, not policy documents.

## 13.5 Geospatial & event architecture (the scale story)

**Why H3 everywhere:** hexagonal hierarchical cells turn every hard geo problem in this product into hash operations — crossing detection (§7.1) is an equijoin on `(h3_cell, t_bucket)`; Spot emergence (§7.3) is cell-count aggregation; pin dedupe, trail overlap, pulse attribution are all cell math. Cell IDs are also the natural partition key: **the data is local because the product is local** — a Seattle walk never joins against London data. This single design choice is what makes "one park" and "one planet" the same algorithm (P7).

**Event-driven from the first walk (logically):** the walk pipeline is a fact stream — `walk.recorded → walk.validated → presence.bucketed → {crossings, spot_visits, pulse, trail_overlap, milestones, feed_fanout}` — implemented in V1 as outbox + workers in one database, and in Stage 2 as the same topology over a real bus (Kafka/Kinesis-class) with each consumer extractable into its own service. The topology is designed now; only the transport upgrades.

**Real-time surfaces** are deliberately few (P4 limits liveness): Pulse live tier = Redis counters with k-floor gating (§7.6); active-walk tracking pill is client-local; everything else is near-real-time (seconds–minutes) via the queue — cheap, and honest about it.

**Feeds:** fan-out-on-write, bounded by the 150-mate cap (§7.2) — O(150) rows per walk post at any scale. The cap is an architecture decision wearing a product costume.

## 13.6 Battery, GPS & permissions engineering

- **Budget: ≤4% battery per 30-minute walk** (CI-measured on reference devices; regression = release blocker). Levers already in the ported engine: adaptive sampling by speed, significant-motion gating during Sniff Stops, no network during recording (sync after).
- **Permission posture: While-Using + foreground service (Android) / background location mode (iOS) only for active sessions.** Trot never requests Always-Allow — the walk is an intentional session (§2.5 mitigation), which is both the trust story and the store-review story.
- **The reconciler guarantee** (§13.2) is the battery *and* trust backstop: no orphaned OS tracking, ever; leak banner + `hardStopTracking` recovery ported as-is.
- **Graceful degradation ladder:** full GPS → coarse+dead-reckoning (urban canyon) → step-count-assisted estimate (validator downgrades confidence honestly, §6.6) → manual logging (permission denied).

## 13.7 Offline support

Recording is fully offline (capture, validation, simplification, Home-Zone clipping are all on-device); sync queue drains idempotently on reconnect (`walkSync` pattern with server-side dedupe via client-generated UUIDs). Map tiles: last-viewed regions cached (MapLibre tile cache); Sniff Map layers cached with staleness badges. Feeds render cache + banner. Late-synced walks enter crossing/visit computation with the §7.1 staleness rules. Multi-day offline (camping trip) is a supported story, not an error state.

## 13.8 Integrations (Stage 2+)

- **GPS collars (Fi, Tractive):** ingest adapters mapping collar sessions → walk candidates (validator still judges them; verdicts keep integrity). Positions Trot as the community/software layer over dog hardware (§2.2). Requires partner APIs; pursue after density proves the network.
- **HealthKit / Health Connect:** owner-side step/workout write ("dog walk" as workout type) — cheap goodwill, Q2.
- **Weather:** one provider behind an interface (recommendations §10.1, Rest-Note suggestions §11.4, pulse covariates §10.8).
- **Public API** (Y2+, §15.6): read-only, aggregate-only, never individual — parks departments, researchers, city planning.

## 13.9 Pawtchi import bridge (one-way, one-tap)

Flow: Trot S-03 → "Import from Pawtchi" → app-link/universal-link into Pawtchi (if installed) → Pawtchi consent screen → Pawtchi backend mints a short-lived signed handoff token (JWT, 5-min TTL, single-use, scoped to profile fields: name, photo, breed, birthday, weight, energy/reactivity flags) → Trot Edge Function redeems token against Pawtchi's export endpoint → profile pre-filled. **No health records, no walk history migration (Pawtchi walks pre-date Trot's covenant disclosures), no ongoing sync, no shared auth** — the products stay independent (approved decision); the bridge is a courtesy, not a coupling. Fallback path: QR-mediated handoff for Pawtchi-on-another-device. Build cost: one endpoint on each side + consent screens; ships in Q1.

## 13.10 Store-compliance launch checklist (inherited playbook, extended)

The Pawtchi walk feature was deferred precisely over this territory; the re-enable checklist in `constants/features.ts` becomes Trot's launch checklist:

1. **app.json/manifest:** iOS `UIBackgroundModes: ["location"]`; Android `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`; expo-location `isAndroidForegroundServiceEnabled: true`; `npx expo prebuild --clean` (checked-in prebuild output must be regenerated).
2. **Play Console:** Foreground Service (location) declaration **with video demo** of the in-walk flow; sensitive-permissions declaration; Data Safety form declaring location collection, purpose, and the no-raw-trace architecture (which materially helps approval).
3. **App Store:** location purpose strings that state the covenant plainly; background-mode justification referencing active-session-only design; privacy nutrition labels consistent with §12.1.
4. **Both stores:** subscription surfaces fully RevenueCat-data-driven (prices/trials never hardcoded — a Play rejection already paid for this lesson at Pawtchi); paywall copy compliance per policy.
5. **Pre-submission QA ritual:** permission-denial paths, tracking-stop guarantee demo recording, battery-budget report — packaged as the review-team narrative.

## 13.11 Observability, reliability & DR

- **SLOs:** walk-save success ≥99.9% (the sacred write — a lost walk is a broken promise); crash-free sessions ≥99.8%; API p95 <400ms; digest/feed jobs' lag alarms.
- **Client telemetry:** recording-session health traces (GPS gaps, validator distributions, battery draw, reconciler events) — the validator verdict mix per device/OS version is the early-warning system for OS regressions.
- **Backend:** structured logs, metrics + tracing (OTel), per-worker dead-letter queues with replay; analytics events (§7 specs) flow to a warehouse (BigQuery-class) from Q1 so §14's tree is queryable from launch.
- **DR:** Postgres PITR + daily snapshots, cross-region replica at Stage 2 (RPO ≤5min, RTO ≤4h V1 → ≤30min Stage 2); photo storage versioned; quarterly restore drills; the offline-first client is itself resilience — a backend outage during a walk loses nothing (queue drains later), and that story is worth stating to users.
- **Privacy ops:** TTL jobs monitored like uptime (a failed presence-purge job is a covenant breach, alarmed at the same severity as data loss).

## 13.12 Scaling stages

| | Stage 1 (launch → ~1M MAU) | Stage 2 (~1–10M) | Stage 3 (10–100M) |
|---|---|---|---|
| Compute | Supabase + workers | Extract hot workers to services; event bus replaces outbox transport | Regional service mesh; cell-based deploys per geography |
| Database | Single Postgres + replicas + PgBouncer | Table partitioning by `metro_id`/H3; read-path caching (Redis) | Regional Postgres clusters sharded on metro/H3; global tables (accounts) via managed distributed SQL |
| Geo | PostGIS + H3 in-db | Dedicated tile service + precomputed vector tiles CDN'd | Fully precomputed layer pipeline; edge-cached tiles |
| Feeds | fan-out in-db | Feed service + Redis timelines | Same, partitioned; still O(150) per write |
| Live pulse | Redis single region | Redis per region | Regional, k-floor logic unchanged |
| The invariant | — | **No client-visible API change at any stage; the H3/metro keys chosen in Q1 are what make each migration mechanical rather than heroic** | — |

**Cost posture:** OSM/MapLibre (no per-tile fees), on-device compute for the heavy ML, bounded fan-out, and aggregates-not-trajectories keep marginal cost per user cents-scale — the architecture is also the margin structure (§15.7).

## 13.13 Security model

- **Authentication:** Supabase Auth with Apple/Google sign-in primary (email/password fallback); short-lived access tokens + rotating refresh; device-bound sessions listed and revocable in settings. No passwords stored by us for the primary paths.
- **Authorization:** RLS is the single enforcement point for row access (every §7 table sketch states its policy intent); Edge Functions run with user context by default — service-role credentials exist only inside pipeline workers, never in any client-reachable path. The `walk_presence` pattern (client access: none) is the template for all derived-data tables.
- **Data classification & handling:** class A (location-derived: routes, presence, visits) — encrypted at rest, TTL'd where derived, never in logs, never in analytics events (analytics carry Spot/metro IDs at most); class B (identity: dog/owner profiles, photos) — standard PII handling, EXIF-stripped, face-flag pipeline §10.4; class C (content/telemetry). Logging lint blocks class-A fields at CI.
- **Client hardening:** certificate pinning for API hosts; signed upload URLs (short-TTL) for photos; no secrets in the bundle (map styles and public keys only); jailbreak/root detection informs trust scores (§12.6) but never blocks (false-positive posture).
- **Abuse-surface controls:** rate limiting per user + per IP at the edge (the existing `rate_limits` pattern from the parent codebase generalizes); idempotency keys on all mutating endpoints (the coin-ledger idempotency discipline applied product-wide); CAPTCHA-class challenges only on anomalous signup/import bursts, never in normal flows.
- **Reviews & response:** external penetration test before Q2 social launch and annually after; dependency scanning in CI; a `security.txt` + disclosure policy from day one; the §12.9 incident runbook covers breach notification thresholds and timelines (GDPR 72h).

## 13.14 API design conventions

- **Shape:** REST over HTTPS, JSON; plural nouns (`/walks`, `/spots/:id/pulse`); cursor pagination everywhere a list can grow (`?cursor=&limit=`); server-generated UUIDs accepted from clients on create (offline-first requirement, §13.7) with idempotent upsert semantics.
- **Versioning:** `/v1/` path prefix; additive changes don't bump; breaking changes require a new version and a 12-month deprecation window (the §13.12 invariant — client-visible APIs outlive infrastructure migrations).
- **Errors:** RFC-7807 problem-details bodies with stable machine codes (`walk_invalid_verdict`, `pin_requires_presence`, `k_floor_not_met`) so client copy can be precise and localized.
- **Privacy in the contract:** no endpoint returns raw coordinates for any dog other than the caller's own walks; aggregate endpoints enforce k-floors server-side and return `basis` fields (sample sizes) so honest-confidence UI (§10 rule 3) is data-driven, not decorative; every response containing another user's dog is filtered through the S-61 field matrix (§12.2) at the API layer, not in the client.
- **Internal events (outbox → bus):** versioned event envelopes (`walk.validated.v1`) with schema registry from Stage 2; consumers must tolerate unknown fields (forward compatibility is what makes the worker-to-service extraction §13.5 promises mechanical).

## 13.15 Delivery plan (team & build sequencing)

Indicative team for the Q1–Q3 plan (lean by design; the ported stack is the headcount discount):

| Role | Q1 | Q3 | Notes |
|---|---|---|---|
| Mobile (Expo/RN) | 3 | 4 | Recording port + shell + share pipeline are parallelizable |
| Backend/infra | 2 | 3 | Supabase-centric until Stage 2 pressure |
| Design (product+brand) | 2 | 2 | Share-card art direction is a growth role (§8.1) |
| PM | 1 | 2 | Second PM owns community/T&S surfaces |
| Data/analytics | 1 | 1 | §14 tree queryable from launch |
| Community/T&S ops | 0 | 2 | Hired before Q2 social launch (§12.9), scales with UGC |
| Growth/metro ops | 1 | 2 | The §8.9 playbook is an operating job, not a campaign |

**Q1 build order (critical path):** walk-stack port + Home Zones (weeks 1–6, gating everything) → data model §13.4 + auth + sync (parallel) → S-20/21/22 + share pipeline → Dog Card + milestones/streaks port → onboarding F1 → recap pipeline + YiR data marts → import bridge → store-compliance submission ritual (§13.10; submit early — review latency for background location is the schedule risk, and the walk-stack port de-risks everything else). Q2 and Q3 orders follow the §7.0 dependency logic: crossings need presence pipeline; Spots need visit history accrued since Q1; Pulse needs Spots.

**Definition of done, product-wide:** feature ships with its analytics events (§7 specs), its T&S review (§12.9), its principles checklist (§7.10 pattern), and its degraded/empty states (§6.6) — the four things retrofits always miss.

---

# §14 — Metrics Framework

One North Star, a small set of input trees, and a hard rule: **we measure walks, relationships, and contributions — never minutes-in-app.** Session-length and scroll-depth are explicitly *not* success metrics (§5.9); a metric that rewards keeping people staring at phones instead of walking dogs is measuring the wrong product.

## 14.1 North Star

> **VWW — Valid Walks per Week** (network-wide count of walks with verdict `valid`).

Why this and not MAU/DAU: VWW captures simultaneously (a) real user value delivered (a walk happened and was worth recording), (b) data-moat growth (every valid walk feeds the map), (c) integrity (the validator gate keeps it honest — §12.6), and (d) frequency, the category's structural advantage (§2.1). Every team's work should trace to VWW through one of the trees below.

**Companion ratio — VWW/WAU (walks per weekly-active user):** health target 4–7. Rising VWW with falling VWW/WAU means we're adding users faster than habits — acceptable in launch quarters, a warning later.

**Evolution:** in Q2+ we track **Connected VWW** (valid walks by users with ≥1 Best Mate) as the North Star's maturing form; the long-run thesis is Connected VWW / VWW → 80%+.

## 14.2 Activation (the F1 spine, §6.3)

| Metric | Target | Notes |
|---|---|---|
| Install → account | ≥80% | S-01/02 friction check |
| Account → dog profile complete | ≥90% | S-03 is celebratory, not a form |
| Location permission grant (contextual ask) | ≥85% | S-05 pre-prompt quality |
| **Activation = first Valid Walk ≤24h** | **≥60%** | The definition of activated |
| First walk → first share card viewed (S-21→22) | ≥50% opened composer | |
| Week-1: ≥3 walks recorded | ≥40% | The habit seed; best single predictor of M3 retention (validate, then manage to it) |
| Pawtchi-import users vs organic activation | +15pts expected | §13.9 |

## 14.3 Retention & engagement

- **Core curves:** D1/D7/D30/M3/M6/M12 targets 55/40/32/26/22/18% (blended installs) — but the *managed* numbers are cohort-conditional: activated-cohort M12 target **45%**; ≥3-mate cohort M12 target **60%** (§7.2's causal story).
- **Habit metrics:** WAU/MAU ≥55%; VWW/WAU 4–7; rhythm-goal keep rate ≥60% (§11.4); streak-loss churn spike = **zero** (the humanity gauge, §11.9).
- **Feature-cohort deltas (the resourcing tool):** M6 retention by — archive depth decile (§8.6), Regular status (§7.4), pack membership (§7.9), contribution activity (§8.7). These deltas decide where the next quarter goes.
- **Session shape:** median session <3 min with a completed loop (walk-wrap or feed-caught-up) ≥70% — *low* time-in-app with high loop completion is the design succeeding (§5.9).

## 14.4 Growth (per §8's loops — all social metrics reported per metro)

| Loop | Metric | Target (graduated metro) |
|---|---|---|
| Viral (8.1) | Shares per WAU (Q1 KPI) | ≥0.35/wk |
| | Share → install-activate | ≥3% of link views |
| Invitation (8.2) | Invites/WAU/mo; accept rate | 0.15; ≥25% |
| | Invited-user D30 vs organic | +10pts (else the loop makes weak users) |
| Local network (8.8) | **% WAU with ≥1 crossing/wk** | **30% sustained ×4wk = metro graduation** |
| Community (8.5) | Events/metro/mo; RSVP→show | rising; ≥60% |
| Creator (8.7) | Active creators/metro | ≥30 |
| Content (8.3) | Organic-search installs/mo | Y2 harvest |
| Blended | Monthly K-factor | ≈0.35 steady-state |

## 14.5 Community, trust & integrity

Contribution rate ≥20% WAU/mo (§7.5); pin accuracy ≥90%; confirm-prompt answer ≥50%; **Monthly Active Packs (Q3 KPI)**; users with ≥3 Best Mates ≥40% of M2 retained (Q2 KPI); reports per 1k WAU trending down per cohort; moderation SLAs met ≥95% (§12.5); crossing opt-out <5% and notification-permission retention M6 ≥85% (the two ambient trust canaries, §7.1/§9.8); "I trust Trot with my location" ≥85% (quarterly survey, §12.9).

## 14.6 Monetization (§15)

Trial start rate; trial→paid ≥40%; paid conversion of M3-retained ≥8% (blended MAU 4–6%); ARPU; LTV:CAC ≥3 within 12mo of paid channels opening; churn of paid ≤2.5%/mo; sponsored-challenge sell-through and advertiser NPS; **guardrail metric: retention delta paid-vs-free explained by selection, not by free-tier degradation** (audited — the §15.2 covenant, quantified).

## 14.7 Infrastructure & quality (§13.11 SLOs, restated as product metrics)

Walk-save success ≥99.9%; crash-free ≥99.8%; battery ≤4%/30min (CI-gated); GPS-degraded walk rate by device (watchlist); validator false-invalid <1%; API p95 <400ms; digest latency (crossings computed → surfaced next 8–10am window) ≥99%; TTL-purge job success = 100% (privacy SLO, §13.11); cost per MAU (cents-scale target, §13.12).

## 14.8 Operating cadence

- **Weekly:** VWW, activation funnel, metro dashboard (each metro's crossing %, contribution rate, K inputs — one page per metro, §8.9).
- **Monthly:** retention curves by cohort, loop portfolio review, notification channel health (§9.8), T&S dashboard (§12.9).
- **Quarterly:** North-Star decomposition review; gamification audit (§11.8); trust survey; metric-target re-baselining (targets above are launch-year planning numbers, expected to be revised against reality — the *definitions* are the stable part of this section, the numbers are hypotheses).
- **Anti-gaming rule:** any metric that becomes a team's target gets a named counter-metric on the same dashboard (shares↔share-quality/removals; VWW↔validator-verdict mix; conversion↔free-tier NPS) — Goodhart is a standing agenda item, not a surprise.

---

# §15 — Monetization

The model: **free product = the network; paid product = depth on top of it.** Network participation is never sold, the map is never paywalled for basic use, and community-generated data is monetized as aggregate place-intelligence, never as people. Monetization sequencing follows the network's maturity — subscription first (Q1, modest expectations), sponsorship at community scale (Q3+), place-intelligence at data scale (Y2+).

## 15.1 Trot+ (subscription — the revenue spine)

**Price posture:** $4.99/mo · $39.99/yr (anchor annual), 14-day free trial. All prices/trials are RevenueCat-offering-driven, never hardcoded (store-compliance lesson already paid for, §13.10); regional pricing from launch.

**Free tier (permanent covenant):** unlimited recording and full history, Dog Card, streaks/milestones/badges, full social graph (crossings, mates, feed, packs, events), full Sniff Map view + contribution, Pulse typical-hours, share cards, monthly recap, Year in Review. *A free user is a complete citizen of the network* — because free users are the inventory every paid feature is depth on.

**Trot+ (depth, insight, delight):**
- **Deep archive analytics:** trends, calibration insights (§10.2), route heatmaps of your own history, wellness observations when they ship (§10.6)
- **Pulse+ :** hour-by-hour predictions (§10.8), quiet-window forecasts (the Quiet Hours power tier — Luna's owner is the most willing payer in the product), multi-Spot watchlists
- **Trail tools:** advanced filters/matching, offline trail packs, trail authoring analytics
- **Recap+:** premium recap styles, longer video recaps, print-quality Year in Review export (and the §15.5 print pipeline discount)
- **Multi-dog household expansion** (≥3 dogs), extended photo storage at original resolution
- **Supporter identity:** subtle Trot+ paw chip (opt-in display — status must stay tasteful, §5.4)

**Explicitly never paid:** network access, badges/repairs/progression (§11.8), map contribution or basic view, safety features (§12.8), memorial features (§12.7 — binding: no monetization adjacent to grief).

**Targets (§14.6):** M3-retained conversion ≥8%; blended 4–6% of MAU; annual-plan share ≥60%.

## 15.2 The monetization covenant (binding rules)

1. Free tier never degrades over time ("give then take" is brand poison; features move paid-ward only at introduction, never retroactively).
2. No ads in feeds, no interstitials, no data sale about individuals — ever. Sponsorship exists only as §15.3/§15.4's opt-in structures.
3. Coins are earned, not bought (§11.6); no pay-to-win anywhere in progression.
4. Paywalls never interrupt a walk, a celebration moment (S-21), or any T&S/memorial surface.
5. Upsell surfaces: settings, feature-discovery moments ("see Bruno's trends" on locked analytics), post-recap — capped at one contextual upsell/week/user.

## 15.3 Sponsored challenges (Q3+, the endemic-brand channel)

Seasonal challenge infrastructure (§7.8.7/§11.5) sold to endemic brands (food, insurance, gear, retail): "The [Brand] Autumn Sniffari — 100k dogs, 1M sniff stops." Sponsor gets: brand presence on the event surface (only), aggregate participation reporting (validated activity only — the walk validator is the sales asset, §12.6), completion-reward fulfillment (samples/coupons, opt-in redemption). Sponsor never gets: user data, targeting, feed placement, push access. **Product rule: a sponsored challenge must be a challenge we'd run unsponsored** — sponsorship pays for better prizes and event kits (§8.5), not for existing. Pricing: per-metro or national flights; this is the natural first revenue *before* subscription volume matures, because dog brands currently have no native way to reach dog owners mid-walk-habit.

## 15.4 Local business partnerships (Q3+, metro-by-metro)

Dog-friendly venues (cafés, breweries, groomers, pet stores) as **verified Sniff Map places**: claimed listings (free, accuracy is map value), with paid tiers for — event hosting (Pack Walk endpoints: "walk ends at the taproom, first water bowl's on us"), Spot-adjacent presence ("near Riverside: 2 verified dog-friendly patios"), and redemption offers surfaced *on place pages only* (never pushed, never in feeds). This monetizes the map's foot-traffic power while making the map *better* (verified amenity data). Guardrail: community pins always outrank paid presence in rendering; a venue can't pay to overwrite what walkers report about it.

## 15.5 Marketplace & physical goods (opportunistic, light)

- **Year-in-Review print books & route-art prints** (print-on-demand partner): pure-margin emotional goods with built-in demand from §7.8.8; the memorial-book variant is offered with extreme care (owner-initiated only, §12.7).
- **Park Card physical tags** (§8.2): QR collar tag that doubles as invite surface and lost-dog contact card — a growth mechanic that pays for itself.
- **Charity rail:** coin-to-donation sinks with Trot matching during events (§11.6) — not revenue; brand equity and economy sink.
- Full gear-commerce marketplace: **explicit non-goal until Y3+** (§1.8); affiliate-style integrations only if organically demanded.

## 15.6 Place-intelligence API & data services (Y2+, the moat monetized — carefully)

Aggregate, k-anonymous, place-level products (§12's architecture makes individual-level products impossible by construction, which is the pitch):
- **Parks & municipalities:** usage patterns, quiet/busy load curves, amenity-gap reports (where dogs walk but no fountains/bins exist) — planning data cities currently buy from guesswork.
- **Real-estate/urban data:** neighborhood dog-friendliness indices.
- **Research:** anonymized activity datasets for veterinary/urban-planning research (review-board-style access).
Rules: aggregate-only endpoints, minimum-region floors, public documentation of exactly what's sold (§12.9 transparency), and an in-app plain-language disclosure. Community sentiment is the constraint: this line only grows if users are proud of it ("our walks improved the city's parks"), which the framing must earn.

## 15.7 Model economics & sequencing

| Phase | Revenue mix | Rationale |
|---|---|---|
| Q1–Q2 | ~100% Trot+ (modest) | Monetization exists but is deliberately quiet; density is the asset being built |
| Q3–Y1 end | Trot+ majority + first sponsored flights | Sponsorship turns on when events/challenges have real audiences |
| Y2 | Trot+ ~60% / sponsorship+local ~30% / goods ~10% | Metro graduation unlocks local sales motion |
| Y3 | + place-intelligence line | §16's platform economics |

Margin structure is protected by §13.12's cost posture (no map fees, on-device ML, bounded fan-out): gross margin stays software-shaped even at free-user scale, which is what lets the free tier stay generous — **the covenant (§15.2) is affordable because the architecture (§13) was designed to make it affordable.**

---

# §16 — Three-Year Product Vision

How a walk-tracking app becomes the world's largest dog community and location-intelligence platform — year by year, each stage funded by the last and made possible by data the last one banked.

## Year 1 — Own the walk *(the habit and the wedge metros)*

**Theme:** single-player excellence → graph ignition → first tribes (the Q1–Q3 roadmap, §7.0, plus a Q4 of hardening and the first Year in Review moment).

- Ship the ported recording core with the privacy covenant as the launch story (§12.1); Dog Cards and share artifacts drive the viral loop (§8.1).
- Execute the 12-metro density playbook (§8.9); flip social features metro-by-metro; graduate ≥8 metros.
- December: the first **Year in Review** — the moment the archive's emotional value becomes publicly visible and the biggest acquisition week of the year (§7.8.8).
- Trot+ live but quiet; first sponsored challenge flight in Q4 as proof of the channel (§15.3).

**Exit criteria:** ~400–600k MAU concentrated in graduated metros; VWW/WAU ≥4; 30%-crossing threshold sustained in 8+ metros; contribution rate ≥15%; the sentence "the app that knows which parks are quiet" appearing organically in reactive-dog communities (§4.5 — the wedge taking hold).

## Year 2 — Own the neighborhood *(the map becomes the moat)*

**Theme:** from network to *intelligence* — the year the data starts doing work no one else can copy.

- **Sniff Map and Pulse mature into infrastructure:** predictive Pulse (§10.8), weather-aware recommendations (§10.1 learned), seasonal map layers; the map's accuracy becomes the retention headline and the word-of-mouth engine (§8.4).
- **Communities deepen:** Puppy Cohorts hit their first graduations; Breed Lounges and Pack Walks become metro institutions; organizer tooling and event kits professionalize the volunteer layer (§8.5); private messaging arrives *with* its dedicated T&S review (§12.5).
- **Wellness observations ship post-audit** (§10.6) — Trot quietly becomes the thing that noticed something worth mentioning to the vet, the single most loyalty-generating moment the product can produce.
- **Expansion:** next metro tranches (Australian national depth, then UK and US entry, with DE/NL per §2.5 leash-culture markets); localization; collar-ingest partnerships (Fi/Tractive, §13.8) make Trot the software layer over dog hardware.
- **Business:** local-partnership sales motion in graduated metros (§15.4); sponsorship becomes a repeatable line; Stage-2 architecture migrations as pressure demands (§13.12).
- **Ecosystem seed:** public place-intelligence pilots with 2–3 parks departments (§15.6) — small revenue, large legitimacy: "our walks improved the city's parks" becomes a community brag.

**Exit criteria:** 2–3M MAU across ~40 graduated metros in 6+ countries; Connected VWW share ≥60%; map coverage rivaling any data source alive for dog-relevant amenities in served metros; LTV:CAC ≥3 with paid channels open; the archive's biography effect visible in M12 cohort curves (§8.6).

## Year 3 — Own the category *(platform and institution)*

**Theme:** Trot stops being an app dog owners use and becomes infrastructure the dog world runs on.

- **The dog identity layer:** the Dog Card becomes portable identity — vet offices, daycares, insurers, and events accept/read it (opt-in, per §12); "does your dog have a Trot?" is the category's version of a LinkedIn question.
- **The place-intelligence platform:** the API line (§15.6) matures — municipal planning contracts, amenity-gap reports steering real infrastructure (fountains, waste stations, off-leash hours), research partnerships publishing on the anonymized corpus. The community sees its collective walking reshape physical cities: the deepest possible closing of the P5 loop.
- **The events layer institutionalizes:** metro-scale seasonal festivals (the Spring Puppy Parade as a real-world event with thousands of dogs), sponsored at national scale, organized through the same Pack infrastructure built in Q3 of year one.
- **Marketplace, carefully:** services and gear integrations only where organically demanded (§15.5's discipline holds); a possible Sniffspot-class partnership or acquisition folds private-space inventory into Quiet Hours (§2.2).
- **Pawtchi relationship revisited from strength:** with both products mature, a deliberate decision about deeper integration (walk data enriching health context, §10.6 handoffs) — from a position where Trot is a network, not a feature.
- **Geographic breadth:** 10+ countries, Stage-3 architecture where scale demands (§13.12), a T&S organization worthy of a network embedded in neighborhoods (§12.9 transparency reporting live).

**Exit criteria:** 8–12M MAU; the category's default ("the dog app"); place-intelligence revenue proving the moat monetizes without touching individuals; and the strategic position stated in §1 achieved — *every walk makes the product smarter, every user makes it more valuable for everyone else, and the dataset underneath it cannot be bought, only walked.*

## Risk register (the honest page)

The ten risks most likely to break this plan, ranked by expected damage, each with its owner-mitigation and its early-warning metric:

| # | Risk | Mitigation | Early warning (§14) |
|---|---|---|---|
| 1 | **Cold-start failure** — metros never reach crossing threshold; social layer looks dead | The entire §8.9 playbook: metro gating, dark features, anchor seeding, single-player excellence carrying the wait | Crossing % plateau <15% after 6mo of seeding in a wedge metro |
| 2 | **Privacy incident** — one leak/stalking story defines the brand forever | Architecture over policy (§12.2: clipping, k-floors, TTLs); adversarial reviews per feature; incident runbook | Trust survey dip; covenant-page traffic spikes; TTL-job failures |
| 3 | **Store rejection/delay** on background location | The inherited compliance playbook (§13.10); While-Using-only posture; early submission | Review cycles >2 on first submission |
| 4 | **Novelty churn** — Q1 users leave before the graph arrives | Habit scaffolding (§5.9), milestone cadence, recap anticipation; be honest that Q1 retention will look worse than steady-state | Week-6 cohort cliff steeper than model |
| 5 | **Map poisoning / integrity collapse** as data gains value | Presence-gated trust weighting (§7.5), validator root (§12.6), anomaly detection | Pin-accuracy audit <85%; confirmation disagreement rising |
| 6 | **Incumbent pivot** (Strava pet tag, Fi social push) | Speed to density; companionship positioning they can't copy; collar partnerships that make us complementary | Competitor announcement (respond with metro depth, not feature war) |
| 7 | **Community toxicity** at the Q2/Q3 surface expansion | Structural prevention (§12.5: no open text, no DMs v1); T&S hired before launch | Reports/1k WAU trend; moderation SLA misses |
| 8 | **Battery/OS regression** breaking the recording promise | CI battery budget (§13.6); reconciler guarantee; validator-mix telemetry as OS-canary (§13.11) | Battery complaints in reviews; verdict-mix shift on an OS version |
| 9 | **Monetization pressure** eroding the free covenant in a funding crunch | §15.2 is board-ratified, not team policy; sponsorship line diversifies before subscription must carry everything | Paid-conversion pressure appearing in roadmap trade-offs |
| 10 | **Team scale vs. surface area** — consumer social + geo infra + community ops is three companies' worth of scope | Phased roadmap discipline (§7.0); the §1.8 non-goals; the ported stack as headcount discount (§13.15) | Slipping quarters; DoD checklist (§13.15) skipped under pressure |

## The through-line

Three years, one sentence per year:

1. **Year 1:** make one owner and one dog love recording their walks — then make their neighborhood light up.
2. **Year 2:** make the neighborhood's accumulated walks smarter than any map on Earth about dogs.
3. **Year 3:** make the dog world — owners, cities, vets, brands — run on what the walks built.

And underneath all of it, unchanged from §1.1: every dog on Earth gets a map, a pack, and a story.

---

# §17 — Design Language: "Fieldcraft"

The design system is named **Fieldcraft** — field notes meet craftsmanship. Its ambition is stated as strategy, not styling: Trot should be recognizable from a single screenshot, memorable from a single session, and emotionally difficult to leave — and the *system* producing that (tokens + motion + photography + map style + voice, working as one organism) should be harder to copy than any feature. Competitors can clone Crossed Paths in a quarter; they cannot clone the accumulated coherence of a thousand small decisions all pointing the same direction. That coherence is this section.

**The one-sentence brief:** *a beautifully kept field journal about a dog, that happens to be software.*

Everything below serves the design philosophy: timeless over fashionable, confident over loud, premium without luxury cosplay, emotional without sentimentality, delightful without gimmicks, minimal without emptiness, calm and deeply crafted. The reference class is Apple, Linear, Arc, Notion, Spotify, Strava — the ambition is a quiet-confidence identity that belongs only to Trot.

## 17.1 Design principles (the Fieldcraft seven)

Each principle includes its **test** — the question a design review actually asks.

1. **The dog is the hero pixel.** In any composition, the most visually privileged element is the dog (photo, name, route — the dog's traces). Chrome, stats, and the owner's world support. *Test: squint at the screen — is the first thing you resolve about the dog?*
2. **The Leash Rule.** Trot is used one-handed, outdoors, with a leash in the other hand. Primary actions live in the bottom 40% of the screen; touch targets ≥48pt; critical flows survive gloves, rain-flecked screens, and direct sunlight. *Test: complete the flow with your left thumb while your right hand is "holding a leash."* This constraint — derived from a truth about our users no desk-app has — is where a genuinely original interaction identity comes from.
3. **Quiet confidence.** One voice speaks at a time: one accent color moment, one celebration, one call to action per view. Whitespace is a feature. Nothing pulses for attention it hasn't earned. *Test: remove one element from the screen — if nobody would miss it, it was noise.*
4. **Warmth through material, not decoration.** Warmth comes from paper-toned surfaces, real photography, a literary serif, and generous spacing — never from gradients, mascots, confetti, or exclamation points. *Test: strip the copy and color to grayscale — does the screen still feel warm?*
5. **Motion is meaning.** Every animation communicates state (drawing a route, settling a card, acknowledging a tap). Nothing idles, loops, or decorates. One heartbeat per celebration — earned, played once, never repeated on re-entry. *Test: name what each animation tells the user; no answer, no animation.*
6. **Legible in the field.** Sunlight-first contrast, glanceable hierarchy (any recording-screen datum readable in <1s), tabular numerals that don't jitter, and an outdoor mode that boosts contrast in bright ambient light. *Test: read it on max brightness in noon sun; read it at 6am in the rain.*
7. **Inevitable, not trendy.** Prefer the choice that will look right in ten years. No dribbblification, no glassmorphism-of-the-month, no skeuomorphic leather. When in doubt, subtract. *Test: would this screen have looked right five years ago, and will it in ten?*

## 17.2 Layout & grid

- **Base unit 4pt; spatial rhythm 8pt.** Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 80 (`space.xs → space.giant`).
- **Screen margins 20pt** (phones), gutter 12pt; content max-width 600pt (tablet/web reflow centers a single column; two-pane map+detail above 840pt, §17.13).
- **Bottom-weighted composition (Leash Rule):** headers are display, not controls; action zones anchor to the bottom via docked buttons and sheets. Top-of-screen interactive elements are limited to back/close.
- **The stat block grid:** all statistics render in a 2- or 3-column block with baseline-aligned tabular numerals, label-above-value, identical everywhere (summary, cards, Spot pages) — one of the small consistencies that makes the product feel machined from one piece.

## 17.3 Typography

Two families, strict roles — the pairing *is* the brand's voice:

| Role | Family | Character |
|---|---|---|
| **UI / data — "Trot Sans"** | A humanist grotesque (license target: Söhne/Graphik-class; V1 fallback: SF Pro / Roboto via system stack until the license lands) | Plainspoken, sturdy, excellent tabular numerals |
| **Voice / story — "Trot Serif"** | A contemporary editorial serif (license target: Tiempos/Signifier-class) | The field-journal voice: dog names, milestone lines, recap headlines, memorial surfaces |

**Rules:** the dog's name is *always* serif (the biography thesis §5.15 rendered typographically); statistics are *always* Trot Sans tabular; the serif never sets UI controls or body-length text; maximum two families forever.

**Scale (pt):** 12 caption · 13 label · 15 secondary · **17 body (base)** · 20 title-3 · 24 title-2 · 28 title-1 · 34 display · 44 hero. Line-height 1.45 body, 1.15 display. Weights: 400/500/600 (Sans), 400/500 (Serif) — bold shouting (700+) does not exist in the system. Dynamic Type: all styles scale to XXL with tested reflow (§17.11).

## 17.4 Color: "Morning" (light) and "Dusk" (dark)

**Philosophy:** the palette is a *place* — an early-morning walk. Warm paper skies, deep trail greens, and one earthen accent. 90% of any screen is Paper + Ink + greens. And the load-bearing semantic rule:

> **Clay is motion.** The terracotta accent is reserved exclusively for the dog's movement — the route line, the record button, live-recording states, sniff-stop dots. It never colors buttons, sales, links, or chrome. Users learn, without being told, that *when you see Clay, a dog moved there.* This is the color system's moat: a reserved semantic no competitor palette has.

| Token | Morning (light) | Dusk (dark) | Role |
|---|---|---|---|
| `color.paper` | `#FAF7F2` | `#141613` | Base surface (warm, never pure white/black) |
| `color.surface` | `#FFFFFF` | `#1D211B` | Cards, sheets |
| `color.ink` | `#22261F` | `#EDEAE3` | Primary text (green-tinged warm near-black) |
| `color.ink2` | `#5A6052` | `#A9AFA0` | Secondary text |
| `color.line` | `#E7E2D8` | `#2A2F27` | Hairlines, borders |
| `color.trail` | `#2F5D3E` | `#7FA98C` | Primary actions, active states, success family |
| `color.meadow` | `#8FAE77` | `#93B27E` | Tints, fills, positive charts |
| **`color.clay`** | **`#C4593B`** | **`#D96A48`** | **Motion only (route, record, live)** |
| `color.sky` | `#A8C3D4` | `#7E99AB` | Water, informational accents |
| `color.honey` | `#E3B23C` | `#E6BC55` | Badges/recognition, used at ≤5% area |
| `color.brick` | `#A6342A` | `#C75548` | Errors/destructive (always paired with icon + text — no color-only meaning) |

Contrast: all text pairs meet WCAG AA (body 4.5:1+); `trail`-on-`paper` and `clay`-on-`paper` are validated for both modes. Semantic colors derive from the palette (success = trail family), never generic stoplight hues.

## 17.5 Elevation & surface

Flat-first. Two shadow levels only: **rest** (0–1dp, `0 1 2 rgba(34,38,31,0.06)`) and **raised** (4dp for sheets/dialogs/the record button). Hairline borders (`color.line`) do most separation work. Dark mode elevates by *surface lightness*, not shadow. No glows, no colored shadows, no glassmorphism.

## 17.6 Iconography

24pt grid, 2pt rounded stroke, geometric-humanist (soft corners, no cuteness); active states fill, inactive stroke — same silhouette so tab changes don't "jump." **The paw is sacred scarcity:** the paw mark appears in exactly three places — the record button, the loading indicator, and the app icon. It never scatters into list bullets or decorations; scarcity is what keeps the mark meaningful. No emoji in chrome (emoji live only in user content).

## 17.7 Illustration: "pencil & wash"

Single-weight ink line (matching icon stroke) + one flat wash tint (meadow/sky/honey) on paper. Subjects drawn with breed accuracy and dog-behavior truth (a play-bow drawn like dogs actually bow). **Humans appear only as fragments — hands, leash, boots — because the illustrated world is seen from dog height** (the photography direction's sibling rule, P1 made visual). Used for: empty states, onboarding moments, education, the rare error with personality. Never decorative filler; an illustration must carry a message or be cut.

## 17.8 Photography direction

The corpus that competitors cannot license: **the world at dog height.**

- Camera at ≤60cm; the horizon sits high; grass, paths, and paws dominate; owners appear as legs, hands, a leash — the dog's-eye social world.
- Natural light only, biased to walk hours (golden morning, dusk); weather is welcome (rain, snow, mud = honesty); motion blur allowed — dogs move.
- Real dogs in real places; no studio, no stock-smiles, no bandana-styled model dogs.
- In-app camera composition hints teach users the grammar (subtle dog-height guide), so **UGC itself converges on the brand's look** — the photography direction becomes self-propagating, which is what makes it a moat rather than a brand-shoot expense.

## 17.9 Motion language: "Gait"

Motion tokens: `motion.micro` 120ms · `motion.standard` 200ms · `motion.emphasis` 320ms · `motion.celebration` ≤600ms. Easing: `cubic-bezier(0.2, 0, 0, 1)` for property animation; critically-damped springs (no overshoot on chrome; slight overshoot allowed only on playful objects like the Treat Toss arc). 60fps floor on reference low-end Android.

**Signature moves (the recognizable four):**
1. **The route draw** — on S-21, the walk draws itself in Clay like a pen line (~900ms, distance-eased), sniff-stop dots popping in sequence with soft haptic ticks. Played once per walk, ever. This is Trot's "signature move" the way the like-heart is Twitter's.
2. **The breath** — during active recording, the record control breathes (2.4s cycle): a living "still with you" status signal, not decoration (it stops the instant recording stops — motion is meaning).
3. **The settle** — cards and sheets arrive with a 4pt settle (200ms), like something placed on a table, not flown in from off-screen.
4. **The heartbeat** — completions (milestone, badge, Regular award) pulse exactly once. Never loops, never replays on revisit.

**Banned:** looping confetti, parallax-for-depth's-sake, shimmer skeletons (loading uses **trail dots** — three paw-pad dots filling in sequence), bouncy chrome, animated gradients, pull-to-refresh cleverness. **Reduced-motion:** every animation has a crossfade equivalent; signature moves degrade to elegant static reveals (the route appears fully drawn with a fade) — parity, not punishment.

## 17.10 Component philosophy

Components are few, deep, and stateful-by-contract: every component ships with **all five states designed — default, loading, empty, error, success** — before it ships at all (§6.6's discipline moved upstream into the system).

- **Field Card:** radius 16, `surface` on `paper`, hairline border or rest shadow (never both), 16–20pt padding. The universal container (feed items, Spot modules, settings groups).
- **Buttons:** primary = filled `trail`; secondary = hairline outline; destructive = `brick` outline (filled only in confirmations); **the record button is the only Clay control in the product.** Height 52pt (Leash Rule), radius 14.
- **Sheets over dialogs:** bottom sheets are the modal idiom (reachable, dismissible with a drag); center dialogs only for destructive confirmation.
- **The Dock:** the 5-tab bar (§6.1) with the raised Clay paw record button; labels always visible (icon-only navigation fails glanceability outdoors).
- **Pills, stat blocks, avatars (always circular — dogs), progress rings** (streak/rhythm ring: trail stroke, honey completion tick), map chips.
- **Composition rule:** cards don't nest inside cards; depth beyond two surfaces means the IA is wrong, fix the IA.

## 17.11 Accessibility (a craft pillar, not a checklist)

- WCAG 2.2 AA product-wide; the recording flow (F2) targets AAA contrast — it's used in the worst viewing conditions we ship for.
- Dynamic Type through XXL with tested reflow (stat blocks wrap, never truncate); minimum body never below 15pt equivalent.
- **Eyes-free recording:** VoiceOver/TalkBack complete for F1/F2; during walks, optional spoken checkpoints ("two kilometers, forty minutes") — accessibility feature and runner's feature in one.
- Touch ≥48pt with 8pt separation; all gestures have button equivalents (§17.12's gesture table lists each pair).
- Haptics as a parallel channel (milestone ticks, crossing digest arrival) — designed for deaf and hard-of-hearing users as *primary*, not garnish.
- Color-independence: no meaning carried by color alone (verdicts, errors, live states all pair icon/text).
- **Field mode:** ambient-light-triggered contrast boost (ink deepens, hairlines strengthen) — the accessibility feature that markets itself every sunny day.
- Reduced motion parity (§17.9); screen-reader labels are brand voice, written by the copy team, not auto-generated ("Bruno's route, 2.4 kilometers, drawn on a map").

## 17.12 Interaction & gesture grammar

| Gesture | Meaning (product-wide) | Button equivalent |
|---|---|---|
| Tap | Open/commit | — |
| Long-press | Preview or quick-start (tab paw = quick-start walk) | Explicit menu |
| Drag down | Dismiss sheet | Close button |
| Swipe horizontal | Move between sibling cards (recap pages, badge shelf) | Arrows |
| Pull down on feed | Refresh (plain spinner→trail dots) | Auto-refresh |
| Double-tap on feed photo | Treat Toss | Treat button |
| Map long-press | Add pin (S-43) | FAB on map |

Haptic grammar: light tick = acknowledgment (toss, confirm); medium = state change (recording start/stop); success pattern (two soft beats — the heartbeat) = celebration; **never haptics for errors alone** (pair with visible message). One grammar, product-wide — gestures mean the same thing everywhere or they don't exist.

## 17.13 Responsive & platform behavior

Phone-first; tablet (≥840pt) runs map+detail two-pane and feed-as-column; web is read-surface only in v1 (share previews, §8.3). Platform respect with brand consistency: iOS gets sheet detents, back-swipe, SF symbols fallbacks; Android gets predictive back, Material You *icon* theming only (the palette does not dynamically re-tint — brand color is brand). Keyboard avoidance, safe-area discipline, and notch/island choreography (§17.16) specified per screen family.

## 17.14 Dark mode: "Dusk"

Not inversion — **re-lighting**. Dusk is the evening-walk world: deep pine surfaces (`#141613`, never true black — OLED savings aren't worth killing warmth), lifted greens, Clay warmed a step brighter. Photography and route art render unmodified (real things keep their color; only the *room* darkens). Map switches to the Dusk Fieldmap (§17.15). Auto-switch honors system, plus an optional **sunset-aware schedule** — the app about evening walks knows when the sun sets. Every §17.4 pair re-validated for contrast in Dusk.

## 17.15 Map styling: "Fieldmap"

The map is Trot's biggest owned canvas and must be recognizable at thumbnail size:

- **Parks are the heroes:** greenspace saturates (meadow tints), everything else recedes — roads thin and warm-grey, buildings whisper-outlines, water soft slate (`sky`), commercial POI clutter suppressed (a dog's map doesn't advertise gas stations).
- **Labels sparse and set in Trot Sans;** park names allowed the serif at high zoom (places with stories get the story voice).
- **The route:** Clay, tapered stroke (thick at present/end, thinning to start), rounded caps, sniff-stop dots as paw-pad marks. On `paper`-toned land, the Clay line is the signature visual asset — Strava's orange line is iconic *on a dark map*; ours is a pen line on paper, unmistakably different.
- Layer rendering per §6.4 (pins as minimal glyph chips, Pulse as soft moss heat, Trails as dashed trail-green until walked, then solid).
- Deliverable: custom MapLibre style JSON (Morning + Dusk variants), owned in-repo, versioned with the design tokens — a brand asset competitors on Google Maps default styling structurally cannot match.

## 17.16 Notification & system-surface design

Notifications are brand surface (§9): rich pushes carry route thumbnails or the dog's avatar (never generic icons); copy per §9.5's voice. **iOS Live Activity + Dynamic Island during walks** — paw mark, elapsed, distance, breathing subtly (§17.9) — turns every recorded walk into 30 minutes of lock-screen brand presence. Android foreground-service notification is *designed* (route-in-progress mini-map, proper actions), not the default gray text that says "app is running."

## 17.17 Widget design

Home-screen widgets follow three laws: **glanceable (one fact), truthful (never stale-as-fresh — show "as of 7:40"), quiet (no CTAs, no badges).** Set: small streak/rhythm ring; medium "this week" (ring + walks + km); medium **route art of the last walk** (the beautiful one people screenshot); Quiet Hours users get the **quiet-window widget** ("Elm Trail: quiet until ~9:40") — a widget that plans your walk before you open anything. Lock-screen circulars: rhythm ring, walk-in-progress elapsed.

## 17.18 Wearable extension (watchOS / Wear OS, v2+)

The wrist is the Leash Rule perfected — zero hands: start/stop from the watch, glanceable elapsed/distance/sniff-count, milestone haptic ticks mid-walk, rhythm-ring complication. Phone-free recording (watch GPS) syncs on reunion via the same offline queue (§13.7). Design language compresses: Clay record control, trail ring, tabular numerals — no feeds, no social, no maps-you-squint-at. The watch records and celebrates; the phone tells the story.

## 17.19 AR & spatial (forward posture, not v1)

Principles staked now so future work inherits restraint: AR only where it serves the walk (dog-height AR trail overlays, sniff-history made visible — "see the invisible city of smells" is the one genuinely native AR idea in this product); Spot layers through the camera at the park gate; a visionOS **Memories Room** concept (the archive as a spatial biography — route lines as sculpture, a year of walks as a room you stand in). Nothing ships until it passes the same test as everything else: *would you use it with a leash in your other hand?*

## 17.20 Design tokens & governance

- **Single source:** a `design-tokens` package exporting TS constants (the discipline inherited from the parent codebase's `constants/design.ts` — no hardcoded hex, spacing, or font values anywhere in app code) + Figma variables from the same JSON. Token families: `color.*`, `space.*`, `radius.*` (4/8/14/16/24), `type.*`, `motion.*`, `elevation.*`, `haptic.*`.
- **Review ritual:** every feature passes the Fieldcraft seven (§17.1 tests) + five-states check (§17.10) + accessibility gate (§17.11) before build; quarterly **craft audit** walks the live app hunting drift (parallel to §11.8's gamification audit).
- **The moat, stated plainly:** any competitor can copy the palette. What compounds beyond reach is the *system in motion* — tokens + Gait + dog-height photography (self-propagating via UGC) + Fieldmap + the serif voice + ten thousand consistent micro-decisions. Design moats are maintained, not achieved: the craft audit is the maintenance contract, and §18 is the system applied feature by feature.

---

# §18 — Feature-Level Design Specifications

Fieldcraft (§17) applied to every major experience. Each spec covers five lenses: **Visual** (identity & hierarchy) · **Interaction** (micro-interactions, gestures, motion, haptics) · **Emotion** (what the user feels, what memory remains, why they return/share/recommend) · **Design-as-growth** (how the design itself drives §8's loops) · **Award bar** (the craft standard that would earn an Apple Design Award / Red Dot / iF jury's respect — through restraint and resonance, never flash). Functional specs live in §7; screens in §6.

---

## 18.1 Onboarding & first walk (S-01→S-08, flow F1)

**Visual.** Paper-white calm; one pencil-&-wash illustration per screen (dog-height world); serif for the single promise line ("Every walk counts"), sans for everything else. The dog-profile screen (S-03) is the composition peak: the photo upload circle sits center-stage like a locket, and the moment a photo lands, the serif name renders beneath it — the Dog Card visibly *mints* in front of the user. Permission screens (S-05/06) use the quietest visual treatment in the flow: plain language, a small map vignette showing the Home Zone circle being drawn, zero urgency styling — trust is the aesthetic.

**Interaction.** One decision per screen; progress via dots, never percentages (a journal, not a form). Breed picker: type-ahead with mixed-breed-first ("Best of Everything" at top, not buried). The Home-Zone circle is set by direct drag — pinch to resize, the map dimming outside the zone, a 200ms settle when released; the gesture *teaches the privacy model* better than any paragraph. First-walk prompt (S-07) docks a single Clay button at thumb height — the first Clay the user ever sees, spent on the product's core verb.

**Emotion.** Feel: *"this thing gets what my dog means to me"* by screen three. Memory: the moment the Dog Card minted with the serif name. Return: the un-walked Clay button is an open loop begging to close. Share: S-08's first summary is designed as the natural first share (below). Recommend: "setup took two minutes and it never asked me anything creepy."

**Design-as-growth.** The activation spine (§14.2) is a design artifact: every screen removed adds points to first-walk-within-24h. The privacy screens *are* referral copy — users quote them ("it clips your home off the map") in exactly the communities (§4.5) where trust is the buying criterion.

**Award bar.** The permission flow good enough to be taught: contextual ask, honest diagrams, decline-path parity (§6.6). Juries reward permission UX that respects people; so do users, at 85%+ grant rates.

---

## 18.2 Recording (S-20, the active walk)

**Visual.** The most restrained screen in the product, designed for 10-second glances in sunlight: Fieldmap fills the frame; the route draws behind the dog-position dot in tapered Clay; three stats max (elapsed · distance · sniff stops) in the large tabular stat block, bottom-anchored (Leash Rule); the breathing record control (§17.9) is the only motion. Auto-pause state: the Clay dot rests, a paw-pad ripple marks the sniff stop being born, the header whispers "sniffing…" in serif — the product's values (P2) visible mid-walk. Field mode contrast boost engages automatically in bright light (§17.11).

**Interaction.** Start: single tap, medium haptic, breath begins. Photo: one tap, camera opens pre-framed with the dog-height hint; the shot drops onto the route as a dot. End: press-and-hold 600ms with a filling ring (prevents pocket-stops; the hold is the "are you sure" — no dialog). Screen-off walking is the *expected* mode: Live Activity / foreground notification (§17.16) carries the walk on the lock screen; milestone haptic ticks arrive through the pocket. Every mid-walk element ≥48pt, glove-tolerant.

**Emotion.** Feel: companionship, not measurement — the app is *with* you, not timing you. Memory: the sniff-stop ripple ("it celebrated him being a dog"). Return: the walk felt witnessed. Recommend: "it just works, even with the phone in my pocket, and the battery doesn't die."

**Design-as-growth.** Reliability rendered visibly (breath = still recording; reconciler guarantee §13.2 = never a stuck tracker) is the trust that compounds into 7–21 sessions/week — the frequency every loop in §8 multiplies against. The Live Activity is ambient brand on the lock screen for 30+ minutes a day.

**Award bar.** The eyes-free walk: complete a full recording with the phone never leaving the pocket, guided by haptics and (optional) spoken checkpoints — accessibility-first design (§17.11) that happens to be the best UX for *every* user in the rain.

---

## 18.3 Walk summary & share cards (S-21/S-22)

**Visual.** The reward moment and the brand's masterpiece surface. Sequence: paper background → **the route draw** (§17.9 signature: Clay pen line, sniff dots popping with ticks) → stat block settles in → photos fade onto their route positions → *then* (never simultaneously) any milestone plays its single heartbeat. Verdict states are designed with equal care: an invalid walk gets the same layout with honest serif copy ("That looked like a car ride, so we kept it off Bruno's record") — dignity in the degraded state is a Fieldcraft signature. Share cards (S-22): three templates (route-art / photo-forward / stat), all built on paper texture, serif dog name, Clay route, small paw watermark — designed to look *editorial* in an Instagram story, not app-generated.

**Interaction.** The draw plays once; a replay affordance exists but is never automatic. Template swipe (horizontal, §17.12), share via native sheet in ≤2 taps from summary. Contextual map contribution (F4) appears as one quiet card *after* the celebration, never before — reciprocity waits its turn.

**Emotion.** Feel: pride, closure, a small ceremony. Memory: watching the walk draw itself — users describe it as "seeing the walk again." Return: tomorrow's walk earns tomorrow's drawing. Share: the card is genuinely beautiful (P6's honesty test: shareworthy with zero incentives). Recommend: the card *is* the recommendation — every story post carries the aesthetic.

**Design-as-growth.** This screen is the viral loop (§8.1). Every design hour invested in route-art quality has direct K-factor yield; template seasonality (§17.20 governance) keeps the share stream fresh without gimmicks.

**Award bar.** The route draw as a signature interaction the industry references — Trot's equivalent of Strava's segment or BeReal's dual camera: instantly attributable, technically flawless at 60fps, meaningful (it re-performs the walk).

---

## 18.4 Home (S-30)

**Visual.** A morning briefing, not a dashboard: greeting with the dog's serif name, the rhythm ring (trail stroke, honey tick), then at most four Field Cards in personalized order (right-now digest, Crossed Paths teaser, milestone proximity, seasonal card). One glance answers "how are we doing, and is anything interesting nearby?" — no metric walls, no red badges, nothing blinking. Whitespace carries the calm (Notion/Linear discipline applied to a consumer surface).

**Interaction.** Cards settle on entry (staggered 40ms, once per session, not per scroll); pull-to-refresh is trail dots; long-press the tab paw anywhere for quick-start. The ring fills with `motion.emphasis` when a walk syncs — the day's state change acknowledged, once.

**Emotion.** Feel: *on top of it* — the good-dog-parent feeling (§4.1's core job) delivered in five seconds. Memory: the ring closing for the week. Return: the briefing is different every morning because the neighborhood is. Recommend: "it's not another feed app — it takes ten seconds."

**Design-as-growth.** The digest module is where §9's demoted notifications land — the design choice (inbox over push) that protects permission retention, the channel every retention loop depends on. Crossed-Paths teasers convert Home glances into graph actions (§8.8).

**Award bar.** A consumer home screen with *no* infinite feed and *no* engagement bait that still drives daily opens — restraint as differentiation, measurable in §14.3's session-shape targets.

---

## 18.5 Dog Card (S-60/S-61)

**Visual.** The identity object, composed like a museum label: circular portrait, serif name at display size, breed/age line in sans, the lifetime odometer as the one big number, badge shelf (honey accents) below, Regular chips as quiet laurels. The public variant (S-61) is the same composition minus private fields — one design, two disclosures (§12.2 matrix). The exportable card renders on paper texture at print quality: it should look correct framed on a wall, because some users will do exactly that.

**Interaction.** Badge shelf swipes horizontally; long-press a badge for its story ("earned March 14, the rainy Tuesday"). Editing is sheet-based; the portrait crop tool is circular with breed-aware framing hints. Export honors the heartbeat: the card assembles itself once (photo → name → stats settle) before the share sheet.

**Emotion.** Feel: *this is who my dog is* — identity made tangible. Memory: the first time the card looked complete. Return: the card accretes (badges, chips, kilometers) — identity compounds (§5.2). Share: a new-badge card is the lowest-friction brag in the product. Recommend: "look at his card" *is* the pitch, shown phone-to-phone at the park.

**Design-as-growth.** The card is the atomic unit of the invitation loop (§8.2): invite links land on the *inviting dog's* card — the most persuasive landing page a dog product can have. The QR Park Card variant is this composition folded into an exchange gesture.

**Award bar.** A profile page that reads as an artifact, not a form — jury-grade typography (the serif carrying genuine emotional weight) and an export pipeline whose print fidelity signals craft obsessives built this.

---

## 18.6 Crossed Paths (S-31/S-32)

**Visual.** Serendipity rendered gently: the crossing card shows both dogs' portraits leaning toward each other over a *place chip* (Spot name + pencil illustration — never a map of anyone's route, the privacy stance made visual). Recurrence is typographic: "3rd time" set in serif, because recurring characters are how stories work. The digest groups crossings into one morning card — abundance without inbox clutter.

**Interaction.** Tap → detail sheet rises; the Best Mate request is one honest button ("Send a hello from Bruno") with a light haptic; dismissal is a swipe, consequence-free and unrecorded. No read receipts anywhere in the flow — the interaction design *is* the social-pressure relief valve (§7.1). Accepting (from the other side) plays the product's warmest micro-moment: the two portraits settle side-by-side with a single heartbeat.

**Emotion.** Feel: cinematic small-world delight ("we keep meeting!") with zero social risk. Memory: the first crossing card — the moment the network stops being theoretical. Return: crossings are the product's variable reward (§5.7), genuinely unpredictable because reality is. Share: "look who Bruno keeps running into" screenshots itself. Recommend: this is the feature users *describe* when describing Trot.

**Design-as-growth.** The magic moment of the local-network loop (§8.8): the design's coarseness (place + day only) is what makes users comfortable *leaving it on*, and opt-in rate is the loop's oxygen. The request framing (dog-voiced hello) converts at friend-warmth, not stranger-cold.

**Award bar.** Privacy-preserving social discovery as a *designed* paradigm: the industry's reference example that serendipity doesn't require surveillance — a Fast Company Innovation-by-Design case study waiting to be written.

---

## 18.7 Pack Feed & Treat Toss (S-50)

**Visual.** A small-town notice board, not a broadcast tower: day-bucketed Field Cards (route art, photos, milestone cards), dog portraits as the bylines, generous spacing, and a designed **end** — the "all caught up" state is a pencil-&-wash dog asleep under a tree, the most-screenshotted empty state in the product if we do our job. No follower counts, no view counts, no verified anything.

**Interaction.** Double-tap a photo tosses a treat: a small physics arc (the one permitted overshoot, §17.9) landing with a light tick — giving feels tactile, receiving stacks treats gently on the card corner. Comments open in a sheet, short-form. Scroll is plain and honest; nothing auto-plays, nothing re-ranks under your thumb.

**Emotion.** Feel: neighborly warmth — the feed equivalent of nodding at the park gate. Memory: the treat arc; the asleep-dog end card. Return: finite feed = complete-able ritual (a reason to return *tomorrow*, not scroll longer today). Share: milestones cross-post outward (§8.1). Recommend: "a social feed that doesn't make you feel bad" is a sentence people say out loud in 2026.

**Design-as-growth.** Feed quality is why invites get sent (a good feed is worth improving with mates — §8.2's engine); the finiteness protects VWW-over-minutes (§14.1), keeping the product aligned with the walk itself — the alignment users eventually notice and reward with trust.

**Award bar.** The anti-doomscroll social surface: measurable in caught-up rates (§7.2), defensible to any jury asking "did you design for wellbeing or engagement?" — we can show the metric we *refused* to optimize.

---

## 18.8 Spots & The Regular (S-41)

**Visual.** Each Spot page is a clubhouse with a hand-painted sign: serif Spot name over a community photo, the busy-hours histogram drawn as soft moss bars (a garden chart, not analytics), amenity chips, and the Regulars podium — portraits with honey laurels, "since March" set in serif. Founding is ceremonial: the christening flow renders the name being written onto the map in real time.

**Interaction.** The histogram scrubs by touch (haptic detents per hour) to answer "when should we go?" with a thumb-drag; follow is one tap; check-in is a long-press with a paw ripple. Award moments: the new Regular's portrait settles onto the podium with the heartbeat; the outgoing Regular's chip slides to the archive shelf with a "thank you" line — status transitions choreographed with dignity (§7.4).

**Emotion.** Feel: belonging to a *place* ("our park"). Memory: seeing your dog on the podium — local fame, wholesome flavor. Return: the podium rotates, the histogram breathes with seasons, the wall accretes photos. Share: Regular awards are the proudest share card in the product. Recommend: Regulars evangelize their Spot page like proprietors (§4.2's Dave becomes the product's ambassador).

**Design-as-growth.** Spot pages are the community loop's venue (§8.5) and the SEO surface (§8.3) — designed to be beautiful *logged-out*, because their public form is a landing page. The founding ceremony converts early-market emptiness into founder status (§5.12).

**Award bar.** Local-place software with civic warmth — the histogram-as-garden and the podium's dignity choreography as examples of data design that respects what it measures.

---

## 18.9 The living map: Sniff Map, Park Pulse & Quiet Hours (S-40)

**Visual.** Fieldmap (§17.15) as the canvas; contribution layers render as minimal glyph chips (fountain, shade, hazard) with confidence expressed through opacity — the map *visibly knows what it knows* (§10's honesty rule made pixel). Pulse renders as soft moss breathing at Spot level, with the confidence caption always present ("typical for Tuesdays · 84 walks"). **Quiet Hours inverts the lens:** quiet windows glow softly on a calmer palette, busy areas recede — the same map, re-lit for a different need; visually, the mode communicates *we designed for you*, not *we filtered for you*.

**Interaction.** Layer toggles as pill chips (persisted); long-press drops a pin with the 10-second flow (category wheel → optional photo → done, light tick); post-walk confirm prompts are one-tap yes/no cards. The time scrubber slides Pulse through the day with haptic detents. Pins never interrupt: the map is browsed, contributions are invited (P5).

**Emotion.** Feel: *the neighborhood knows things and shares them with me* — and for Luna's owner, relief: the day planned around a quiet window that proved true. Memory: the first time a stranger's pin saved a walk (the dry-fountain day). Return: the map is a living document; it's different every week because the neighborhood walked. Share: hazard pins get screenshotted into local group chats — the map leaks outward on its own. Recommend: "it knows which fountains work" — the data moat as a sentence (§8.4).

**Design-as-growth.** Confidence-as-opacity and impact receipts make contribution feel like *tending a garden others walk in* — the emotional frame that sustains 20% contribution rates (§14.5). The Quiet Hours lens is the wedge persona's proof (§4.5) that mints evangelists.

**Award bar.** An honest map: uncertainty visualized, community knowledge foregrounded, zero commercial clutter — cartographic design juries (and Google Maps refugees) recognize the difference immediately.

---

## 18.10 Trail Tails (S-42/S-44)

**Visual.** Route pages composed like guidebook entries: the trail drawn in trail-green over Fieldmap, attribute chips (shade %, surface, senior-OK) as scannable pictograph pills, elevation as a gentle filled curve, reviews as short serif pull-quotes ("Perfect for old hips — flat and shady after 9"). The per-dog match ("Good for Duke today") renders as a small reasoned card — recommendation with its "why" attached (§10.1), never an oracle.

**Interaction.** "Walk this" overlays the trail on S-20; off-route drift gets one soft nudge, then silence (it's a walk, not a delivery). The composer (S-44) is the delight: pick a past walk, watch it become a trail — geometry pre-filled, attributes suggested, name it in serif, publish in under a minute. Completion auto-stamps the passport with a light heartbeat.

**Emotion.** Feel: local expertise flowing both directions — guided when you want novelty, author when you know something. Memory: the first stranger's completion of *your* trail ("142 dogs walked your route"). Return: variety-seeking has a home (§5.11's collections); seniors and reactive dogs get *plans*, not hopes. Share: trails are inherently sendable ("do this one Saturday"). Recommend: the senior-suitability filters win the exact users (§4.6) other products forgot.

**Design-as-growth.** The creator loop's tooling (§8.7): 60-second authorship is the difference between 3 creators and 30 per metro. Public trail pages compound the SEO loop (§8.3) with inventory that ages into authority.

**Award bar.** Recommendation UX with visible reasoning and dog-calibrated matching — personalization that explains itself is both an accessibility position and a jury favorite.

---

## 18.11 Recaps & Year in Review (S-65)

**Visual.** The product's editorial voice at full volume: full-bleed story pages, serif headlines over the month's best photo (auto-curated, §10.7), the month's walks composited into one route-art constellation, stat blocks kept to three numbers that *mean* something ("14 new sniff spots" beats "42.3 km"). Year in Review extends the grammar: a year of Clay lines drawn as one continuing thread — the biography made visible (§5.15). Senior and memorial variants shift to slower pacing, warmer paper, and zero stats-as-triumph — the same system, re-tuned to hold grief (§12.7).

**Interaction.** Swipe-paged like a story; every page individually shareable; the route-thread page supports slow scrubbing (the year under your thumb). Plays once with the draw; replays start assembled. Print/export (§15.5) renders at archival quality.

**Emotion.** Feel: the lump-in-throat recognition that *this is our life together, kept*. Memory: the year-thread page — most users' single most emotional software moment of December. Return: recaps are the anticipation engine (§5.14) — the product keeps appointments. Share: Wrapped-class shareability with warmer material (dogs beat listening habits). Recommend: December's share wave *is* the year's biggest referral event (§7.8.8).

**Design-as-growth.** The retention loop's compounding proof (§8.6): each recap deepens the archive's gravity; each shared recap recruits the next cohort exactly when new-year walk resolutions form. The memorial variant, handled perfectly, defines the brand in the community's hardest conversations.

**Award bar.** Wrapped's craft with Pixar's restraint: an annual data-storytelling artifact whose *silences* (what we chose not to count) demonstrate the design philosophy better than any feature — the piece juries and press both single out.

---

## 18.12 The pattern across all eleven

Every spec above repeats one structure, stated once here: **restraint at the surface, ceremony at the moment, honesty in the data, dignity in the degraded state.** That four-part signature — not any single screen — is what a competitor would have to replicate, and it only exists as the compound interest of the whole system (§17.20). Design review enforces it with the §17.1 tests; the §14 metrics (session shape, caught-up rate, permission retention, trust survey) are how we know the philosophy is surviving contact with growth pressure.

---

# §19 — Competitive Experience Analysis

What the reference class does exceptionally well, where each falls short for our category, and precisely how Trot's experience differentiates. The rule from the brief holds: **learn the lesson, never copy the pattern** — every borrowing below is re-derived from Trot's own truths (the dog, the leash, the neighborhood) or it doesn't come in.

## 19.1 Product-by-product

### Strava
**Exceptional:** the activity artifact (map + stats as a social object), segments as invented competitive geography, kudos as low-friction reciprocity, Year in Sport, and the most durable habit graph in fitness.
**Falls short (for us):** performance framing excludes the non-athlete majority (§2.2); its map privacy history (heatmap incidents, opt-out complexity) is the cautionary tale our covenant answers; the feed has drifted toward clutter (ads, suggested content); kudos inflation has cheapened the gesture.
**Trot differs:** the artifact celebrates *companionship* (sniff stops as features, not dead time); "segments" become *Spots + The Regular* — geography that rewards showing up, not speed (§7.4); privacy is architectural (on-device simplification, Home Zones at capture, §12.2) rather than a settings maze; Treat Toss stays scarce and warm (mutual-cap graph, §7.2). **Paradigm claimed:** consistency-status over performance-status.

### Apple Fitness
**Exceptional:** the rings — the most legible goal metaphor ever shipped; restraint; deep OS integration (Live Activities, complications); accessibility rigor.
**Falls short:** sterile emotional register (a medical chart, beautifully set); no place, no community; celebrates streaks with confetti that means nothing by March.
**Trot differs:** the rhythm ring borrows the legibility lesson but attaches it to a *life* (the dog's serif name above it, §18.4); our OS-surface investment (walk Live Activity, §17.16) matches Apple's grammar while carrying warm material (route thumbnails, the dog). **Paradigm claimed:** the ring that forgives — Rest Notes and rhythm-framing (§11.4) make the goal metaphor humane.

### Nike Run Club
**Exceptional:** voice and coaching personality (guided runs made effort emotional); celebration energy; brand courage in copy.
**Falls short:** the energy is *loud* — hype culture ages poorly and excludes the unhurried; personality lives in audio content more than in the product's bones; community features are vestigial.
**Trot differs:** personality lives in *typography, motion, and copy voice* (the serif, the heartbeat, dog-voiced notifications §9.5) — ambient rather than performed; our optional spoken checkpoints (§17.11) take the audio lesson for accessibility, not hype. **Paradigm claimed:** quiet personality — character without volume.

### Arc Browser
**Exceptional:** interaction inventiveness with a point of view; onboarding as theater; making users feel like members of something, not customers.
**Falls short:** novelty-density taxes comprehension (the cost of being clever everywhere); desktop-native lessons don't map directly to a leash in the rain.
**Trot differs:** we spend inventiveness in exactly four signature moves (§17.9) and standardize everything else — cleverness rationed to the moments that deserve ceremony (§18.12). Arc's membership feeling we build through founding rituals (Spot christening, Founding Pack chips §7.3) — earned in the neighborhood, not the browser. **Paradigm claimed:** the signature-move budget.

### Notion
**Exceptional:** calm surfaces, typography-led hierarchy, restraint as identity; a design system so coherent it became the category's default aesthetic.
**Falls short:** the calm can read as *blank* (empty-state anxiety); infinitely flexible tools push composition burden onto users.
**Trot differs:** we take the typographic calm and add *material warmth* (paper tones, pencil-&-wash, photography — §17.4/17.7/17.8) so minimal never feels empty (the philosophy's explicit demand); zero composition burden — Trot's surfaces are opinionated and finished. **Paradigm claimed:** warm minimalism — Notion's discipline on Airbnb's material palette.

### Spotify
**Exceptional:** Wrapped — the industry's best annual ritual (anticipation, identity, shareability); Blend's relational data products; design serving a daily habit without demanding attention.
**Falls short:** engagement-maximizing surfaces creep (autoplay, podcast pushiness); Wrapped's grammar is now widely cloned and increasingly loud.
**Trot differs:** Year in Review inherits Wrapped's anticipation cycle but tells a *shared life* story rather than a consumption profile (§18.11) — and its restraint (three numbers that mean something; silences by design) differentiates against Wrapped-clone fatigue. Blend's relational insight becomes Crossed Paths — relationship data generated by *reality*, not co-listening. **Paradigm claimed:** the biography ritual.

### Airbnb
**Exceptional:** photography as product infrastructure (standards that made listings trustworthy); place-pages with editorial dignity; trust design (reviews, verification) for real-world encounters between strangers.
**Falls short:** its lessons are transactional — trust for a booking, not a community; polish has drifted corporate.
**Trot differs:** we industrialize a photography direction the same way (dog-height grammar propagated through UGC hints, §17.8) but for belonging, not conversion; Spot pages take the place-page dignity and give it to *free public places* (§18.8); real-world trust design (§12.5's event rails) borrows the verification instinct without importing marketplace coldness. **Paradigm claimed:** place-pages for the commons.

### BeReal
**Exceptional:** proved small-graph, low-pressure, authenticity-framed sharing at scale; the constraint (one moment, imperfect) *was* the brand.
**Falls short:** the synchronous prompt is an interruption engine (the app demands; life obeys) — novelty decayed because the ritual served the product, not the person; no accumulation (moments evaporate culturally).
**Trot differs:** our authenticity anchor is the *walk itself* — reality scheduled by the dog, not by our push server (§5.9); imperfection is welcome (motion blur, rain — §17.8) but everything *accumulates* into the archive (§8.6), the exact asset BeReal never built. **Paradigm claimed:** asynchronous authenticity — real moments without the summons.

### Google Maps
**Exceptional:** authority through completeness; Live Busyness as normalized ambient intelligence; local-guide contribution at planetary scale.
**Falls short (for dogs):** the map serves commerce and navigation — POI clutter, ad pins, zero dog dimensions; contribution feels like unpaid labor for a giant (no belonging, thin reciprocity); busyness is a black box (no confidence, no "why").
**Trot differs:** Fieldmap inverts the visual hierarchy (parks hero, commerce whisper — §17.15); contribution is reciprocal and *visible* (impact receipts, Cartographer standing — §7.5/§11.7); Pulse shows its basis ("84 walks") where Google shows an unexplained bar (§18.9). **Paradigm claimed:** the honest map — confidence-as-opacity, community-owned.

## 19.2 The differentiation matrix (experience level)

| Experience | Best-in-class today | Their frame | Trot's frame | The re-derivation |
|---|---|---|---|---|
| Activity artifact | Strava | proof of effort | proof of companionship | route draw + sniff dots (§18.3) |
| Daily goal | Apple rings | close your rings | keep your rhythm | forgiveness built in (§11.4) |
| Social feed | Strava/IG | audience | neighbors | finite, mutual, dog-bylined (§18.7) |
| Serendipity | BeReal prompt | synchronized demand | retrospective discovery | Crossed Paths digest (§18.6) |
| Place intelligence | Google Maps | commerce graph | commons graph | Fieldmap + honest Pulse (§18.9) |
| Annual ritual | Spotify Wrapped | consumption identity | shared-life biography | Year thread (§18.11) |
| Status | Strava segments | fastest wins | most-present wins | The Regular podium (§18.8) |
| Membership feeling | Arc | product fandom | neighborhood founding | christening rituals (§18.8) |

## 19.3 Paradigms we claim (the design-moat register)

New interaction/experience paradigms this document establishes as Trot's own — each grounded in a category truth competitors would have to *become us* to copy:

1. **The Leash Rule** (§17.1) — one-hand, outdoor, glanceable ergonomics as a first-class design law, derived from the physical reality of the use case.
2. **Clay is motion** (§17.4) — a reserved color semantic meaning "a dog moved here," product-wide.
3. **The route draw** (§17.9/§18.3) — the walk re-performed as the reward ceremony; the signature interaction.
4. **Consistency-status** (§7.4/§18.8) — presence-based local recognition with dignity choreography, replacing leaderboards.
5. **Retrospective serendipity** (§7.1/§18.6) — social discovery without surveillance or synchronous demands; coarse by design.
6. **The honest map** (§17.15/§18.9) — confidence-as-opacity, basis captions, parks-first hierarchy, zero commercial clutter.
7. **The finite feed** (§7.2/§18.7) — a designed end, day-buckets, no ranked infinity; wellbeing as a measured product spec.
8. **Dog-height photography** (§17.8) — a UGC-propagating visual grammar that makes the corpus itself unlicensable.
9. **Dignity in degraded states** (§18.12) — invalid walks, declined permissions, memorials, and empty metros designed with the same care as celebrations.
10. **The forgiving streak** (§11.4) — Rest Notes and earned repair as the humane re-derivation of loss aversion.

Individually, each is copyable in a sprint. Together, enforced by the Fieldcraft tests (§17.1), audited quarterly (§17.20), and measured by the §14 counter-metrics, they compound into the thing the brief asked for: **a product whose design is the moat — inevitable-feeling, instantly attributable, and structurally difficult to replicate because it is the visible surface of the product's values, not a coat of paint over them.**

---

# §20 — Go-To-Market Playbook: Zero to 10,000 Engaged

The operating manual for Trot's growth team, from pre-launch to the first 10,000 highly engaged users. It operationalizes the PRD: the loops of §8 become programs with owners and calendars; the density playbook of §8.9 becomes a week-by-week runbook; Fieldcraft (§17) becomes the creative system; the §14 metric tree becomes the growth dashboard. Nothing here contradicts the PRD — where the PRD sets a law (P6: honest growth; §8.9: no national paid before density; §15.2: no reward referrals in v1), this playbook builds inside it.

**The core GTM thesis, stated once:** Trot does not launch to a market; it launches to *parks*. The unit of go-to-market is not a country, a demographic, or an app-store category — it is a single park's morning crew, won completely, then multiplied. Every deliverable below is in service of a repeatable ritual: **seed a park → make its regulars founders → let the artifacts recruit the periphery → flip the network when crossings are inevitable → graduate the metro → hand the playbook to the next one.** 10,000 engaged users is not a big number reached broadly; it is roughly 60 parks won deeply.

**Definition of done for this playbook's scope:** 10,000 users who are *engaged* by the PRD's definition — activated (first Valid Walk ≤24h), walking ≥3×/week (VWW/WAU ≥4), in metros where the network is visibly alive. Not 10,000 installs. Installs without local peers are pre-churned (§8.9.7); this document treats them as a cost, not an asset.

---

## 20.1 Phased GTM strategy

Six phases. Each states objective, rationale, execution, dependencies, KPIs, and the gate to the next phase. Timeline references assume product Q1 ("Worth Sharing") completes before Phase 3 and Q2 ("Bruno Has Friends") ships during Phase 4 — the GTM phases interleave with the §7.0 roadmap rather than following it.

**Australia-first (governing note for every phase):** Trot launches in Australia — Melbourne as metro #1, Sydney + Brisbane as the Phase-4 pair, then Perth/Adelaide/Canberra before the international tranche (§2.6). Why Australia leads: one of the world's highest dog-ownership rates (roughly half of households), a café-and-park culture already organized around dogs, council-designated off-leash areas that map one-to-one onto Spots, contained walkable inner suburbs (the §8.9 "neighborhood containment" criterion at its best), and a quiet-market advantage — the playbook is proven at home before it meets US competitor attention. Operating consequences, binding across this section:
1. **The seasonal calendar runs on southern-hemisphere seasons** — launch-year Autumn Sniffari lands in March–May, Summer Early-Bird and heat-safety content own December–February, and the December Year in Review doubles as a summer moment (§11.5's season-named events transfer cleanly; month references localize).
2. **Local hazards are a localization moat:** snake-season awareness (roughly September–March near bush and waterways) and magpie swooping season (September–November) become Sniff Map layers and content pillars no US-built competitor would think to ship — safety intelligence that makes the map's value unmistakably local.
3. **Councils replace parks departments** as the civic partner (§15.6/§16): off-leash designations, dog-registration channels, and bench-plaque/OOH permissions all run through local councils.
4. **Partner map:** RSPCA state branches, The Lost Dogs' Home, and local rescue groups anchor the Shelter Program (§20.10); Mad Paws is the local Rover-equivalent to track per §2.2; PETstock/Petbarn are later retail surfaces, not launch partners.
5. **Community channels skew local:** Facebook groups carry outsized weight in Australian dog communities; r/melbourne and r/AusDogs sit alongside the global subreddits (§20.4).
6. **Money and compliance:** planning budgets stay in USD per doc conventions (≈1.5× in A$); consumer pricing localizes via RevenueCat from day one (§15.1); Australian Privacy Act (APP) compliance is already covered by the GDPR-native posture (§12.3).

### Phase 0 — Pre-launch: "Earn the room" *(product Q1 in build; ~10 weeks)*

**Objective:** enter launch day already trusted by the communities that decide dog-app reputations, with a waitlist that is *geographically concentrated* rather than large.

**Rationale:** dog culture has gatekeepers — trainers, rescue orgs, reactive-dog forum moderators, park elders. Their endorsement is unbuyable and their skepticism is fatal (they have watched a decade of dog apps die, §2.2). Pre-launch is spent earning them, not teasing consumers. A national waitlist is explicitly *not* the goal: 5,000 scattered emails are worth less than 300 dog owners within walking distance of five Melbourne parks.

**Execution:**
1. **Pick metro #1** — **Melbourne** (the densest dog culture in an already dog-mad country: café norms that welcome dogs, council off-leash parks everywhere, contained inner-north/inner-west villages, media-friendly) — and its **five seed parks** (candidate set: Edinburgh Gardens, Princes Park, Royal Park, Yarra Bend, plus one dog-beach Spot such as Brighton) — confirmed by observed morning-crew density, not data we don't have yet. Founders walk them. Literally.
2. **The Listening Tour:** 50 conversations — trainers, reactive-dog group admins, shelter volunteer coordinators, park regulars. Not user interviews disguised as marketing; actual relationship-building with the people who will become Anchors (§20.9). Every conversation ends with "want to shape this before it exists?"
3. **The privacy covenant published early** (§12.1, as a public page) — in this category, the trust document *is* pre-launch marketing. Reactive-dog and safety-minded communities share privacy stances that respect them.
4. **Waitlist as neighborhood census:** signup asks one question beyond email — "which park do you walk?" The waitlist page shows, per park, how many neighbors are waiting ("23 dogs near Edinburgh Gardens are waiting"). Social proof (§5.12) and crossing-supply forecasting in one artifact.
5. **Begin the content engine** (§20.5) at low volume: the dog-height photo project and two "The Regulars" mini-documentary shoots banked for launch.
6. **Founding Pack kits produced** (§20.2): brass Park Card tags, founding certificates — physical, cheap, real.

**Dependencies:** privacy covenant final (§12.1); brand voice locked (§20.8); Anchor agreements drafted (§20.9); S-01→S-08 flow demo-able on TestFlight for gatekeeper conversations.

**KPIs:** 50 gatekeeper conversations held; ≥15 committed Anchors across 5 parks; waitlist ≥600 in metro #1 with ≥60% within 2km of a seed park; 2 rescue-org partnerships signed.

**Gate to Phase 1:** product Q1 feature-complete in TestFlight; ≥15 Anchors ready to walk on day one.

### Phase 1 — Closed beta: "The Founding Hundred" *(4–6 weeks, ~100–150 users)*

**Objective:** 100 users who feel like founders because they are; a product hardened by real walks; the first library of genuine artifacts (share cards, route art, stories).

**Rationale:** the first hundred users of a community product set its culture permanently. Recruit them by hand, treat them like co-founders, and their pride becomes the founding story every later cohort inherits. This is also the only phase where white-glove onboarding is possible — use it to learn what activation friction looks like *in person*.

**Execution:**
1. **Concierge founding:** every beta user onboarded in person or by video call — at the park where they walk. The team walks with them. (At 100 users this is ~25 person-hours/week. Do it.)
2. **The Founding Pack ceremony:** each founding dog receives the brass tag (engraved paw + QR — the physical Park Card, §8.2), a printed founding certificate with their dog's name in Trot Serif, and the permanent in-app Founding chip (§7.3's founder mechanic, applied to the metro itself).
3. **Private pack:** one WhatsApp/Discord space with founders + team; bugs fixed visibly fast; founders' feature suggestions publicly credited in release notes ("Sniff-stop counter — Maya & Biscuit's idea").
4. **Artifact harvesting (with consent):** the first hundred beautiful share cards, first Regulars, first stories — the raw material of every launch asset in §20.11.
5. Weekly "founders' walk" at rotating seed parks — the prototype of the Pack Walk program (§20.10).

**Dependencies:** Q1 product stable; walk-save SLO holding (§13.11 — a lost walk in beta costs a founder).

**KPIs:** ≥85% of betas activated (first Valid Walk ≤24h — above the ≥60% public target because onboarding is white-glove); VWW/WAU ≥5; ≥50% share a card at least once; qualitative: 10 unprompted "I told a friend" reports.

**Gate to Phase 2:** activation funnel instrumented and the top-3 friction points fixed; battery budget verified in the field (§13.6); founders retention D28 ≥80%.

### Phase 2 — Early access: "Fill the five parks" *(6–8 weeks, → ~1,000 users)*

**Objective:** saturate the seed parks — make Trot *ambient* at five physical locations, so that a non-user at those parks encounters it weekly without any ad.

**Rationale:** the density thesis (§8.8) says the product's magic moment (Crossed Paths) needs neighborhood-level supply. Before flipping social features, the five parks must reach the crossing threshold. Early access is invite-gated *by geography*: the waitlist opens park-by-park, in visible cohorts, which converts scarcity into neighborhood momentum without fake-scarcity theater (P6).

**Execution:**
1. **Park-by-park waitlist opening:** "Edinburgh Gardens is open." Each park's opening is an event — founders' pack walk + open invitation, local dog businesses (café, groomer) hosting water bowls. The opening *is* the marketing.
2. **Anchor programming begins** (§20.9): trainers run "sniffari walks," the shelter partnership logs volunteer walks, the photographer Anchor shoots the dog-height series at each park.
3. **Brass-tag flywheel:** every founding dog wearing the Park Card tag is a walking QR code; park conversations ("what's that tag?") are the top acquisition channel this phase — measured (each tag's QR is unique).
4. **Local press, one story only:** the founding-hundred human-interest story (not a product launch story) offered to one local outlet per metro. "A hundred Melbourne dogs became founders of something" is a story; "startup launches app" is not.
5. **Crossed Paths flips on** (Q2 feature, metro-gated per §7.1) the week modeling says median seed-park users will hit ≥1 crossing/week — the moment early access earns its payoff and word-of-mouth language changes from "pretty walk tracker" to "it knows who Bruno keeps meeting."

**Dependencies:** Q2 social features ready behind the metro flag; crossing-supply model live on the metro dashboard (§14.8).

**KPIs:** 1,000 users with ≥70% within 2km of a seed park; ≥25% of seed-park WAU experiencing ≥1 crossing/week by phase end; tag-QR scans ≥150/month; organic (non-invited) signups ≥30% of weekly adds by phase end.

**Gate to Phase 3:** two of five parks at crossing threshold; share→install loop measurably working (≥3% of share-link views install, §14.4).

### Phase 3 — Public metro launch: "Melbourne belongs to the dogs" *(one quarter, → ~4,000 users in metro #1)*

**Objective:** take metro #1 from five parks to city-wide network liveliness; run the first flagship campaign; prove the full loop portfolio in one contained market.

**Rationale:** this is the dress rehearsal for every future city. Everything must be measured well enough to write the **Metro Playbook** — the document Phase 4 clones. Going loud in one city (and quiet everywhere else) concentrates word-of-mouth where it can compound and keeps the national narrative in reserve.

**Execution:**
1. **Open the metro** (no invite gate within Melbourne) with the flagship launch campaign — **The Slowest Walk in Australia** (§20.11.1), the city-scale event that turns the product philosophy into a story.
2. **Spot founding wave:** the christening mechanic (§7.3) opens city-wide; every park's founding ceremony is a micro-event with its own founders and its own local pride.
3. **Full loop portfolio live:** share cards (8.1), Park Card invites (8.2), pack walks (8.5), creator content (8.7), the Sniff Map contribution drive ("Map Melbourne for dogs" — §20.10).
4. **Metro-scoped paid begins** — small, per §20.7: geofenced Meta/TikTok with harvested artifacts as creative, ASA brand capture. Paid amplifies proven organics; it never leads.
5. **Measurement obsession:** every initiative tagged; the Metro Playbook drafted in real time (what moved crossing %, what didn't).

**Dependencies:** T&S staffed for open registration (§12.9); store listings final (§20.8); support runbook.

**KPIs:** 4,000 metro users; metro crossing % ≥25% and climbing; ≥40 active Spots; ≥8 Anchors producing monthly; blended CAC <$2 (organic-dominant); D30 ≥35%.

**Gate to Phase 4:** Melbourne hits **metro graduation** (30% × 4 weeks, §8.8) or is credibly on path; Metro Playbook v1 written and costed.

### Phase 4 — City-by-city expansion: "The next eleven" *(quarters 2–4 of launch year, → 10,000+)*

**Objective:** run the Metro Playbook in metros #2 and #3 simultaneously (e.g., Sydney + Brisbane), each cheaper and faster than Melbourne; reach 10,000 engaged users across three metros.

**Rationale:** the expansion test is not "can we grow?" but "does the playbook transfer without the founders' personal presence?" Two metros at once forces the playbook to be a system (kits, checklists, local hires) rather than heroics.

**Execution:**
1. **Metro Launch Kit:** the productized Phase 0–3 — seed-park selection checklist, Anchor recruitment scripts and agreements, Founding Pack kit (tags, certificates), park-opening event runbook, local-press template, dashboard template.
2. **One Metro Lead per city** (contract/part-time acceptable): a connected local dog person — often a graduated Anchor — not a marketer. Their job: 50 conversations, 15 Anchors, 5 parks. The §13.15 growth/metro-ops headcount.
3. **Cross-metro rituals begin:** the first multi-city seasonal challenge (§7.8.7) — "Autumn Sniffari" — creating national community texture while acquisition stays local.
4. Melbourne becomes the **flagship community** (events, first sponsored-challenge pilot per §15.3) proving the community can host commerce without corroding.

**Dependencies:** Metro Playbook v1; Q3 product (Spots, Sniff Map, Pulse, events) live; hiring/contracting pipeline for Metro Leads.

**KPIs:** metros #2–3 hit 1,000 users in ≤60% of Melbourne's time; per-metro CAC declining; **10,000 total engaged users** (activation ≥60%, VWW/WAU ≥4, D30 ≥35% blended); ≥2 metros graduated.

**Gate to Phase 5:** two consecutive metro launches on-playbook without founder heroics.

### Phase 5 — Scale posture: "From playbook to machine" *(beyond 10k; sets up Year 2)*

**Objective:** transition from hand-run city launches to a repeatable expansion machine (tranches of 3–4 metros/quarter), open the international beachhead (UK), and let the compounding loops (content/SEO §8.3, data §8.4) take over an increasing share of acquisition.

**Execution summary:** metro tranches per §2.6's list; Year-in-Review as the first national-scale moment (December, §7.8.8); SEO harvest begins (Spot/trail pages indexed since Phase 2); creator program formalized into the Pack Leader ambassador structure (§20.10); first UK metro (London) validates the kit internationally. Full Year-2 scaling is §16's territory; this playbook's job ends with the machine proven.

**KPIs:** each new tranche cheaper per engaged user than the last; organic share of acquisition rising (target ≥75%); the §14.4 loop portfolio metrics all green in graduated metros.

---

## 20.2 User acquisition roadmap: 100 → 10,000

Each milestone: channels, activation, conversion, retention, referral, and the numbers that define success. The through-line: **channels change, the artifact doesn't** — at every scale, the thing doing the acquiring is a beautiful walk artifact or a real-world encounter, never an interruption.

### First 100 — recruited by hand *(Phase 1)*

- **Channels:** founder outreach at the five seed parks (the clipboard era — actually talking to people with dogs); Anchor invitations (each Anchor brings 3–5 owners they know); the two rescue-org partnerships (staff + volunteers).
- **Activation:** concierge onboarding at the park; first walk recorded *together*; goal 85%+.
- **Conversion (to habit):** the founders' WhatsApp; visible bug-fix velocity; feature credits.
- **Retention:** weekly founders' walk; the founding identity itself (chips, tags, certificates — people don't churn from things they founded).
- **Referral:** none formal. The brass tag and the share card exist; watch what happens naturally (baseline measurement for P6's honesty test).
- **Success:** 100–150 users, ≥85% activated, D28 ≥80%, ≥50 shared artifacts harvested, 10+ unprompted referral anecdotes.

### First 500 — the parks fill *(Phase 2, weeks 1–4)*

- **Channels:** park-opening events (each adds 50–100); tag-QR scans; founders' shares; waitlist release per park.
- **Activation:** self-serve onboarding now carries the load — watch the funnel daily against the ≥60% target; the S-05 permission screen is the first bottleneck to A/B (§20.12 experiments E-11..E-15).
- **Conversion:** first-week rhythm nudge (§9's T2, gently); "your park's founders" shown at signup (social proof, §5.12).
- **Retention:** park identity — new users see their park's Spot page already alive with founders' history (the §7.3 seed value).
- **Referral:** Park Card QR exchange soft-launched (it's just the tag + profile link); household invites (§7.9.1 arrives with Q2).
- **Success:** 500 users, ≥65% activated, ≥60% within 2km of a seed park, tag scans ≥25/week.

### First 1,000 — the network flips on *(Phase 2, weeks 5–8)*

- **Channels:** Crossed Paths flip = the word-of-mouth phase change (the product's most tellable story starts happening to people); local human-interest press piece; Anchor content (trainers' sniffari walks).
- **Activation:** unchanged mechanics, but the first crossing becomes part of activation definition internally ("activated-plus": first walk + first crossing ≤14 days).
- **Conversion:** crossing digest → mate request → feed value (the §7.1→§7.2 chain; watch accept rates ≥60%).
- **Retention:** the feed exists now; caught-up ritual forms; first Regulars awarded at seed parks (retention's strongest feature, §7.4).
- **Referral:** "Bruno crossed paths with a dog who isn't on Trot yet" — the *ghost crossing* prompt (E-42, one of this playbook's signature mechanics): when a user meets an untracked dog repeatedly IRL, the Park Card is the natural gift. Never automated, only enabled.
- **Success:** 1,000 users; ≥25% of seed-park WAU with ≥1 crossing/week; organic ≥30% of weekly adds; D30 ≥35%.

### First 5,000 — one loud city *(Phase 3)*

- **Channels:** The Slowest Walk campaign (§20.11.1) — the single biggest spike of the year; city-wide Spot founding wave; metro-scoped paid (small) amplifying harvested creative; creator loop output (The Regulars films, dog-height series); Reddit/community presence matured (§20.4).
- **Activation:** campaign traffic is colder — expect ≥55%; the landing → install → first-walk path gets its own funnel review; "walk one week with us" framing (not "sign up").
- **Conversion:** seasonal challenge #1 as the fresh-cohort commitment device (§5.8).
- **Retention:** Spots + Regulars city-wide; monthly recap cadence begins mattering at scale; Quiet Hours cohort tracked separately (the wedge's D30 should *lead* all cohorts — if it doesn't, the wedge promise is broken somewhere).
- **Referral:** Park Cards at scale (every campaign event distributes tags); household packs; pack-walk plus-ones.
- **Success:** 5,000 total; Melbourne ≥4,000; crossing % ≥25%; blended CAC <$2; share→install ≥3%.

### First 10,000 — the playbook transfers *(Phase 4)*

- **Channels:** metros #2–3 run the kit (their own founding hundreds, park openings, campaigns); Melbourne compounding (SEO pages begin returning; YiR in December if timing aligns); first cross-metro challenge.
- **Activation/conversion/retention:** the machine from above, now with playbook targets per metro and a weekly cross-metro review (§20.13).
- **Referral:** the mechanics are now product-native (Park Cards, ghost crossings, household, events); GTM's referral job shifts to *supply* — putting tags and moments where exchanges happen.
- **Success:** 10,000 engaged (per definition above) across 3 metros; ≥2 graduated; metro #3 launch cost ≤60% of Melbourne's; organic share ≥70%.

**What we deliberately do NOT do at any milestone:** national paid, install-farming, incentivized referrals, press tours before density, influencer CPM buys, cross-promo networks, ASO keyword-stuffing. Every one of these manufactures the §8.9.7 anti-pattern: users without local peers, pre-churned, poisoning cohort data.

---

## 20.3 The organic growth engine (loops as an operating system)

The PRD (§8) defines nine loops; GTM's job is to *staff, fuel, and sequence* them. This section assigns each loop an owner, a fuel source, a weekly operating action, and shows how the loops feed each other. The engine's design goal: by 10,000 users, ≥70% of new engaged users arrive through a loop rather than a campaign.

| Loop (§8 ref) | GTM owner | Fuel (what the team supplies weekly) | The compounding hand-off |
|---|---|---|---|
| **Sharing** (8.1) | Design + growth | Template art refreshes; milestone-moment QA; seasonal card drops | Shares recruit periphery → new walkers → more artifacts |
| **Invitation** (8.2) | Community | Brass-tag supply at events; Park Card moments engineered into every gathering | Each accepted invite improves two feeds → both invite again |
| **Content** (8.3) | Content lead | Spot/trail pages polished for indexing; local search terms mapped per metro | Community data creates pages → pages recruit → recruits create data |
| **Data** (8.4) | Product marketing | "Map your city" contribution drives; impact-receipt storytelling | Better map → "it knows which fountains work" word-of-mouth → more mappers |
| **Community** (8.5) | Community | Pack-walk kits; event calendar; organizer support | Events are visible in parks → bystanders join → bigger events |
| **Retention/archive** (8.6) | Lifecycle | Recap quality; Memories moments; YiR production | Deeper archives → longer lives → more of every other loop |
| **Creator** (8.7) | Partnerships | Anchor onboarding; usage receipts; tooling feedback fast-lane | Creator inventory (trails, films, photos) → consumers → receipts → more creation |
| **Local network** (8.8) | Metro leads | Seed-park saturation; crossing-supply monitoring; flip timing | The master loop all others feed |
| **Advocacy** (new, GTM-owned) | Founder + community | Founding ceremonies; feature credits; wedge-community service (Quiet Hours) | People defend and evangelize what they co-built — advocacy is founding, industrialized |

**How they interlock (the flywheel in words):** a *founder* (advocacy) brings her park's *regulars* (invitation); their walks produce *artifacts* (sharing) and *map data* (data); an *Anchor trainer* runs a pack walk (community + creator) that a bystander joins after scanning a *brass tag* (invitation); six weeks later the bystander's dog crosses paths with the founder's dog (local network) and the story gets told at a dinner party (advocacy). One physical park, seven loops, zero ads.

**Loop health review:** every Monday, the §14.4 loop metrics per metro, with one rule — a loop below target for 3 consecutive weeks gets a dedicated experiment sprint (§20.12) before any new initiative launches. Loops are maintained like infrastructure, not admired like slideware.

---

## 20.4 Social media strategy

**Global doctrine before platform detail:**
1. **The account is the dogs', not the brand's.** Trot's social presence reads like the world's best-kept neighborhood dog journal — real dogs, real parks, real crossings — never like a SaaS brand doing dog content.
2. **The signature formats are proprietary:** the *route draw* (§17.9), *dog-height POV* (§17.8), and *crossing stories* are formats competitors can't post without looking like copies.
3. **UGC-first ratio:** ≥60% of published content originates from users/Anchors (with consent and credit); the feed's job is to make members famous in their neighborhood, not to make the brand famous.
4. **Geography-honest:** while only Melbourne is live, the content says so proudly ("Melbourne first. Your city's turn is coming.") — scarcity as honesty, not gimmick.

| Platform | Audience & role | Content pillars | Cadence | Engagement & growth mechanics | Conversion path | KPIs |
|---|---|---|---|---|---|---|
| **Instagram** (primary) | Dog owners 25–45; the brand's living portfolio | Route-art + dog portrait pairs; Crossed Paths stories; The Regulars podium features; dog-height photo series; recap-season waves | 4–5 feed/wk, daily stories during campaigns | Story-first (share cards are natively story-shaped); "your dog could be next" tagging norms; park-account collabs; carousel = one dog's story arc | Bio link → metro-aware landing (waitlist or store); story link stickers on features | Saves & shares (not likes); story share-rate of user cards; profile→install |
| **TikTok** | Younger + broader dog-internet; discovery engine | Sniffari POV (dog-height gimbal walks); route-draw ASMR; "the 6am crew" mini-docs; crossing-reveal storytimes; Slowest Walk content | 3–4/wk; batch-produced | Sounds built from walk ambience; duet-able formats ("show us your dog's route"); Anchor trainers' educational sniff content | Comment-pinned link; bio; TikTok drives awareness > installs — measured accordingly | Completion rate; creates-using-our-sound; follows/1k views |
| **YouTube Shorts (+ long)** | Searchers + documentary audience | Shorts: best of TikTok/IG. Long: **The Regulars** (3-min park-elder documentaries, §20.6); Quiet Hours mini-doc; annual YiR film | Shorts 3/wk; 1 long/mo | Long-form is the trust asset gatekeepers share in forums; Shorts feed the algorithm between | Description links; end-cards to metro pages | Long-form avg view duration; embeds in dog forums |
| **X (Twitter)** | Dog-internet culture + tech/press | Brand-voice quips (dog-voiced); build-in-public threads from founder; crossing-story screenshots (with consent); privacy-stance statements | 3–5/wk, reactive | The privacy covenant threads earn the security/tech audience; founder replies personally | Low direct conversion; narrative + press channel | Quality reposts; press/partner inbound |
| **LinkedIn** | Partners, hires, investors, city/parks officials | Founder narrative (why dogs, why privacy-first); metro-launch recaps with real numbers; hiring posts written in brand voice; parks-department case notes (Y1 end) | 1–2/wk | Comments from team > company posts; Metro Lead spotlights | Careers + partnership inbound | Qualified inbound (candidates, venues, parks depts) |
| **Reddit** | The gatekeeper layer: r/dogs, r/reactivedogs, r/puppy101, r/AusDogs, city subs (r/melbourne first) | **Participation, not promotion.** Team + Anchors answer genuinely (flair-disclosed); Quiet Hours built *with* r/reactivedogs feedback publicly; city-sub presence only around real local events | Ongoing presence; zero scheduled promo | Hard rules: disclose affiliation always; never astroturf; contribute 10× more than we mention Trot; AMAs at metro launches | Organic mentions by others (the only kind that works on Reddit) | Unprompted mention rate; sentiment; mod relationships |
| **Threads** | IG-adjacent conversational | Repurposed X voice content + community questions ("what's your park's unofficial name?") — the answers seed Spot-naming culture | 2–3/wk | Low-effort mirror; harvest conversation prompts for product copy | Bio | Reply quality; prompt→product-insight rate |
| **Pinterest** | Planners: routes, puppy prep, senior-dog care | Trail-guide pins (Trail Tails as boards); "dog-friendly [city]" maps; puppy socialization checklists; senior-dog route guides | Batch: 10–15 pins/mo | SEO-adjacent: pins rank for "dog friendly trails [city]" — feeds the §8.3 content loop | Pin → trail/Spot web page → install | Outbound clicks to trail pages; long-tail search impressions |

**Team reality check (startup-executable):** one content lead + one editor/designer + Anchor UGC covers this. IG/TikTok are daily craft; YouTube long-form is monthly; X/LinkedIn are founder-voice; Reddit is a rotation everyone shares; Threads/Pinterest are batched repurposing. Anything that can't be sustained at this staffing gets cut before quality does.

---

## 20.5 Content strategy (the editorial framework)

**Editorial thesis:** Trot's content is a *local paper for dogs* — genuinely useful neighborhood intelligence and genuinely moving neighborhood stories, produced with the product's data and community. It is never "content marketing about a dog app."

**The twelve pillars, organized into three jobs:**

**Job 1 — Be useful (earns search, saves, and gatekeeper respect):**
- **Local discoveries:** "Where's shaded after 10am in Edinburgh Gardens" — Sniff Map data as editorial; the content loop's (§8.3) human-readable face.
- **Dog health & enrichment insights** (carefully fenced per §10 rule 2 — enrichment/behavior, never medicine): "Why the sniff is the point," heat-safety walk timing, puppy five-minute-rule explainers — co-bylined with Anchor trainers/vets for credibility.
- **Product education:** feature stories told through a real dog's use ("How Luna's owner reads the quiet map"), never tutorial voice.

**Job 2 — Make people feel (earns shares and memory):**
- **Emotional storytelling:** Crossed Paths serendipity stories; senior-dog biographies; gotcha-day arcs; the memorial-done-right stories (rare, handled with §12.7's gravity, only ever user-initiated).
- **User stories & community highlights:** The Regulars features; founder-dog profiles; "the 7am crew of [park]" group portraits.
- **Humor:** dog-logic voice ("Bruno's route today was determined entirely by a squirrel in a hat"); the Slowest Walk's comedy of anti-fitness; never memes-for-memes.

**Job 3 — Build the world (earns identity and belonging):**
- **Behind-the-scenes & founder narrative:** why privacy-first, why sniff stops count, build-in-public metro diaries ("what we learned opening Edinburgh Gardens").
- **Seasonal campaigns:** Autumn Sniffari, Winter Dawn Patrol, Rain Walk Club content waves aligned to §11.5's calendar.
- **Trend participation rule:** join a trend only when the dog-height/route-art treatment makes it *ours* within 24h; otherwise skip — trend-chasing off-brand is negative equity (§17.1 P7).

**Production system:** a two-week editorial sprint cycle; every piece tagged to pillar + loop it feeds + metro; one **hero piece** per month (Regulars film, quiet-map release, data story like "Melbourne's dogs walked 40,000 km this spring — here's the heatmap" built on k-anonymous aggregates §12.5). Evergreen>topical 70/30. Every hero piece must answer: *who shares this, to whom, and why do they look good doing it?*

---

## 20.6 Creative direction (the campaign-facing creative system)

Fieldcraft (§17) governs everything; this section extends it to marketing surfaces. **The creative rule: every asset must be mistakable for something a proud member made, not something a brand bought.** Concept · visual · message · emotional objective · desired action, per asset class:

- **Static ads:** a single real share card (route-art + dog portrait + serif name) on paper ground, one line of copy beneath. Visual: indistinguishable from the product's own artifact (that's the point — the ad *is* the product experience). Message: "Every walk counts." Emotion: recognition ("that could be my dog"). Action: metro landing page.
- **Motion ads (15s):** the route draw, full-screen — a walk re-performing itself in Clay, sniff-dots ticking, ending on the dog's card. No VO, ambient park sound. Emotion: quiet awe. Action: install.
- **Reels/short-form:** dog-height POV walking formats; crossing-reveal narratives ("we kept seeing this collie…"); Regulars micro-docs. Emotion: warmth + small-world delight. Action: follow → metro page.
- **Story ads:** vertical share-card stack with the "typical Tuesday" framing (three cards = three walks = one week's rhythm). Action: swipe-up to the park's Spot page (live proof, not promises).
- **Carousels:** one dog's arc (puppy's first month of walks; a senior's year) told in 6 cards ending on the odometer stat. Emotion: the biography effect (§5.15). Action: "start your dog's record."
- **Launch film (one, 90s, for metro #1):** *"The Slowest Walk"* — a film about everything a dog notices in 400 meters, shot at dog height, ending: "Strava counts your pace. We count what he noticed. Trot — every walk counts." Emotion: the category inversion, felt. Action: cultural — this is the share asset for launch week.
- **UGC templates:** in-app share templates ARE the UGC system (§7.8.3); marketing adds seasonal template drops and the campaign frames (Slowest Walk bib numbers, founding certificates) — always tools for members' pride, never brand billboards with user photos.
- **Walk cards:** covered in §17/§18.3 — restated here as marketing's most important asset: template art direction gets a named owner and a seasonal release calendar, treated like a product surface because it is one.
- **Out-of-home (metro-scoped, cheap):** **The Bench Plaques** — small brass-style plaques on park benches: "Reserved for the 6:45 crew. Every walk counts. — Trot" with a QR to that park's live Spot page. A dozen benches per metro, permission-secured, photographed constantly by passers-by. Companion: fountain tags ("This fountain works. 47 dogs confirmed it. — the Sniff Map").
- **Guerrilla:** chalk paw-trails from park gates to the notable sniff spots on launch weekends ("what's this trail?"); "Missing: one hour of your dog's day" posters that resolve into the sniffari message; lamppost "quiet hours" cards at reactive-friendly times (co-designed with the r/reactivedogs Anchors so it lands as service, not stunt).
- **Interactive:** the **public quiet-map microsite** per metro (§20.11.3) — the community's data as a gift to all dog owners, installed or not.

---

## 20.7 Ad strategy (paid as amplifier, never engine)

**Posture:** per §8.9, paid never leads and never runs nationally pre-density. Budget through 10k users: **$15–25k total** — deliberately small; its job is (a) amplifying proven organic creative inside live metros, (b) brand-term protection, (c) learning what cold audiences respond to before Year-2 scale.

- **Structure:** one account per platform, campaigns per metro (never national), ad sets per persona-message pair (from the §2.3 message architecture: new-owner "beautiful record" / reactive "quiet parks" / social-sharer "worth posting"). Creative = harvested artifacts + the motion route-draw. Geofence: metro polygons, 5km park radii for the sharpest sets.
- **Meta (primary tester):** Advantage+ off; manual placements story/reel-first; 3 creatives × 3 messages × 2 personas rotating weekly; kill rule: below-median CPI *and* below-median activation after $150 spend.
- **TikTok:** spark-ads on our own top organics only (paid pushes proven content, buys no new content); metro-geofenced.
- **Apple Search Ads:** brand terms + "dog walk tracker" exact-match; the cheapest high-intent capture; always-on at low caps. Discovery campaigns off until Year 2.
- **Google (UAC/search):** search brand-protection only through 10k; UAC deferred (its install quality is unverifiable against our peer-density requirement).
- **Reddit ads:** none. Reddit is a participation channel (§20.4); ads there would spend the credibility the participation earns.
- **YouTube:** the launch film promoted once per metro launch ($500–1k) to metro geography — a story, boosted, not an ad campaign.
- **Measurement & optimization:** optimize to *activated user* (first Valid Walk), never install — SKAdNetwork conversion values encode activation; weekly creative review against activation-CPA; **the guardrail metric: paid-cohort D30 must be ≥80% of organic-cohort D30**, else paid is off in that metro (buying pre-churned users is worse than buying nothing).
- **Remarketing:** minimal and respectful — one flow: metro-landing visitors who didn't install see the route-draw motion ad ≤2×/week for 2 weeks; no cart-abandon-style pressure; no owned-audience retargeting of lapsed users via ads (lapsed users belong to lifecycle §20.8, not to ad platforms).
- **Experimentation roadmap:** Phase 3: creative-message fit per persona; Phase 4: landing variants (park-specific vs metro), ASA term expansion, lookalike-of-activated tests; Year 2 (out of scope here): scaled UAC/discovery with the activation-quality guardrails proven.

---

## 20.8 Copywriting framework

**Voice definition (binding, extends §9.5 product-wide):** Trot writes like *a neighbor who really knows dogs* — plainspoken, specific, warm, lightly funny, never hype. Four voice laws: (1) the dog is the subject of sentences wherever possible; (2) specifics beat superlatives ("47 dogs confirmed this fountain" > "the best dog map"); (3) no urgency theater, no exclamation-point enthusiasm, no fitness-bro energy; (4) every claim is one a founder could defend at a dog park.

**The messaging house:**
- **Roof (master promise):** *Every walk counts.*
- **Pillars:** (1) *The most beautiful record of your dog's walks* — identity/archive; (2) *Your neighborhood, mapped for dogs* — the commons; (3) *The dogs you keep meeting* — the network; (4) *Private by architecture* — trust.
- **Persona doors** (from §2.3): Biscuit → "proof you're doing right by them"; Ranger → "the record his walks deserve"; Luna → "finally know when the park is quiet"; Duke → "every walk he has left, kept."

**Funnel copy, with canonical examples:**
- **Headlines (testing pool):** "Every walk counts." / "Your dog's life, one walk at a time." / "The walk is the best part of their day. Keep it." / "Know when the park is quiet." / "Bruno keeps meeting Luna. Now he knows her name."
- **Ad copy (statics):** one line under the artifact: "Tuesday, 2.4 km, 14 great smells. — Bruno's walk, kept forever." CTA: "Start Bruno's record."
- **Landing pages (metro-aware):** hero = live local proof ("412 dogs are walking Edinburgh Gardens on Trot"), the covenant strip ("Your exact route never leaves your phone"), three artifact examples, one CTA. Park-specific variants for QR/bench traffic.
- **App Store listing:** Title: "Trot — Dog Walk Tracker & Map." Subtitle: "Every walk counts." First paragraph: "Trot turns your dog's daily walks into a beautiful record — the routes, the sniff stops, the dogs you keep meeting, and the neighborhood map that makes every walk better. Built privacy-first: your exact route never leaves your phone." Keyword field: dog walk, walking, tracker, puppy, routes, dog parks, pet. Screenshots: summary-with-route-draw, Dog Card, quiet-hours map, crossing card, recap — each captioned in voice.
- **Push notifications:** governed entirely by §9.5's table — GTM adds zero push inventory (marketing never gets the push channel; that rule protects everything).
- **Email (the 6-touch lifecycle, weekly max):** (1) welcome = the covenant + one job ("take one walk"); (2) day-3 = your first route art, exportable; (3) week-2 = "the rhythm" (self-set goal nudge); (4) month-1 = first recap preview; (5) event-driven: first crossing congratulations; (6) Sunday digest opt-in. Lapsed flow: exactly two emails — "Bruno's record is safe whenever you're ready" (30d) and the annual YiR invite; no guilt sequence, ever (§5.5).
- **Referral messaging:** the Park Card frame — "Give them Bruno's card" (dog-first, gift-framed, per P6 no incentives): "Luna's human should see this. Here's Bruno's card — Trot is where the park's dogs keep their walks."
- **Social captions:** dog-voiced observational ("Route determined entirely by a suspicious leaf. 41 minutes. No regrets. — Peanut"); credit lines always name the dog then the human.
- **CTA library:** "Start the record" / "Walk one week with us" / "See who Bruno's been meeting" / "Find your quiet hour" / "Keep this walk" — never "Sign up free!!" energy.

---

## 20.9 Creator strategy: the Anchor Program

**Philosophy:** Trot does not buy audiences; it deputizes the people dogs already trust. An **Anchor** is a local dog-world figure with earned credibility whose work becomes *better with Trot in it* — and who therefore stays for the community, not the invoice. No CPM buys before density; no one-off promos ever.

**The seven Anchor archetypes and their deal:**

| Archetype | What they bring | What they get (never cash-first) |
|---|---|---|
| **Dog trainers** | Credibility + programming (sniffari walks, reactive workshops) | Client-facing tools (share enriched walk summaries with clients), event kits, co-bylined content, early features |
| **Veterinarians** | Trust ceiling; enrichment-content review | Content co-authorship (reviewed-by credibility both ways), waiting-room Spot-map posters; *never* health-claim entanglement (§10 rule 2) |
| **Shelters & rescues** | The gotcha-day pipeline + moral authority | The Shelter Program (§20.10): volunteer-walk logging, adoption-kit tags, "walks that help" visibility; donations from charity rail (§11.6) |
| **Photographers** | The dog-height corpus (§17.8) | Paid commissions (the exception: craft is paid), gallery credit, the Dogs of [City] exhibit platform |
| **Pet cafés & dog-friendly venues** | Physical space + foot traffic | Verified Sniff Map presence (§15.4's free tier), pack-walk endpoint status, water-bowl kit |
| **Breed clubs & community groups** | Pre-formed communities | Breed Lounge founding rights (§7.9.3), club challenge tooling, event support |
| **Micro-creators (1k–20k, dog-first accounts)** | Authentic reach in the exact neighborhoods | Founding access, their dog's story produced properly (The Regulars treatment), template early-drops; small stipends only for defined work products |

**Program mechanics:** 15 Anchors per metro (the Phase 0 KPI); a named partnerships owner; quarterly Anchor council (their feedback gets the founders'-WhatsApp treatment); public usage receipts ("412 dogs walked trails you authored") as the creator loop's fuel (§8.7); graduation path → **Pack Leader** (paid metro ambassador, the §13.15 metro-ops seat) for the standouts. **Exit honesty:** Anchors can leave anytime with their content and their community standing intact — the program's retention is its value, not its contract.

---

## 20.10 Community strategy

Community is the moat's human layer and this playbook's center of gravity. Programs, each with owner + cadence + KPI:

1. **Pack Walks (the atomic ritual):** weekly, per seed park, organizer-kitted (route via Trail Tails, water, tags, the F5 recap loop §6.3). Grows from founders' walks (Phase 1) to community-run (Phase 3+, organizer = Regulars and Anchors). KPI: walks/metro/week; attendee→mate conversion (§14.4).
2. **The Founding system:** every park's christening ceremony (§7.3), founding chips, certificates — earliness converted to permanent status (§5.12). KPI: founding-flow acceptance ≥40%.
3. **City challenges:** the seasonal calendar (§11.5) run as *community property* — challenge kickoff = simultaneous pack walks across the metro's parks. KPI: participation ≥30% WAU.
4. **The Shelter Program ("Walks that help"):** volunteers log shelter-dog walks (special account class); shelters get walk-history pages that help adoptions ("Rex loves the canal route — 3km, mostly sniffing"); adopters leave with the dog's *existing* Trot record — the most emotionally loaded onboarding imaginable, and the program that makes the brand's values undeniable. KPI: shelters live/metro; adoption-continuation rate.
5. **Quiet Hours community:** co-built with reactive-dog Anchors; quiet pack walks (small, structured, trainer-led); the public quiet-map gift (§20.11.3). This community is *served first and marketed to never* — their advocacy (§4.5) follows from that order. KPI: Quiet Hours cohort D30 leading all cohorts.
6. **Pack Leaders (ambassadors):** one per metro post-graduation — paid part-time, community-sourced (Anchor graduates), owning the event calendar and welcome culture. KPI: metro event cadence sustained without HQ.
7. **Online spaces:** deliberately minimal — the product's feeds and packs are the forum (§7.9); one Discord for founders/Anchors/organizers (operational, not a destination). No general community forum to moderate before T&S scale allows (§12.5's structural-prevention logic applied to GTM).
8. **Recognition system:** product-native (Regular §7.4, Cartographer §11.7, founding chips) + GTM's additions: the annual **Good Neighbor** award per metro (community-nominated, human-judged, physical brass plaque on their park's bench — tying back to the OOH system). KPI: recognition reach (% of metro community holding any recognition ≥25%).

---

## 20.11 Flagship launch campaigns

Four concepts, each a story first. Budgets are deliberately small; the currency is cleverness and truth.

### 20.11.1 "The Slowest Walk in Australia" *(metro #1 public launch)*
**Narrative:** every fitness event celebrates speed; dogs think that's insane. Trot hosts a 1-kilometer walk with no time limit where the *most thorough* dog wins — most sniff stops, best route deviation, judges' award for "most interested in one specific bush." The anti-marathon: bibs, a finish line, medals ("Finisher: eventually"), and a world's-slowest-average-pace record attempt.
**Execution:** one Saturday, flagship park; bib = share-card template with the dog's sniff count; Anchors judge; shelter dogs walk with volunteers (adoptable, bib'd "Free Agent"); local café partner at the finish. Film crew shoots the launch film's b-roll live.
**Sequence:** 3 weeks teaser (founders + Anchors invite) → event → 1 week of recap wave (every participant's card auto-generated) → film release.
**Assets:** bibs, medals, route chalk, the film, participant cards, press kit ("Melbourne hosted the world's slowest race on purpose").
**Expected outcomes:** 300–500 dogs; the year's biggest install spike; regional press without buying it; the brand position (P2) performed in public.
**Measurement:** event installs (unique QR per bib batch); participant D30 vs baseline; earned-media reach; sniff stops recorded (the number the press quotes).

### 20.11.2 "The Founding Hundred" *(closed beta, ongoing per metro)*
**Narrative:** the first hundred dogs of every city are founders, permanently — named, photographed at dog height, brass-tagged, on a public founders' wall (web) and, where a partner venue allows, a physical print wall at the flagship café.
**Execution/sequence/assets:** as §20.1 Phase 1; the campaign *is* the program.
**Outcomes:** culture-setting, artifact library, the origin story every city launch retells. **Measurement:** founder D28 ≥80%; founder referral anecdotes; press pickup of the wall.

### 20.11.3 "The Quiet Map" *(the wedge gift; pre-public-launch)*
**Narrative:** for the owners who walk at 5:45am to avoid everyone — a beautiful, free, public map of each metro's quiet windows (built from Pulse aggregates + Anchor knowledge), published as a microsite and a printable PDF, *usable without installing anything*. The product's most vulnerable audience gets the most generous artifact.
**Execution:** co-created with r/reactivedogs Anchors; released in the subreddit and reactive-dog groups by the Anchors themselves; press angle: "an app that made its best feature free for the dogs who need it."
**Assets:** microsite per metro, print PDF, lamppost quiet-hours cards (§20.6 guerrilla), a 2-min mini-doc of one reactive dog's dawn walk.
**Outcomes:** the wedge community's trust, permanently; the highest-advocacy cohort seeded. **Measurement:** map usage; Quiet Hours cohort growth + D30; sentiment in reactive-dog communities (tracked qualitatively).

### 20.11.4 "Dogs of [City], at Their Height" *(rolling; peaks at each metro launch)*
**Narrative:** the city as dogs see it — the photographer-Anchor's dog-height portrait series exhibited where people already are: a partner café wall, a farmers-market pop-up, an Instagram series. Every portrait's dog has a Trot card; every visitor learns the city has a dog map.
**Execution:** 40 portraits/metro; subjects recruited from founders + shelter dogs (adoption spotlight); opening night = pack walk to the venue.
**Outcomes:** the visual identity (§17.8) becomes a public art story; the photography corpus grows; venue partners join the map. **Measurement:** exhibit visitors→QR scans; portraits' social reach; venue partnerships signed.

---

## 20.12 One hundred growth experiments

Scored **I**mpact / **C**onfidence / **E**ffort (1–5; effort inverted — 5 = cheap). Priority = I×C×E rank within category; **bold** = run first. Grouped by funnel stage; each is testable within the constraints (no spam, no fake scarcity, no paid incentives).

**Acquisition (A):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **A1** | Unique-QR brass tags: measure park-conversation conversion per tag batch | 4 | 4 | 4 |
| **A2** | Park-specific landing pages (bench/tag traffic) vs metro generic | 3 | 4 | 4 |
| A3 | Waitlist "neighbors waiting near [park]" counter vs plain form | 3 | 3 | 5 |
| A4 | Bench-plaque QR placement: gate vs bench vs fountain | 2 | 3 | 5 |
| **A5** | Shelter adoption kit (tag+profile at gotcha day) → activation rate | 5 | 4 | 3 |
| A6 | Trainer class-graduation walk ritual (Anchor-led first recorded walk) | 4 | 3 | 3 |
| A7 | Chalk paw-trail weekends: foot-traffic scans per park | 2 | 2 | 5 |
| A8 | Farmers-market dog-height photo booth → card + install | 3 | 3 | 3 |
| A9 | "Is [park] busy?" Google-SEO pages from Pulse aggregates | 4 | 3 | 3 |
| A10 | Vet waiting-room Spot-map poster w/ QR | 2 | 3 | 4 |
| A11 | Dog-café table cards ("this café is on the Sniff Map") | 2 | 3 | 5 |
| A12 | ASA: "dog walk tracker" vs "puppy walks" vs brand-adjacent terms | 3 | 4 | 4 |
| A13 | Metro-geofenced story ads: artifact vs route-draw motion | 3 | 3 | 4 |
| A14 | Local-press founding-story pitch template across metros | 3 | 3 | 4 |
| A15 | Breed-club bulk founding (club joins as cohort w/ lounge) | 3 | 3 | 3 |

**Activation & onboarding (B):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **B1** | S-05 permission pre-prompt: covenant-forward vs benefit-forward copy | 5 | 4 | 5 |
| **B2** | First-walk timing nudge: "now" vs learned-window suggestion | 4 | 4 | 4 |
| B3 | Pawtchi import placement: S-03 top vs bottom | 2 | 3 | 5 |
| B4 | Onboarding length: S-04 dog-context screen on/off | 3 | 3 | 5 |
| B5 | Home-Zone default radius 150m vs 250m (grant + trust survey) | 3 | 3 | 4 |
| **B6** | Activation definition test: does first-crossing-≤14d predict M3 better than 3-walks-week-1 | 4 | 4 | 4 |
| B7 | Post-first-walk share prompt: immediate vs next-morning | 3 | 3 | 5 |
| B8 | "Your park's founders" social proof at signup on/off | 3 | 3 | 4 |
| B9 | Manual-log fallback prominence for permission-decliners | 2 | 4 | 4 |
| B10 | Welcome email: covenant-first vs artifact-first | 2 | 3 | 5 |
| B11 | First-week rhythm goal: default 5 vs self-set-first | 3 | 3 | 4 |
| B12 | Onboarding illustration vs photography A/B (activation + brand recall) | 2 | 2 | 4 |
| B13 | Day-2 route-art email w/ export vs in-app only | 3 | 3 | 5 |
| B14 | Quiet Hours self-ID at S-04: checkbox vs respectful phrasing variants | 3 | 4 | 5 |
| B15 | TestFlight → store migration flow for founders (retention of earliest) | 3 | 4 | 4 |

**Sharing (C):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **C1** | Template order: route-art vs photo-first default | 4 | 4 | 5 |
| **C2** | Milestone cards: pre-announced ("3 walks to 100th") vs surprise-only → share rate | 4 | 4 | 4 |
| C3 | Seasonal template drops: share-rate lift per drop | 4 | 3 | 4 |
| C4 | Card watermark: paw-only vs paw+name legibility on IG stories | 2 | 3 | 5 |
| C5 | Share-link web preview: live route draw vs static | 4 | 3 | 3 |
| C6 | Recap share: whole-recap vs per-page share affordance | 3 | 4 | 4 |
| C7 | First-crossing moment: shareable card on/off (privacy-reviewed) | 3 | 3 | 4 |
| C8 | Dog-height camera hint in composer: usage + share quality | 2 | 3 | 4 |
| C9 | "Proud moment" prompt after Regular award: share rate | 3 | 4 | 5 |
| C10 | Weather-badge cards (rain walks) as share spike driver | 2 | 3 | 5 |
| C11 | Share CTA copy: "Keep this walk" vs "Share Bruno's walk" | 2 | 3 | 5 |
| C12 | YiR page order: stats-first vs story-first → completion & share | 4 | 3 | 3 |

**Retention (D):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **D1** | Rhythm default framing: 5/week vs daily-streak opt-in cohort retention | 5 | 4 | 4 |
| **D2** | First Regular candidacy notice timing: quiet vs celebrated | 4 | 3 | 4 |
| D3 | Rest Note auto-suggest on extreme weather: usage + churn protection | 4 | 4 | 4 |
| D4 | Memories resurfacing start: day-30 vs day-90 | 3 | 3 | 4 |
| D5 | Monthly recap push timing: Sunday 6pm vs 1st-of-month | 3 | 4 | 5 |
| D6 | Caught-up state art rotation: does delight measurably return users | 2 | 2 | 4 |
| D7 | Pack-walk attendance → D60 lift measurement (event ROI baseline) | 4 | 4 | 4 |
| D8 | Repair-token auto-offer copy variants → acceptance vs churn | 4 | 4 | 5 |
| D9 | Multi-dog households: second-dog prompt timing | 2 | 3 | 4 |
| D10 | Trail suggestion on route-repetition detection ("same loop 12×—try this?") | 3 | 3 | 3 |
| D11 | Winter cohort: Dawn Patrol challenge vs no seasonal → Jan retention | 4 | 3 | 4 |
| D12 | Lapsed email #1 tone: archive-safety vs neighborhood-news | 3 | 3 | 5 |

**Referral & invitation (E):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **E1** | Ghost-crossing prompt ("that collie isn't on Trot yet — gift a card") consent-first design | 5 | 3 | 4 |
| **E2** | Park Card exchange flow: QR vs share-sheet vs AirDrop-style | 4 | 4 | 4 |
| E3 | Invite landing: inviting-dog's card vs generic → accept rate | 4 | 4 | 4 |
| E4 | Household invite prompt at 2nd-walker detection (same dog, different phone GPS pattern — privacy-reviewed) | 3 | 2 | 3 |
| E5 | Event plus-one flow: "bring a dog they know" RSVP field | 3 | 4 | 5 |
| E6 | Physical tag reorder flow (lost/second tags) as referral supply | 2 | 3 | 5 |
| E7 | Mate-accept celebration: both-feeds moment on/off → next-invite rate | 3 | 3 | 4 |
| E8 | Invite copy: dog-voiced vs human-voiced | 3 | 4 | 5 |
| E9 | New-mate onboarding: show shared crossing history first | 3 | 3 | 4 |
| E10 | Waitlist referral: "move your park up" collective (not individual) queue | 3 | 2 | 4 |

**Community & events (F):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **F1** | Pack-walk kit v1 vs v2 (route pre-set vs organizer choice) → recurring organizer rate | 4 | 4 | 4 |
| F2 | Founding ceremony: named founders wall on Spot page → founding acceptance | 4 | 4 | 4 |
| F3 | Quiet pack walks (small, trainer-led): wedge cohort growth | 4 | 4 | 3 |
| F4 | Challenge kickoff simultaneous walks vs rolling start | 3 | 3 | 4 |
| F5 | Shelter volunteer-walk leaderboard (walks-that-help count, collective not competitive) | 4 | 3 | 3 |
| F6 | Good Neighbor award nomination flow: participation | 2 | 3 | 4 |
| F7 | Event recap gallery auto-send timing → next-event RSVP | 3 | 4 | 5 |
| F8 | Breed-lounge seeding: auto-suggest vs Anchor-club-led | 3 | 3 | 4 |
| F9 | New-user welcome-walk invite (first 30 days) → D60 | 4 | 3 | 4 |
| F10 | Café-endpoint pack walks vs park-only → attendance | 3 | 4 | 5 |
| F11 | Puppy cohort kickoff event per metro quarter | 3 | 3 | 3 |
| F12 | Bench-plaque parks vs control parks: Spot-page traffic | 2 | 3 | 4 |

**Creator/Anchor (G):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **G1** | Anchor usage receipts cadence: monthly vs milestone-triggered → output | 4 | 4 | 5 |
| G2 | Trainer client-tools pilot: does client-sharing recruit trainers' whole rosters | 4 | 3 | 3 |
| G3 | Regulars film subjects: Anchor vs everyday member → view-through + installs | 3 | 3 | 4 |
| G4 | Photographer commission model: per-shoot vs per-metro residency | 2 | 3 | 4 |
| G5 | Anchor council feedback → shipped-feature credit publicity | 3 | 4 | 5 |
| G6 | Micro-creator template early-drops: content volume lift | 3 | 3 | 5 |
| G7 | Vet co-bylined enrichment articles: gatekeeper share rate | 3 | 3 | 4 |
| G8 | Pack Leader pilot: Anchor-graduate vs external hire | 4 | 3 | 3 |

**Lifecycle (H):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **H1** | Sunday digest email: recap + neighborhood news vs recap-only → WAU | 4 | 4 | 5 |
| H2 | First-crossing congratulations email on/off | 3 | 4 | 5 |
| H3 | Email cadence cap: 1/week vs event-driven-only | 3 | 3 | 5 |
| H4 | Gotcha-day annual email (from profile date) → session + share | 3 | 4 | 5 |
| H5 | Weather-window suggestion email (heat weeks) → walk timing shift | 3 | 3 | 4 |
| H6 | Re-permission ask after value moment (first crossing) for decliners | 4 | 3 | 4 |
| H7 | Winter "Rain Walk Club" micro-campaign → badge cohort retention | 3 | 3 | 4 |
| H8 | YiR anticipation drip (Dec 1 teaser) → open rate | 3 | 4 | 5 |

**Monetization (J; post-5k only, quiet per §15.7):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| J1 | Trot+ discovery surface: recap-end vs settings-only | 3 | 3 | 5 |
| **J2** | Quiet-window forecasts as the lead Trot+ pitch for QH cohort | 4 | 4 | 4 |
| J3 | Trial length 14d vs 30d → trial-to-paid | 3 | 3 | 4 |
| J4 | Annual-first price presentation | 3 | 4 | 5 |
| J5 | Print YiR book waitlist (demand signal, pre-build) | 3 | 3 | 5 |
| J6 | Upsell frequency cap 1/week vs 1/month → conversion + NPS | 3 | 3 | 5 |
| J7 | Founding-member lifetime price honored forever (loyalty economics) | 2 | 3 | 4 |
| J8 | Charity-rail matching events → coin sink + sentiment | 2 | 3 | 4 |

**Experiment governance:** one growth analyst owns the backlog; ≤4 concurrent experiments (small-sample honesty at this scale — most "tests" pre-5k are cohort observations, not significance-powered A/Bs, and are labeled as such); every experiment writes a one-page result memo; anything touching privacy, notifications, or streak pressure requires the §12.9 T&S check first.

---

## 20.13 Measurement framework

**North Star: VWW — Valid Walks per Week** (§14.1, unchanged; GTM shares the product's North Star or the org fractures). GTM's contribution is measured as *engaged-user adds* (activated + peer-dense) and loop health, never raw installs.

**The GTM dashboard (weekly, per metro + blended):**
- **Acquisition:** engaged-user adds by source (tag QR / event / share link / press / paid / organic-store); CAC by channel (target: blended <$2 through 10k); % adds within 2km of an active Spot (the peer-density quality gate).
- **Activation:** install→first-Valid-Walk ≤24h (≥60%; ≥85% white-glove phases); permission grant ≥85%; week-1 3-walks ≥40% (§14.2).
- **Engagement:** VWW/WAU 4–7; session-shape compliance (§14.3 — we report *low* time-in-app proudly).
- **Retention:** D30 ≥35% blended; cohort curves by acquisition source (the paid-vs-organic ≥80% guardrail, §20.7); Quiet Hours cohort leading.
- **Referral/loops:** the §14.4 table per metro — crossing %, shares/WAU ≥0.35, share→install ≥3%, invite accept ≥25%, tag scans, event attendance, creators active.
- **Content:** hero-piece shares by *whom* (gatekeeper shares weighted 10× consumer shares); SEO impressions on Spot/trail pages; unprompted Reddit mention rate + sentiment.
- **Creator:** Anchors active/metro (≥8 producing monthly); usage receipts delivered; Anchor-sourced installs.
- **Community:** pack walks/metro/week; RSVP→show ≥60%; attendee→mate conversion; recognition reach ≥25%.
- **Monetization (post-5k):** §14.6's set, reported monthly not weekly (protecting the quiet posture).
- **Brand/trust (quarterly):** the §12.9 trust survey; notification permission retention ≥85% (§9.8) as the ambient trust gauge; aided recall in live metros.

**Operating cadence:** Monday loop review (30 min, the §20.3 table); Thursday experiment readouts; monthly metro deep-dive (one page per metro, §14.8's format); quarterly narrative review — *are we becoming a story people tell?* — assessed with real evidence (press, unprompted mentions, anecdote log) because the cultural-movement goal, while hard to quantify, is the actual objective and deserves a standing agenda item.

**Anti-vanity rules (binding):** no reporting of installs without activation; no follower counts in OKRs (saves/shares/mentions only); no reach numbers without a conversion or trust pairing; every dashboard metric carries its §14.8 counter-metric.

---

## 20.14 Team, budget & timeline summary

**Team through 10k (lean, per §13.15's growth seats):** Head of Growth (owner of this playbook) · Content lead + editor/designer · Community/partnerships lead (Anchors + events) · Growth analyst (part-time acceptable) · Metro Leads (contract, one per live metro) · founders on Reddit/X/LinkedIn voice. Total ≈ 4–5 FTE + contractors.

**Budget through 10k (12 months, excluding salaries):** Founding kits & tags ~$8k · events & campaigns (Slowest Walk, exhibits, quiet-map) ~$20k · content production (films, photography commissions) ~$25k · paid media $15–25k · tools/analytics ~$6k — **≈ $75–85k total** (USD planning figures per doc conventions, roughly A$115–130k; consumer pricing localizes via RevenueCat from day one, §15.1): creativity-over-budget as a real number, not a slogan.

**Timeline at a glance:**

| Month | Milestone |
|---|---|
| −3 → 0 | Phase 0: Melbourne listening tour, 15 Anchors, covenant published, waitlist-by-park |
| 0–1.5 | Phase 1: Founding Hundred, concierge era, artifact harvest |
| 1.5–3.5 | Phase 2: five parks open + fill; Crossed Paths flips; 1,000 users |
| 3.5–6.5 | Phase 3: Melbourne public launch, Slowest Walk, Quiet Map, 4–5,000 users |
| 6.5–12 | Phase 4: Sydney + Brisbane on the kit; first cross-metro season; **10,000 engaged**; Metro Playbook v2 |
| 12+ | Phase 5 posture: tranches, YiR national moment, UK beachhead (→ §16 Year 2) |

**The closing statement of the playbook:** Trot's marketing is the product experienced in public — a brass tag on a collar, a bench plaque, a slow race, a quiet map given away, a founding certificate on a fridge. If the growth team ever finds itself buying attention instead of engineering moments worth attention, this document has failed; return to §20.3 and fix the loop instead.

---

## 20.15 Creative asset library (ad copy · reels · statics · carousels)

The working library: copy and concepts ready to brief, all governed by the voice laws (§20.8), Fieldcraft (§17), and the creative rule (§20.6 — every asset mistakable for something a proud member made). **Usage rules:** (1) consumer-facing copy in the Australian market uses en-AU spelling ("neighbourhood," "colour") — this document stays en-US per conventions; (2) every dog named in a live asset is a real consenting member (founders first — "Bruno/Luna/Duke" below are placeholders from the §4 personas); (3) every asset is tagged to the loop it feeds (§20.3) and dies by the §20.7 kill rule if it underperforms; (4) nothing here uses urgency, guilt, or superlatives — if a line needs an exclamation point, rewrite the line.

### 20.15.1 Ad copy library

Format: **H** headline · **P** primary text · **CTA**. Mix-and-match H/P across sets is allowed; CTAs come only from the §20.8 CTA library.

**Evergreen — the record (pillar 1):**
1. **H:** Every walk counts. **P:** Tuesday. 2.4 km. Fourteen great smells. Bruno's walk, kept forever. **CTA:** Start the record
2. **H:** Your dog's life, one walk at a time. **P:** Routes drawn. Sniffs counted. Nothing about the best part of his day gets forgotten. **CTA:** Start the record
3. **H:** The walk is the best part of their day. **P:** Keep it. Every route, every sniff stop, every season — a record you'll be glad exists. **CTA:** Walk one week with us
4. **H:** 312 km together. **P:** Bruno has walked the length of the Great Ocean Road, one morning at a time. Trot kept every step. **CTA:** Start the record
5. **H:** He'll never read it. It's still his biography. **P:** Every walk you take together, drawn and kept. **CTA:** Start the record

**The neighbourhood (pillar 2):**
6. **H:** Your suburb, mapped for dogs. **P:** Which fountains work. Where the shade is after 10am. When the park goes quiet. Mapped by the dogs who walk it. **CTA:** See your neighbourhood
7. **H:** 47 dogs confirmed this fountain works. **P:** The Sniff Map is what happens when every walk makes the next one better. **CTA:** See your neighbourhood
8. **H:** The dogs of Fitzroy know things. **P:** Shaded routes, working taps, quiet hours, snake-season warnings. Now you know them too. **CTA:** Find your quiet hour

**The network (pillar 3):**
9. **H:** Bruno keeps meeting Luna. Now he knows her name. **P:** Trot notices when your dogs keep crossing paths — and lets the friendship become official. **CTA:** See who Bruno's been meeting
10. **H:** You've seen that collie eleven times. **P:** Your dog already has friends at the park. Trot just does the introductions. **CTA:** See who's at your park
11. **H:** The 7am crew, official at last. **P:** The dogs you nod at every morning — now with names, walks, and a shared record. **CTA:** Find your park

**Privacy (pillar 4):**
12. **H:** Your exact route never leaves your phone. **P:** Home stays hidden. Nothing about you is ever live. Built that way from the first line of code — read the covenant. **CTA:** Read the covenant
13. **H:** A walking app that doesn't know where you live. **P:** Home Zones clip your street out before anything is saved. That's not a setting. It's the architecture. **CTA:** Read the covenant

**Persona doors:**
14. *(Biscuit — new owner)* **H:** Is this enough walking? **P:** Trot answers gently — with your dog's own rhythm, not a red number. You're doing better than you think. **CTA:** Walk one week with us
15. *(Biscuit)* **H:** Proof you're doing right by her. **P:** Every walk recorded, every milestone celebrated. The good-dog-parent receipts. **CTA:** Start the record
16. *(Luna — reactive)* **H:** Finally know when the park is quiet. **P:** Quiet windows, wide paths, no surprises. Built with reactive-dog owners, for the walks that need space. **CTA:** Find your quiet hour
17. *(Luna)* **H:** For the 5:45am walkers. **P:** You walk early to avoid everyone. Trot tells you when you don't have to. **CTA:** Find your quiet hour
18. *(Duke — senior)* **H:** Every walk he has left, kept. **P:** Shorter now. Slower now. Still the best part of his day — and yours. **CTA:** Keep this walk
19. *(Duke)* **H:** 800 metres is a triumph at fourteen. **P:** Trot measures your dog against his own good days, never anyone else's. **CTA:** Start the record
20. *(Ranger — veteran owner)* **H:** The record his walks deserve. **P:** Ten years of mornings at the same park. Someone should have been writing it down. Now something is. **CTA:** Start the record
21. *(Ziggy — puppy)* **H:** She grows fast. Keep up. **P:** First walk, first beach, first magpie season. Trot keeps the whole first year. **CTA:** Start the record
22. *(Cooper — family)* **H:** One dog. Four walkers. One record. **P:** Everyone's walks count toward Cooper's story — the family streak lives on the fridge and in the app. **CTA:** Start the record

**Campaign — The Slowest Walk in Australia:**
23. **H:** The world's slowest race is in Melbourne. **P:** One kilometre. No time limit. The most thorough sniffer wins. Bring the dog; leave the pace. **CTA:** Enter the Slowest Walk
24. **H:** Personal worst. **P:** At the Slowest Walk, 94 minutes for one kilometre is a podium finish. Your dog was born for this. **CTA:** Enter the Slowest Walk
25. **H:** Fourteen sniff stops. One medal. **P:** Every fitness event counts speed. Ours counts curiosity. **CTA:** Enter the Slowest Walk

**Campaign — The Quiet Map:**
26. **H:** A free map of Melbourne's quiet hours. **P:** For the dogs who need space — no app required, no catch. Built with the owners who walk at dawn. **CTA:** Get the Quiet Map

**Seasonal (southern hemisphere):**
27. *(Summer)* **H:** Before nine or after six. **P:** Summer walking in Australia is a timing game. Trot knows the shade, the water, and the cool hours. **CTA:** Find the cool hours
28. *(Summer)* **H:** The five-second rule. **P:** Back of your hand on the footpath. Can't hold it five seconds? Neither can his paws. Trot flags the shade routes. **CTA:** See your neighbourhood
29. *(Autumn)* **H:** Thirty sniffs in April. **P:** The Autumn Sniffari is on — a month of celebrating the thing your dog does best. **CTA:** Join the Sniffari
30. *(Spring)* **H:** Magpie season is mapped. **P:** The dogs of your suburb know which corners to skip until November. Now their humans do too. **CTA:** See your neighbourhood
31. *(December)* **H:** A year of walks, one thread. **P:** Bruno's Year in Review is ready — every route he walked in 2027, drawn as one line. **CTA:** See the year

**App Store / ASA short lines:** "Every walk counts." · "Dog walks, drawn and kept." · "The dog walk tracker that celebrates the sniff." · "Know when the park is quiet."

### 20.15.2 Reel & short-form video library

Format: **Hook (first 2s)** → beats → sound → CTA → loop fed. Series marked ★ are recurring formats (the franchise system — one format, endless episodes).

**★ Series: "At Their Height"** *(dog-height POV, §17.8 — the signature format)*
1. **Hook:** grass-level gimbal shot bursting through a park gate. Beats: 20 seconds of one walk at dog height — legs, leaves, another nose, a fountain. On-screen: "Edinburgh Gardens, 7:04am, as Bruno sees it." Sound: ambient park, no music. CTA: none (brand film energy). Loop: sharing/brand.
2. **Hook:** "Your dog's commute is better than yours." Beats: split-screen — human eye-level grey street vs dog-height adventure of the same street. CTA: Start the record. Loop: sharing.
3. **Hook:** dog-height beach sprint, Brighton dog beach. Beats: the beach as dogs get it; ends on the walk card with the route hugging the shoreline. CTA: See your neighbourhood. Loop: local network (beach Spots).

**★ Series: "The Route Explains Itself"** *(route-draw + deadpan narration — comedy franchise)*
4. **Hook:** a bizarre route shape drawing itself in Clay. Narration: "This corner? A chip. This loop? The same chip, reconsidered." CTA: Keep this walk. Loop: sharing.
5. **Hook:** perfectly straight route, then a violent detour. "Everything was normal until the magpie." (Spring seasonal.) Loop: sharing + AU localization.
6. **Hook:** route that circles one tree four times. "Day 3. The possum knows he knows." Loop: sharing.
7. **Hook:** two routes drawn side by side — owner's plan vs actual. "The proposed agenda. The amendments." Loop: sharing.

**★ Series: "We Keep Meeting"** *(Crossed Paths storytimes — the network's tellable story)*
8. **Hook:** "We'd been calling him 'the beautiful staffy' for a year." Beats: owner-told story of a crossing card → Best Mates → now they walk Tuesdays; ends on both dog cards side by side. CTA: See who's at your park. Loop: local network.
9. **Hook:** crossing card screenshot: "3rd time crossing Luna this month." Beats: the reveal montage — same park, same time, never met; then the meeting, filmed. Loop: local network.
10. **Hook:** "My dog had a social life I didn't know about." Beats: the crossing digest as a soap-opera recap. Loop: sharing.

**★ Series: "The Regulars"** *(90-second micro-docs; the long-form §20.4 asset cut down)*
11. **Hook:** "Ray has opened this park every morning for nine years." Beats: dawn, gates, the shepherd, the podium chip on the Spot page; Ray shrugs: "someone finally noticed." Loop: advocacy/community.
12. **Hook:** "The 6am crew doesn't know each other's names. Only the dogs'." Beats: group portrait energy; ends on the Spot page gallery. Loop: community.

**★ Series: "Sniffari Science"** *(Anchor trainers; educational)*
13. **Hook:** "Your dog's walk isn't exercise. It's the newspaper." Beats: trainer explains sniff enrichment in 30s; ends on a sniff-stop count celebration. CTA: Join the Sniffari. Loop: creator.
14. **Hook:** "Let him sniff the pole. I'm serious." Beats: what a sniff stop does for a dog's brain; the auto-pause feature shown honoring it. Loop: creator + product education.
15. **Hook:** "The five-minute rule for puppies, explained in one walk." Beats: trainer + puppy, Puppy Mode duration guidance on screen. Loop: creator (puppy cohort feed).

**★ Series: "Quiet Hours"** *(the wedge; always service-first)*
16. **Hook:** empty park at dawn, one dog, exhale. Text: "For the dogs who need space." Beats: a reactive dog's calm walk in a quiet window; the quiet-map glow shown once. No hard sell. CTA: Get the Quiet Map. Loop: advocacy.
17. **Hook:** "We walk at 5:45 so no one has to see us struggle." Beats: owner voiceover; the app's quiet window suggests 9:40 Tuesday; the first daylight walk in months. Handle with §12.7-grade care. Loop: advocacy.

**Campaign — Slowest Walk:**
18. **Hook:** starting gun → nobody moves; one dog sits. Text: "The race has begun." Beats: bibs, judges with clipboards at a bush, the "Finisher: Eventually" medal. CTA: Enter the Slowest Walk. Loop: community/event.
19. **Hook:** "Training montage" music over a dog inspecting one leaf for 40 seconds. Loop: sharing.
20. **Hook:** post-race interview framing: "How did you prepare?" Owner: "We didn't." Dog: [sniffing the microphone]. Loop: sharing.

**★ Series: "Field Notes"** *(local intelligence as content)*
21. **Hook:** "Three shaded walks in Fitzroy for 35-degree days." Beats: map flyover of three Trail Tails, shade % chips visible. CTA: See your neighbourhood. Loop: content/SEO + data.
22. **Hook:** "This fountain hasn't worked since March. The dogs know." Beats: pin history, confirmations, the fixed-fountain celebration when council repairs it. Loop: data + civic story.
23. **Hook:** "Snake season starts in September. Here's what the map knows." Beats: hazard layers near waterways, trainer safety notes. Loop: data + AU localization.

**Product moments (used sparingly):**
24. **Hook:** the route draw, full-screen, no words. 12 seconds. The most-replayed asset we own. CTA: Start the record. Loop: sharing.
25. **Hook:** a phone going into a pocket at the walk's start… and not coming out until the end. Text: "It just records." Beats: lock-screen Live Activity glimpse; summary reveal at home. Loop: product trust.

### 20.15.3 Static post library

Each: concept · copy · visual note (all on Fieldcraft paper ground, §17).

1. **The artifact pair** — a real member's route-art card beside the dog's portrait. Copy: "Tuesday, 2.4 km, fourteen great smells. — Bruno, Carlton North." Visual: card + photo, serif name. *(The workhorse — one per week, always a different dog.)*
2. **The odometer** — giant tabular number. Copy: "1,000 km together. Started with a puppy who wouldn't pass the letterbox." Visual: stat block grammar, honey badge accent.
3. **The covenant card** — plain text on paper. Copy: "Your exact route never leaves your phone. Home stays hidden. Nothing about you is ever live." Visual: typography only; the trust ad. *(Runs forever.)*
4. **The bench plaque photo** — real OOH plaque photographed with a dog sitting beside it. Copy: "Reserved for the 6:45 crew." Visual: warm morning light, no logo beyond the plaque's.
5. **Fountain confirmation** — close crop of a fountain + confidence chip. Copy: "Working. 47 dogs confirmed it." Visual: Sniff Map pin styling.
6. **Founding portrait** — dog-height portrait + founding chip. Copy: "Founding Dog #041 of Melbourne. Walks Edinburgh Gardens, owns it emotionally."
7. **The quiet window** — soft dawn photo, one dog. Copy: "Elm Trail is quiet until 9:40 most Tuesdays. Some dogs need that. Now their humans know."
8. **Crossing announcement** — two portraits leaning together over a place chip. Copy: "Bruno & Luna. Eleven crossings before anyone said hello."
9. **The sniff-stop stat** — single number. Copy: "94 seconds. One bush. Zero regrets." Visual: stat block + pencil-wash bush illustration.
10. **Season opener (autumn)** — leaves at dog height. Copy: "Sniffari season. Thirty sniffs in April — the dogs are ready."
11. **Summer safety** — hand on footpath photo. Copy: "Five seconds. If your hand can't, his paws can't. The shade routes are mapped."
12. **Magpie season PSA** — pencil-wash magpie, respectful distance. Copy: "September to November: the dogs of Brunswick reroute. The map knows the corners."
13. **The Regular award** — podium composition. Copy: "Morning Regular, Princes Park: Winnie. 61 visits in 90 days. Dignity intact."
14. **Rest Note card** — dog asleep, paper texture. Copy: "40 degrees today. The streak pauses honourably. That's what Rest Notes are for."
15. **Caught-up art** — the asleep-under-a-tree end-state illustration. Copy: "You're all caught up. Go walk."
16. **YiR teaser (December)** — a year of Clay lines composited as one thread. Copy: "365 days. One line. Bruno's year is ready."

### 20.15.4 Carousel library

Each: title · slide arc (5–8 slides) · final-slide CTA.

1. **"Ziggy's first month"** — 6 slides: gotcha-day card → first walk (200m) → first beach → first friend crossing → the month's route constellation → "Every first, kept." CTA: Start the record. *(Template repeats for any puppy — the cohort feeds it.)*
2. **"Duke's year"** — 6 slides: January's 3km loop → winter's shorter loops → the bench he likes now → 12th-birthday walk card → lifetime odometer → "Every walk he has left, kept." *(Handled with §18.11 senior grace; no decline framing.)*
3. **"Why the sniff is the point"** — 7 slides: trainer co-byline; dog's nose vs ours → sniffing as reading the news → why pulling him past the pole is like snatching your phone mid-sentence → the auto-pause feature → sniff-count celebration. CTA: Join the Sniffari.
4. **"How Crossed Paths works (and why it's safe)"** — 6 slides: the crossing card → what we compute (place + day, never times) → what we never store (routes, schedules) → mutual opt-in → the friendship. CTA: Read the covenant. *(The privacy explainer that doubles as the network pitch.)*
5. **"Five shaded walks in Fitzroy for a scorcher"** — 7 slides: five Trail Tails with shade % chips + water pins → the five-second rule → CTA: See your neighbourhood. *(Template per suburb — infinite local series, feeds SEO loop.)*
6. **"The Founding Hundred: #001–#005"** — portraits + one-line stories per dog. CTA: none (pride post). *(Runs weekly through Phase 1–2.)*
7. **"Puppy socialisation, one walk at a time"** — 8 slides: the checklist (a cyclist ✓, an umbrella ✓, a calm large dog ✓) → vaccination-window ground rules → Puppy Mode. CTA: Start the record.
8. **"What your dog's route says about them"** — 6 slides: five real route shapes with personality readings (the perimeter patroller, the zigzag scholar, the one-tree devotee) → "every route tells on them." CTA: Keep this walk. *(High-share comedy.)*
9. **"Magpie season survival, mapped"** — 6 slides: the season explained → the swooping-corner pins → reroute suggestions → respect-the-magpie etiquette. CTA: See your neighbourhood.
10. **"How the Quiet Map was made"** — 7 slides: the 5:45am walkers → what reactive owners asked for → the aggregate data (never individuals) → the free public map → who it's for. CTA: Get the Quiet Map.
11. **"One park, one year"** — Edinburgh Gardens through four seasons: pulse histograms shifting, the winter crew, the spring puppies, the Regulars changing. CTA: Find your park.
12. **"The walk we almost didn't take"** — UGC story arc: rainy Tuesday → the reluctant leash-up → the best walk of the month, card as proof → "the worst-weather walks make the best stories." CTA: Walk one week with us.

**Library governance:** refresh cadence — ads reviewed against the §20.7 kill rule weekly; one new reel-series pilot per month (kill or franchise within four episodes); statics rotate with the seasonal calendar; carousels are evergreen with suburb/dog swaps. Every asset logs its loop tag and its performance in the §20.13 content metrics; the quarterly craft audit (§17.20) reviews the live library for voice drift.

---

*End of master document. Section files (00–20) in `docs/walk-spinoff-prd/` remain the working set; regenerate this master after editing any section.*
