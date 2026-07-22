# §14 — Metrics Framework

One North Star, a small set of input trees, and a hard rule: **we measure walks, relationships, and contributions — never minutes-in-app.** Session-length and scroll-depth are explicitly *not* success metrics (§5.9); a metric that rewards keeping people staring at phones instead of walking dogs is measuring the wrong product.

## 14.1 North Star

> **VWW — Valid Walks per Week** (network-wide count of walks with verdict `valid`).

Why this and not MAU/DAU: VWW captures simultaneously (a) real user value delivered (a walk happened and was worth recording), (b) data-moat growth (every valid walk feeds the map), (c) integrity (the validator gate keeps it honest — §12.6), and (d) frequency, the category's structural advantage (§2.1). Every team's work should trace to VWW through one of the trees below.

**Companion ratio — VWW/WAU (walks per weekly-active user):** health target 4–7. Rising VWW with falling VWW/WAU means we're adding users faster than habits — acceptable in launch quarters, a warning later.

**Evolution:** in Q2+ we track **Connected VWW** (valid walks by users with ≥1 Best Mate) as the North Star's maturing form; the long-run thesis is Connected VWW / VWW → 80%+.

## 14.2 Activation (the F1 spine, §6.3)

| Metric | Target | Notes |
|---|---|---|
| Install → account | ≥80% | S-01/02 friction check |
| Account → dog profile complete | ≥90% | S-03 is celebratory, not a form |
| Location permission grant (contextual ask) | ≥85% | S-05 pre-prompt quality |
| **Activation = first Valid Walk ≤24h** | **≥60%** | The definition of activated |
| First walk → first share card viewed (S-21→22) | ≥50% opened composer | |
| Week-1: ≥3 walks recorded | ≥40% | The habit seed; best single predictor of M3 retention (validate, then manage to it) |
| Pawtchi-import users vs organic activation | +15pts expected | §13.9 |

## 14.3 Retention & engagement

- **Core curves:** D1/D7/D30/M3/M6/M12 targets 55/40/32/26/22/18% (blended installs) — but the *managed* numbers are cohort-conditional: activated-cohort M12 target **45%**; ≥3-mate cohort M12 target **60%** (§7.2's causal story).
- **Habit metrics:** WAU/MAU ≥55%; VWW/WAU 4–7; rhythm-goal keep rate ≥60% (§11.4); streak-loss churn spike = **zero** (the humanity gauge, §11.9).
- **Feature-cohort deltas (the resourcing tool):** M6 retention by — archive depth decile (§8.6), Regular status (§7.4), pack membership (§7.9), contribution activity (§8.7). These deltas decide where the next quarter goes.
- **Session shape:** median session <3 min with a completed loop (walk-wrap or feed-caught-up) ≥70% — *low* time-in-app with high loop completion is the design succeeding (§5.9).

## 14.4 Growth (per §8's loops — all social metrics reported per metro)

| Loop | Metric | Target (graduated metro) |
|---|---|---|
| Viral (8.1) | Shares per WAU (Q1 KPI) | ≥0.35/wk |
| | Share → install-activate | ≥3% of link views |
| Invitation (8.2) | Invites/WAU/mo; accept rate | 0.15; ≥25% |
| | Invited-user D30 vs organic | +10pts (else the loop makes weak users) |
| Local network (8.8) | **% WAU with ≥1 crossing/wk** | **30% sustained ×4wk = metro graduation** |
| Community (8.5) | Events/metro/mo; RSVP→show | rising; ≥60% |
| Creator (8.7) | Active creators/metro | ≥30 |
| Content (8.3) | Organic-search installs/mo | Y2 harvest |
| Blended | Monthly K-factor | ≈0.35 steady-state |

## 14.5 Community, trust & integrity

Contribution rate ≥20% WAU/mo (§7.5); pin accuracy ≥90%; confirm-prompt answer ≥50%; **Monthly Active Packs (Q3 KPI)**; users with ≥3 Best Mates ≥40% of M2 retained (Q2 KPI); reports per 1k WAU trending down per cohort; moderation SLAs met ≥95% (§12.5); crossing opt-out <5% and notification-permission retention M6 ≥85% (the two ambient trust canaries, §7.1/§9.8); "I trust Trot with my location" ≥85% (quarterly survey, §12.9).

## 14.6 Monetization (§15)

Trial start rate; trial→paid ≥40%; paid conversion of M3-retained ≥8% (blended MAU 4–6%); ARPU; LTV:CAC ≥3 within 12mo of paid channels opening; churn of paid ≤2.5%/mo; sponsored-challenge sell-through and advertiser NPS; **guardrail metric: retention delta paid-vs-free explained by selection, not by free-tier degradation** (audited — the §15.2 covenant, quantified).

## 14.7 Infrastructure & quality (§13.11 SLOs, restated as product metrics)

Walk-save success ≥99.9%; crash-free ≥99.8%; battery ≤4%/30min (CI-gated); GPS-degraded walk rate by device (watchlist); validator false-invalid <1%; API p95 <400ms; digest latency (crossings computed → surfaced next 8–10am window) ≥99%; TTL-purge job success = 100% (privacy SLO, §13.11); cost per MAU (cents-scale target, §13.12).

## 14.8 Operating cadence

- **Weekly:** VWW, activation funnel, metro dashboard (each metro's crossing %, contribution rate, K inputs — one page per metro, §8.9).
- **Monthly:** retention curves by cohort, loop portfolio review, notification channel health (§9.8), T&S dashboard (§12.9).
- **Quarterly:** North-Star decomposition review; gamification audit (§11.8); trust survey; metric-target re-baselining (targets above are launch-year planning numbers, expected to be revised against reality — the *definitions* are the stable part of this section, the numbers are hypotheses).
- **Anti-gaming rule:** any metric that becomes a team's target gets a named counter-metric on the same dashboard (shares↔share-quality/removals; VWW↔validator-verdict mix; conversion↔free-tier NPS) — Goodhart is a standing agenda item, not a surprise.
