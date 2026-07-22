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
