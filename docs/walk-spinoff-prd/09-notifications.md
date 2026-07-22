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
