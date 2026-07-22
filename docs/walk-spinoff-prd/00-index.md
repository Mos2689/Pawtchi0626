# TROT — Product Requirements Document

**The social operating system for dog walking.**

| | |
|---|---|
| Status | Draft v1.0 |
| Date | July 12, 2026 |
| Origin | Spin-off of the Pawtchi tracked-walks feature (`my-app/lib/walk/`, currently gated behind `WALK_TRACKING_ENABLED=false`) |
| Relationship to Pawtchi | Fully independent product — own brand, own database, own accounts. Optional one-way profile import bridge from Pawtchi (§13.9) |
| Audience | Product, design, engineering, growth, and investors |

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

## Document map

| § | File | Contents |
|---|---|---|
| 1 | [01-executive-summary.md](01-executive-summary.md) | Vision, mission, product thesis, why now, competitive advantage |
| 2 | [02-market-analysis.md](02-market-analysis.md) | TAM/SAM/SOM, competitive landscape, positioning, differentiation, SWOT |
| 3 | [03-product-principles.md](03-product-principles.md) | The seven principles every future feature must pass |
| 4 | [04-personas.md](04-personas.md) | Seven personas, jobs-to-be-done, persona-to-feature matrix |
| 5 | [05-user-psychology.md](05-user-psychology.md) | Fifteen motivational mechanics, each with an ethics constraint |
| 6 | [06-information-architecture.md](06-information-architecture.md) | Complete screen inventory, navigation, flows, onboarding, settings, notifications, map interactions |
| 7 | [07-feature-specs.md](07-feature-specs.md) | Full specs: six core features + Q1–Q3 roadmap features (objective, UX, edge cases, data model, backend, APIs, permissions, analytics, metrics) |
| 8 | [08-growth-loops.md](08-growth-loops.md) | Nine loop types, compounding math, city-by-city density strategy |
| 9 | [09-notifications.md](09-notifications.md) | Notification system: budgets, tiers, timing intelligence, trust guardrails |
| 10 | [10-ai-opportunities.md](10-ai-opportunities.md) | Eight AI value areas grounded in on-device signals |
| 11 | [11-gamification.md](11-gamification.md) | Progression: achievements, levels, streaks + repair, seasons, collectibles, local reputation |
| 12 | [12-trust-safety.md](12-trust-safety.md) | Privacy-first location, consent, child & dog safety, abuse, fraud, emergency |
| 13 | [13-technical-architecture.md](13-technical-architecture.md) | V1 architecture (ported Pawtchi walk stack) → 100M-user evolution path; Pawtchi import bridge; store-compliance launch checklist |
| 14 | [14-metrics.md](14-metrics.md) | North Star and the full metric tree |
| 15 | [15-monetization.md](15-monetization.md) | Subscriptions, sponsored challenges, local partnerships, marketplace, API |
| 16 | [16-three-year-vision.md](16-three-year-vision.md) | Year-by-year path to the global dog location-intelligence platform; risk register |
| 17 | [17-design-language.md](17-design-language.md) | The Fieldcraft design system: principles, tokens, typography, color, motion, map style, accessibility, widgets, wearables, AR posture |
| 18 | [18-feature-design-specs.md](18-feature-design-specs.md) | Per-feature design language: visual identity, interaction, emotional goals, design-as-growth, award bar — for all eleven major experiences |
| 19 | [19-competitive-experience.md](19-competitive-experience.md) | Experience-level competitive analysis (Strava, Apple Fitness, NRC, Arc, Notion, Spotify, Airbnb, BeReal, Google Maps) + the ten claimed paradigms |
| 20 | [20-gtm-playbook.md](20-gtm-playbook.md) | Go-to-market operating playbook (Australia-first): six launch phases, 100→10,000 acquisition roadmap, loop operating system, social/content/creative/ads/copy systems, Anchor creator program, community programs, four flagship campaigns, 100 prioritized experiments, GTM measurement, creative asset library (ad copy, reels, statics, carousels) |

> **Portable master document:** [TROT-PRD-MASTER.md](TROT-PRD-MASTER.md) contains all twenty-one sections concatenated into one self-contained file — the hand-off artifact for PMs, designers, engineers, AI coding agents, and investors. The per-section files remain the working set; regenerate the master after editing sections. |

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
