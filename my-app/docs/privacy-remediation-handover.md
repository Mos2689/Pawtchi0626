# Privacy remediation — what's done, what's left

Companion to the full gap review. Read `privacy-policy-revised.md` for the policy text and the
plan file for the evidence behind each finding.

---

## Done in this pass

| Artefact | Path | Note |
|---|---|---|
| Revised policy source of truth | `my-app/docs/privacy-policy-revised.md` | Placeholders and editorial notes inline |
| Revised Word document | `Downloads/Privacy Policy - REVISED DRAFT.docx` | New file — the original is untouched |
| Shipped in-app policy | `my-app/app/privacy.tsx` | Rewritten to match; `tsc --noEmit` passes clean |
| Build script for the .docx | `my-app/docs/build-privacy-docx.js` | Re-run to regenerate after edits |

Regenerate the document with:

```bash
node docs/build-privacy-docx.js "path/to/output.docx"
```

`docx` (npm) is not in this project's dependencies — the script was run from a scratch workspace.
Install it wherever you run the script, or add it as a devDependency.

### Deliberate difference between the two copies — read this before publishing

They are **not** byte-identical, on purpose:

* the **.docx** is the review copy: open decisions appear in red brackets and shaded notes explain
  why each clause changed;
* **`privacy.tsx`** is shippable today: it states the current position in every place the .docx
  leaves a decision open, because putting `[RETENTION PERIOD]` in front of a user would be worse
  than the status quo.

Once the four decisions below are made, resolve the .docx placeholders and bring both copies into
exact alignment. A header comment in `privacy.tsx` lists what is still outstanding. This drift is
the same failure mode that produced the original mismatch — it needs closing, not managing.

---

## Four decisions blocking publication

1. **Gemini API billing tier.** The claim "content sent via the API is not used to train Google's
   foundation models" holds on the **paid** tier only. Calls go to
   `generativelanguage.googleapis.com` with a raw API key, and `ask-vet` uses
   `gemini-3.1-pro-preview`, which carries different data-handling terms again. The claim has been
   **removed from both copies** pending confirmation — put it back if the tier supports it.
2. **Retention period for walk location data.** Currently indefinite. A route history whose start
   point identifies a home address is difficult to defend under APP 11.2 / IPP 9. Pick a period.
3. **Supabase project region.** Needed for APP 8 / APP 1.4(g). Not determinable from the project URL.
4. **Android advertising identifier.** Both copies now say the identifier is collected at app start
   with no consent gate, because that is what the code does. If you add the gate (B5 below), restore
   the stronger wording. This is a revenue decision — gating it will affect Meta attribution.

---

## Track B — code changes, in the order I would do them

Ranked by exposure removed per unit of effort.

| # | Change | Files | Why first |
|---|---|---|---|
| B6 | Add a privacy/terms link and one-line collection notice at signup | `app/(auth)/login.tsx`, first onboarding step | Cheapest fix on the list. APP 5 / IPP 3 currently fail outright, and §6's "by using the App you consent" has nothing to stand on. |
| B7 | Prominent location disclosure before the OS prompt; complete the Play Console Location Permissions declaration | `app/walk.tsx` | **Store-rejection risk**, not just a policy gap. |
| B1 | Route the PostHog sink through the existing allowlist **and disable `autocapture`** | `lib/analytics.ts`, `app/_layout.tsx:306` | Reuse `sanitise()` / `PII_BLOCKLIST` from `lib/metaEvents.ts`. Without the autocapture change the sanitised sink is bypassed. Lets you restore the stripping claim. |
| B9 | Delete unused `RECORD_AUDIO`; gate/delete the two `dev-*` routes; delete the cached PDF after sharing | `app.json`, `app/dev-*.tsx`, `app/vet-report.tsx` | Three small independent changes. |
| B3 | Make the `avatars` bucket private, serve signed URLs, commit the storage RLS policy | `app/(tabs)/profile.tsx:494`, new migration | Removes the §11 caveat about public photo URLs. |
| B2 | Fan account deletion out to PostHog / Firebase / RevenueCat; **commit the `delete-account` function to the repo** | `supabase/functions/delete-account/` | It is deployed but unversioned, so nobody can audit what it deletes. |
| B10 | Move the auth session to `expo-secure-store` | `lib/supabase.ts` | The storage adapter is already pluggable — drop-in swap of `SafeStorage`. |
| B5 | Gate the Meta SDK on Android; align the ATT prompt string with §18 | `app.json:80-90`, `app/_layout.tsx` | Do last — it has revenue implications and needs the decision above. |
| B8 | Cap walk retention; bound `walk:sync_queue` by age as well as attempts | migration, `lib/walk/walkSync.ts` | Depends on decision 2. |

## Track C — governance

* Confirm `https://pawtchi.com/terms` is live and consistent — the policy references it twice.
* Re-answer the **Play Data Safety** form and **Apple Privacy Nutrition Label** from the revised §2
  and diff against what is published. Several answers are wrong today for the same reasons as the
  Tier-1 findings — location, advertising ID, and "data linked to you" in particular.
* Record the **APP 1.7 automated-decision assessment** before 10 December 2026. Section 14 of the
  revised policy states the position; the assessment behind it should be written down.
* Have counsel confirm the **NZ IPP count** — the 2025 Amendment Act added IPP 3A in force
  1 May 2026, so "the 13 IPPs" is likely wrong. The numbers were dropped rather than restated.
* If the **weekly summary email** is ever switched on, §7 must be rewritten and the message needs
  consent, sender identification and a working unsubscribe under the Spam Act 2003 (Cth).

---

## Verification once Track B lands

* **B1** — `npx jest lib/analytics.test.ts lib/metaEvents.test.ts`; add a case asserting a `breed`
  prop never reaches the PostHog sink.
* **B3** — fetch an avatar URL without a token and confirm 400/403; confirm Profile and Home avatars
  still render.
* **B5** — build to a physical Android device and confirm with a proxy that no Meta event fires
  before consent; on iOS confirm the ATT prompt still appears and declining suppresses the IDFA.
* **B6** — cold-install and confirm the policy link is reachable *before* the first onboarding
  question.
* **B7** — confirm the disclosure screen precedes the OS dialog on a fresh install.
