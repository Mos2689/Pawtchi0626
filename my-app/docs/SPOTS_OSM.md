# Pawtchi Spots — nearby places from OpenStreetMap

Status: **built, flag-off, never run on a device.** `spotsOsmMvp: false` in
`constants/featureFlags.json`.

---

## What it is

A third segment on Home showing dog-relevant places nearby — off-leash parks,
dog-friendly parks and beaches, vets, pet stores, water points — sourced from
OpenStreetMap via Overpass and cached hard.

Home's segmented control now reads **Walks / Sniffs / Spots**:

| Segment | Source | Meaning |
|---|---|---|
| Walks | `walk_sessions` | Where this dog has been |
| Sniffs | `resolveSniffStops` over walk history | Where this dog stopped and read |
| Spots | OpenStreetMap | Where this dog could go |

**"Sniffs" was called "Spots" before this feature.** It is the same shipped
sniff-stop rail, renamed — the OSM layer needed the name, and "Sniffs" is the
more accurate word for `resolveSniffStops` output anyway. The rename was landed
and verified as its own step before any new behaviour was added.

---

## The one rule everything here follows

**Say only what the data says.**

OSM is crowd-mapped and wildly uneven. The failure mode worth designing against
is not "we missed a park" — it is "we told someone their dog could run free
somewhere it can't."

So:

- `dogAccess` has an explicit `unknown` member and it is **the default**. Most
  parks on earth carry no `dog=*` tag.
- Untagged parks and beaches **are shown**, labelled *"Dog access not
  confirmed"*, ranked below confirmed ones. Excluding them would make the empty
  state the common case in most cities. (Product decision, confirmed.)
- The two claims that could genuinely harm someone — **off-leash** and
  **emergency vet** — come only from explicit source tags. Never inferred, not
  from opening hours, not from the name.
- A place we cannot locate is **dropped**, not guessed at. A park pinned to the
  wrong street sends someone somewhere; a missing park just isn't there.
- Unnamed places get their category ("Veterinary clinic"), never an OSM id.
- `PawtchiSpot` carries **no raw tags**, so the UI cannot re-derive its own
  answer — that is how a cautious rule gets quietly relaxed in a layout tweak.

Every one of these is pinned by a test in `lib/spots/*.test.ts`.

---

## Architecture

```
Home (Spots segment)
  └─ useNearbySpots(center, radius)
       ├─ AsyncStorage cache  [24 h, stale-while-revalidate]
       └─ supabase.functions.invoke('nearby-spots')
            ├─ verifyAuth → checkRateLimit(40/h) → validate
            ├─ spot_cache lookup by (cell_key, radius_bucket, query_version) [72 h]
            ├─ MISS → Overpass QL → normalize → dedupe → cache write
            └─ FAIL → serve stale row, at any age
```

### Geographic cells: the cache key *and* a privacy property

Overpass is never asked where the user is. The client quantizes to a `0.02°`
(~2.2 km) grid and the query is centred on the **cell centre**, with radius
`requested + 1800 m` so it covers a user standing anywhere in that cell
(`lib/spots/cellKey.test.ts` proves the coverage property at four latitudes).

This buys two things at once:

1. **Sharing.** A whole neighbourhood costs one upstream request per 72 h.
   Overpass is volunteer infrastructure; this is the difference between polite
   use and getting Pawtchi's traffic blocked.
2. **Privacy.** There is no row in `spot_cache`, and no line in Overpass's logs,
   that says where a person was.

True distances are computed client-side from the real position — the server
never learns it, which is also why ranking is client-side.

### Cache invalidation

`SPOT_QUERY_VERSION` (`lib/spots/osmTags.ts`) is embedded in **both** cache
keys. Bump it in the same commit as any tag-rule change or `PawtchiSpot` shape
change, every time — otherwise users keep seeing results from the old rules for
up to 72 hours with no way to tell.

### Shared code

`lib/spots/{types,osmTags,classify,normalize,dedupe,cellKey,overpassQuery}.ts`
and `lib/walk/geo.ts` are **mirrored** into `supabase/functions/_shared/` by
`scripts/sync-notification-shared.js` — the same mechanism the notification and
email engines use, added after the August 2026 audit found a forked dispatcher.

```bash
node scripts/sync-notification-shared.js
```

The drift check runs in the test suite (`lib/email/copy.test.ts` iterates every
group; `lib/spots/mirror.test.ts` guards that the spots and walk groups still
exist). The specific failure this prevents: the query and the classifier
disagreeing about which tags matter — which fails silently, as an empty map.

`copy / filters / cluster / rank / directions / fetchPolicy` are **client-only**
by design. The server has no user position, so it cannot rank or measure.

---

## Category → tag rules

Single source of truth: `lib/spots/osmTags.ts`. First match wins; the array is
ordered by specificity so a dog run inside a park classifies as off-leash.

| Category | Matches |
|---|---|
| `off_leash_park` | `leisure=dog_park`, `dog=unleashed` |
| `veterinary` | `amenity=veterinary` |
| `pet_store` | `shop=pet`, `shop=pet_grooming` |
| `drinking_water` | `amenity=drinking_water`, `amenity=water_point` |
| `dog_friendly_beach` | `natural=beach` |
| `dog_friendly_park` | `leisure=park\|garden\|common\|nature_reserve` |
| `walking_trail` | `route=hiking\|walking` — **not queried, see below** |

**Excluded outright:** `dog=no`, `access=no\|private\|permit`, `foot=no`,
`disused=yes`/`abandoned=yes`, and the lifecycle *prefix* form
(`disused:amenity=veterinary`) which is how closed vets are actually tagged.

…plus **`natural=beach` + `tidal=yes`** (see below).

`access=customers` is deliberately **not** excluded — a pet shop's car park is
exactly where a dog owner belongs.

### What the live probe changed

`scratch_test/spotsLiveProbe.ts` (gitignored) runs the real query builder and
normalizer against live Overpass. It found two things unit tests structurally
could not, both fixed in `SPOT_QUERY_VERSION = 2`:

**1. A single global element cap starved whole categories.** Central London
returned exactly the cap, of which 46 were drinking fountains — and because the
cap applied to the whole union, *every* off-leash park and pet shop was silently
truncated away. The response looked healthy; the results were wrong. Fixed with
one `out` per category, each with its own budget sized by value rather than
density. London went from 0 off-leash parks and 0 pet shops to 8 and 2.

**2. The Thames foreshore was being offered as twelve "beaches".** All
`natural=beach, surface=sand, tidal=yes`, unnamed, one 480 m from Leicester
Square. This is the most dangerous thing the feature could have shipped — the
foreshore is submerged half of every day and has currents the PLA publishes
warnings about. A real beach is mapped as the dry part; the tidal polygon is the
water's edge. Now excluded.

A third, smaller finding: 46 consecutive water fountains all captioned "Dog
access not confirmed". True, useless, and the fastest way to teach someone to
stop reading the line that matters on the park below. `showsDogAccess()` now
suppresses the badge for vets, shops and water points, where the question is not
meaningful. For water the real signal is `dogWaterConfirmed`, badged separately.

### Live coverage, measured

| Location | Spots within 3 km | Breakdown |
|---|---|---|
| Arpora / Calangute, Goa | 12 | 8 parks, 3 beaches, 1 vet · 1 confirmed / 11 unknown |
| Central London (control) | 47 | 22 parks, 8 off-leash, 11 water, 4 vets, 2 shops · 14 confirmed / 33 unknown |

Goa is thin but real, and most of its parks are unnamed — so the rail will show
several cards all reading "Park", separated only by distance. Honest, but worth
knowing before launch.

Overpass also 429'd one probe mid-session. That is its normal load-shedding, and
it is why the stale-serving path exists.

### Walking trails are deferred

`SPOT_TRAILS_ENABLED = false`. Telling a recreational trail from the pavement
outside a house using `highway=path|footway` is genuinely hard — the tags are
identical and the difference lives in context OSM does not encode. Querying them
returns thousands of way fragments per cell, mostly pavement.

The category, classifier and normalizer all ship and are tested. Enabling it is
one line plus a `SPOT_QUERY_VERSION` bump, once there is a heuristic worth
shipping.

---

## GPS safety

**Spots reads no location of its own.** It takes the coordinate
`useHomeMapCenter` already resolved, as a prop.

It never calls `watchPositionAsync`, `startLocationUpdatesAsync` or
`stopLocationUpdatesAsync`, and never touches the `walk:active` AsyncStorage
record that is the sole authority for whether a walk exists
(`lib/walk/walkTracker.ts`). It therefore cannot start, stop, pause or corrupt a
walk, and cannot alter accuracy config, background-task registration or battery
behaviour — it is not connected to any of them.

Two additional guards:

1. **No network during a walk.** `decideFetch` blocks it, and the walk guard sits
   *above* `userRequested` — so even tapping Refresh mid-walk will not wake the
   radio. Cached spots still render. Not because it would break tracking (it
   can't) but because a walk is when the phone is pocketed and the radio should
   be left alone.
2. **No subscription to the walk stream.** Spots reads a coordinate once per
   entry to the segment, never per GPS fix.

---

## Query discipline

Fetches happen on **first entry to the segment** and on **explicit Refresh or
Search-wider**. Not on pan, not on focus, not per GPS update, never during a
walk. All of it in `lib/spots/fetchPolicy.ts`, all tested.

Filtering **never fetches** — one query returns every category and the chips are
a view over it.

**"Search this area" became Refresh + Search wider.** Home's map is
`interactive={false}` — the rail drives the camera and there is no panning — so
there is no other area to search. The control says what it does rather than
implying a gesture the screen does not support.

---

## Attribution (ODbL)

`components/spots/OsmAttribution.tsx` renders `© OpenStreetMap contributors`,
linked to the copyright page, whenever the Spots segment is active — **on both
platforms**.

This matters most on iOS: the basemap there is Apple's, so the screen carries
Apple's attribution and no OSM credit at all, while every spot pin on it is
OSM-derived. ODbL attaches to the derived data, not just the tiles.

Do not redistribute the cached extracts as a dataset.

---

## Operating it

**Kill switch:** `spotsOsmMvp: false` in `constants/featureFlags.json`. JS-only —
no native footprint, so it can ride an OTA update. Walks and Sniffs are entirely
unaffected; the segment simply disappears.

**Endpoint:** configurable via the `OVERPASS_ENDPOINT` env var on the Edge
Function. Defaults to `overpass-api.de`.

**Rate limit:** 40/hour/user (`_shared/rateLimit.ts`).

**Cache sweep:** `sweep_spot_cache()` deletes rows older than 30 days. Not wired
to cron yet — the table is small and rows are served stale on failure, so this
is a housekeeping job rather than a correctness one.

**Metrics to watch first:**
- `cache_status` distribution — `upstream_fetch` per active user is our load on
  volunteer infrastructure. Target cache-hit ≥ 80 % within a week in any city.
- `spots_empty_state_viewed` rate by region — the honest coverage signal.
- `walk_tracking_started` after a spot view — the number that decides whether
  this is a feature or a directory.

---

## Verification status

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npx eslint` (all touched paths) | Pass, 0 warnings |
| `npx jest` | Pass — 82 suites, 1369 tests |
| `deno check nearby-spots/index.ts` | Pass |
| `npx expo export --platform ios` | Pass |
| `npx expo export --platform android` | Pass |
| Live Overpass probe (Goa + London) | Pass — real results, two bugs found and fixed |
| Migration applied to `mbvpjbwukhypvmgeuyyw` | Done |
| `nearby-spots` deployed | Done — **redeploy needed, see below** |

> **The deployed function predates the v2 fixes.** `osmTags.ts`,
> `overpassQuery.ts` and `classify.ts` all changed after deployment and are
> mirrored server-side, so `nearby-spots` must be redeployed or it will keep
> serving foreshore-as-beach and starved categories.

**Not verified, and not claimed:**

- **Never run on a device or simulator.** No Spots UI has been observed
  rendering, at any point.
- **The endpoint has never been invoked.** The live probe called Overpass
  directly with the same code the function runs; it did not go through
  `nearby-spots`, so auth, rate limiting, and the `spot_cache` read/write path
  are unexercised.
- **No UI-render assertions.** The Jest setup is `testEnvironment: node` with
  `react-native` stubbed; all 82 suites are pure logic. UI states need manual QA.

### Manual QA checklist (dev build — Expo Go cannot draw a basemap)

- [ ] Open Spots; results appear
- [ ] Each filter chip; unavailable chips dimmed
- [ ] Tap a marker → rail selects it → camera moves
- [ ] Tap a cluster bubble
- [ ] Open details → Get directions → return to app
- [ ] Switch segments during an active walk (no fetch, cached spots render)
- [ ] Finish that walk normally afterwards
- [ ] Airplane mode with cached spots → stale note
- [ ] Airplane mode with no cache → error card + retry
- [ ] Location denied → prompt card
- [ ] A genuinely empty rural cell → empty card + Search wider
- [ ] Flag off → segment absent, Home unchanged
- [ ] Cat profile → no map, no segments (unchanged)
