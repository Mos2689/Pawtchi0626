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
