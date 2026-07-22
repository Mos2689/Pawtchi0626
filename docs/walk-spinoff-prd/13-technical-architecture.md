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
