/**
 * The banner conditions, lifted out of the banner components.
 *
 * Each of the migrated banners kept its own visibility test inside its own
 * render body — `if (bcs < 8) return null`, `if (dismissed) return null`, and so
 * on. That was fine while the component *was* the surface. Now that the center
 * decides what exists, the tests have to be answerable without mounting
 * anything, so they live here as pure functions over plain values.
 *
 * The predicates are copied across unchanged. Every threshold, every dismiss
 * key and every dismiss window is byte-identical to the component it came from,
 * because a migration that quietly re-shows a banner someone dismissed in March
 * is indistinguishable from a bug.
 *
 * Dismiss STATE is not read here — this module stays pure and synchronous. The
 * store loads the AsyncStorage values (using the key builders exported below)
 * and passes them in.
 */

import clinicalAdjustments from '../../data/clinical_adjustments.json';
import type { MissingItem } from '../profileCompleteness';
import type { ObservedMerResult } from '../observedMer';
import { PERSISTENT_SCOPE, dayScope, stableId } from './stableId';
import type { InboxItem } from './types';

// ── Dismiss keys ────────────────────────────────────────────────────────────
// Verbatim from the components. Changing any of these resurrects a banner for
// every owner who has already dealt with it.

const VET_TUNED_PREFIX = '@pawtchi/vet_tuned_banner_dismissed:';
const GROWTH_PHASE_PREFIX = '@pawtchi/growth_phase_banner_dismissed:';
const MER_RECALIB_PREFIX = '@pawtchi/mer_recalib_dismissed_at:';
/**
 * Per-pet, unlike the global key `ProfileCompletionCard` used to write.
 *
 * A global key meant the next account on the device inherited this one's
 * three-day dismissal, so a brand-new owner's profile prompt could be suppressed
 * before they ever saw it. Keying by pet — matching the three prefixes above —
 * fixes that and the multi-pet case in one go.
 */
const PROFILE_COMPLETION_PREFIX = '@pawtchi/profile_completion_dismissed_at:';

export const PROFILE_COMPLETION_RESURFACE_MS = 3 * 24 * 60 * 60 * 1000;
export const MER_DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export const vetTunedDismissKey = (petId: string) => `${VET_TUNED_PREFIX}${petId}`;
export const growthPhaseDismissKey = (petId: string) => `${GROWTH_PHASE_PREFIX}${petId}`;
export const merRecalibDismissKey = (petId: string) => `${MER_RECALIB_PREFIX}${petId}`;
export const profileCompletionDismissKey = (petId: string) => `${PROFILE_COMPLETION_PREFIX}${petId}`;

/** Friendly labels for the deferred conditions. Verbatim from VetTunedNutritionBanner. */
const DEFERRED_LABELS: Record<string, string> = {
  diabetes: 'Diabetes',
  ckd_stage_2: 'Kidney disease (CKD stage 2)',
  ckd_stage_3: 'Kidney disease (CKD stage 3)',
  urolithiasis_oxalate: 'Oxalate bladder stones',
};

/** Which of an animal's conditions need a vet-set diet the app must not guess at. */
export function matchedDeferredConditions(
  medicalConditions: string[] | null | undefined,
): string[] {
  const deferredKeys = Object.keys(clinicalAdjustments._deferred_conditions ?? {}).filter(
    k => !k.startsWith('_'),
  );
  const conditions = medicalConditions ?? [];
  return deferredKeys.filter(k => conditions.includes(k));
}

export interface BannerInput {
  petId: string | null | undefined;
  petName: string;
  species: 'dog' | 'cat' | string | null | undefined;
  goal: 'lose' | 'maintain' | 'gain' | null | undefined;

  bcs: number | null | undefined;
  severeObesityVetConfirmedAt: string | null | undefined;
  medicalConditions: string[] | null | undefined;
  ageMonths: number | undefined;
  currentWeightKg: number | null | undefined;
  targetWeightKg: number | null | undefined;

  todayCalories: number;
  observedMer: ObservedMerResult | null;

  subscriptionStatus: string | null | undefined;
  trialDaysLeft: number | null | undefined;

  completeness: { score: number; missing: MissingItem[]; isAccurateEnough: boolean } | null;
  pendingCheckin: { questionId: string; reason: string | null } | null;

  /** The next scheduled item on today's plan, if any. */
  nextActivity: {
    id: string;
    activity_type: string;
    title: string;
    scheduled_time: string | null;
    duration_minutes: number | null;
    intensity: string | null;
    notes: string | null;
  } | null;
  /** Walks are dogs-only; decides whether the walk item offers tracking. */
  walkEnabled: boolean;
  /**
   * Whether the Activity tab would actually open — `checkFeature('activity_plan')`.
   *
   * The plan rows can exist while the tab that shows them is gated shut: a
   * schedule generated before a weight was cleared, or on another device, leaves
   * 49 activity rows behind a `HealthProfileGate` the owner still has to pass.
   * Without this the centre cheerfully announced "Relaxing Grooming Session at
   * 19:45" for a plan that could not be opened, tapped through to, or acted on.
   */
  activityPlanReady: boolean;

  currentStreak: number;
  longestStreak: number;

  /** Dismiss state, already read from AsyncStorage by the store. */
  dismissed: {
    vetTuned: boolean;
    growthPhase: boolean;
    /** True while inside the 14-day rejection window. */
    merRecalibration: boolean;
    /** True while inside the 3-day resurface window. */
    profileCompletion: boolean;
  };

  /** Injectable for tests. Defaults to the local hour. */
  hour?: number;
  /** Injectable for tests. Defaults to now. */
  now?: Date;
}

/** Possessive that handles names ending in "s" cleanly. Verbatim from ProfileCompletionCard. */
function possessive(name: string): string {
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

/** Glyph per activity type. Verbatim from the retired Up next row. */
const ACTIVITY_ICON: Record<string, string> = {
  walk: 'directions-walk',
  play: 'sports-baseball',
  water: 'water-drop',
  training: 'school',
  grooming: 'content-cut',
};

/**
 * The Up next subtitle, unchanged from the row it replaces: duration and
 * intensity when they exist, then the free-text note, then a type-specific
 * fallback so the line is never empty.
 */
function describeActivity(act: NonNullable<BannerInput['nextActivity']>): string {
  const parts = [
    act.duration_minutes ? `${act.duration_minutes} min` : null,
    act.intensity || null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  if (act.notes) return act.notes;
  switch (act.activity_type) {
    case 'water': return 'Hydration break';
    case 'meal':
    case 'dinner':
    case 'breakfast':
    case 'lunch': return 'Mealtime';
    case 'grooming': return 'Grooming';
    case 'training': return 'Training session';
    case 'walk': return 'Time to move';
    case 'play': return 'Playtime';
    default: return 'Tap to start';
  }
}

/**
 * Every banner condition that currently holds, as inbox items.
 *
 * Order here is presentation-neutral — the center sorts by tone and recency —
 * but the clinical trio is listed first so the file reads in the order of how
 * much each matters.
 */
export function buildBannerItems(input: BannerInput): InboxItem[] {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const hour = typeof input.hour === 'number' ? input.hour : now.getHours();
  const name = input.petName?.trim() || 'your companion';
  const petId = input.petId ?? null;
  const items: InboxItem[] = [];

  /**
   * Ties an id to the animal it is about.
   *
   * Without this, `banner:profile_completion:persistent` is the identical string
   * for every pet in the world — so dismissing it for one animal dismissed it
   * for the next one too, whether that was a second pet in the same household or
   * a different account entirely on the same device.
   *
   * Only applied to the pet-specific items. `trial_ending` and `streak_broken`
   * belong to the account rather than the animal, and `up_next` / `vet_checkin`
   * already carry a unique row id.
   */
  const petScoped = (key: string) => (petId ? `${key}_${petId}` : key);

  // ── Severe obesity: a consent gate, not a suggestion ──────────────────────
  // AAHA/WSAVA: a BCS 8-9 animal needs bloodwork to rule out hypothyroidism and
  // Cushing's before a kcal-restricted plan is safe to follow. `sticky`, and it
  // stays until the owner asserts the vet conversation happened.
  if (
    petId &&
    typeof input.bcs === 'number' &&
    input.bcs >= 8 &&
    !input.severeObesityVetConfirmedAt
  ) {
    items.push({
      id: stableId('banner', petScoped('severe_obesity_vet'), PERSISTENT_SCOPE),
      source: 'banner',
      tone: 'clinical',
      title: `Vet check recommended for ${name}`,
      body: `A body condition of ${input.bcs}/9 often goes with thyroid or hormonal issues that change the right plan. Please confirm with your vet before relying on this calorie target.`,
      icon: 'local-hospital',
      createdAt: nowIso,
      action: 'confirm_vet_consult',
      petId,
      sticky: true,
    });
  }

  // ── Cat refusing food ─────────────────────────────────────────────────────
  // Cats on a weight-loss plan can develop hepatic lipidosis when they stop
  // eating; even 48-72 hours can be fatal. Only after ~2pm — earlier in the day
  // zero calories is not yet a signal.
  if (
    input.species === 'cat' &&
    input.goal === 'lose' &&
    input.todayCalories === 0 &&
    hour >= 14
  ) {
    items.push({
      id: stableId('banner', petScoped('cat_refusing_food'), dayScope(now)),
      source: 'banner',
      tone: 'clinical',
      title: `Has ${name} eaten today?`,
      body: `Cats on a weight-loss plan can develop a dangerous liver condition, hepatic lipidosis, if they stop eating. If ${name} has refused food for more than 24 hours, please call your vet rather than waiting it out.`,
      icon: 'warning-amber',
      createdAt: nowIso,
      petId,
      sticky: true,
    });
  }

  // ── Conditions whose diet targets only a vet can set ──────────────────────
  const deferred = matchedDeferredConditions(input.medicalConditions);
  if (petId && deferred.length > 0 && !input.dismissed.vetTuned) {
    const conditionList = deferred.map(k => DEFERRED_LABELS[k] ?? k).join(', ');
    items.push({
      id: stableId('banner', petScoped('vet_tuned_nutrition'), PERSISTENT_SCOPE),
      source: 'banner',
      tone: 'clinical',
      title: 'Vet-tuned nutrition needed',
      body: `${conditionList} need${deferred.length === 1 ? 's' : ''} diet targets your vet sets. The Pawtchi plan for ${name} is generic guidance, so check in with your vet before relying on it.`,
      icon: 'medical-services',
      createdAt: nowIso,
      petId,
      sticky: true,
    });
  }

  // ── Growing animal with a restriction goal ────────────────────────────────
  // The kcal engine deliberately overrides to maintenance here to avoid stunted
  // growth and orthopedic disease. This explains why, so the plan does not look
  // like it is ignoring the goal.
  const isGrowing = typeof input.ageMonths === 'number' && input.ageMonths < 12;
  const wantsRestriction =
    typeof input.currentWeightKg === 'number' &&
    typeof input.targetWeightKg === 'number' &&
    input.targetWeightKg > 0 &&
    input.targetWeightKg < input.currentWeightKg;
  if (petId && isGrowing && wantsRestriction && !input.dismissed.growthPhase) {
    items.push({
      id: stableId('banner', petScoped('growth_phase'), PERSISTENT_SCOPE),
      source: 'banner',
      tone: 'clinical',
      title: 'Growing pets need calories',
      body: `${name} is still growing, so the plan stays focused on healthy portions rather than restriction. Talk to your vet if you are concerned about weight.`,
      icon: 'child-care',
      createdAt: nowIso,
      petId,
    });
  }

  // ── Up next ───────────────────────────────────────────────────────────────
  //
  // The one remaining prompt on the Health tab. It is a scheduled reminder
  // about something that has not happened yet, which is exactly what the center
  // is for — and once the rest of the feed moved, leaving it behind made Health
  // look like it had one nudge nobody had got round to.
  //
  // Scoped to the activity row plus the day, so the item follows the plan
  // rather than resetting at midnight while the same task is still pending.
  //
  // Gated on the same check `HealthProfileGate` puts in front of the Activity
  // tab. The centre must never advertise something the owner cannot open: the
  // plan rows outlive the profile that justified them, so "there is a
  // nextActivity" is not the same question as "this owner has an activity plan".
  if (input.nextActivity && input.activityPlanReady) {
    const act = input.nextActivity;
    const isWalk = act.activity_type === 'walk';
    const at = act.scheduled_time ? act.scheduled_time.slice(0, 5) : null;

    items.push({
      id: stableId('banner', `up_next_${act.id}`, dayScope(now)),
      source: 'banner',
      tone: 'action',
      title: at ? `${act.title} at ${at}` : act.title,
      body: describeActivity(act),
      icon: ACTIVITY_ICON[act.activity_type] ?? 'star',
      createdAt: nowIso,
      // A dog's walk goes straight to tracking; everything else opens the plan.
      // Same split the row's "Track" button made, so the shortcut survives.
      route: isWalk && input.walkEnabled ? '/walk' : '/(tabs)/activity',
      petId,
      meta: { activity_type: act.activity_type, scheduled_time: at },
    });
  }

  // ── Pending Second Opinion check-in ───────────────────────────────────────
  if (input.pendingCheckin) {
    const { questionId, reason } = input.pendingCheckin;
    items.push({
      // Scoped to the case id: one item per open case, and it survives the day
      // boundary because the case does.
      id: stableId('banner', `vet_checkin_${questionId}`, PERSISTENT_SCOPE),
      source: 'banner',
      tone: 'action',
      title: `Checking in on ${name}`,
      body: reason ? `How are things going ${reason}?` : `How is ${name} doing now?`,
      icon: 'favorite-border',
      createdAt: nowIso,
      route: `/ask?case=${questionId}&mode=checkin`,
      petId,
    });
  }

  // ── MER recalibration ─────────────────────────────────────────────────────
  // Fires when real maintenance calories drift more than 15% from the formula.
  // The plan is never mutated silently, so this carries an action rather than a
  // route — resolving it opens the same confirm modal the banner used.
  if (
    petId &&
    input.observedMer &&
    input.observedMer.status === 'recalibration_suggested' &&
    !input.dismissed.merRecalibration
  ) {
    const oldKcal = input.observedMer.predictedDailyKcal;
    const newKcal = input.observedMer.suggestedDailyKcal ?? oldKcal;
    items.push({
      id: stableId('banner', petScoped('mer_recalibration'), PERSISTENT_SCOPE),
      source: 'banner',
      tone: 'action',
      title: `Recalibrate ${possessive(name)} plan`,
      body: `${name} is running at about ${newKcal} kcal a day rather than the predicted ${oldKcal}. Reviewing the target keeps the plan matched to real intake.`,
      icon: 'tune',
      createdAt: nowIso,
      action: 'review_mer_recalibration',
      petId,
      meta: { old_kcal: oldKcal, new_kcal: newKcal },
    });
  }

  // ── Profile completeness ──────────────────────────────────────────────────
  // Every downstream calculation leans on these fields, so this is the highest-
  // leverage item in the feed even though it is never urgent.
  //
  // Weight is handled separately because `computeCompleteness` does not score it
  // at all — its FIELDS list has no weight entry, a gap from when onboarding
  // could not finish without one. Two consequences, both visible to owners:
  // it recommended "add a food to the pantry" while the health gate one tab away
  // said the blocker was the weight, and a pet could read as `isAccurateEnough`
  // with no weight at all, retiring this prompt while every health feature
  // stayed locked.
  //
  // Reported under focus `bcs`, the same compromise `featureRequirements.ts`
  // makes for its WEIGHT_ITEM: weight has no FocusKey of its own, and bcs is the
  // deep link that lands closest to it.
  const completeness = input.completeness;
  const hasWeight = typeof input.currentWeightKg === 'number' && input.currentWeightKg > 0;
  const weightStep: MissingItem = {
    key: 'bcs',
    label: 'Add a current weight',
    impact: 'high',
    weight: 4,
    focus: 'bcs',
  };
  if (
    completeness &&
    (!completeness.isAccurateEnough || !hasWeight) &&
    (completeness.missing.length > 0 || !hasWeight) &&
    !input.dismissed.profileCompletion
  ) {
    // Weight leads when it is missing: it is the field whose absence produces
    // the most confidently wrong number, and the one the gate will ask for next.
    const missing = hasWeight ? completeness.missing : [weightStep, ...completeness.missing];
    const next: MissingItem = missing[0];
    const count = missing.length;
    items.push({
      id: stableId('banner', petScoped('profile_completion'), PERSISTENT_SCOPE),
      source: 'banner',
      tone: 'action',
      title: `${possessive(name)} full picture`,
      body:
        count === 1
          ? `1 detail left to make ${possessive(name)} results more accurate. Next: ${next.label.toLowerCase()}.`
          : `${count} details left to make ${possessive(name)} results more accurate. Next: ${next.label.toLowerCase()}.`,
      icon: 'account-circle',
      createdAt: nowIso,
      route: `/(tabs)/profile?focus=${next.focus}`,
      petId,
      meta: { score: completeness.score, next_key: next.key },
    });
  }

  // ── Trial ending ──────────────────────────────────────────────────────────
  if (
    input.subscriptionStatus === 'trial' &&
    typeof input.trialDaysLeft === 'number' &&
    input.trialDaysLeft <= 5
  ) {
    const d = input.trialDaysLeft;
    items.push({
      id: stableId('banner', 'trial_ending', dayScope(now)),
      source: 'banner',
      tone: 'info',
      title:
        d === 0 ? 'The trial ends today' : d === 1 ? '1 day left on the trial' : `${d} days left on the trial`,
      body: `Keeping Pawtchi Plus keeps ${possessive(name)} picture complete and the AI features available.`,
      icon: 'schedule',
      createdAt: nowIso,
      route: '/paywall',
      petId,
    });
  }

  // ── Broken streak ─────────────────────────────────────────────────────────
  if (input.currentStreak === 0 && input.longestStreak > 0) {
    items.push({
      id: stableId('banner', 'streak_broken', dayScope(now)),
      source: 'banner',
      tone: 'info',
      title: `${input.longestStreak}-day streak to beat`,
      body: 'Logging something today starts a new one.',
      icon: 'replay',
      createdAt: nowIso,
      route: '/(tabs)/meal',
      petId,
    });
  }

  return items;
}
