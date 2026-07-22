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
