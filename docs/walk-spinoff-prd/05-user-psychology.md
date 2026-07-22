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
