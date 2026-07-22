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
