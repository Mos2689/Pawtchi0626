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
