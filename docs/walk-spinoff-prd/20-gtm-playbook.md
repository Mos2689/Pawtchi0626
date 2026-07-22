# §20 — Go-To-Market Playbook: Zero to 10,000 Engaged

The operating manual for Trot's growth team, from pre-launch to the first 10,000 highly engaged users. It operationalizes the PRD: the loops of §8 become programs with owners and calendars; the density playbook of §8.9 becomes a week-by-week runbook; Fieldcraft (§17) becomes the creative system; the §14 metric tree becomes the growth dashboard. Nothing here contradicts the PRD — where the PRD sets a law (P6: honest growth; §8.9: no national paid before density; §15.2: no reward referrals in v1), this playbook builds inside it.

**The core GTM thesis, stated once:** Trot does not launch to a market; it launches to *parks*. The unit of go-to-market is not a country, a demographic, or an app-store category — it is a single park's morning crew, won completely, then multiplied. Every deliverable below is in service of a repeatable ritual: **seed a park → make its regulars founders → let the artifacts recruit the periphery → flip the network when crossings are inevitable → graduate the metro → hand the playbook to the next one.** 10,000 engaged users is not a big number reached broadly; it is roughly 60 parks won deeply.

**Definition of done for this playbook's scope:** 10,000 users who are *engaged* by the PRD's definition — activated (first Valid Walk ≤24h), walking ≥3×/week (VWW/WAU ≥4), in metros where the network is visibly alive. Not 10,000 installs. Installs without local peers are pre-churned (§8.9.7); this document treats them as a cost, not an asset.

---

## 20.1 Phased GTM strategy

Six phases. Each states objective, rationale, execution, dependencies, KPIs, and the gate to the next phase. Timeline references assume product Q1 ("Worth Sharing") completes before Phase 3 and Q2 ("Bruno Has Friends") ships during Phase 4 — the GTM phases interleave with the §7.0 roadmap rather than following it.

**Australia-first (governing note for every phase):** Trot launches in Australia — Melbourne as metro #1, Sydney + Brisbane as the Phase-4 pair, then Perth/Adelaide/Canberra before the international tranche (§2.6). Why Australia leads: one of the world's highest dog-ownership rates (roughly half of households), a café-and-park culture already organized around dogs, council-designated off-leash areas that map one-to-one onto Spots, contained walkable inner suburbs (the §8.9 "neighborhood containment" criterion at its best), and a quiet-market advantage — the playbook is proven at home before it meets US competitor attention. Operating consequences, binding across this section:
1. **The seasonal calendar runs on southern-hemisphere seasons** — launch-year Autumn Sniffari lands in March–May, Summer Early-Bird and heat-safety content own December–February, and the December Year in Review doubles as a summer moment (§11.5's season-named events transfer cleanly; month references localize).
2. **Local hazards are a localization moat:** snake-season awareness (roughly September–March near bush and waterways) and magpie swooping season (September–November) become Sniff Map layers and content pillars no US-built competitor would think to ship — safety intelligence that makes the map's value unmistakably local.
3. **Councils replace parks departments** as the civic partner (§15.6/§16): off-leash designations, dog-registration channels, and bench-plaque/OOH permissions all run through local councils.
4. **Partner map:** RSPCA state branches, The Lost Dogs' Home, and local rescue groups anchor the Shelter Program (§20.10); Mad Paws is the local Rover-equivalent to track per §2.2; PETstock/Petbarn are later retail surfaces, not launch partners.
5. **Community channels skew local:** Facebook groups carry outsized weight in Australian dog communities; r/melbourne and r/AusDogs sit alongside the global subreddits (§20.4).
6. **Money and compliance:** planning budgets stay in USD per doc conventions (≈1.5× in A$); consumer pricing localizes via RevenueCat from day one (§15.1); Australian Privacy Act (APP) compliance is already covered by the GDPR-native posture (§12.3).

### Phase 0 — Pre-launch: "Earn the room" *(product Q1 in build; ~10 weeks)*

**Objective:** enter launch day already trusted by the communities that decide dog-app reputations, with a waitlist that is *geographically concentrated* rather than large.

**Rationale:** dog culture has gatekeepers — trainers, rescue orgs, reactive-dog forum moderators, park elders. Their endorsement is unbuyable and their skepticism is fatal (they have watched a decade of dog apps die, §2.2). Pre-launch is spent earning them, not teasing consumers. A national waitlist is explicitly *not* the goal: 5,000 scattered emails are worth less than 300 dog owners within walking distance of five Melbourne parks.

**Execution:**
1. **Pick metro #1** — **Melbourne** (the densest dog culture in an already dog-mad country: café norms that welcome dogs, council off-leash parks everywhere, contained inner-north/inner-west villages, media-friendly) — and its **five seed parks** (candidate set: Edinburgh Gardens, Princes Park, Royal Park, Yarra Bend, plus one dog-beach Spot such as Brighton) — confirmed by observed morning-crew density, not data we don't have yet. Founders walk them. Literally.
2. **The Listening Tour:** 50 conversations — trainers, reactive-dog group admins, shelter volunteer coordinators, park regulars. Not user interviews disguised as marketing; actual relationship-building with the people who will become Anchors (§20.9). Every conversation ends with "want to shape this before it exists?"
3. **The privacy covenant published early** (§12.1, as a public page) — in this category, the trust document *is* pre-launch marketing. Reactive-dog and safety-minded communities share privacy stances that respect them.
4. **Waitlist as neighborhood census:** signup asks one question beyond email — "which park do you walk?" The waitlist page shows, per park, how many neighbors are waiting ("23 dogs near Edinburgh Gardens are waiting"). Social proof (§5.12) and crossing-supply forecasting in one artifact.
5. **Begin the content engine** (§20.5) at low volume: the dog-height photo project and two "The Regulars" mini-documentary shoots banked for launch.
6. **Founding Pack kits produced** (§20.2): brass Park Card tags, founding certificates — physical, cheap, real.

**Dependencies:** privacy covenant final (§12.1); brand voice locked (§20.8); Anchor agreements drafted (§20.9); S-01→S-08 flow demo-able on TestFlight for gatekeeper conversations.

**KPIs:** 50 gatekeeper conversations held; ≥15 committed Anchors across 5 parks; waitlist ≥600 in metro #1 with ≥60% within 2km of a seed park; 2 rescue-org partnerships signed.

**Gate to Phase 1:** product Q1 feature-complete in TestFlight; ≥15 Anchors ready to walk on day one.

### Phase 1 — Closed beta: "The Founding Hundred" *(4–6 weeks, ~100–150 users)*

**Objective:** 100 users who feel like founders because they are; a product hardened by real walks; the first library of genuine artifacts (share cards, route art, stories).

**Rationale:** the first hundred users of a community product set its culture permanently. Recruit them by hand, treat them like co-founders, and their pride becomes the founding story every later cohort inherits. This is also the only phase where white-glove onboarding is possible — use it to learn what activation friction looks like *in person*.

**Execution:**
1. **Concierge founding:** every beta user onboarded in person or by video call — at the park where they walk. The team walks with them. (At 100 users this is ~25 person-hours/week. Do it.)
2. **The Founding Pack ceremony:** each founding dog receives the brass tag (engraved paw + QR — the physical Park Card, §8.2), a printed founding certificate with their dog's name in Trot Serif, and the permanent in-app Founding chip (§7.3's founder mechanic, applied to the metro itself).
3. **Private pack:** one WhatsApp/Discord space with founders + team; bugs fixed visibly fast; founders' feature suggestions publicly credited in release notes ("Sniff-stop counter — Maya & Biscuit's idea").
4. **Artifact harvesting (with consent):** the first hundred beautiful share cards, first Regulars, first stories — the raw material of every launch asset in §20.11.
5. Weekly "founders' walk" at rotating seed parks — the prototype of the Pack Walk program (§20.10).

**Dependencies:** Q1 product stable; walk-save SLO holding (§13.11 — a lost walk in beta costs a founder).

**KPIs:** ≥85% of betas activated (first Valid Walk ≤24h — above the ≥60% public target because onboarding is white-glove); VWW/WAU ≥5; ≥50% share a card at least once; qualitative: 10 unprompted "I told a friend" reports.

**Gate to Phase 2:** activation funnel instrumented and the top-3 friction points fixed; battery budget verified in the field (§13.6); founders retention D28 ≥80%.

### Phase 2 — Early access: "Fill the five parks" *(6–8 weeks, → ~1,000 users)*

**Objective:** saturate the seed parks — make Trot *ambient* at five physical locations, so that a non-user at those parks encounters it weekly without any ad.

**Rationale:** the density thesis (§8.8) says the product's magic moment (Crossed Paths) needs neighborhood-level supply. Before flipping social features, the five parks must reach the crossing threshold. Early access is invite-gated *by geography*: the waitlist opens park-by-park, in visible cohorts, which converts scarcity into neighborhood momentum without fake-scarcity theater (P6).

**Execution:**
1. **Park-by-park waitlist opening:** "Edinburgh Gardens is open." Each park's opening is an event — founders' pack walk + open invitation, local dog businesses (café, groomer) hosting water bowls. The opening *is* the marketing.
2. **Anchor programming begins** (§20.9): trainers run "sniffari walks," the shelter partnership logs volunteer walks, the photographer Anchor shoots the dog-height series at each park.
3. **Brass-tag flywheel:** every founding dog wearing the Park Card tag is a walking QR code; park conversations ("what's that tag?") are the top acquisition channel this phase — measured (each tag's QR is unique).
4. **Local press, one story only:** the founding-hundred human-interest story (not a product launch story) offered to one local outlet per metro. "A hundred Melbourne dogs became founders of something" is a story; "startup launches app" is not.
5. **Crossed Paths flips on** (Q2 feature, metro-gated per §7.1) the week modeling says median seed-park users will hit ≥1 crossing/week — the moment early access earns its payoff and word-of-mouth language changes from "pretty walk tracker" to "it knows who Bruno keeps meeting."

**Dependencies:** Q2 social features ready behind the metro flag; crossing-supply model live on the metro dashboard (§14.8).

**KPIs:** 1,000 users with ≥70% within 2km of a seed park; ≥25% of seed-park WAU experiencing ≥1 crossing/week by phase end; tag-QR scans ≥150/month; organic (non-invited) signups ≥30% of weekly adds by phase end.

**Gate to Phase 3:** two of five parks at crossing threshold; share→install loop measurably working (≥3% of share-link views install, §14.4).

### Phase 3 — Public metro launch: "Melbourne belongs to the dogs" *(one quarter, → ~4,000 users in metro #1)*

**Objective:** take metro #1 from five parks to city-wide network liveliness; run the first flagship campaign; prove the full loop portfolio in one contained market.

**Rationale:** this is the dress rehearsal for every future city. Everything must be measured well enough to write the **Metro Playbook** — the document Phase 4 clones. Going loud in one city (and quiet everywhere else) concentrates word-of-mouth where it can compound and keeps the national narrative in reserve.

**Execution:**
1. **Open the metro** (no invite gate within Melbourne) with the flagship launch campaign — **The Slowest Walk in Australia** (§20.11.1), the city-scale event that turns the product philosophy into a story.
2. **Spot founding wave:** the christening mechanic (§7.3) opens city-wide; every park's founding ceremony is a micro-event with its own founders and its own local pride.
3. **Full loop portfolio live:** share cards (8.1), Park Card invites (8.2), pack walks (8.5), creator content (8.7), the Sniff Map contribution drive ("Map Melbourne for dogs" — §20.10).
4. **Metro-scoped paid begins** — small, per §20.7: geofenced Meta/TikTok with harvested artifacts as creative, ASA brand capture. Paid amplifies proven organics; it never leads.
5. **Measurement obsession:** every initiative tagged; the Metro Playbook drafted in real time (what moved crossing %, what didn't).

**Dependencies:** T&S staffed for open registration (§12.9); store listings final (§20.8); support runbook.

**KPIs:** 4,000 metro users; metro crossing % ≥25% and climbing; ≥40 active Spots; ≥8 Anchors producing monthly; blended CAC <$2 (organic-dominant); D30 ≥35%.

**Gate to Phase 4:** Melbourne hits **metro graduation** (30% × 4 weeks, §8.8) or is credibly on path; Metro Playbook v1 written and costed.

### Phase 4 — City-by-city expansion: "The next eleven" *(quarters 2–4 of launch year, → 10,000+)*

**Objective:** run the Metro Playbook in metros #2 and #3 simultaneously (e.g., Sydney + Brisbane), each cheaper and faster than Melbourne; reach 10,000 engaged users across three metros.

**Rationale:** the expansion test is not "can we grow?" but "does the playbook transfer without the founders' personal presence?" Two metros at once forces the playbook to be a system (kits, checklists, local hires) rather than heroics.

**Execution:**
1. **Metro Launch Kit:** the productized Phase 0–3 — seed-park selection checklist, Anchor recruitment scripts and agreements, Founding Pack kit (tags, certificates), park-opening event runbook, local-press template, dashboard template.
2. **One Metro Lead per city** (contract/part-time acceptable): a connected local dog person — often a graduated Anchor — not a marketer. Their job: 50 conversations, 15 Anchors, 5 parks. The §13.15 growth/metro-ops headcount.
3. **Cross-metro rituals begin:** the first multi-city seasonal challenge (§7.8.7) — "Autumn Sniffari" — creating national community texture while acquisition stays local.
4. Melbourne becomes the **flagship community** (events, first sponsored-challenge pilot per §15.3) proving the community can host commerce without corroding.

**Dependencies:** Metro Playbook v1; Q3 product (Spots, Sniff Map, Pulse, events) live; hiring/contracting pipeline for Metro Leads.

**KPIs:** metros #2–3 hit 1,000 users in ≤60% of Melbourne's time; per-metro CAC declining; **10,000 total engaged users** (activation ≥60%, VWW/WAU ≥4, D30 ≥35% blended); ≥2 metros graduated.

**Gate to Phase 5:** two consecutive metro launches on-playbook without founder heroics.

### Phase 5 — Scale posture: "From playbook to machine" *(beyond 10k; sets up Year 2)*

**Objective:** transition from hand-run city launches to a repeatable expansion machine (tranches of 3–4 metros/quarter), open the international beachhead (UK), and let the compounding loops (content/SEO §8.3, data §8.4) take over an increasing share of acquisition.

**Execution summary:** metro tranches per §2.6's list; Year-in-Review as the first national-scale moment (December, §7.8.8); SEO harvest begins (Spot/trail pages indexed since Phase 2); creator program formalized into the Pack Leader ambassador structure (§20.10); first UK metro (London) validates the kit internationally. Full Year-2 scaling is §16's territory; this playbook's job ends with the machine proven.

**KPIs:** each new tranche cheaper per engaged user than the last; organic share of acquisition rising (target ≥75%); the §14.4 loop portfolio metrics all green in graduated metros.

---

## 20.2 User acquisition roadmap: 100 → 10,000

Each milestone: channels, activation, conversion, retention, referral, and the numbers that define success. The through-line: **channels change, the artifact doesn't** — at every scale, the thing doing the acquiring is a beautiful walk artifact or a real-world encounter, never an interruption.

### First 100 — recruited by hand *(Phase 1)*

- **Channels:** founder outreach at the five seed parks (the clipboard era — actually talking to people with dogs); Anchor invitations (each Anchor brings 3–5 owners they know); the two rescue-org partnerships (staff + volunteers).
- **Activation:** concierge onboarding at the park; first walk recorded *together*; goal 85%+.
- **Conversion (to habit):** the founders' WhatsApp; visible bug-fix velocity; feature credits.
- **Retention:** weekly founders' walk; the founding identity itself (chips, tags, certificates — people don't churn from things they founded).
- **Referral:** none formal. The brass tag and the share card exist; watch what happens naturally (baseline measurement for P6's honesty test).
- **Success:** 100–150 users, ≥85% activated, D28 ≥80%, ≥50 shared artifacts harvested, 10+ unprompted referral anecdotes.

### First 500 — the parks fill *(Phase 2, weeks 1–4)*

- **Channels:** park-opening events (each adds 50–100); tag-QR scans; founders' shares; waitlist release per park.
- **Activation:** self-serve onboarding now carries the load — watch the funnel daily against the ≥60% target; the S-05 permission screen is the first bottleneck to A/B (§20.12 experiments E-11..E-15).
- **Conversion:** first-week rhythm nudge (§9's T2, gently); "your park's founders" shown at signup (social proof, §5.12).
- **Retention:** park identity — new users see their park's Spot page already alive with founders' history (the §7.3 seed value).
- **Referral:** Park Card QR exchange soft-launched (it's just the tag + profile link); household invites (§7.9.1 arrives with Q2).
- **Success:** 500 users, ≥65% activated, ≥60% within 2km of a seed park, tag scans ≥25/week.

### First 1,000 — the network flips on *(Phase 2, weeks 5–8)*

- **Channels:** Crossed Paths flip = the word-of-mouth phase change (the product's most tellable story starts happening to people); local human-interest press piece; Anchor content (trainers' sniffari walks).
- **Activation:** unchanged mechanics, but the first crossing becomes part of activation definition internally ("activated-plus": first walk + first crossing ≤14 days).
- **Conversion:** crossing digest → mate request → feed value (the §7.1→§7.2 chain; watch accept rates ≥60%).
- **Retention:** the feed exists now; caught-up ritual forms; first Regulars awarded at seed parks (retention's strongest feature, §7.4).
- **Referral:** "Bruno crossed paths with a dog who isn't on Trot yet" — the *ghost crossing* prompt (E-42, one of this playbook's signature mechanics): when a user meets an untracked dog repeatedly IRL, the Park Card is the natural gift. Never automated, only enabled.
- **Success:** 1,000 users; ≥25% of seed-park WAU with ≥1 crossing/week; organic ≥30% of weekly adds; D30 ≥35%.

### First 5,000 — one loud city *(Phase 3)*

- **Channels:** The Slowest Walk campaign (§20.11.1) — the single biggest spike of the year; city-wide Spot founding wave; metro-scoped paid (small) amplifying harvested creative; creator loop output (The Regulars films, dog-height series); Reddit/community presence matured (§20.4).
- **Activation:** campaign traffic is colder — expect ≥55%; the landing → install → first-walk path gets its own funnel review; "walk one week with us" framing (not "sign up").
- **Conversion:** seasonal challenge #1 as the fresh-cohort commitment device (§5.8).
- **Retention:** Spots + Regulars city-wide; monthly recap cadence begins mattering at scale; Quiet Hours cohort tracked separately (the wedge's D30 should *lead* all cohorts — if it doesn't, the wedge promise is broken somewhere).
- **Referral:** Park Cards at scale (every campaign event distributes tags); household packs; pack-walk plus-ones.
- **Success:** 5,000 total; Melbourne ≥4,000; crossing % ≥25%; blended CAC <$2; share→install ≥3%.

### First 10,000 — the playbook transfers *(Phase 4)*

- **Channels:** metros #2–3 run the kit (their own founding hundreds, park openings, campaigns); Melbourne compounding (SEO pages begin returning; YiR in December if timing aligns); first cross-metro challenge.
- **Activation/conversion/retention:** the machine from above, now with playbook targets per metro and a weekly cross-metro review (§20.13).
- **Referral:** the mechanics are now product-native (Park Cards, ghost crossings, household, events); GTM's referral job shifts to *supply* — putting tags and moments where exchanges happen.
- **Success:** 10,000 engaged (per definition above) across 3 metros; ≥2 graduated; metro #3 launch cost ≤60% of Melbourne's; organic share ≥70%.

**What we deliberately do NOT do at any milestone:** national paid, install-farming, incentivized referrals, press tours before density, influencer CPM buys, cross-promo networks, ASO keyword-stuffing. Every one of these manufactures the §8.9.7 anti-pattern: users without local peers, pre-churned, poisoning cohort data.

---

## 20.3 The organic growth engine (loops as an operating system)

The PRD (§8) defines nine loops; GTM's job is to *staff, fuel, and sequence* them. This section assigns each loop an owner, a fuel source, a weekly operating action, and shows how the loops feed each other. The engine's design goal: by 10,000 users, ≥70% of new engaged users arrive through a loop rather than a campaign.

| Loop (§8 ref) | GTM owner | Fuel (what the team supplies weekly) | The compounding hand-off |
|---|---|---|---|
| **Sharing** (8.1) | Design + growth | Template art refreshes; milestone-moment QA; seasonal card drops | Shares recruit periphery → new walkers → more artifacts |
| **Invitation** (8.2) | Community | Brass-tag supply at events; Park Card moments engineered into every gathering | Each accepted invite improves two feeds → both invite again |
| **Content** (8.3) | Content lead | Spot/trail pages polished for indexing; local search terms mapped per metro | Community data creates pages → pages recruit → recruits create data |
| **Data** (8.4) | Product marketing | "Map your city" contribution drives; impact-receipt storytelling | Better map → "it knows which fountains work" word-of-mouth → more mappers |
| **Community** (8.5) | Community | Pack-walk kits; event calendar; organizer support | Events are visible in parks → bystanders join → bigger events |
| **Retention/archive** (8.6) | Lifecycle | Recap quality; Memories moments; YiR production | Deeper archives → longer lives → more of every other loop |
| **Creator** (8.7) | Partnerships | Anchor onboarding; usage receipts; tooling feedback fast-lane | Creator inventory (trails, films, photos) → consumers → receipts → more creation |
| **Local network** (8.8) | Metro leads | Seed-park saturation; crossing-supply monitoring; flip timing | The master loop all others feed |
| **Advocacy** (new, GTM-owned) | Founder + community | Founding ceremonies; feature credits; wedge-community service (Quiet Hours) | People defend and evangelize what they co-built — advocacy is founding, industrialized |

**How they interlock (the flywheel in words):** a *founder* (advocacy) brings her park's *regulars* (invitation); their walks produce *artifacts* (sharing) and *map data* (data); an *Anchor trainer* runs a pack walk (community + creator) that a bystander joins after scanning a *brass tag* (invitation); six weeks later the bystander's dog crosses paths with the founder's dog (local network) and the story gets told at a dinner party (advocacy). One physical park, seven loops, zero ads.

**Loop health review:** every Monday, the §14.4 loop metrics per metro, with one rule — a loop below target for 3 consecutive weeks gets a dedicated experiment sprint (§20.12) before any new initiative launches. Loops are maintained like infrastructure, not admired like slideware.

---

## 20.4 Social media strategy

**Global doctrine before platform detail:**
1. **The account is the dogs', not the brand's.** Trot's social presence reads like the world's best-kept neighborhood dog journal — real dogs, real parks, real crossings — never like a SaaS brand doing dog content.
2. **The signature formats are proprietary:** the *route draw* (§17.9), *dog-height POV* (§17.8), and *crossing stories* are formats competitors can't post without looking like copies.
3. **UGC-first ratio:** ≥60% of published content originates from users/Anchors (with consent and credit); the feed's job is to make members famous in their neighborhood, not to make the brand famous.
4. **Geography-honest:** while only Melbourne is live, the content says so proudly ("Melbourne first. Your city's turn is coming.") — scarcity as honesty, not gimmick.

| Platform | Audience & role | Content pillars | Cadence | Engagement & growth mechanics | Conversion path | KPIs |
|---|---|---|---|---|---|---|
| **Instagram** (primary) | Dog owners 25–45; the brand's living portfolio | Route-art + dog portrait pairs; Crossed Paths stories; The Regulars podium features; dog-height photo series; recap-season waves | 4–5 feed/wk, daily stories during campaigns | Story-first (share cards are natively story-shaped); "your dog could be next" tagging norms; park-account collabs; carousel = one dog's story arc | Bio link → metro-aware landing (waitlist or store); story link stickers on features | Saves & shares (not likes); story share-rate of user cards; profile→install |
| **TikTok** | Younger + broader dog-internet; discovery engine | Sniffari POV (dog-height gimbal walks); route-draw ASMR; "the 6am crew" mini-docs; crossing-reveal storytimes; Slowest Walk content | 3–4/wk; batch-produced | Sounds built from walk ambience; duet-able formats ("show us your dog's route"); Anchor trainers' educational sniff content | Comment-pinned link; bio; TikTok drives awareness > installs — measured accordingly | Completion rate; creates-using-our-sound; follows/1k views |
| **YouTube Shorts (+ long)** | Searchers + documentary audience | Shorts: best of TikTok/IG. Long: **The Regulars** (3-min park-elder documentaries, §20.6); Quiet Hours mini-doc; annual YiR film | Shorts 3/wk; 1 long/mo | Long-form is the trust asset gatekeepers share in forums; Shorts feed the algorithm between | Description links; end-cards to metro pages | Long-form avg view duration; embeds in dog forums |
| **X (Twitter)** | Dog-internet culture + tech/press | Brand-voice quips (dog-voiced); build-in-public threads from founder; crossing-story screenshots (with consent); privacy-stance statements | 3–5/wk, reactive | The privacy covenant threads earn the security/tech audience; founder replies personally | Low direct conversion; narrative + press channel | Quality reposts; press/partner inbound |
| **LinkedIn** | Partners, hires, investors, city/parks officials | Founder narrative (why dogs, why privacy-first); metro-launch recaps with real numbers; hiring posts written in brand voice; parks-department case notes (Y1 end) | 1–2/wk | Comments from team > company posts; Metro Lead spotlights | Careers + partnership inbound | Qualified inbound (candidates, venues, parks depts) |
| **Reddit** | The gatekeeper layer: r/dogs, r/reactivedogs, r/puppy101, r/AusDogs, city subs (r/melbourne first) | **Participation, not promotion.** Team + Anchors answer genuinely (flair-disclosed); Quiet Hours built *with* r/reactivedogs feedback publicly; city-sub presence only around real local events | Ongoing presence; zero scheduled promo | Hard rules: disclose affiliation always; never astroturf; contribute 10× more than we mention Trot; AMAs at metro launches | Organic mentions by others (the only kind that works on Reddit) | Unprompted mention rate; sentiment; mod relationships |
| **Threads** | IG-adjacent conversational | Repurposed X voice content + community questions ("what's your park's unofficial name?") — the answers seed Spot-naming culture | 2–3/wk | Low-effort mirror; harvest conversation prompts for product copy | Bio | Reply quality; prompt→product-insight rate |
| **Pinterest** | Planners: routes, puppy prep, senior-dog care | Trail-guide pins (Trail Tails as boards); "dog-friendly [city]" maps; puppy socialization checklists; senior-dog route guides | Batch: 10–15 pins/mo | SEO-adjacent: pins rank for "dog friendly trails [city]" — feeds the §8.3 content loop | Pin → trail/Spot web page → install | Outbound clicks to trail pages; long-tail search impressions |

**Team reality check (startup-executable):** one content lead + one editor/designer + Anchor UGC covers this. IG/TikTok are daily craft; YouTube long-form is monthly; X/LinkedIn are founder-voice; Reddit is a rotation everyone shares; Threads/Pinterest are batched repurposing. Anything that can't be sustained at this staffing gets cut before quality does.

---

## 20.5 Content strategy (the editorial framework)

**Editorial thesis:** Trot's content is a *local paper for dogs* — genuinely useful neighborhood intelligence and genuinely moving neighborhood stories, produced with the product's data and community. It is never "content marketing about a dog app."

**The twelve pillars, organized into three jobs:**

**Job 1 — Be useful (earns search, saves, and gatekeeper respect):**
- **Local discoveries:** "Where's shaded after 10am in Edinburgh Gardens" — Sniff Map data as editorial; the content loop's (§8.3) human-readable face.
- **Dog health & enrichment insights** (carefully fenced per §10 rule 2 — enrichment/behavior, never medicine): "Why the sniff is the point," heat-safety walk timing, puppy five-minute-rule explainers — co-bylined with Anchor trainers/vets for credibility.
- **Product education:** feature stories told through a real dog's use ("How Luna's owner reads the quiet map"), never tutorial voice.

**Job 2 — Make people feel (earns shares and memory):**
- **Emotional storytelling:** Crossed Paths serendipity stories; senior-dog biographies; gotcha-day arcs; the memorial-done-right stories (rare, handled with §12.7's gravity, only ever user-initiated).
- **User stories & community highlights:** The Regulars features; founder-dog profiles; "the 7am crew of [park]" group portraits.
- **Humor:** dog-logic voice ("Bruno's route today was determined entirely by a squirrel in a hat"); the Slowest Walk's comedy of anti-fitness; never memes-for-memes.

**Job 3 — Build the world (earns identity and belonging):**
- **Behind-the-scenes & founder narrative:** why privacy-first, why sniff stops count, build-in-public metro diaries ("what we learned opening Edinburgh Gardens").
- **Seasonal campaigns:** Autumn Sniffari, Winter Dawn Patrol, Rain Walk Club content waves aligned to §11.5's calendar.
- **Trend participation rule:** join a trend only when the dog-height/route-art treatment makes it *ours* within 24h; otherwise skip — trend-chasing off-brand is negative equity (§17.1 P7).

**Production system:** a two-week editorial sprint cycle; every piece tagged to pillar + loop it feeds + metro; one **hero piece** per month (Regulars film, quiet-map release, data story like "Melbourne's dogs walked 40,000 km this spring — here's the heatmap" built on k-anonymous aggregates §12.5). Evergreen>topical 70/30. Every hero piece must answer: *who shares this, to whom, and why do they look good doing it?*

---

## 20.6 Creative direction (the campaign-facing creative system)

Fieldcraft (§17) governs everything; this section extends it to marketing surfaces. **The creative rule: every asset must be mistakable for something a proud member made, not something a brand bought.** Concept · visual · message · emotional objective · desired action, per asset class:

- **Static ads:** a single real share card (route-art + dog portrait + serif name) on paper ground, one line of copy beneath. Visual: indistinguishable from the product's own artifact (that's the point — the ad *is* the product experience). Message: "Every walk counts." Emotion: recognition ("that could be my dog"). Action: metro landing page.
- **Motion ads (15s):** the route draw, full-screen — a walk re-performing itself in Clay, sniff-dots ticking, ending on the dog's card. No VO, ambient park sound. Emotion: quiet awe. Action: install.
- **Reels/short-form:** dog-height POV walking formats; crossing-reveal narratives ("we kept seeing this collie…"); Regulars micro-docs. Emotion: warmth + small-world delight. Action: follow → metro page.
- **Story ads:** vertical share-card stack with the "typical Tuesday" framing (three cards = three walks = one week's rhythm). Action: swipe-up to the park's Spot page (live proof, not promises).
- **Carousels:** one dog's arc (puppy's first month of walks; a senior's year) told in 6 cards ending on the odometer stat. Emotion: the biography effect (§5.15). Action: "start your dog's record."
- **Launch film (one, 90s, for metro #1):** *"The Slowest Walk"* — a film about everything a dog notices in 400 meters, shot at dog height, ending: "Strava counts your pace. We count what he noticed. Trot — every walk counts." Emotion: the category inversion, felt. Action: cultural — this is the share asset for launch week.
- **UGC templates:** in-app share templates ARE the UGC system (§7.8.3); marketing adds seasonal template drops and the campaign frames (Slowest Walk bib numbers, founding certificates) — always tools for members' pride, never brand billboards with user photos.
- **Walk cards:** covered in §17/§18.3 — restated here as marketing's most important asset: template art direction gets a named owner and a seasonal release calendar, treated like a product surface because it is one.
- **Out-of-home (metro-scoped, cheap):** **The Bench Plaques** — small brass-style plaques on park benches: "Reserved for the 6:45 crew. Every walk counts. — Trot" with a QR to that park's live Spot page. A dozen benches per metro, permission-secured, photographed constantly by passers-by. Companion: fountain tags ("This fountain works. 47 dogs confirmed it. — the Sniff Map").
- **Guerrilla:** chalk paw-trails from park gates to the notable sniff spots on launch weekends ("what's this trail?"); "Missing: one hour of your dog's day" posters that resolve into the sniffari message; lamppost "quiet hours" cards at reactive-friendly times (co-designed with the r/reactivedogs Anchors so it lands as service, not stunt).
- **Interactive:** the **public quiet-map microsite** per metro (§20.11.3) — the community's data as a gift to all dog owners, installed or not.

---

## 20.7 Ad strategy (paid as amplifier, never engine)

**Posture:** per §8.9, paid never leads and never runs nationally pre-density. Budget through 10k users: **$15–25k total** — deliberately small; its job is (a) amplifying proven organic creative inside live metros, (b) brand-term protection, (c) learning what cold audiences respond to before Year-2 scale.

- **Structure:** one account per platform, campaigns per metro (never national), ad sets per persona-message pair (from the §2.3 message architecture: new-owner "beautiful record" / reactive "quiet parks" / social-sharer "worth posting"). Creative = harvested artifacts + the motion route-draw. Geofence: metro polygons, 5km park radii for the sharpest sets.
- **Meta (primary tester):** Advantage+ off; manual placements story/reel-first; 3 creatives × 3 messages × 2 personas rotating weekly; kill rule: below-median CPI *and* below-median activation after $150 spend.
- **TikTok:** spark-ads on our own top organics only (paid pushes proven content, buys no new content); metro-geofenced.
- **Apple Search Ads:** brand terms + "dog walk tracker" exact-match; the cheapest high-intent capture; always-on at low caps. Discovery campaigns off until Year 2.
- **Google (UAC/search):** search brand-protection only through 10k; UAC deferred (its install quality is unverifiable against our peer-density requirement).
- **Reddit ads:** none. Reddit is a participation channel (§20.4); ads there would spend the credibility the participation earns.
- **YouTube:** the launch film promoted once per metro launch ($500–1k) to metro geography — a story, boosted, not an ad campaign.
- **Measurement & optimization:** optimize to *activated user* (first Valid Walk), never install — SKAdNetwork conversion values encode activation; weekly creative review against activation-CPA; **the guardrail metric: paid-cohort D30 must be ≥80% of organic-cohort D30**, else paid is off in that metro (buying pre-churned users is worse than buying nothing).
- **Remarketing:** minimal and respectful — one flow: metro-landing visitors who didn't install see the route-draw motion ad ≤2×/week for 2 weeks; no cart-abandon-style pressure; no owned-audience retargeting of lapsed users via ads (lapsed users belong to lifecycle §20.8, not to ad platforms).
- **Experimentation roadmap:** Phase 3: creative-message fit per persona; Phase 4: landing variants (park-specific vs metro), ASA term expansion, lookalike-of-activated tests; Year 2 (out of scope here): scaled UAC/discovery with the activation-quality guardrails proven.

---

## 20.8 Copywriting framework

**Voice definition (binding, extends §9.5 product-wide):** Trot writes like *a neighbor who really knows dogs* — plainspoken, specific, warm, lightly funny, never hype. Four voice laws: (1) the dog is the subject of sentences wherever possible; (2) specifics beat superlatives ("47 dogs confirmed this fountain" > "the best dog map"); (3) no urgency theater, no exclamation-point enthusiasm, no fitness-bro energy; (4) every claim is one a founder could defend at a dog park.

**The messaging house:**
- **Roof (master promise):** *Every walk counts.*
- **Pillars:** (1) *The most beautiful record of your dog's walks* — identity/archive; (2) *Your neighborhood, mapped for dogs* — the commons; (3) *The dogs you keep meeting* — the network; (4) *Private by architecture* — trust.
- **Persona doors** (from §2.3): Biscuit → "proof you're doing right by them"; Ranger → "the record his walks deserve"; Luna → "finally know when the park is quiet"; Duke → "every walk he has left, kept."

**Funnel copy, with canonical examples:**
- **Headlines (testing pool):** "Every walk counts." / "Your dog's life, one walk at a time." / "The walk is the best part of their day. Keep it." / "Know when the park is quiet." / "Bruno keeps meeting Luna. Now he knows her name."
- **Ad copy (statics):** one line under the artifact: "Tuesday, 2.4 km, 14 great smells. — Bruno's walk, kept forever." CTA: "Start Bruno's record."
- **Landing pages (metro-aware):** hero = live local proof ("412 dogs are walking Edinburgh Gardens on Trot"), the covenant strip ("Your exact route never leaves your phone"), three artifact examples, one CTA. Park-specific variants for QR/bench traffic.
- **App Store listing:** Title: "Trot — Dog Walk Tracker & Map." Subtitle: "Every walk counts." First paragraph: "Trot turns your dog's daily walks into a beautiful record — the routes, the sniff stops, the dogs you keep meeting, and the neighborhood map that makes every walk better. Built privacy-first: your exact route never leaves your phone." Keyword field: dog walk, walking, tracker, puppy, routes, dog parks, pet. Screenshots: summary-with-route-draw, Dog Card, quiet-hours map, crossing card, recap — each captioned in voice.
- **Push notifications:** governed entirely by §9.5's table — GTM adds zero push inventory (marketing never gets the push channel; that rule protects everything).
- **Email (the 6-touch lifecycle, weekly max):** (1) welcome = the covenant + one job ("take one walk"); (2) day-3 = your first route art, exportable; (3) week-2 = "the rhythm" (self-set goal nudge); (4) month-1 = first recap preview; (5) event-driven: first crossing congratulations; (6) Sunday digest opt-in. Lapsed flow: exactly two emails — "Bruno's record is safe whenever you're ready" (30d) and the annual YiR invite; no guilt sequence, ever (§5.5).
- **Referral messaging:** the Park Card frame — "Give them Bruno's card" (dog-first, gift-framed, per P6 no incentives): "Luna's human should see this. Here's Bruno's card — Trot is where the park's dogs keep their walks."
- **Social captions:** dog-voiced observational ("Route determined entirely by a suspicious leaf. 41 minutes. No regrets. — Peanut"); credit lines always name the dog then the human.
- **CTA library:** "Start the record" / "Walk one week with us" / "See who Bruno's been meeting" / "Find your quiet hour" / "Keep this walk" — never "Sign up free!!" energy.

---

## 20.9 Creator strategy: the Anchor Program

**Philosophy:** Trot does not buy audiences; it deputizes the people dogs already trust. An **Anchor** is a local dog-world figure with earned credibility whose work becomes *better with Trot in it* — and who therefore stays for the community, not the invoice. No CPM buys before density; no one-off promos ever.

**The seven Anchor archetypes and their deal:**

| Archetype | What they bring | What they get (never cash-first) |
|---|---|---|
| **Dog trainers** | Credibility + programming (sniffari walks, reactive workshops) | Client-facing tools (share enriched walk summaries with clients), event kits, co-bylined content, early features |
| **Veterinarians** | Trust ceiling; enrichment-content review | Content co-authorship (reviewed-by credibility both ways), waiting-room Spot-map posters; *never* health-claim entanglement (§10 rule 2) |
| **Shelters & rescues** | The gotcha-day pipeline + moral authority | The Shelter Program (§20.10): volunteer-walk logging, adoption-kit tags, "walks that help" visibility; donations from charity rail (§11.6) |
| **Photographers** | The dog-height corpus (§17.8) | Paid commissions (the exception: craft is paid), gallery credit, the Dogs of [City] exhibit platform |
| **Pet cafés & dog-friendly venues** | Physical space + foot traffic | Verified Sniff Map presence (§15.4's free tier), pack-walk endpoint status, water-bowl kit |
| **Breed clubs & community groups** | Pre-formed communities | Breed Lounge founding rights (§7.9.3), club challenge tooling, event support |
| **Micro-creators (1k–20k, dog-first accounts)** | Authentic reach in the exact neighborhoods | Founding access, their dog's story produced properly (The Regulars treatment), template early-drops; small stipends only for defined work products |

**Program mechanics:** 15 Anchors per metro (the Phase 0 KPI); a named partnerships owner; quarterly Anchor council (their feedback gets the founders'-WhatsApp treatment); public usage receipts ("412 dogs walked trails you authored") as the creator loop's fuel (§8.7); graduation path → **Pack Leader** (paid metro ambassador, the §13.15 metro-ops seat) for the standouts. **Exit honesty:** Anchors can leave anytime with their content and their community standing intact — the program's retention is its value, not its contract.

---

## 20.10 Community strategy

Community is the moat's human layer and this playbook's center of gravity. Programs, each with owner + cadence + KPI:

1. **Pack Walks (the atomic ritual):** weekly, per seed park, organizer-kitted (route via Trail Tails, water, tags, the F5 recap loop §6.3). Grows from founders' walks (Phase 1) to community-run (Phase 3+, organizer = Regulars and Anchors). KPI: walks/metro/week; attendee→mate conversion (§14.4).
2. **The Founding system:** every park's christening ceremony (§7.3), founding chips, certificates — earliness converted to permanent status (§5.12). KPI: founding-flow acceptance ≥40%.
3. **City challenges:** the seasonal calendar (§11.5) run as *community property* — challenge kickoff = simultaneous pack walks across the metro's parks. KPI: participation ≥30% WAU.
4. **The Shelter Program ("Walks that help"):** volunteers log shelter-dog walks (special account class); shelters get walk-history pages that help adoptions ("Rex loves the canal route — 3km, mostly sniffing"); adopters leave with the dog's *existing* Trot record — the most emotionally loaded onboarding imaginable, and the program that makes the brand's values undeniable. KPI: shelters live/metro; adoption-continuation rate.
5. **Quiet Hours community:** co-built with reactive-dog Anchors; quiet pack walks (small, structured, trainer-led); the public quiet-map gift (§20.11.3). This community is *served first and marketed to never* — their advocacy (§4.5) follows from that order. KPI: Quiet Hours cohort D30 leading all cohorts.
6. **Pack Leaders (ambassadors):** one per metro post-graduation — paid part-time, community-sourced (Anchor graduates), owning the event calendar and welcome culture. KPI: metro event cadence sustained without HQ.
7. **Online spaces:** deliberately minimal — the product's feeds and packs are the forum (§7.9); one Discord for founders/Anchors/organizers (operational, not a destination). No general community forum to moderate before T&S scale allows (§12.5's structural-prevention logic applied to GTM).
8. **Recognition system:** product-native (Regular §7.4, Cartographer §11.7, founding chips) + GTM's additions: the annual **Good Neighbor** award per metro (community-nominated, human-judged, physical brass plaque on their park's bench — tying back to the OOH system). KPI: recognition reach (% of metro community holding any recognition ≥25%).

---

## 20.11 Flagship launch campaigns

Four concepts, each a story first. Budgets are deliberately small; the currency is cleverness and truth.

### 20.11.1 "The Slowest Walk in Australia" *(metro #1 public launch)*
**Narrative:** every fitness event celebrates speed; dogs think that's insane. Trot hosts a 1-kilometer walk with no time limit where the *most thorough* dog wins — most sniff stops, best route deviation, judges' award for "most interested in one specific bush." The anti-marathon: bibs, a finish line, medals ("Finisher: eventually"), and a world's-slowest-average-pace record attempt.
**Execution:** one Saturday, flagship park; bib = share-card template with the dog's sniff count; Anchors judge; shelter dogs walk with volunteers (adoptable, bib'd "Free Agent"); local café partner at the finish. Film crew shoots the launch film's b-roll live.
**Sequence:** 3 weeks teaser (founders + Anchors invite) → event → 1 week of recap wave (every participant's card auto-generated) → film release.
**Assets:** bibs, medals, route chalk, the film, participant cards, press kit ("Melbourne hosted the world's slowest race on purpose").
**Expected outcomes:** 300–500 dogs; the year's biggest install spike; regional press without buying it; the brand position (P2) performed in public.
**Measurement:** event installs (unique QR per bib batch); participant D30 vs baseline; earned-media reach; sniff stops recorded (the number the press quotes).

### 20.11.2 "The Founding Hundred" *(closed beta, ongoing per metro)*
**Narrative:** the first hundred dogs of every city are founders, permanently — named, photographed at dog height, brass-tagged, on a public founders' wall (web) and, where a partner venue allows, a physical print wall at the flagship café.
**Execution/sequence/assets:** as §20.1 Phase 1; the campaign *is* the program.
**Outcomes:** culture-setting, artifact library, the origin story every city launch retells. **Measurement:** founder D28 ≥80%; founder referral anecdotes; press pickup of the wall.

### 20.11.3 "The Quiet Map" *(the wedge gift; pre-public-launch)*
**Narrative:** for the owners who walk at 5:45am to avoid everyone — a beautiful, free, public map of each metro's quiet windows (built from Pulse aggregates + Anchor knowledge), published as a microsite and a printable PDF, *usable without installing anything*. The product's most vulnerable audience gets the most generous artifact.
**Execution:** co-created with r/reactivedogs Anchors; released in the subreddit and reactive-dog groups by the Anchors themselves; press angle: "an app that made its best feature free for the dogs who need it."
**Assets:** microsite per metro, print PDF, lamppost quiet-hours cards (§20.6 guerrilla), a 2-min mini-doc of one reactive dog's dawn walk.
**Outcomes:** the wedge community's trust, permanently; the highest-advocacy cohort seeded. **Measurement:** map usage; Quiet Hours cohort growth + D30; sentiment in reactive-dog communities (tracked qualitatively).

### 20.11.4 "Dogs of [City], at Their Height" *(rolling; peaks at each metro launch)*
**Narrative:** the city as dogs see it — the photographer-Anchor's dog-height portrait series exhibited where people already are: a partner café wall, a farmers-market pop-up, an Instagram series. Every portrait's dog has a Trot card; every visitor learns the city has a dog map.
**Execution:** 40 portraits/metro; subjects recruited from founders + shelter dogs (adoption spotlight); opening night = pack walk to the venue.
**Outcomes:** the visual identity (§17.8) becomes a public art story; the photography corpus grows; venue partners join the map. **Measurement:** exhibit visitors→QR scans; portraits' social reach; venue partnerships signed.

---

## 20.12 One hundred growth experiments

Scored **I**mpact / **C**onfidence / **E**ffort (1–5; effort inverted — 5 = cheap). Priority = I×C×E rank within category; **bold** = run first. Grouped by funnel stage; each is testable within the constraints (no spam, no fake scarcity, no paid incentives).

**Acquisition (A):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **A1** | Unique-QR brass tags: measure park-conversation conversion per tag batch | 4 | 4 | 4 |
| **A2** | Park-specific landing pages (bench/tag traffic) vs metro generic | 3 | 4 | 4 |
| A3 | Waitlist "neighbors waiting near [park]" counter vs plain form | 3 | 3 | 5 |
| A4 | Bench-plaque QR placement: gate vs bench vs fountain | 2 | 3 | 5 |
| **A5** | Shelter adoption kit (tag+profile at gotcha day) → activation rate | 5 | 4 | 3 |
| A6 | Trainer class-graduation walk ritual (Anchor-led first recorded walk) | 4 | 3 | 3 |
| A7 | Chalk paw-trail weekends: foot-traffic scans per park | 2 | 2 | 5 |
| A8 | Farmers-market dog-height photo booth → card + install | 3 | 3 | 3 |
| A9 | "Is [park] busy?" Google-SEO pages from Pulse aggregates | 4 | 3 | 3 |
| A10 | Vet waiting-room Spot-map poster w/ QR | 2 | 3 | 4 |
| A11 | Dog-café table cards ("this café is on the Sniff Map") | 2 | 3 | 5 |
| A12 | ASA: "dog walk tracker" vs "puppy walks" vs brand-adjacent terms | 3 | 4 | 4 |
| A13 | Metro-geofenced story ads: artifact vs route-draw motion | 3 | 3 | 4 |
| A14 | Local-press founding-story pitch template across metros | 3 | 3 | 4 |
| A15 | Breed-club bulk founding (club joins as cohort w/ lounge) | 3 | 3 | 3 |

**Activation & onboarding (B):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **B1** | S-05 permission pre-prompt: covenant-forward vs benefit-forward copy | 5 | 4 | 5 |
| **B2** | First-walk timing nudge: "now" vs learned-window suggestion | 4 | 4 | 4 |
| B3 | Pawtchi import placement: S-03 top vs bottom | 2 | 3 | 5 |
| B4 | Onboarding length: S-04 dog-context screen on/off | 3 | 3 | 5 |
| B5 | Home-Zone default radius 150m vs 250m (grant + trust survey) | 3 | 3 | 4 |
| **B6** | Activation definition test: does first-crossing-≤14d predict M3 better than 3-walks-week-1 | 4 | 4 | 4 |
| B7 | Post-first-walk share prompt: immediate vs next-morning | 3 | 3 | 5 |
| B8 | "Your park's founders" social proof at signup on/off | 3 | 3 | 4 |
| B9 | Manual-log fallback prominence for permission-decliners | 2 | 4 | 4 |
| B10 | Welcome email: covenant-first vs artifact-first | 2 | 3 | 5 |
| B11 | First-week rhythm goal: default 5 vs self-set-first | 3 | 3 | 4 |
| B12 | Onboarding illustration vs photography A/B (activation + brand recall) | 2 | 2 | 4 |
| B13 | Day-2 route-art email w/ export vs in-app only | 3 | 3 | 5 |
| B14 | Quiet Hours self-ID at S-04: checkbox vs respectful phrasing variants | 3 | 4 | 5 |
| B15 | TestFlight → store migration flow for founders (retention of earliest) | 3 | 4 | 4 |

**Sharing (C):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **C1** | Template order: route-art vs photo-first default | 4 | 4 | 5 |
| **C2** | Milestone cards: pre-announced ("3 walks to 100th") vs surprise-only → share rate | 4 | 4 | 4 |
| C3 | Seasonal template drops: share-rate lift per drop | 4 | 3 | 4 |
| C4 | Card watermark: paw-only vs paw+name legibility on IG stories | 2 | 3 | 5 |
| C5 | Share-link web preview: live route draw vs static | 4 | 3 | 3 |
| C6 | Recap share: whole-recap vs per-page share affordance | 3 | 4 | 4 |
| C7 | First-crossing moment: shareable card on/off (privacy-reviewed) | 3 | 3 | 4 |
| C8 | Dog-height camera hint in composer: usage + share quality | 2 | 3 | 4 |
| C9 | "Proud moment" prompt after Regular award: share rate | 3 | 4 | 5 |
| C10 | Weather-badge cards (rain walks) as share spike driver | 2 | 3 | 5 |
| C11 | Share CTA copy: "Keep this walk" vs "Share Bruno's walk" | 2 | 3 | 5 |
| C12 | YiR page order: stats-first vs story-first → completion & share | 4 | 3 | 3 |

**Retention (D):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **D1** | Rhythm default framing: 5/week vs daily-streak opt-in cohort retention | 5 | 4 | 4 |
| **D2** | First Regular candidacy notice timing: quiet vs celebrated | 4 | 3 | 4 |
| D3 | Rest Note auto-suggest on extreme weather: usage + churn protection | 4 | 4 | 4 |
| D4 | Memories resurfacing start: day-30 vs day-90 | 3 | 3 | 4 |
| D5 | Monthly recap push timing: Sunday 6pm vs 1st-of-month | 3 | 4 | 5 |
| D6 | Caught-up state art rotation: does delight measurably return users | 2 | 2 | 4 |
| D7 | Pack-walk attendance → D60 lift measurement (event ROI baseline) | 4 | 4 | 4 |
| D8 | Repair-token auto-offer copy variants → acceptance vs churn | 4 | 4 | 5 |
| D9 | Multi-dog households: second-dog prompt timing | 2 | 3 | 4 |
| D10 | Trail suggestion on route-repetition detection ("same loop 12×—try this?") | 3 | 3 | 3 |
| D11 | Winter cohort: Dawn Patrol challenge vs no seasonal → Jan retention | 4 | 3 | 4 |
| D12 | Lapsed email #1 tone: archive-safety vs neighborhood-news | 3 | 3 | 5 |

**Referral & invitation (E):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **E1** | Ghost-crossing prompt ("that collie isn't on Trot yet — gift a card") consent-first design | 5 | 3 | 4 |
| **E2** | Park Card exchange flow: QR vs share-sheet vs AirDrop-style | 4 | 4 | 4 |
| E3 | Invite landing: inviting-dog's card vs generic → accept rate | 4 | 4 | 4 |
| E4 | Household invite prompt at 2nd-walker detection (same dog, different phone GPS pattern — privacy-reviewed) | 3 | 2 | 3 |
| E5 | Event plus-one flow: "bring a dog they know" RSVP field | 3 | 4 | 5 |
| E6 | Physical tag reorder flow (lost/second tags) as referral supply | 2 | 3 | 5 |
| E7 | Mate-accept celebration: both-feeds moment on/off → next-invite rate | 3 | 3 | 4 |
| E8 | Invite copy: dog-voiced vs human-voiced | 3 | 4 | 5 |
| E9 | New-mate onboarding: show shared crossing history first | 3 | 3 | 4 |
| E10 | Waitlist referral: "move your park up" collective (not individual) queue | 3 | 2 | 4 |

**Community & events (F):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **F1** | Pack-walk kit v1 vs v2 (route pre-set vs organizer choice) → recurring organizer rate | 4 | 4 | 4 |
| F2 | Founding ceremony: named founders wall on Spot page → founding acceptance | 4 | 4 | 4 |
| F3 | Quiet pack walks (small, trainer-led): wedge cohort growth | 4 | 4 | 3 |
| F4 | Challenge kickoff simultaneous walks vs rolling start | 3 | 3 | 4 |
| F5 | Shelter volunteer-walk leaderboard (walks-that-help count, collective not competitive) | 4 | 3 | 3 |
| F6 | Good Neighbor award nomination flow: participation | 2 | 3 | 4 |
| F7 | Event recap gallery auto-send timing → next-event RSVP | 3 | 4 | 5 |
| F8 | Breed-lounge seeding: auto-suggest vs Anchor-club-led | 3 | 3 | 4 |
| F9 | New-user welcome-walk invite (first 30 days) → D60 | 4 | 3 | 4 |
| F10 | Café-endpoint pack walks vs park-only → attendance | 3 | 4 | 5 |
| F11 | Puppy cohort kickoff event per metro quarter | 3 | 3 | 3 |
| F12 | Bench-plaque parks vs control parks: Spot-page traffic | 2 | 3 | 4 |

**Creator/Anchor (G):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **G1** | Anchor usage receipts cadence: monthly vs milestone-triggered → output | 4 | 4 | 5 |
| G2 | Trainer client-tools pilot: does client-sharing recruit trainers' whole rosters | 4 | 3 | 3 |
| G3 | Regulars film subjects: Anchor vs everyday member → view-through + installs | 3 | 3 | 4 |
| G4 | Photographer commission model: per-shoot vs per-metro residency | 2 | 3 | 4 |
| G5 | Anchor council feedback → shipped-feature credit publicity | 3 | 4 | 5 |
| G6 | Micro-creator template early-drops: content volume lift | 3 | 3 | 5 |
| G7 | Vet co-bylined enrichment articles: gatekeeper share rate | 3 | 3 | 4 |
| G8 | Pack Leader pilot: Anchor-graduate vs external hire | 4 | 3 | 3 |

**Lifecycle (H):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| **H1** | Sunday digest email: recap + neighborhood news vs recap-only → WAU | 4 | 4 | 5 |
| H2 | First-crossing congratulations email on/off | 3 | 4 | 5 |
| H3 | Email cadence cap: 1/week vs event-driven-only | 3 | 3 | 5 |
| H4 | Gotcha-day annual email (from profile date) → session + share | 3 | 4 | 5 |
| H5 | Weather-window suggestion email (heat weeks) → walk timing shift | 3 | 3 | 4 |
| H6 | Re-permission ask after value moment (first crossing) for decliners | 4 | 3 | 4 |
| H7 | Winter "Rain Walk Club" micro-campaign → badge cohort retention | 3 | 3 | 4 |
| H8 | YiR anticipation drip (Dec 1 teaser) → open rate | 3 | 4 | 5 |

**Monetization (J; post-5k only, quiet per §15.7):**
| # | Experiment | I | C | E |
|---|---|---|---|---|
| J1 | Trot+ discovery surface: recap-end vs settings-only | 3 | 3 | 5 |
| **J2** | Quiet-window forecasts as the lead Trot+ pitch for QH cohort | 4 | 4 | 4 |
| J3 | Trial length 14d vs 30d → trial-to-paid | 3 | 3 | 4 |
| J4 | Annual-first price presentation | 3 | 4 | 5 |
| J5 | Print YiR book waitlist (demand signal, pre-build) | 3 | 3 | 5 |
| J6 | Upsell frequency cap 1/week vs 1/month → conversion + NPS | 3 | 3 | 5 |
| J7 | Founding-member lifetime price honored forever (loyalty economics) | 2 | 3 | 4 |
| J8 | Charity-rail matching events → coin sink + sentiment | 2 | 3 | 4 |

**Experiment governance:** one growth analyst owns the backlog; ≤4 concurrent experiments (small-sample honesty at this scale — most "tests" pre-5k are cohort observations, not significance-powered A/Bs, and are labeled as such); every experiment writes a one-page result memo; anything touching privacy, notifications, or streak pressure requires the §12.9 T&S check first.

---

## 20.13 Measurement framework

**North Star: VWW — Valid Walks per Week** (§14.1, unchanged; GTM shares the product's North Star or the org fractures). GTM's contribution is measured as *engaged-user adds* (activated + peer-dense) and loop health, never raw installs.

**The GTM dashboard (weekly, per metro + blended):**
- **Acquisition:** engaged-user adds by source (tag QR / event / share link / press / paid / organic-store); CAC by channel (target: blended <$2 through 10k); % adds within 2km of an active Spot (the peer-density quality gate).
- **Activation:** install→first-Valid-Walk ≤24h (≥60%; ≥85% white-glove phases); permission grant ≥85%; week-1 3-walks ≥40% (§14.2).
- **Engagement:** VWW/WAU 4–7; session-shape compliance (§14.3 — we report *low* time-in-app proudly).
- **Retention:** D30 ≥35% blended; cohort curves by acquisition source (the paid-vs-organic ≥80% guardrail, §20.7); Quiet Hours cohort leading.
- **Referral/loops:** the §14.4 table per metro — crossing %, shares/WAU ≥0.35, share→install ≥3%, invite accept ≥25%, tag scans, event attendance, creators active.
- **Content:** hero-piece shares by *whom* (gatekeeper shares weighted 10× consumer shares); SEO impressions on Spot/trail pages; unprompted Reddit mention rate + sentiment.
- **Creator:** Anchors active/metro (≥8 producing monthly); usage receipts delivered; Anchor-sourced installs.
- **Community:** pack walks/metro/week; RSVP→show ≥60%; attendee→mate conversion; recognition reach ≥25%.
- **Monetization (post-5k):** §14.6's set, reported monthly not weekly (protecting the quiet posture).
- **Brand/trust (quarterly):** the §12.9 trust survey; notification permission retention ≥85% (§9.8) as the ambient trust gauge; aided recall in live metros.

**Operating cadence:** Monday loop review (30 min, the §20.3 table); Thursday experiment readouts; monthly metro deep-dive (one page per metro, §14.8's format); quarterly narrative review — *are we becoming a story people tell?* — assessed with real evidence (press, unprompted mentions, anecdote log) because the cultural-movement goal, while hard to quantify, is the actual objective and deserves a standing agenda item.

**Anti-vanity rules (binding):** no reporting of installs without activation; no follower counts in OKRs (saves/shares/mentions only); no reach numbers without a conversion or trust pairing; every dashboard metric carries its §14.8 counter-metric.

---

## 20.14 Team, budget & timeline summary

**Team through 10k (lean, per §13.15's growth seats):** Head of Growth (owner of this playbook) · Content lead + editor/designer · Community/partnerships lead (Anchors + events) · Growth analyst (part-time acceptable) · Metro Leads (contract, one per live metro) · founders on Reddit/X/LinkedIn voice. Total ≈ 4–5 FTE + contractors.

**Budget through 10k (12 months, excluding salaries):** Founding kits & tags ~$8k · events & campaigns (Slowest Walk, exhibits, quiet-map) ~$20k · content production (films, photography commissions) ~$25k · paid media $15–25k · tools/analytics ~$6k — **≈ $75–85k total** (USD planning figures per doc conventions, roughly A$115–130k; consumer pricing localizes via RevenueCat from day one, §15.1): creativity-over-budget as a real number, not a slogan.

**Timeline at a glance:**

| Month | Milestone |
|---|---|
| −3 → 0 | Phase 0: Melbourne listening tour, 15 Anchors, covenant published, waitlist-by-park |
| 0–1.5 | Phase 1: Founding Hundred, concierge era, artifact harvest |
| 1.5–3.5 | Phase 2: five parks open + fill; Crossed Paths flips; 1,000 users |
| 3.5–6.5 | Phase 3: Melbourne public launch, Slowest Walk, Quiet Map, 4–5,000 users |
| 6.5–12 | Phase 4: Sydney + Brisbane on the kit; first cross-metro season; **10,000 engaged**; Metro Playbook v2 |
| 12+ | Phase 5 posture: tranches, YiR national moment, UK beachhead (→ §16 Year 2) |

**The closing statement of the playbook:** Trot's marketing is the product experienced in public — a brass tag on a collar, a bench plaque, a slow race, a quiet map given away, a founding certificate on a fridge. If the growth team ever finds itself buying attention instead of engineering moments worth attention, this document has failed; return to §20.3 and fix the loop instead.

---

## 20.15 Creative asset library (ad copy · reels · statics · carousels)

The working library: copy and concepts ready to brief, all governed by the voice laws (§20.8), Fieldcraft (§17), and the creative rule (§20.6 — every asset mistakable for something a proud member made). **Usage rules:** (1) consumer-facing copy in the Australian market uses en-AU spelling ("neighbourhood," "colour") — this document stays en-US per conventions; (2) every dog named in a live asset is a real consenting member (founders first — "Bruno/Luna/Duke" below are placeholders from the §4 personas); (3) every asset is tagged to the loop it feeds (§20.3) and dies by the §20.7 kill rule if it underperforms; (4) nothing here uses urgency, guilt, or superlatives — if a line needs an exclamation point, rewrite the line.

### 20.15.1 Ad copy library

Format: **H** headline · **P** primary text · **CTA**. Mix-and-match H/P across sets is allowed; CTAs come only from the §20.8 CTA library.

**Evergreen — the record (pillar 1):**
1. **H:** Every walk counts. **P:** Tuesday. 2.4 km. Fourteen great smells. Bruno's walk, kept forever. **CTA:** Start the record
2. **H:** Your dog's life, one walk at a time. **P:** Routes drawn. Sniffs counted. Nothing about the best part of his day gets forgotten. **CTA:** Start the record
3. **H:** The walk is the best part of their day. **P:** Keep it. Every route, every sniff stop, every season — a record you'll be glad exists. **CTA:** Walk one week with us
4. **H:** 312 km together. **P:** Bruno has walked the length of the Great Ocean Road, one morning at a time. Trot kept every step. **CTA:** Start the record
5. **H:** He'll never read it. It's still his biography. **P:** Every walk you take together, drawn and kept. **CTA:** Start the record

**The neighbourhood (pillar 2):**
6. **H:** Your suburb, mapped for dogs. **P:** Which fountains work. Where the shade is after 10am. When the park goes quiet. Mapped by the dogs who walk it. **CTA:** See your neighbourhood
7. **H:** 47 dogs confirmed this fountain works. **P:** The Sniff Map is what happens when every walk makes the next one better. **CTA:** See your neighbourhood
8. **H:** The dogs of Fitzroy know things. **P:** Shaded routes, working taps, quiet hours, snake-season warnings. Now you know them too. **CTA:** Find your quiet hour

**The network (pillar 3):**
9. **H:** Bruno keeps meeting Luna. Now he knows her name. **P:** Trot notices when your dogs keep crossing paths — and lets the friendship become official. **CTA:** See who Bruno's been meeting
10. **H:** You've seen that collie eleven times. **P:** Your dog already has friends at the park. Trot just does the introductions. **CTA:** See who's at your park
11. **H:** The 7am crew, official at last. **P:** The dogs you nod at every morning — now with names, walks, and a shared record. **CTA:** Find your park

**Privacy (pillar 4):**
12. **H:** Your exact route never leaves your phone. **P:** Home stays hidden. Nothing about you is ever live. Built that way from the first line of code — read the covenant. **CTA:** Read the covenant
13. **H:** A walking app that doesn't know where you live. **P:** Home Zones clip your street out before anything is saved. That's not a setting. It's the architecture. **CTA:** Read the covenant

**Persona doors:**
14. *(Biscuit — new owner)* **H:** Is this enough walking? **P:** Trot answers gently — with your dog's own rhythm, not a red number. You're doing better than you think. **CTA:** Walk one week with us
15. *(Biscuit)* **H:** Proof you're doing right by her. **P:** Every walk recorded, every milestone celebrated. The good-dog-parent receipts. **CTA:** Start the record
16. *(Luna — reactive)* **H:** Finally know when the park is quiet. **P:** Quiet windows, wide paths, no surprises. Built with reactive-dog owners, for the walks that need space. **CTA:** Find your quiet hour
17. *(Luna)* **H:** For the 5:45am walkers. **P:** You walk early to avoid everyone. Trot tells you when you don't have to. **CTA:** Find your quiet hour
18. *(Duke — senior)* **H:** Every walk he has left, kept. **P:** Shorter now. Slower now. Still the best part of his day — and yours. **CTA:** Keep this walk
19. *(Duke)* **H:** 800 metres is a triumph at fourteen. **P:** Trot measures your dog against his own good days, never anyone else's. **CTA:** Start the record
20. *(Ranger — veteran owner)* **H:** The record his walks deserve. **P:** Ten years of mornings at the same park. Someone should have been writing it down. Now something is. **CTA:** Start the record
21. *(Ziggy — puppy)* **H:** She grows fast. Keep up. **P:** First walk, first beach, first magpie season. Trot keeps the whole first year. **CTA:** Start the record
22. *(Cooper — family)* **H:** One dog. Four walkers. One record. **P:** Everyone's walks count toward Cooper's story — the family streak lives on the fridge and in the app. **CTA:** Start the record

**Campaign — The Slowest Walk in Australia:**
23. **H:** The world's slowest race is in Melbourne. **P:** One kilometre. No time limit. The most thorough sniffer wins. Bring the dog; leave the pace. **CTA:** Enter the Slowest Walk
24. **H:** Personal worst. **P:** At the Slowest Walk, 94 minutes for one kilometre is a podium finish. Your dog was born for this. **CTA:** Enter the Slowest Walk
25. **H:** Fourteen sniff stops. One medal. **P:** Every fitness event counts speed. Ours counts curiosity. **CTA:** Enter the Slowest Walk

**Campaign — The Quiet Map:**
26. **H:** A free map of Melbourne's quiet hours. **P:** For the dogs who need space — no app required, no catch. Built with the owners who walk at dawn. **CTA:** Get the Quiet Map

**Seasonal (southern hemisphere):**
27. *(Summer)* **H:** Before nine or after six. **P:** Summer walking in Australia is a timing game. Trot knows the shade, the water, and the cool hours. **CTA:** Find the cool hours
28. *(Summer)* **H:** The five-second rule. **P:** Back of your hand on the footpath. Can't hold it five seconds? Neither can his paws. Trot flags the shade routes. **CTA:** See your neighbourhood
29. *(Autumn)* **H:** Thirty sniffs in April. **P:** The Autumn Sniffari is on — a month of celebrating the thing your dog does best. **CTA:** Join the Sniffari
30. *(Spring)* **H:** Magpie season is mapped. **P:** The dogs of your suburb know which corners to skip until November. Now their humans do too. **CTA:** See your neighbourhood
31. *(December)* **H:** A year of walks, one thread. **P:** Bruno's Year in Review is ready — every route he walked in 2027, drawn as one line. **CTA:** See the year

**App Store / ASA short lines:** "Every walk counts." · "Dog walks, drawn and kept." · "The dog walk tracker that celebrates the sniff." · "Know when the park is quiet."

### 20.15.2 Reel & short-form video library

Format: **Hook (first 2s)** → beats → sound → CTA → loop fed. Series marked ★ are recurring formats (the franchise system — one format, endless episodes).

**★ Series: "At Their Height"** *(dog-height POV, §17.8 — the signature format)*
1. **Hook:** grass-level gimbal shot bursting through a park gate. Beats: 20 seconds of one walk at dog height — legs, leaves, another nose, a fountain. On-screen: "Edinburgh Gardens, 7:04am, as Bruno sees it." Sound: ambient park, no music. CTA: none (brand film energy). Loop: sharing/brand.
2. **Hook:** "Your dog's commute is better than yours." Beats: split-screen — human eye-level grey street vs dog-height adventure of the same street. CTA: Start the record. Loop: sharing.
3. **Hook:** dog-height beach sprint, Brighton dog beach. Beats: the beach as dogs get it; ends on the walk card with the route hugging the shoreline. CTA: See your neighbourhood. Loop: local network (beach Spots).

**★ Series: "The Route Explains Itself"** *(route-draw + deadpan narration — comedy franchise)*
4. **Hook:** a bizarre route shape drawing itself in Clay. Narration: "This corner? A chip. This loop? The same chip, reconsidered." CTA: Keep this walk. Loop: sharing.
5. **Hook:** perfectly straight route, then a violent detour. "Everything was normal until the magpie." (Spring seasonal.) Loop: sharing + AU localization.
6. **Hook:** route that circles one tree four times. "Day 3. The possum knows he knows." Loop: sharing.
7. **Hook:** two routes drawn side by side — owner's plan vs actual. "The proposed agenda. The amendments." Loop: sharing.

**★ Series: "We Keep Meeting"** *(Crossed Paths storytimes — the network's tellable story)*
8. **Hook:** "We'd been calling him 'the beautiful staffy' for a year." Beats: owner-told story of a crossing card → Best Mates → now they walk Tuesdays; ends on both dog cards side by side. CTA: See who's at your park. Loop: local network.
9. **Hook:** crossing card screenshot: "3rd time crossing Luna this month." Beats: the reveal montage — same park, same time, never met; then the meeting, filmed. Loop: local network.
10. **Hook:** "My dog had a social life I didn't know about." Beats: the crossing digest as a soap-opera recap. Loop: sharing.

**★ Series: "The Regulars"** *(90-second micro-docs; the long-form §20.4 asset cut down)*
11. **Hook:** "Ray has opened this park every morning for nine years." Beats: dawn, gates, the shepherd, the podium chip on the Spot page; Ray shrugs: "someone finally noticed." Loop: advocacy/community.
12. **Hook:** "The 6am crew doesn't know each other's names. Only the dogs'." Beats: group portrait energy; ends on the Spot page gallery. Loop: community.

**★ Series: "Sniffari Science"** *(Anchor trainers; educational)*
13. **Hook:** "Your dog's walk isn't exercise. It's the newspaper." Beats: trainer explains sniff enrichment in 30s; ends on a sniff-stop count celebration. CTA: Join the Sniffari. Loop: creator.
14. **Hook:** "Let him sniff the pole. I'm serious." Beats: what a sniff stop does for a dog's brain; the auto-pause feature shown honoring it. Loop: creator + product education.
15. **Hook:** "The five-minute rule for puppies, explained in one walk." Beats: trainer + puppy, Puppy Mode duration guidance on screen. Loop: creator (puppy cohort feed).

**★ Series: "Quiet Hours"** *(the wedge; always service-first)*
16. **Hook:** empty park at dawn, one dog, exhale. Text: "For the dogs who need space." Beats: a reactive dog's calm walk in a quiet window; the quiet-map glow shown once. No hard sell. CTA: Get the Quiet Map. Loop: advocacy.
17. **Hook:** "We walk at 5:45 so no one has to see us struggle." Beats: owner voiceover; the app's quiet window suggests 9:40 Tuesday; the first daylight walk in months. Handle with §12.7-grade care. Loop: advocacy.

**Campaign — Slowest Walk:**
18. **Hook:** starting gun → nobody moves; one dog sits. Text: "The race has begun." Beats: bibs, judges with clipboards at a bush, the "Finisher: Eventually" medal. CTA: Enter the Slowest Walk. Loop: community/event.
19. **Hook:** "Training montage" music over a dog inspecting one leaf for 40 seconds. Loop: sharing.
20. **Hook:** post-race interview framing: "How did you prepare?" Owner: "We didn't." Dog: [sniffing the microphone]. Loop: sharing.

**★ Series: "Field Notes"** *(local intelligence as content)*
21. **Hook:** "Three shaded walks in Fitzroy for 35-degree days." Beats: map flyover of three Trail Tails, shade % chips visible. CTA: See your neighbourhood. Loop: content/SEO + data.
22. **Hook:** "This fountain hasn't worked since March. The dogs know." Beats: pin history, confirmations, the fixed-fountain celebration when council repairs it. Loop: data + civic story.
23. **Hook:** "Snake season starts in September. Here's what the map knows." Beats: hazard layers near waterways, trainer safety notes. Loop: data + AU localization.

**Product moments (used sparingly):**
24. **Hook:** the route draw, full-screen, no words. 12 seconds. The most-replayed asset we own. CTA: Start the record. Loop: sharing.
25. **Hook:** a phone going into a pocket at the walk's start… and not coming out until the end. Text: "It just records." Beats: lock-screen Live Activity glimpse; summary reveal at home. Loop: product trust.

### 20.15.3 Static post library

Each: concept · copy · visual note (all on Fieldcraft paper ground, §17).

1. **The artifact pair** — a real member's route-art card beside the dog's portrait. Copy: "Tuesday, 2.4 km, fourteen great smells. — Bruno, Carlton North." Visual: card + photo, serif name. *(The workhorse — one per week, always a different dog.)*
2. **The odometer** — giant tabular number. Copy: "1,000 km together. Started with a puppy who wouldn't pass the letterbox." Visual: stat block grammar, honey badge accent.
3. **The covenant card** — plain text on paper. Copy: "Your exact route never leaves your phone. Home stays hidden. Nothing about you is ever live." Visual: typography only; the trust ad. *(Runs forever.)*
4. **The bench plaque photo** — real OOH plaque photographed with a dog sitting beside it. Copy: "Reserved for the 6:45 crew." Visual: warm morning light, no logo beyond the plaque's.
5. **Fountain confirmation** — close crop of a fountain + confidence chip. Copy: "Working. 47 dogs confirmed it." Visual: Sniff Map pin styling.
6. **Founding portrait** — dog-height portrait + founding chip. Copy: "Founding Dog #041 of Melbourne. Walks Edinburgh Gardens, owns it emotionally." 
7. **The quiet window** — soft dawn photo, one dog. Copy: "Elm Trail is quiet until 9:40 most Tuesdays. Some dogs need that. Now their humans know." 
8. **Crossing announcement** — two portraits leaning together over a place chip. Copy: "Bruno & Luna. Eleven crossings before anyone said hello."
9. **The sniff-stop stat** — single number. Copy: "94 seconds. One bush. Zero regrets." Visual: stat block + pencil-wash bush illustration.
10. **Season opener (autumn)** — leaves at dog height. Copy: "Sniffari season. Thirty sniffs in April — the dogs are ready."
11. **Summer safety** — hand on footpath photo. Copy: "Five seconds. If your hand can't, his paws can't. The shade routes are mapped."
12. **Magpie season PSA** — pencil-wash magpie, respectful distance. Copy: "September to November: the dogs of Brunswick reroute. The map knows the corners."
13. **The Regular award** — podium composition. Copy: "Morning Regular, Princes Park: Winnie. 61 visits in 90 days. Dignity intact."
14. **Rest Note card** — dog asleep, paper texture. Copy: "40 degrees today. The streak pauses honourably. That's what Rest Notes are for."
15. **Caught-up art** — the asleep-under-a-tree end-state illustration. Copy: "You're all caught up. Go walk."
16. **YiR teaser (December)** — a year of Clay lines composited as one thread. Copy: "365 days. One line. Bruno's year is ready."

### 20.15.4 Carousel library

Each: title · slide arc (5–8 slides) · final-slide CTA.

1. **"Ziggy's first month"** — 6 slides: gotcha-day card → first walk (200m) → first beach → first friend crossing → the month's route constellation → "Every first, kept." CTA: Start the record. *(Template repeats for any puppy — the cohort feeds it.)*
2. **"Duke's year"** — 6 slides: January's 3km loop → winter's shorter loops → the bench he likes now → 12th-birthday walk card → lifetime odometer → "Every walk he has left, kept." *(Handled with §18.11 senior grace; no decline framing.)*
3. **"Why the sniff is the point"** — 7 slides: trainer co-byline; dog's nose vs ours → sniffing as reading the news → why pulling him past the pole is like snatching your phone mid-sentence → the auto-pause feature → sniff-count celebration. CTA: Join the Sniffari.
4. **"How Crossed Paths works (and why it's safe)"** — 6 slides: the crossing card → what we compute (place + day, never times) → what we never store (routes, schedules) → mutual opt-in → the friendship. CTA: Read the covenant. *(The privacy explainer that doubles as the network pitch.)*
5. **"Five shaded walks in Fitzroy for a scorcher"** — 7 slides: five Trail Tails with shade % chips + water pins → the five-second rule → CTA: See your neighbourhood. *(Template per suburb — infinite local series, feeds SEO loop.)*
6. **"The Founding Hundred: #001–#005"** — portraits + one-line stories per dog. CTA: none (pride post). *(Runs weekly through Phase 1–2.)*
7. **"Puppy socialisation, one walk at a time"** — 8 slides: the checklist (a cyclist ✓, an umbrella ✓, a calm large dog ✓) → vaccination-window ground rules → Puppy Mode. CTA: Start the record.
8. **"What your dog's route says about them"** — 6 slides: five real route shapes with personality readings (the perimeter patroller, the zigzag scholar, the one-tree devotee) → "every route tells on them." CTA: Keep this walk. *(High-share comedy.)*
9. **"Magpie season survival, mapped"** — 6 slides: the season explained → the swooping-corner pins → reroute suggestions → respect-the-magpie etiquette. CTA: See your neighbourhood.
10. **"How the Quiet Map was made"** — 7 slides: the 5:45am walkers → what reactive owners asked for → the aggregate data (never individuals) → the free public map → who it's for. CTA: Get the Quiet Map.
11. **"One park, one year"** — Edinburgh Gardens through four seasons: pulse histograms shifting, the winter crew, the spring puppies, the Regulars changing. CTA: Find your park.
12. **"The walk we almost didn't take"** — UGC story arc: rainy Tuesday → the reluctant leash-up → the best walk of the month, card as proof → "the worst-weather walks make the best stories." CTA: Walk one week with us.

**Library governance:** refresh cadence — ads reviewed against the §20.7 kill rule weekly; one new reel-series pilot per month (kill or franchise within four episodes); statics rotate with the seasonal calendar; carousels are evergreen with suburb/dog swaps. Every asset logs its loop tag and its performance in the §20.13 content metrics; the quarterly craft audit (§17.20) reviews the live library for voice drift.
