/**
 * Canonical write orchestration for weight measurements and accepted body
 * assessments. Every UI source uses these functions so logs, the pet snapshot,
 * calories, plan state and schedules cannot drift independently.
 */

import { track } from './analytics';
import { getBreedDefaults, sizeCategoryFromWeight } from './breedData';
import {
  calculateDailyKcal,
  deriveGoal,
} from './healthMath';
import {
  deriveLifeStage,
  getAgeMonths,
  getLifeStageCalorieMultiplier,
} from './lifeStage';
import { regenerateSchedule } from './scheduleAdjuster';
import { supabase } from './supabase';
import { getLocalYMD } from './dateUtils';
import { waterPerSessionMl } from './hydration';
import { validateWeeklyLossRate } from './weightLossRate';
import { validateWeight } from './weightBounds';
import type { WeightSaveStage } from './weightSaveStages';
import {
  createWeightAssessment,
  canAssessmentSupersede,
  evaluateWeightPlan,
  isAssessableWeightKg,
  type WeightAssessmentSource,
  type WeightMeasurementEvidence,
  type WeightMeasurementSource,
  type WeightPlanPet,
} from './weightPlan';
import {
  useActivePetStore,
  type Pet,
} from '../store/useActivePetStore';
import { usePetContextStore } from '../store/usePetContextStore';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecordWeightMeasurementInput {
  pet: Pet;
  weightKg: number;
  source: WeightMeasurementSource;
  notes?: string | null;
  measuredAt?: string;
  sourceEventId?: string;
  confirmUnusual?: boolean;
  /**
   * Reports which part of the save is running, so a caller can say so.
   *
   * Optional and side-effect free — every existing call site keeps working
   * untouched. It exists because most of this function's wall-clock time is
   * spent in the schedule rebuild at the end (an AI-backed edge function), and
   * without this the UI cannot tell that apart from writing one number.
   *
   * Fired when work BEGINS, not when it finishes, so the label on screen always
   * names what is happening right now.
   */
  onStage?: (stage: WeightSaveStage) => void;
}

export interface RecordWeightAssessmentInput {
  pet: Pet;
  bcs: number;
  source: WeightAssessmentSource;
  assessedAt?: string;
  assessmentWeightKg?: number;
}


export type RecordWeightMeasurementResult =
  | {
      status: 'confirmation_required';
      message: string;
    }
  | {
      status: 'saved';
      currentWeightKg: number;
      previousWeightKg: number | null;
      targetCalories: number;
      planStatus: string;
      isBackdated: boolean;
      scheduleRegenerated: boolean;
      lossRateWarning: {
        pctPerWeek: number;
        species: 'dog' | 'cat';
      } | null;
    };

export interface RecordWeightAssessmentResult {
  applied: boolean;
  idealWeightKg: number | null;
  previousIdealWeightKg: number | null;
  targetWeightKg: number | null;
  planStatus: string;
  targetCalories: number;
  revision: number;
  discloseIdealChange: boolean;
  scheduleRegenerated: boolean;
}

function asPlanPet(
  pet: Pet,
  currentWeightKg = pet.current_weight_kg,
): WeightPlanPet {
  return {
    species: pet.species,
    breed: pet.breed,
    gender: pet.gender,
    ageMonths: getAgeMonths(pet),
    currentWeightKg,
    targetWeightKg: pet.target_weight_kg,
    idealWeightKg: pet.ideal_weight_kg,
    healthyBandLowKg: pet.healthy_band_low_kg,
    healthyBandHighKg: pet.healthy_band_high_kg,
    weightAssessmentKg: pet.weight_assessment_kg,
    weightAssessmentBcs: pet.weight_assessment_bcs,
    weightAssessedAt: pet.weight_assessed_at,
    journeyStartWeightKg: pet.weight_journey_start_kg,
    bodyConditionScore: pet.body_condition_score,
    bcsUpdatedAt: pet.bcs_updated_at,
    planStatus: pet.weight_plan_status,
    planRevision: pet.weight_plan_revision,
    reproductiveStatus: pet.reproductive_status,
  };
}

function calculatePlanCalories(
  pet: Pet,
  currentWeightKg: number,
  targetWeightKg: number | null | undefined,
  bcs: number | null | undefined,
): number {
  const ageMonths = getAgeMonths(pet);
  const breedDefaults = getBreedDefaults(
    pet.species,
    pet.breed ?? null,
    currentWeightKg,
  );
  const sizeCategory =
    breedDefaults?.sizeCategory ??
    sizeCategoryFromWeight(pet.species, currentWeightKg);
  const ageYears = pet.age_years ?? 0;
  const lifeStage = deriveLifeStage(
    pet.species,
    Math.floor(ageYears),
    Math.round((ageYears % 1) * 12),
    sizeCategory,
  );
  const goal = deriveGoal(
    currentWeightKg,
    targetWeightKg,
    bcs,
  );
  const createdAt = pet.created_at
    ? new Date(pet.created_at).getTime()
    : Number.NaN;
  const daysSincePlanStart = Number.isFinite(createdAt)
    ? Math.max(0, Math.floor((Date.now() - createdAt) / DAY_MS))
    : undefined;

  return calculateDailyKcal(
    currentWeightKg,
    pet.species,
    pet.is_neutered,
    pet.activity_level,
    goal,
    ageMonths,
    getLifeStageCalorieMultiplier(lifeStage, pet.species),
    targetWeightKg,
    breedDefaults?.metabolicModifier ?? 1,
    bcs,
    daysSincePlanStart,
    pet.reproductive_status,
    pet.pregnancy_weeks,
  );
}

async function regenerateAfterPlanChange(
  pet: Pet,
): Promise<boolean> {
  // Weight/profile reconciliation is allowed to REBUILD an activity plan, not
  // create the owner's first one. Those are separate choices in the product:
  // the Activity tab asks the owner to set their routine and explicitly build
  // a seven-day plan. Without this guard, a fresh onboarding assessment could
  // trigger the weight reconciler on first boot and silently manufacture that
  // plan before the owner had made the choice.
  //
  // Any historical AI-generated row proves the owner created a plan before,
  // even if its seven-day window has passed. Manual activity logs do not.
  const { data: existingPlan, error: existingPlanError } = await supabase
    .from('activities')
    .select('id')
    .eq('pet_id', pet.id)
    .eq('is_ai_generated', true)
    .limit(1)
    .maybeSingle();

  if (existingPlanError) {
    console.warn('[weightPlan] could not verify existing activity plan:', existingPlanError);
    return false;
  }
  if (!existingPlan) return false;

  useActivePetStore.getState().setRecalibrating(true);
  try {
    const context = usePetContextStore.getState();
    const result = await regenerateSchedule({
      pet,
      weeklyStats: null,
      todayCalPercent: context.calPercent ?? 0,
      weightTrendDirection:
        context.weightTrend?.direction ?? null,
    });
    if (result.success) {
      await supabase
        .from('activities')
        .update({
          water_ml: waterPerSessionMl(
            pet.current_weight_kg,
            pet.diet_type,
          ),
        })
        .eq('pet_id', pet.id)
        .eq('activity_type', 'water')
        .eq('scheduled_date', getLocalYMD(new Date()))
        .eq('status', 'pending');
    }
    return result.success;
  } catch {
    return false;
  } finally {
    useActivePetStore.getState().setRecalibrating(false);
  }
}

function applyAndInvalidate(patch: Partial<Pet>): void {
  useActivePetStore.getState().applyPetPatch(patch);
  usePetContextStore.getState().invalidateContext();
}

/**
 * Keep the last confirmed ideal visible while profile evidence is incomplete.
 * Used for breed/sex/life-stage changes that need a fresh body assessment.
 */
export async function requestWeightPlanReassessment(
  pet: Pet,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  const targetCalories = calculatePlanCalories(
    pet,
    pet.current_weight_kg,
    pet.target_weight_kg,
    pet.body_condition_score,
  );
  const patch: Partial<Pet> = {
    weight_plan_status: 'needs_reassessment',
    target_daily_calories: targetCalories,
    ...((pet.weight_plan_status === 'maintenance' ||
      !pet.weight_journey_start_kg)
      ? {
          weight_journey_start_kg: pet.current_weight_kg,
          weight_journey_started_at: now,
        }
      : {}),
  };
  const { error } = await supabase
    .from('pets')
    .update(patch)
    .eq('id', pet.id);
  if (error) throw error;

  applyAndInvalidate(patch);
  await regenerateAfterPlanChange({ ...pet, ...patch });
  track('weight_plan_transition', {
    from: pet.weight_plan_status ?? null,
    to: 'needs_reassessment',
    reason,
  });
}

function eventId(input: RecordWeightMeasurementInput): string {
  if (input.sourceEventId) return input.sourceEventId;
  const measuredAt = input.measuredAt ?? new Date().toISOString();
  return [
    input.source,
    input.pet.id,
    measuredAt,
    input.weightKg.toFixed(3),
  ].join(':');
}

/**
 * Record a measurement, select the latest chronological reading, and
 * reconcile it against the locked assessment. Backdated rows never replace
 * a newer current weight.
 */
export async function recordWeightMeasurement(
  input: RecordWeightMeasurementInput,
): Promise<RecordWeightMeasurementResult> {
  const validation = validateWeight(
    input.weightKg,
    input.pet.species,
    input.pet.breed,
  );
  if (validation.status === 'invalid') {
    track('weight_measurement_rejected', {
      source: input.source,
      reason: 'invalid',
    });
    throw new Error(validation.message ?? 'Invalid weight');
  }
  if (validation.status === 'soft' && !input.confirmUnusual) {
    return {
      status: 'confirmation_required',
      message: validation.message ?? 'Please confirm this weight.',
    };
  }

  // Reported after validation, so a soft-confirmation bounce never flashes a
  // "saving" step for work that has not started.
  input.onStage?.('saving');

  const measuredAt = input.measuredAt ?? new Date().toISOString();
  const sourceEventId = eventId({ ...input, measuredAt });
  const { error: insertError } = await supabase
    .from('weight_logs')
    .upsert(
      {
        pet_id: input.pet.id,
        weight_kg: input.weightKg,
        notes: input.notes ?? null,
        // Keep the legacy constrained column compatible. The precise
        // canonical source lives in the additive measurement_source column.
        source: 'manual',
        measurement_source: input.source,
        logged_at: measuredAt,
        source_event_id: sourceEventId,
      },
      {
        onConflict: 'pet_id,source_event_id',
        ignoreDuplicates: true,
      },
    );
  if (insertError) throw insertError;

  const { data: rows, error: readError } = await supabase
    .from('weight_logs')
    .select('weight_kg, logged_at')
    .eq('pet_id', input.pet.id)
    .order('logged_at', { ascending: false })
    .limit(3);
  if (readError) throw readError;

  const measurements: WeightMeasurementEvidence[] = (rows ?? [])
    .flatMap((row) => {
      const weightKg = Number(row.weight_kg);
      return Number.isFinite(weightKg) && weightKg > 0 && row.logged_at
        ? [{ weightKg, loggedAt: row.logged_at }]
        : [];
    });
  const latest = measurements[0] ?? {
    weightKg: input.weightKg,
    loggedAt: measuredAt,
  };
  const previous = measurements[1] ?? null;
  const latestAt = new Date(latest.loggedAt).toISOString();
  const isBackdated =
    new Date(measuredAt).getTime() <
    new Date(latest.loggedAt).getTime();
  const planPet = asPlanPet(input.pet, latest.weightKg);
  input.onStage?.('recalculating');

  const evaluation = evaluateWeightPlan(planPet, measurements);

  let targetCalories = calculatePlanCalories(
    input.pet,
    latest.weightKg,
    evaluation.targetWeightKg,
    input.pet.body_condition_score,
  );

  let lossRateWarning: {
    pctPerWeek: number;
    species: 'dog' | 'cat';
  } | null = null;
  if (previous) {
    const daysBetween =
      (new Date(latest.loggedAt).getTime() -
        new Date(previous.loggedAt).getTime()) /
      DAY_MS;
    const rate = validateWeeklyLossRate(
      latest.weightKg,
      previous.weightKg,
      daysBetween,
      input.pet.species,
    );
    if (rate.status === 'dangerous') {
      targetCalories = Math.round(targetCalories * 1.1);
      lossRateWarning = {
        pctPerWeek: rate.pctPerWeek,
        species: input.pet.species,
      };
    }
  }

  const patch: Partial<Pet> = {
    current_weight_kg: latest.weightKg,
    current_weight_logged_at: latestAt,
    weight_plan_status: evaluation.status,
    target_daily_calories: targetCalories,
    ...((input.pet.weight_plan_status === 'maintenance' ||
      !input.pet.weight_journey_start_kg) &&
    ['verify_change', 'needs_reassessment'].includes(
      evaluation.status,
    )
      ? {
          weight_journey_start_kg: latest.weightKg,
          weight_journey_started_at: latestAt,
        }
      : {}),
  };
  const { data: updatedRow, error: updateError } = await supabase
    .from('pets')
    .update(patch)
    .eq('id', input.pet.id)
    .lte('current_weight_logged_at', latestAt)
    .select('*')
    .maybeSingle();
  if (updateError) throw updateError;

  // A newer concurrent measurement won the timestamp guard. The submitted
  // row remains in history, but this older operation must not roll back the
  // pet snapshot, stores, calories or schedule.
  if (!updatedRow) {
    const { data: currentRow, error: currentReadError } =
      await supabase
        .from('pets')
        .select('*')
        .eq('id', input.pet.id)
        .single();
    if (currentReadError) throw currentReadError;
    useActivePetStore.setState({ activePet: currentRow as Pet });
    usePetContextStore.getState().invalidateContext();
    return {
      status: 'saved',
      currentWeightKg: Number(currentRow.current_weight_kg),
      previousWeightKg: previous?.weightKg ?? null,
      targetCalories: Number(
        currentRow.target_daily_calories ?? targetCalories,
      ),
      planStatus:
        currentRow.weight_plan_status ?? evaluation.status,
      isBackdated: true,
      scheduleRegenerated: false,
      lossRateWarning: null,
    };
  }

  applyAndInvalidate(patch);
  const updatedPet = { ...input.pet, ...patch };
  const priorGoal = deriveGoal(
    input.pet.current_weight_kg,
    input.pet.target_weight_kg,
    input.pet.body_condition_score,
  );
  const nextGoal = deriveGoal(
    updatedPet.current_weight_kg,
    updatedPet.target_weight_kg,
    updatedPet.body_condition_score,
  );
  const meaningfulDelta =
    Math.abs(
      updatedPet.current_weight_kg -
        input.pet.current_weight_kg,
    ) >= 0.3;
  const planChanged =
    evaluation.status !== input.pet.weight_plan_status;
  // The expensive one, and the only conditional one: an AI-backed schedule
  // regeneration that runs solely when the change is big enough to matter.
  // Announced inside the branch so the UI never shows a step that is skipped.
  const needsRebuild = meaningfulDelta || priorGoal !== nextGoal || planChanged;
  if (needsRebuild) input.onStage?.('rebuilding');
  const scheduleRegenerated = needsRebuild
    ? await regenerateAfterPlanChange(updatedPet)
    : false;

  track('weight_measurement_recorded', {
    source: input.source,
    plan_status: evaluation.status,
    plan_reason: evaluation.reason,
    current_weight_kg: latest.weightKg,
    is_backdated:
      isBackdated,
  });
  if (planChanged) {
    track('weight_plan_transition', {
      from: input.pet.weight_plan_status ?? null,
      to: evaluation.status,
      reason: evaluation.reason,
    });
  }

  return {
    status: 'saved',
    currentWeightKg: latest.weightKg,
    previousWeightKg: previous?.weightKg ?? null,
    targetCalories,
    planStatus: evaluation.status,
    isBackdated,
    scheduleRegenerated,
    lossRateWarning,
  };
}

/** Accept an explicit BCS and create a versioned assessment revision. */
export async function recordWeightAssessment(
  input: RecordWeightAssessmentInput,
): Promise<RecordWeightAssessmentResult> {
  if (
    !Number.isFinite(input.bcs) ||
    input.bcs < 1 ||
    input.bcs > 9
  ) {
    throw new Error('Body condition score must be between 1 and 9.');
  }

  const assessedAt = input.assessedAt ?? new Date().toISOString();
  const assessedTime = Date.parse(assessedAt);
  if (!Number.isFinite(assessedTime)) {
    throw new Error('Assessment time is invalid.');
  }
  if (
    input.assessmentWeightKg != null &&
    (!Number.isFinite(input.assessmentWeightKg) ||
      input.assessmentWeightKg <= 0)
  ) {
    throw new Error('Assessment weight must be a positive number.');
  }
  // The same rule, applied to the weight that will ACTUALLY be written. Only
  // the explicit parameter was checked above, so a pet still carrying the
  // walk-first onboarding sentinel (0) passed validation here and failed on the
  // table's `assessment_weight_kg > 0` constraint instead — turning a profile
  // state the app already knows how to handle into a database error.
  if (
    !isAssessableWeightKg(
      input.assessmentWeightKg ?? input.pet.current_weight_kg,
    )
  ) {
    throw new Error('Assessment weight must be a positive number.');
  }

  const lifeStage = deriveLifeStage(
    input.pet.species,
    Math.floor(input.pet.age_years ?? 0),
    Math.round(((input.pet.age_years ?? 0) % 1) * 12),
    getBreedDefaults(
      input.pet.species,
      input.pet.breed,
      input.pet.current_weight_kg,
    )?.sizeCategory,
  );

  let revision: ReturnType<typeof createWeightAssessment> | null =
    null;
  let isBackdated = false;

  // A revision is append-only. If two assessment sources race, the loser
  // rereads the sequence and receives the next revision instead of
  // overwriting the first assessment.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [latestResult, activeResult] = await Promise.all([
      supabase
        .from('weight_plan_assessments')
        .select('revision')
        .eq('pet_id', input.pet.id)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('weight_plan_assessments')
        .select(
          'revision, assessed_at, ideal_weight_kg, target_weight_kg, healthy_band_low_kg, healthy_band_high_kg, assessment_weight_kg, bcs, plan_status',
        )
        .eq('pet_id', input.pet.id)
        .eq('is_active', true)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (latestResult.error) throw latestResult.error;
    if (activeResult.error) throw activeResult.error;

    const activeRevision = activeResult.data;
    const latestRevision = Math.max(
      input.pet.weight_plan_revision ?? 0,
      Number(latestResult.data?.revision ?? 0),
    );
    const planPet = {
      ...asPlanPet(input.pet),
      ...(activeRevision &&
      Number(activeRevision.revision) >
        (input.pet.weight_plan_revision ?? 0)
        ? {
            idealWeightKg: activeRevision.ideal_weight_kg,
            targetWeightKg: activeRevision.target_weight_kg,
            healthyBandLowKg:
              activeRevision.healthy_band_low_kg,
            healthyBandHighKg:
              activeRevision.healthy_band_high_kg,
            weightAssessmentKg:
              activeRevision.assessment_weight_kg,
            weightAssessmentBcs: activeRevision.bcs,
            weightAssessedAt: activeRevision.assessed_at,
            planStatus: activeRevision.plan_status,
          }
        : {}),
      planRevision: latestRevision,
    };
    isBackdated = !canAssessmentSupersede(
      activeRevision?.assessed_at ??
        input.pet.weight_assessed_at,
      assessedAt,
    );
    revision = createWeightAssessment({
      pet:
        isBackdated && input.assessmentWeightKg
          ? {
              ...planPet,
              currentWeightKg: input.assessmentWeightKg,
            }
          : planPet,
      bcs: input.bcs,
      source: input.source,
      assessedAt,
      assessmentWeightKg: input.assessmentWeightKg,
    });
    const band = revision.healthyBand;
    const { error: insertError } = await supabase
      .from('weight_plan_assessments')
      .insert({
        pet_id: input.pet.id,
        revision: revision.revision,
        source: revision.source,
        assessed_at: revision.assessedAt,
        assessment_weight_kg: revision.assessmentWeightKg,
        bcs: revision.bcs,
        breed: input.pet.breed ?? null,
        sex: input.pet.gender ?? null,
        age_months: getAgeMonths(input.pet) ?? null,
        life_stage: lifeStage,
        reproductive_status:
          input.pet.reproductive_status ?? null,
        ideal_weight_kg: revision.idealWeightKg,
        target_weight_kg: revision.targetWeightKg,
        healthy_band_low_kg: band?.low ?? null,
        healthy_band_high_kg: band?.high ?? null,
        plan_status: revision.status,
        confidence: revision.confidence,
        previous_ideal_weight_kg:
          revision.previousIdealWeightKg,
        ideal_change_pct: revision.idealChangePct,
        superseded_revision:
          activeRevision?.revision ??
          input.pet.weight_plan_revision ??
          null,
        is_active: !isBackdated,
        input_snapshot: {
          current_weight_kg: input.pet.current_weight_kg,
          assessment_weight_kg: revision.assessmentWeightKg,
          body_condition_score: revision.bcs,
          breed: input.pet.breed ?? null,
          gender: input.pet.gender ?? null,
          age_months: getAgeMonths(input.pet) ?? null,
        },
      });
    if (!insertError) break;
    if (insertError.code !== '23505' || attempt === 3) {
      throw insertError;
    }
    revision = null;
  }
  if (!revision) {
    throw new Error('Could not allocate a weight-plan revision.');
  }
  const band = revision.healthyBand;

  if (isBackdated) {
    track('weight_assessment_recorded', {
      source: input.source,
      revision: revision.revision,
      plan_status: input.pet.weight_plan_status ?? null,
      backdated: true,
      applied: false,
    });
    return {
      applied: false,
      idealWeightKg: input.pet.ideal_weight_kg ?? null,
      previousIdealWeightKg: input.pet.ideal_weight_kg ?? null,
      targetWeightKg: input.pet.target_weight_kg ?? null,
      planStatus:
        input.pet.weight_plan_status ?? 'needs_reassessment',
      targetCalories:
        input.pet.target_daily_calories ??
        calculatePlanCalories(
          input.pet,
          input.pet.current_weight_kg,
          input.pet.target_weight_kg,
          input.pet.body_condition_score,
        ),
      revision: revision.revision,
      discloseIdealChange: false,
      scheduleRegenerated: false,
    };
  }

  const { error: supersedeError } = await supabase
    .from('weight_plan_assessments')
    .update({ is_active: false })
    .eq('pet_id', input.pet.id)
    .eq('is_active', true)
    .lt('revision', revision.revision);
  if (supersedeError) throw supersedeError;

  const targetCalories = calculatePlanCalories(
    input.pet,
    input.pet.current_weight_kg,
    revision.targetWeightKg,
    revision.bcs,
  );
  const patch: Partial<Pet> = {
    body_condition_score: revision.bcs,
    bcs_updated_at: revision.assessedAt,
    ideal_weight_kg: revision.idealWeightKg,
    target_weight_kg: revision.targetWeightKg,
    healthy_band_low_kg: band?.low ?? null,
    healthy_band_high_kg: band?.high ?? null,
    weight_assessment_kg: revision.assessmentWeightKg,
    weight_assessment_bcs: revision.bcs,
    weight_assessed_at: revision.assessedAt,
    weight_assessment_source: revision.source,
    weight_assessment_confidence: revision.confidence,
    weight_journey_start_kg: input.pet.current_weight_kg,
    weight_journey_started_at: new Date().toISOString(),
    weight_plan_status: revision.status,
    weight_plan_revision: revision.revision,
    target_daily_calories: targetCalories,
  };
  const { data: updatedAssessmentPet, error: updateError } =
    await supabase
    .from('pets')
    .update({
      ...patch,
      target_weight_kg: revision.targetWeightKg,
    })
    .eq('id', input.pet.id)
    .lte('weight_plan_revision', revision.revision)
    .select('weight_plan_revision')
    .maybeSingle();
  if (updateError) throw updateError;

  // A newer concurrent accepted assessment already updated the pet. Keep
  // this revision in history, but never roll the snapshot or stores back.
  if (!updatedAssessmentPet) {
    const { data: currentRow, error: currentReadError } =
      await supabase
        .from('pets')
        .select('*')
        .eq('id', input.pet.id)
        .single();
    if (currentReadError) throw currentReadError;
    useActivePetStore.setState({ activePet: currentRow as Pet });
    usePetContextStore.getState().invalidateContext();
    return {
      applied: false,
      idealWeightKg: currentRow.ideal_weight_kg ?? null,
      previousIdealWeightKg:
        revision.previousIdealWeightKg,
      targetWeightKg: currentRow.target_weight_kg ?? null,
      planStatus:
        currentRow.weight_plan_status ??
        'needs_reassessment',
      targetCalories: Number(
        currentRow.target_daily_calories ??
          targetCalories,
      ),
      revision: revision.revision,
      discloseIdealChange: false,
      scheduleRegenerated: false,
    };
  }

  applyAndInvalidate(patch);
  const updatedPet = { ...input.pet, ...patch };
  const scheduleRegenerated =
    await regenerateAfterPlanChange(updatedPet);

  track('weight_assessment_recorded', {
    source: input.source,
    revision: revision.revision,
    plan_status: revision.status,
    previous_ideal_weight_kg:
      revision.previousIdealWeightKg,
    ideal_weight_kg: revision.idealWeightKg,
    ideal_change_disclosed: revision.discloseIdealChange,
  });
  track('weight_plan_transition', {
    from: input.pet.weight_plan_status ?? null,
    to: revision.status,
    reason: 'accepted_assessment',
  });

  return {
    applied: true,
    idealWeightKg: revision.idealWeightKg,
    previousIdealWeightKg:
      revision.previousIdealWeightKg,
    targetWeightKg: revision.targetWeightKg,
    planStatus: revision.status,
    targetCalories,
    revision: revision.revision,
    discloseIdealChange: revision.discloseIdealChange,
    scheduleRegenerated,
  };
}

/**
 * Read-side repair for older/interrupted writes. Safe on focus: it updates
 * only the effective status when the persisted state disagrees.
 */
export async function reconcilePersistedWeightPlan(
  pet: Pet,
): Promise<void> {
  const [measurementResult, assessmentResult] = await Promise.all([
    supabase
      .from('weight_logs')
      .select('weight_kg, logged_at')
      .eq('pet_id', pet.id)
      .order('logged_at', { ascending: false })
      .limit(3),
    supabase
      .from('weight_plan_assessments')
      .select('*')
      .eq('pet_id', pet.id)
      .eq('is_active', true)
      .order('revision', { ascending: false })
      .limit(2),
  ]);
  if (measurementResult.error) throw measurementResult.error;
  if (assessmentResult.error) throw assessmentResult.error;

  const data = measurementResult.data;
  const activeAssessments = assessmentResult.data ?? [];
  const pendingAssessment = activeAssessments[0] ?? null;
  const hasConflictingActiveAssessments =
    activeAssessments.length > 1;
  const hasUnappliedAssessment =
    pendingAssessment &&
    Number(pendingAssessment.revision) >
      (pet.weight_plan_revision ?? 0);
  const reconciledPet: Pet = hasUnappliedAssessment
    ? {
        ...pet,
        body_condition_score: pendingAssessment.bcs,
        bcs_updated_at: pendingAssessment.assessed_at,
        ideal_weight_kg: pendingAssessment.ideal_weight_kg,
        target_weight_kg: pendingAssessment.target_weight_kg,
        healthy_band_low_kg:
          pendingAssessment.healthy_band_low_kg,
        healthy_band_high_kg:
          pendingAssessment.healthy_band_high_kg,
        weight_assessment_kg:
          pendingAssessment.assessment_weight_kg,
        weight_assessment_bcs: pendingAssessment.bcs,
        weight_assessed_at: pendingAssessment.assessed_at,
        weight_assessment_source: pendingAssessment.source,
        weight_assessment_confidence:
          pendingAssessment.confidence,
        weight_journey_start_kg:
          Number(
            pendingAssessment.input_snapshot?.current_weight_kg,
          ) > 0
            ? Number(
                pendingAssessment.input_snapshot.current_weight_kg,
              )
            : pendingAssessment.assessment_weight_kg,
        weight_journey_started_at:
          pendingAssessment.created_at ??
          pendingAssessment.assessed_at,
        weight_plan_status: pendingAssessment.plan_status,
        weight_plan_revision: pendingAssessment.revision,
      }
    : pet;
  const measurements: WeightMeasurementEvidence[] = (data ?? [])
    .flatMap((row) => {
      const weightKg = Number(row.weight_kg);
      return Number.isFinite(weightKg) && weightKg > 0 && row.logged_at
        ? [{ weightKg, loggedAt: row.logged_at }]
        : [];
    });
  const newestLog = measurements[0];
  const newestLogTime = newestLog
    ? new Date(newestLog.loggedAt).getTime()
    : Number.NaN;
  const persistedTime = reconciledPet.current_weight_logged_at
    ? Date.parse(reconciledPet.current_weight_logged_at)
    : Number.NaN;
  const useNewestLog =
    newestLog != null &&
    (!Number.isFinite(persistedTime) ||
      newestLogTime >= persistedTime);
  const latestAt = useNewestLog
    ? new Date(newestLog.loggedAt).toISOString()
    : reconciledPet.current_weight_logged_at ?? null;
  const latestWeight = useNewestLog
    ? newestLog.weightKg
    : reconciledPet.current_weight_kg;
  const evaluation = evaluateWeightPlan(
    asPlanPet(reconciledPet, latestWeight),
    measurements,
  );
  const targetCalories = calculatePlanCalories(
    reconciledPet,
    latestWeight,
    evaluation.targetWeightKg,
    reconciledPet.body_condition_score,
  );
  const needsJourneyAnchor =
    (reconciledPet.weight_plan_status === 'maintenance' ||
      !reconciledPet.weight_journey_start_kg) &&
    ['verify_change', 'needs_reassessment'].includes(
      evaluation.status,
    );
  const patch: Partial<Pet> = {
    ...(hasUnappliedAssessment
      ? {
          body_condition_score:
            reconciledPet.body_condition_score,
          bcs_updated_at: reconciledPet.bcs_updated_at,
          ideal_weight_kg: reconciledPet.ideal_weight_kg,
          target_weight_kg: reconciledPet.target_weight_kg,
          healthy_band_low_kg:
            reconciledPet.healthy_band_low_kg,
          healthy_band_high_kg:
            reconciledPet.healthy_band_high_kg,
          weight_assessment_kg:
            reconciledPet.weight_assessment_kg,
          weight_assessment_bcs:
            reconciledPet.weight_assessment_bcs,
          weight_assessed_at:
            reconciledPet.weight_assessed_at,
          weight_assessment_source:
            reconciledPet.weight_assessment_source,
          weight_assessment_confidence:
            reconciledPet.weight_assessment_confidence,
          weight_journey_start_kg:
            reconciledPet.weight_journey_start_kg,
          weight_journey_started_at:
            reconciledPet.weight_journey_started_at,
          weight_plan_revision:
            reconciledPet.weight_plan_revision,
        }
      : {}),
    current_weight_kg: latestWeight,
    current_weight_logged_at: latestAt,
    weight_plan_status: evaluation.status,
    target_daily_calories: targetCalories,
    ...(needsJourneyAnchor
      ? {
          weight_journey_start_kg: latestWeight,
          weight_journey_started_at:
            latestAt ?? new Date().toISOString(),
        }
      : {}),
  };
  const isAlreadyReconciled =
    !hasUnappliedAssessment &&
    !hasConflictingActiveAssessments &&
    evaluation.status === reconciledPet.weight_plan_status &&
    latestWeight === reconciledPet.current_weight_kg &&
    ((latestAt == null && reconciledPet.current_weight_logged_at == null) ||
      (latestAt != null &&
        reconciledPet.current_weight_logged_at != null &&
        Date.parse(latestAt) ===
          Date.parse(reconciledPet.current_weight_logged_at))) &&
    targetCalories === reconciledPet.target_daily_calories &&
    !needsJourneyAnchor;
  if (isAlreadyReconciled) return;

  const { error } = await supabase
    .from('pets')
    .update(patch)
    .eq('id', pet.id);
  if (error) throw error;

  if (pendingAssessment && hasConflictingActiveAssessments) {
    const { error: cleanupError } = await supabase
      .from('weight_plan_assessments')
      .update({ is_active: false })
      .eq('pet_id', pet.id)
      .eq('is_active', true)
      .neq('revision', pendingAssessment.revision);
    if (cleanupError) throw cleanupError;
  }

  applyAndInvalidate(patch);
  const meaningfulWeightChange =
    Math.abs(latestWeight - reconciledPet.current_weight_kg) >=
    0.3;
  if (
    meaningfulWeightChange ||
    evaluation.status !== reconciledPet.weight_plan_status ||
    hasUnappliedAssessment
  ) {
    await regenerateAfterPlanChange({
      ...reconciledPet,
      ...patch,
    });
  }
  track('weight_plan_transition', {
    from: pet.weight_plan_status ?? null,
    to: evaluation.status,
    reason: evaluation.reason,
    source: 'focus_reconciliation',
  });
}
