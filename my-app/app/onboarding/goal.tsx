import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert, Platform} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  forwardCompletionParams,
  isCompletionMode,
} from '../../lib/onboarding/completionMode';
import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withSequence, withSpring, withTiming, FadeIn,
} from 'react-native-reanimated';

import { LinearGradient } from 'expo-linear-gradient';

import { supabase } from '../../lib/supabase';
import { petFallbackImage } from '../../lib/petFallbackImage';
import { useAuth } from '../../providers/AuthProvider';
import { usePetStore } from '../../store/usePetStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { OnboardingHeader } from '../../components/OnboardingHeader';
import { BodyShapeIcon } from '../../components/icons/BodyShapeIcon';
import { CountUpText } from '../../components/CountUpText';
import { WeightJourneyBar } from '../../components/WeightJourneyBar';
import { haptic } from '../../lib/haptics';

import { calculateDailyKcal, deriveGoal, shouldBlockGrowthWeightLoss } from '../../lib/healthMath';
import { getBreedDefaults } from '../../lib/breedData';
import { deriveLifeStage, getLifeStageCalorieMultiplier, getLifeStageLabel } from '../../lib/lifeStage';
import {
  estimateIdealWeight, computeSliderBounds, activitySuggestion, stageCount,
  IdealWeightResult,
} from '../../lib/idealWeight';
import { SAFE_PCT_PER_WEEK } from '../../lib/weightLossRate';
import { BCS_OPTIONS, CLASSIFICATION_LABEL } from '../../lib/bcsOptions';
import { bucketForBcs, deriveBcsSuggestion, resolveBcsSource } from '../../lib/bcsPhotoEstimate';
import { errorCopy, reportError, toAppError, type ErrorCopy } from '../../lib/appError';
import { ErrorState } from '../../components/ErrorState';
import { track } from '../../lib/analytics';
import {
  stepIndex, trackStepCompleted, useOnboardingStepTracking,
} from '../../lib/onboardingFunnel';
import { deriveProvisionalWalksign } from '../../lib/walksign/walksignEngine';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


// Step 6 of 6 — set goal. The last input screen before the plan reveal.
export default function GoalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const completionParams = useLocalSearchParams<{ mode?: string; feature?: string }>();
  const completing = isCompletionMode(completionParams);
  useOnboardingStepTracking('goal');

  const { user } = useAuth();
  const petData = usePetStore();
  // No resetForm here on purpose: `reveal` reads the plan summary this screen
  // writes into the store, and clears it once the owner has seen it.
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  // Severe cases (BCS 8/9 obesity OR severe underweight per the estimator)
  // must confirm they've reviewed the plan with a vet before proceeding.
  // Severe obesity often co-occurs with hypothyroidism or Cushing's; severe
  // underweight can signal parasites, malabsorption, or worse — bloodwork
  // should come first in both directions. The checkbox acknowledges, it
  // never blocks the weight from being entered or the plan from existing.
  const [vetConfirmedSevereCondition, setVetConfirmedSevereCondition] = useState(false);
  const isSevereObesity = (petData.bodyConditionScore ?? 0) >= 8;

  // Start Target weight at current weight. body-basics.tsx blocks save when
  // weight isn't a positive number in species bounds, so by the time this
  // screen renders we should never see a NaN. Fall back to 0 (which disables
  // the build-plan CTA via the weight check below) rather than 18.5, which
  // silently substituted a medium-dog weight and could mis-feed a toy or cat.
  const currentWeight = parseFloat(petData.weight) || 0;
  const [targetWeight, setTargetWeight] = useState(currentWeight);
  const [idealExplanation, setIdealExplanation] = useState('');
  const [estimating, setEstimating] = useState(true);
  // When the estimate lands, the number ticks from the current weight into the
  // estimated target — a brief reveal instead of a silent swap.
  const [sweep, setSweep] = useState<{ from: number; to: number } | null>(null);
  const [estimatePhase, setEstimatePhase] = useState('');
  // Full assessment result from the estimator. The current weight is a
  // MEASUREMENT, never an error — out-of-band pets get a classification, a
  // band-anchored target, and a non-blocking vet advisory instead of a gate.
  const [estimate, setEstimate] = useState<IdealWeightResult | null>(null);
  // Bumped per estimate so the journey map remounts (replays its build
  // choreography) on a new estimate but NOT on slider drags.
  const [estimateSeq, setEstimateSeq] = useState(0);
  // Progressive disclosure: the advisory and the fine-tune slider start
  // collapsed — the vet-grade estimate is the default path, adjustment and
  // medical detail are one tap away for those who want them.
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Body-shape carousel discoverability: scroll metrics drive progress dots
  // and the right-edge fade; a one-time nudge teaches the swipe.
  const [bcsScrollX, setBcsScrollX] = useState(0);
  const [bcsViewportW, setBcsViewportW] = useState(0);
  const [bcsContentW, setBcsContentW] = useState(0);
  const bcsScrollRef = React.useRef<ScrollView>(null);
  const bcsNudged = React.useRef(false);
  const bcsSuggestionTracked = React.useRef(false);
  const bcsSuggestionScrolled = React.useRef(false);

  // Life stage computation
  const weightKg = parseFloat(petData.weight) || null;
  const breedDefaults = getBreedDefaults(petData.species, petData.breed, weightKg);
  const ageYearsNum = parseInt(petData.ageYears) || 0;
  const ageMonthsNum = parseInt(petData.ageMonths) || 0;
  const speciesVal = (petData.species === 'cat') ? 'cat' as const : 'dog' as const;
  const lifeStage = deriveLifeStage(speciesVal, ageYearsNum, ageMonthsNum, breedDefaults?.sizeCategory);
  const lifeStageLabel = getLifeStageLabel(lifeStage, speciesVal);
  const lifeStageMultiplier = getLifeStageCalorieMultiplier(lifeStage, speciesVal);

  const petName = petData.name?.trim() || 'your pet';

  // BCS normally arrives from the hands-on check step (guided or quick-pick).
  // The silhouette picker below survives only as the safety fallback for the
  // rare arrival without one — latched at mount so picking a card in the
  // fallback doesn't make the picker vanish mid-interaction.
  const arrivedWithBcs = React.useRef(petData.bodyConditionScore != null).current;

  // Photo body-shape read — the raw estimate was fetched in the background
  // after body-basics; gating into a suggestion happens HERE, at display
  // time, so the scale cross-check always uses the live weight/breed. The
  // AI never writes the score: it pre-highlights a card, the owner's tap
  // confirms. Anything short of a confident read renders as no suggestion.
  const photoDecision = React.useMemo(() => {
    if (!petData.bcsPhotoRaw) return null;
    return deriveBcsSuggestion(petData.bcsPhotoRaw, {
      species: speciesVal,
      breed: petData.breed || null,
      sex: (petData.gender === 'male' || petData.gender === 'female') ? petData.gender : null,
      currentWeightKg: currentWeight,
    });
  }, [petData.bcsPhotoRaw, speciesVal, petData.breed, petData.gender, currentWeight]);
  const photoSuggestion = photoDecision?.suggestion ?? null;
  // Chip + card highlight only while the question is still open.
  const showPhotoSuggestion = photoSuggestion != null && petData.bodyConditionScore == null;
  const suggestedOption = photoSuggestion
    ? BCS_OPTIONS.find((o) => o.bcs === photoSuggestion.bucket) ?? null
    : null;

  React.useEffect(() => {
    if (bcsSuggestionTracked.current || !photoDecision) return;
    bcsSuggestionTracked.current = true;
    if (showPhotoSuggestion && photoSuggestion) {
      track('bcs_photo_suggestion_shown', {
        suggested_bucket: photoSuggestion.bucket,
        bcs_low: photoSuggestion.bandLow,
        bcs_high: photoSuggestion.bandHigh,
        confidence: photoSuggestion.confidence,
      });
    } else if (photoDecision.suppressedReason) {
      track('bcs_photo_suggestion_suppressed', { reason: photoDecision.suppressedReason });
    }
  }, [photoDecision, photoSuggestion, showPhotoSuggestion]);

  // Bring the suggested card into view — the picker rests on the left edge
  // and the suggestion may be card 3-5. One gentle scroll, never repeated.
  React.useEffect(() => {
    if (!showPhotoSuggestion || bcsSuggestionScrolled.current || !photoSuggestion) return;
    bcsSuggestionScrolled.current = true;
    const idx = BCS_OPTIONS.findIndex((o) => o.bcs === photoSuggestion.bucket);
    if (idx < 2) return;
    // Card width 100 + gap 10 (bcsCard/bcsRow styles below).
    const timer = setTimeout(() => {
      bcsScrollRef.current?.scrollTo({ x: Math.max(0, idx * 110 - 20), animated: true });
    }, 700);
    return () => clearTimeout(timer);
  }, [showPhotoSuggestion, photoSuggestion]);

  // Growth-phase weight-loss guard: puppies and kittens under 12 months should
  // never be calorie-restricted. If the slider is moved below current weight,
  // we surface a banner and the kcal math falls through to maintenance.
  const totalAgeMonthsForGuard = ageYearsNum * 12 + ageMonthsNum;
  const growthWeightLossBlocked = shouldBlockGrowthWeightLoss(
    totalAgeMonthsForGuard || undefined,
    deriveGoal(currentWeight, targetWeight, petData.bodyConditionScore),
  );

  // Vet-gate attention pulse — when the CTA is tapped while the gate is
  // unchecked, the checkbox itself asks for the look.
  const gateScale = useSharedValue(1);
  const gateStyle = useAnimatedStyle(() => ({ transform: [{ scale: gateScale.value }] }));

  // Skeleton shimmer while the estimate is running.
  const shimmer = useSharedValue(0.4);
  React.useEffect(() => {
    if (!estimating) return;
    shimmer.value = withRepeat(
      withSequence(
        withTiming(0.75, { duration: motion.duration.slow }),
        withTiming(0.4, { duration: motion.duration.slow }),
      ),
      -1,
    );
  }, [estimating, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  // Rotate a phase line while estimating so the wait reads as work.
  const { species, breed, ageYears, weight, gender, ageMonths } = petData;
  React.useEffect(() => {
    if (!estimating) return;
    const phases = [
      `Reading ${breed || (speciesVal === 'cat' ? 'cat' : 'dog')} references`,
      'Comparing healthy adult weights',
      'Anchoring to body condition',
    ];
    let i = 0;
    setEstimatePhase(phases[0]);
    const interval = setInterval(() => {
      i = (i + 1) % phases.length;
      setEstimatePhase(phases[i]);
    }, 500);
    return () => clearInterval(interval);
  }, [estimating, breed, speciesVal]);

  // Ideal-weight estimation is a pure local computation — see
  // `lib/idealWeight.ts` (BCS-primary, breed-band-reconciled, AAHA-staged).
  // We wait until a BCS is chosen before showing anything, so the reveal
  // moment isn't spent on a placeholder we're about to overwrite.
  React.useEffect(() => {
    const bcs = petData.bodyConditionScore;
    if (bcs == null) {
      setEstimating(true);
      setEstimate(null);
      return;
    }

    setEstimating(true);
    // Brief reveal beat — no network call, just a smooth transition.
    const revealTimer = setTimeout(() => {
      const result = estimateIdealWeight({
        species: (species === 'cat' ? 'cat' : 'dog'),
        breed: breed || null,
        sex: (gender === 'male' || gender === 'female') ? gender : null,
        ageMonths: totalAgeMonthsForGuard || null,
        currentWeightKg: currentWeight,
        bcs,
      });

      track('ideal_weight_estimated', {
        mode: result.mode,
        reason: result.reason,
        bcs,
        breed: breed || null,
        current_weight_kg: currentWeight,
        target_kg: result.targetKg ?? null,
        staged: result.staged ?? false,
        classification: result.classification ?? null,
        severity: result.severity ?? null,
      });

      setEstimate(result);
      setEstimateSeq((s) => s + 1);
      setAdvisoryOpen(false);

      if (result.mode === 'ok' && result.targetKg != null) {
        setTargetWeight(result.targetKg);
        // Headline sweeps to the DESTINATION (final ideal), not the waypoint —
        // the first number the user anchors on is where the journey ends.
        setSweep({ from: currentWeight, to: result.finalIdealKg ?? result.targetKg });
        setIdealExplanation(result.explanation);
      } else if (result.mode === 'growth') {
        // Growing pet — hold at current; the growth banner and the kcal
        // growth-guard handle messaging + safety.
        setTargetWeight(currentWeight);
        setSweep(null);
        setIdealExplanation(result.explanation);
      } else {
        // 'invalid' — upstream should have prevented this; hold current.
        setTargetWeight(currentWeight);
        setSweep(null);
        setIdealExplanation('');
      }

      setEstimating(false);
    }, 500);

    return () => clearTimeout(revealTimer);
  }, [species, breed, gender, currentWeight, totalAgeMonthsForGuard, petData.bodyConditionScore]);

  // One-time carousel nudge: a short scroll-and-return so the body-shape row
  // demonstrates its own swipe. Only before any shape is chosen — returning
  // users already know.
  React.useEffect(() => {
    if (bcsNudged.current || petData.bodyConditionScore != null) return;
    // A photo read is coming (or here): the scroll-to-suggestion is the
    // teaching gesture — two competing auto-scrolls would fight.
    if (petData.bcsPhotoStatus === 'pending' || petData.bcsPhotoStatus === 'ready') return;
    bcsNudged.current = true;
    const out = setTimeout(() => bcsScrollRef.current?.scrollTo({ x: 28, animated: true }), 900);
    const back = setTimeout(() => bcsScrollRef.current?.scrollTo({ x: 0, animated: true }), 1450);
    return () => { clearTimeout(out); clearTimeout(back); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComplete = async () => {
    if (!user) {
      Alert.alert('Error', 'No authenticated user found.');
      return;
    }

    setFailure(null);
    setLoading(true);

    // Calculate baseline calories
    const weightVal = parseFloat(petData.weight) || 10;
    const totalAgeMonths = ageYearsNum * 12 + ageMonthsNum;

    const bcs = petData.bodyConditionScore;
    // Day 0 of the plan — cats get the 14-day ramp floor (≥95% of maintenance)
    // to prevent the rapid-drop → fasting → hepatic lipidosis pathway.
    // Pregnant / nursing also override into a high-energy multiplier; the UI
    // surfaces a "vet-supervised feeding" banner so the user knows this is a
    // rough starting point, not a precision target.
    const dailyKcal = calculateDailyKcal(
      weightVal,
      speciesVal,
      petData.isNeutered,
      petData.activityLevel || 'normal',
      deriveGoal(weightVal, targetWeight, bcs),
      totalAgeMonths || undefined,
      lifeStageMultiplier,
      targetWeight,
      breedDefaults?.metabolicModifier ?? 1.0,
      bcs ?? undefined,
      0,
      petData.reproductiveStatus ?? undefined,
      petData.pregnancyWeeks ?? undefined,
    );

    let publicAvatarUrl = null;
    if (petData.imageUri) {
      try {
        const ext = petData.imageUri.substring(petData.imageUri.lastIndexOf('.') + 1) || 'jpg';
        const fileName = `${user.id}_${Date.now()}.${ext}`;

        const formData = new FormData();
        formData.append('file', {
          uri: petData.imageUri,
          name: fileName,
          type: `image/${ext === 'jpg' ? 'jpeg' : ext}`
        } as any);

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, formData);

        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
          publicAvatarUrl = urlData.publicUrl;
        }
      } catch (err) {
        console.error("Avatar upload failed:", err);
      }
    }

    // Store age as decimal (years + months/12)
    const decimalAge = ageYearsNum + ageMonthsNum / 12;

    // The first Walksign reading — dogs only, from what onboarding already
    // knows. Ownership starts today, so ownershipMonths is 0 here.
    const walksign = deriveProvisionalWalksign({
      species: speciesVal,
      lifeStage,
      firstDog: petData.firstDog,
      householdWalkers: petData.householdWalkers,
      ownershipMonths: 0,
      activityLevel: petData.activityLevel || 'normal',
    });
    const nowIso = new Date().toISOString();
    const onboardingAssessmentSource =
      petData.bcsSource === 'guided_check'
        ? 'guided_check'
        : petData.bcsSource === 'vet_report'
          ? 'vet_report'
          : 'onboarding';
    const hasAcceptedBodyAssessment =
      petData.bodyConditionScore != null;
    const assessedIdeal =
      hasAcceptedBodyAssessment && estimate?.mode === 'ok'
        ? estimate.finalIdealKg ?? null
        : null;
    const initialPlanStatus =
      estimate?.mode === 'growth'
        ? 'growth'
        : petData.reproductiveStatus === 'pregnant' ||
            petData.reproductiveStatus === 'nursing'
          ? 'supervised'
          : assessedIdeal == null
            ? 'needs_reassessment'
            : Math.abs(weightVal - assessedIdeal) /
                  Math.max(assessedIdeal, 0.001) <=
                0.03
              ? 'maintenance'
              : 'active';

    // ── Create or enrich ──────────────────────────────────────────────────
    // Dogs now get a row after step two and enter the app, so by the time they
    // reach this screen (through the health completion flow) the pet already
    // exists and this is an UPDATE. Cats, and any dog taken through the full
    // flow, still arrive here with no row and this INSERTs.
    //
    // The column map below is identical either way — writing it once is what
    // stops the two paths drifting into different profiles.
    const existingPetId = useActivePetStore.getState().activePet?.id ?? null;

    const petRow = {
      owner_id: user.id,
      name: petData.name || 'My Pet',
      species: speciesVal,
      breed: petData.breed || null,
      gender: petData.gender,
      current_weight_kg: weightVal,
      target_weight_kg: targetWeight,
      age_years: decimalAge || null,
      is_neutered: petData.isNeutered,
      activity_level: petData.activityLevel || 'normal',
      target_daily_calories: dailyKcal,
      ideal_weight_kg: assessedIdeal,
      healthy_band_low_kg: hasAcceptedBodyAssessment
        ? estimate?.band?.low ?? null
        : null,
      healthy_band_high_kg: hasAcceptedBodyAssessment
        ? estimate?.band?.high ?? null
        : null,
      weight_assessment_kg: hasAcceptedBodyAssessment
        ? weightVal
        : null,
      weight_assessment_bcs: hasAcceptedBodyAssessment
        ? petData.bodyConditionScore
        : null,
      weight_assessed_at: hasAcceptedBodyAssessment
        ? nowIso
        : null,
      weight_assessment_source: hasAcceptedBodyAssessment
        ? onboardingAssessmentSource
        : null,
      weight_assessment_confidence: hasAcceptedBodyAssessment
        ? estimate?.confidence ?? null
        : null,
      weight_plan_status: initialPlanStatus,
      weight_plan_revision: hasAcceptedBodyAssessment ? 1 : 0,
      current_weight_logged_at: nowIso,
      weight_journey_start_kg: weightVal,
      weight_journey_started_at: nowIso,
      allergies: petData.allergies.length > 0 ? petData.allergies : null,
      body_condition_score: petData.bodyConditionScore,
      // Stamp the BCS recording time so the milestone loop can detect
      // staleness. Spread-conditional keeps the insert compatible with
      // projects where the bcs_updated_at migration hasn't run yet.
      ...(petData.bodyConditionScore != null
        ? { bcs_updated_at: new Date().toISOString() }
        : {}),
      // Photo-read provenance + the raw AI band — the calibration dataset
      // that tells us whether the photo suggestion beats owner guesses.
      // Spread-conditionals keep the insert compatible with projects where
      // the bcs_source migration hasn't run yet.
      ...(petData.bodyConditionScore != null && petData.bcsSource
        ? { bcs_source: petData.bcsSource }
        : {}),
      ...(petData.bcsPhotoRaw?.bcs_low != null && petData.bcsPhotoRaw?.bcs_high != null
        ? {
            ai_bcs_low: petData.bcsPhotoRaw.bcs_low,
            ai_bcs_high: petData.bcsPhotoRaw.bcs_high,
            ai_bcs_confidence: petData.bcsPhotoRaw.confidence,
          }
        : {}),
      // Hands-on check answers + outcome — the calibration dataset for the
      // guided questionnaire. Spread-conditional keeps the insert compatible
      // with projects where the bcs_check_answers migration hasn't run yet.
      ...(petData.bcsCheckRecord ? { bcs_check_answers: petData.bcsCheckRecord } : {}),
      reproductive_status: petData.reproductiveStatus,
      // pregnancy_weeks is only included when the pet is actually pregnant AND
      // the owner provided a week. This keeps the insert compatible with
      // Supabase projects where the migration hasn't been applied yet — the
      // column is only referenced for the ~1% of profiles that need it.
      ...(petData.reproductiveStatus === 'pregnant' && petData.pregnancyWeeks != null
        ? { pregnancy_weeks: petData.pregnancyWeeks }
        : {}),
      // Column is obesity-specific; the severe-underweight acknowledgment is
      // UI + analytics only (no schema migration for it yet).
      severe_obesity_vet_confirmed_at: isSevereObesity && vetConfirmedSevereCondition
        ? new Date().toISOString()
        : null,
      image_url: publicAvatarUrl || petFallbackImage(speciesVal, 1000),
      // The provisional Walksign, stamped at creation. Spread-conditional
      // keeps the insert compatible with projects where the walksign
      // migration hasn't run yet — and cats simply never get one.
      ...(walksign
        ? {
            walksign: walksign.sign,
            walksign_status: walksign.status,
            walksign_assigned_at: nowIso,
            walksign_history: [
              { sign: walksign.sign, status: walksign.status, reason: walksign.reason, at: nowIso },
            ],
            first_dog: petData.firstDog,
            ...(petData.householdWalkers != null
              ? { household_walkers: petData.householdWalkers }
              : {}),
          }
        : {}),
    };

    const { data: createdPet, error: petInsertError } = existingPetId
      ? await supabase
          .from('pets')
          .update(petRow)
          .eq('id', existingPetId)
          .select('id')
          .single()
      : await supabase.from('pets').insert(petRow).select('id').single();

    let error = petInsertError;
    if (!error && createdPet?.id && petData.bodyConditionScore != null) {
      const { error: assessmentError } = await supabase
        .from('weight_plan_assessments')
        .insert({
          pet_id: createdPet.id,
          revision: 1,
          source: onboardingAssessmentSource,
          assessed_at: nowIso,
          assessment_weight_kg: weightVal,
          bcs: petData.bodyConditionScore,
          breed: petData.breed || null,
          sex: petData.gender,
          age_months: totalAgeMonths,
          life_stage: lifeStage,
          reproductive_status: petData.reproductiveStatus,
          ideal_weight_kg: assessedIdeal,
          target_weight_kg: targetWeight,
          healthy_band_low_kg: estimate?.band?.low ?? null,
          healthy_band_high_kg: estimate?.band?.high ?? null,
          plan_status: initialPlanStatus,
          confidence: estimate?.confidence ?? null,
          previous_ideal_weight_kg: null,
          ideal_change_pct: null,
          superseded_revision: null,
          is_active: true,
          input_snapshot: {
            current_weight_kg: weightVal,
            body_condition_score: petData.bodyConditionScore,
            breed: petData.breed || null,
            gender: petData.gender,
            age_months: totalAgeMonths,
          },
        });
      error = assessmentError;
    }
    if (!error && createdPet?.id) {
      const { error: logError } = await supabase
        .from('weight_logs')
        .upsert(
          {
            pet_id: createdPet.id,
            weight_kg: weightVal,
            notes: 'Onboarding baseline',
            source: 'manual',
            measurement_source: 'onboarding',
            logged_at: nowIso,
            source_event_id: `onboarding:${createdPet.id}:baseline`,
          },
          {
            onConflict: 'pet_id,source_event_id',
            ignoreDuplicates: true,
          },
        );
      error = logError;
    }

    setLoading(false);

    if (error) {
      const appErr = toAppError(error);
      reportError(appErr, 'pet_save');
      track('onboarding_pet_create_failed', { reason: appErr.kind });
      haptic.warning();
      setFailure(errorCopy(appErr, { context: 'pet_save', petName }));
    } else {
      if (walksign) {
        track('walksign_assigned', {
          sign: walksign.sign,
          status: walksign.status,
          reason: walksign.reason,
        });
      }
      // Hydrate the active pet store. Stash the plan summary FIRST so the
      // reveal screen has the numbers it needs without re-fetching.
      petData.setPlanSummary({
        targetWeightKg: targetWeight,
        dailyKcal,
        lifeStageLabel,
        // Journey context for the reveal's map — continuity across screens.
        idealWeightKg: estimate?.mode === 'ok' ? estimate.finalIdealKg ?? null : null,
        healthyBandLow: estimate?.band?.low ?? null,
        healthyBandHigh: estimate?.band?.high ?? null,
      });
      await useActivePetStore.getState().fetchPet(user.id);
      trackStepCompleted('goal', {
        target_weight_kg: targetWeight,
        daily_kcal: dailyKcal,
        goal: deriveGoal(weightVal, targetWeight, bcs),
        bcs_source: petData.bcsSource ?? null,
      });
      // ── Completing a profile is not completing onboarding ────────────────
      // A dog owner arriving here from a health gate finished onboarding weeks
      // ago. Firing `onboarding_completed` again would double-count them and
      // quietly corrupt the signup funnel, so the two paths report separately.
      //
      // They still see the reveal. It is where the plan they just built is
      // actually explained — the kcal target, the portion plate, the weight
      // journey, the breed watch-outs. Skipping it would mean answering six
      // screens of questions and being dropped back with nothing to show for
      // it, which is the opposite of the trade the gate offered them.
      if (completing) {
        track('health_gate_completed', {
          feature: completionParams.feature ?? 'unknown',
          daily_kcal: dailyKcal,
        });
      } else {
        track('onboarding_completed', {
          daily_kcal: dailyKcal,
          target_weight_kg: targetWeight,
        });
      }

      // The reveal screen owns the climax — it reads the plan summary from
      // the store, plays the labour-illusion beat, and continues onward
      // (opening the paywall on the way for non-Pro users). The store must NOT
      // be reset here: reveal reads the summary goal just wrote into it.
      router.replace({
        pathname: '/onboarding/reveal',
        params: forwardCompletionParams(completionParams),
      } as never);
    }
  };

  // Severe in either direction (owner BCS ≥ 8, or the estimator flagged
  // severe underweight / scale-detected obesity) requires the vet
  // acknowledgment. The plan always exists — this is a confirmation, not a gate
  // on the weight itself.
  const isSevereCondition = isSevereObesity || estimate?.severity === 'severe';
  const gateBlocked = isSevereCondition && !vetConfirmedSevereCondition;

  // Proportional slider bounds from the estimator band (falls back to
  // current × [0.7, 1.3]); 0.1-kg steps for pets under 10 kg.
  const sliderBounds = computeSliderBounds(speciesVal, currentWeight, estimate?.band ?? null);
  // Live timeline at the species-safe weekly rate, tracking the slider so the
  // number honestly reflects the goal the user is actually setting.
  const liveWeeks = currentWeight > 0 && Math.abs(targetWeight - currentWeight) >= 0.05
    ? Math.ceil((Math.abs(targetWeight - currentWeight) / currentWeight) * 100 / SAFE_PCT_PER_WEEK[speciesVal])
    : 0;

  // ── Journey framing: current → first milestone → final ideal. ──
  const idealFinal = estimate?.finalIdealKg ?? null;
  const journeyOk = estimate?.mode === 'ok' && idealFinal != null;
  const frameLabel =
    petData.breed && petData.breed !== 'Mixed Breed' && petData.breed !== 'Mixed Breed / Domestic Shorthair' && petData.breed !== 'Other'
      ? petData.breed
      : speciesVal === 'cat' ? 'cat' : 'dog';
  const totalStages = idealFinal != null ? stageCount(currentWeight, idealFinal) : 1;
  // Already at the destination — the map collapses to "in the zone".
  const journeyAtIdeal = journeyOk && idealFinal != null
    && Math.abs(idealFinal - currentWeight) < 0.05
    && Math.abs(targetWeight - currentWeight) < 0.05;
  // The live slider value is a genuine intermediate stop (not the ideal, not current).
  const milestoneIsStop = journeyOk && idealFinal != null
    && Math.abs(targetWeight - idealFinal) >= 0.1
    && Math.abs(targetWeight - currentWeight) >= 0.05;
  // Collapsed advisory: one calm line; the full medical detail expands on tap.
  const advisorySummary = estimate?.reason === 'clamped_to_band_low'
    ? `Below the typical ${frameLabel} range — loop in your vet`
    : estimate?.reason === 'clamped_to_band_high'
      ? `Above the typical ${frameLabel} range — loop in your vet`
      : `A note on ${petName}'s weight`;

  // Carousel progress: three buckets across the scrollable width.
  const bcsMaxScroll = Math.max(0, bcsContentW - bcsViewportW);
  const bcsActiveDot = bcsMaxScroll > 0 ? Math.min(2, Math.round((bcsScrollX / bcsMaxScroll) * 2)) : 0;
  const handleCtaPress = () => {
    if (gateBlocked) {
      // Point at the checkbox instead of dead-buttoning — the most common
      // "app is broken" stall at the last step.
      haptic.warning();
      gateScale.value = withSequence(
        withSpring(1.04, motion.spring.bouncy),
        withSpring(1, motion.spring.gentle),
      );
      return;
    }
    handleComplete();
  };

  return (
    <View style={styles.container}>
      <OnboardingHeader step={stepIndex('goal')} stepId="goal" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 48 + (Platform.OS === 'android' ? insets.bottom : 0) },
        ]}
        showsVerticalScrollIndicator={false}
      >

        <Animated.View entering={FadeInDown.duration(420)}>
          <Text style={styles.eyebrow}>STEP {stepIndex('goal')}</Text>
          <Text style={styles.title}>Set {petName}&apos;s{'\n'}goal.</Text>
          <Text style={styles.subtitle}>
            Pawtchi estimates the healthy target — you can adjust it.
          </Text>
        </Animated.View>

        {/* Life-stage chip — visible intelligence, same treatment as energy */}
        <Animated.View entering={FadeInDown.duration(420).delay(60)} style={styles.lifeStageChip}>
          <MaterialIcons name="auto-awesome" size={14} color={color.navy} />
          <Text style={styles.lifeStageChipText}>
            {petName} is a{' '}
            <Text style={styles.lifeStageChipBold}>
              {lifeStageLabel}{' '}
              {petData.breed && petData.breed !== 'Mixed Breed' && petData.breed !== 'Other'
                ? petData.breed
                : speciesVal === 'cat' ? 'cat' : 'dog'}
            </Text>
          </Text>
        </Animated.View>

        {/* Avatar hero — the face on the plan. Initials fallback when the
            photo was skipped; a stock dog at the commit moment kills trust. */}
        <Animated.View entering={FadeInDown.duration(420).delay(120)} style={styles.heroSection}>
          <View style={styles.avatarContainer}>
            <View style={styles.blurBlob} />
            <View style={styles.avatarInner}>
              {petData.imageUri ? (
                <Image source={{ uri: petData.imageUri }} style={styles.avatarImg} />
              ) : (
                <View style={[styles.avatarImg, styles.avatarFallback]}>
                  <Text style={styles.avatarInitials}>
                    {(petData.name?.trim()?.[0] || (petData.species === 'cat' ? 'C' : 'D')).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.overlapBadge}>
              <MaterialIcons name="fitness-center" size={28} color={color.navy} />
            </View>
          </View>
        </Animated.View>

        {/* Pregnancy / lactation question — only for intact females.
            Skipping this for spayed females or any male. Pregnant/nursing
            mothers need vet-tuned nutrition, not an app-prescribed deficit. */}
        {petData.gender === 'female' && !petData.isNeutered && (
          <View style={styles.reproSection}>
            <Text style={styles.questionLabel}>
              Is {petData.name?.trim() || 'she'} pregnant or nursing?
            </Text>
            <View style={styles.reproRow}>
              {([
                { v: 'neither', label: 'Neither' },
                { v: 'pregnant', label: 'Pregnant' },
                { v: 'nursing', label: 'Nursing' },
              ] as const).map((opt) => {
                const selected = petData.reproductiveStatus === opt.v;
                return (
                  <SelectableChip
                    key={opt.v}
                    selected={selected}
                    style={styles.reproChip}
                    selectedStyle={styles.reproChipSelected}
                    scaleTo={motion.scale.press}
                    onPress={() => {
                      petData.setReproductiveStatus(opt.v);
                      track('onboarding_option_selected', { step: 'goal', option: 'repro_status', value: opt.v });
                    }}
                  >
                    <Text style={[styles.reproChipText, selected && styles.reproChipTextSelected]}>
                      {opt.label}
                    </Text>
                  </SelectableChip>
                );
              })}
            </View>
            {petData.reproductiveStatus === 'pregnant' && (
              <View style={{ gap: 10 }}>
                <Text style={styles.questionLabel}>
                  About how many weeks pregnant?
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => {
                    const selected = petData.pregnancyWeeks === w;
                    return (
                      <SelectableChip
                        key={w}
                        selected={selected}
                        style={styles.weekChip}
                        selectedStyle={styles.reproChipSelected}
                        scaleTo={motion.scale.press}
                        onPress={() => {
                          petData.setPregnancyWeeks(selected ? null : w);
                          track('onboarding_option_selected', { step: 'goal', option: 'pregnancy_weeks', value: selected ? 'null' : w });
                        }}
                      >
                        <Text style={[styles.weekChipText, selected && styles.reproChipTextSelected]}>
                          {w}
                        </Text>
                      </SelectableChip>
                    );
                  })}
                </ScrollView>
                <Text style={styles.weekHint}>
                  Skip if unsure — we&apos;ll estimate at mid-gestation.
                </Text>
              </View>
            )}
            {(petData.reproductiveStatus === 'pregnant' || petData.reproductiveStatus === 'nursing') && (
              <View style={styles.alertBanner}>
                <MaterialIcons name="info" size={16} color={color.alertDeep} />
                <Text style={styles.alertBannerText}>
                  {petData.reproductiveStatus === 'pregnant' ? 'Pregnant' : 'Nursing'} pets need vet-tuned nutrition. This plan is a starting estimate — please confirm targets with your vet.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Body condition — set on the hands-on check step. Here it renders
            as provenance + a re-check path; the silhouette picker below is
            the fallback for arrivals without a score. */}
        {arrivedWithBcs && petData.bodyConditionScore != null && (
          <View style={styles.bcsProvenanceRow}>
            <BodyShapeIcon
              shape={(BCS_OPTIONS.find((o) => o.bcs === bucketForBcs(petData.bodyConditionScore!)) ?? BCS_OPTIONS[1]).shape}
              species={speciesVal}
              size={44}
              color={color.navy}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.bcsProvenanceTitle}>
                {(BCS_OPTIONS.find((o) => o.bcs === bucketForBcs(petData.bodyConditionScore!)) ?? BCS_OPTIONS[1]).label}
              </Text>
              <Text style={styles.bcsProvenanceSub}>
                {petData.bcsSource === 'guided_check' ? 'From your hands-on check' : 'From your quick pick'}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                track('ui_button_tapped', { button_name: 'bcs_recheck', screen: 'goal' });
                if (router.canGoBack()) router.back();
                // Fallback for a deep-linked arrival with nothing to go back
                // to. Carries the mode, or the owner would re-check the body
                // score and then be routed to Home instead of the feature they
                // started from.
                else {
                  router.push({
                    pathname: '/onboarding/body-check',
                    params: forwardCompletionParams(completionParams),
                  } as never);
                }
              }}
            >
              <Text style={styles.bcsProvenanceLink}>Re-check</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Fallback picker — silhouettes, not glyphs. Card width is fixed so
            the 4th card peeks at rest; fade + dots + a one-time nudge make
            "there are more shapes" self-evident. */}
        {!arrivedWithBcs && (
        <View style={styles.bcsSection}>
          <Text style={styles.questionLabel}>
            Which shape looks most like {petData.name?.trim() || 'your pet'}?
          </Text>
          {/* Photo read — a suggestion to confirm, never a silent default. */}
          {showPhotoSuggestion && suggestedOption && (
            <Animated.View entering={FadeIn.duration(motion.duration.slow)} style={styles.bcsSuggestChip}>
              <MaterialIcons name="auto-awesome" size={14} color={color.navy} />
              <Text style={styles.bcsSuggestText}>
                From {petName}&apos;s photo, <Text style={styles.bcsSuggestBold}>{suggestedOption.label.toLowerCase()}</Text> looks closest
                {photoSuggestion.indicators.length > 0
                  ? ` — ${photoSuggestion.indicators.slice(0, 2).join(', ')}`
                  : ''}. Tap to confirm or pick another.
              </Text>
            </Animated.View>
          )}
          <View>
            <ScrollView
              ref={bcsScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bcsRow}
              onScroll={(e) => setBcsScrollX(e.nativeEvent.contentOffset.x)}
              scrollEventThrottle={32}
              onLayout={(e) => setBcsViewportW(e.nativeEvent.layout.width)}
              onContentSizeChange={(cw) => setBcsContentW(cw)}
            >
              {BCS_OPTIONS.map((opt) => {
                const isSelected = petData.bodyConditionScore === opt.bcs;
                const isSuggested = showPhotoSuggestion && photoSuggestion.bucket === opt.bcs;
                return (
                  <SelectableChip
                    key={opt.bcs}
                    selected={isSelected}
                    style={[styles.bcsCard, isSuggested && styles.bcsCardSuggested]}
                    selectedStyle={styles.bcsCardSelected}
                    scaleTo={motion.scale.press}
                    onPress={() => {
                      petData.setBodyConditionScore(opt.bcs);
                      // Provenance: a shown suggestion the pick matches is a
                      // confirmation; picked past it is an override; no
                      // suggestion means the pick is the owner's alone.
                      const source = resolveBcsSource(opt.bcs, photoSuggestion);
                      petData.setBcsSource(source);
                      track('onboarding_option_selected', { step: 'goal', option: 'bcs', value: opt.bcs });
                      if (photoSuggestion) {
                        track(
                          source === 'ai_confirmed'
                            ? 'bcs_photo_suggestion_accepted'
                            : 'bcs_photo_suggestion_overridden',
                          {
                            suggested_bucket: photoSuggestion.bucket,
                            picked_bcs: opt.bcs,
                            confidence: photoSuggestion.confidence,
                          },
                        );
                      }
                    }}
                  >
                    {isSuggested && (
                      <View style={styles.bcsSuggestBadge}>
                        <MaterialIcons name="auto-awesome" size={10} color={color.navy} />
                      </View>
                    )}
                    <BodyShapeIcon
                      shape={opt.shape}
                      species={speciesVal}
                      size={64}
                      color={isSelected ? color.navy : color.slateFaint}
                    />
                    <Text style={[styles.bcsCardText, isSelected && styles.bcsCardTextSelected]}>
                      {opt.label}
                    </Text>
                  </SelectableChip>
                );
              })}
            </ScrollView>
            {bcsScrollX < bcsMaxScroll - 8 && (
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(255,255,255,0)', color.surface]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.bcsFade}
              />
            )}
          </View>
          {bcsMaxScroll > 8 && (
            <View style={styles.bcsDotsRow}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.bcsDot, i === bcsActiveDot && styles.bcsDotActive]} />
              ))}
            </View>
          )}
        </View>
        )}

        {growthWeightLossBlocked && (
          <View style={[styles.alertBanner, { marginBottom: space.lg }]}>
            <MaterialIcons name="child-care" size={16} color={color.alertDeep} />
            <Text style={styles.alertBannerText}>
              Growing pets need calories for growth — we&apos;ll focus on healthy portions, not restriction. Talk to your vet if you&apos;re concerned about weight.
            </Text>
          </View>
        )}

        {/* Journey card — revealed once a body shape is chosen, so the screen
            asks one question at a time instead of stacking five */}
        {petData.bodyConditionScore != null && (
          <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.controlsCard}>
            <View style={styles.weightHeader}>
              <Text style={styles.weightLabel}>{petName.toUpperCase()}&apos;S JOURNEY</Text>
              {estimating ? (
                <>
                  <Animated.View style={[styles.weightSkeleton, shimmerStyle]} />
                  <Animated.Text key={estimatePhase} entering={FadeIn.duration(280)} style={styles.estimatePhase}>
                    {estimatePhase.toUpperCase()}
                  </Animated.Text>
                </>
              ) : journeyOk && idealFinal != null ? (
                <>
                  {/* Headline is the journey span (today → ideal), never the
                      waypoint — anchoring lands on the destination. */}
                  <View style={styles.weightValueRow}>
                    {!journeyAtIdeal && (
                      <>
                        <Text style={styles.journeyFrom}>{currentWeight.toFixed(1)}</Text>
                        <MaterialIcons name="arrow-right-alt" size={26} color={color.slateFaint} />
                      </>
                    )}
                    {sweep ? (
                      <CountUpText
                        from={sweep.from}
                        value={sweep.to}
                        decimals={1}
                        duration={motion.duration.ring}
                        style={styles.weightValue}
                        onDone={() => {
                          haptic.select();
                          setSweep(null);
                        }}
                      />
                    ) : (
                      <Text style={styles.weightValue}>{idealFinal.toFixed(1)}</Text>
                    )}
                    <Text style={styles.weightUnit}>kg</Text>
                  </View>
                  {!estimate?.staged && idealExplanation ? (
                    <Text style={styles.journeyCaption}>{idealExplanation}</Text>
                  ) : null}
                </>
              ) : (
                // Growth mode (and any no-ideal fallback): a single number and
                // the explanation — a growing pet has portions, not a target.
                <>
                  <View style={styles.weightValueRow}>
                    <Text style={styles.weightValue}>{targetWeight.toFixed(1)}</Text>
                    <Text style={styles.weightUnit}>kg</Text>
                  </View>
                  {idealExplanation ? (
                    <View style={styles.idealBadge}>
                      <Text style={styles.idealBadgeText}>{idealExplanation}</Text>
                    </View>
                  ) : (
                    <Text style={styles.idealHint}>Slide to set the goal yourself</Text>
                  )}
                </>
              )}
            </View>

            {/* The journey map — current → first stop → ideal on one spectrum,
                healthy band as a zone. Remounts per estimate (key) so the
                build choreography replays; slider drags update it in place. */}
            {journeyOk && idealFinal != null && !estimating && (
              <View style={styles.journeyMapWrap}>
                <WeightJourneyBar
                  key={estimateSeq}
                  currentKg={currentWeight}
                  milestoneKg={targetWeight}
                  idealKg={idealFinal}
                  band={estimate?.band ?? null}
                  zoneLabel={`Healthy ${frameLabel} range`}
                />
              </View>
            )}

            {/* Milestone framing — "1 of ~N" endows progress; the count is
                hidden for very long ladders (severe cases) where it would
                read as a mountain instead of a path. */}
            {journeyOk && !estimating && (
              <Animated.View
                entering={FadeIn.delay(1600).duration(motion.duration.slow)}
                style={styles.milestoneChip}
              >
                <MaterialIcons name="flag" size={14} color={color.navy} />
                {journeyAtIdeal ? (
                  <Text style={styles.milestoneChipText}>
                    Right in the healthy zone — we&apos;ll keep it that way
                  </Text>
                ) : milestoneIsStop ? (
                  <Text style={styles.milestoneChipText}>
                    Milestone <Text style={styles.milestoneChipBold}>1{totalStages >= 2 && totalStages <= 5 ? ` of ~${totalStages}` : ''}</Text>
                    {' '}· first stop <Text style={styles.milestoneChipBold}>{targetWeight.toFixed(1)} kg</Text>
                    {liveWeeks > 0 ? ` · ~${liveWeeks} week${liveWeeks === 1 ? '' : 's'}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.milestoneChipText}>
                    Straight to ideal{liveWeeks > 0 ? ` · about ${liveWeeks} week${liveWeeks === 1 ? '' : 's'} at a safe pace` : ''}
                  </Text>
                )}
              </Animated.View>
            )}

            {/* Fine-tuning is the exception, not the default — the slider
                hides behind a disclosure so trusting users never face the
                "is 17.0 right?" decision at the commit moment. */}
            {!estimating && (
              <>
                <TouchableOpacity
                  style={styles.adjustToggle}
                  activeOpacity={0.7}
                  onPress={() => {
                    haptic.tap();
                    setAdjustOpen((v) => {
                      track('ui_button_tapped', {
                        button_name: v ? 'adjust_milestone_close' : 'adjust_milestone_open',
                        screen: 'goal',
                      });
                      return !v;
                    });
                  }}
                >
                  <Text style={styles.adjustToggleText}>
                    {journeyOk ? 'Adjust first milestone' : 'Adjust target weight'}
                  </Text>
                  <MaterialIcons
                    name={adjustOpen ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={color.slateMuted}
                  />
                </TouchableOpacity>

                {adjustOpen && (
                  <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={styles.sliderContainer}>
                    <Slider
                      style={{ width: '100%', height: 40 }}
                      minimumValue={sliderBounds.min}
                      maximumValue={sliderBounds.max}
                      step={sliderBounds.step}
                      value={targetWeight}
                      onValueChange={(v) => setTargetWeight(v)}
                      minimumTrackTintColor={color.yellow}
                      maximumTrackTintColor={color.track}
                      thumbTintColor={color.navy}
                    />
                    <View style={styles.sliderMarkers}>
                      <Text style={styles.markerText}>{sliderBounds.min.toFixed(1)} kg</Text>
                      <Text style={styles.markerText}>
                        {estimate?.targetKg != null
                          ? `Suggested ${estimate.targetKg.toFixed(1)}`
                          : `${currentWeight.toFixed(1)} kg`}
                      </Text>
                      <Text style={styles.markerText}>{sliderBounds.max.toFixed(1)} kg</Text>
                    </View>
                  </Animated.View>
                )}
              </>
            )}

            {/* Assessment strip — classification + a gentle activity line.
                The timeline lives in the milestone chip; no duplication. */}
            {!estimating && estimate?.classification && (
              <View style={styles.assessmentStrip}>
                <Text style={styles.assessmentText}>
                  {petName} {CLASSIFICATION_LABEL[estimate.classification]}
                </Text>
                <Text style={styles.assessmentHint}>
                  {activitySuggestion(speciesVal, estimate.classification)}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Weight advisory — NON-BLOCKING, collapsed by default. The estimate
            landed outside the breed's healthy band; the map already shows the
            recovery plan, so this reads as a care instruction, not an alarm.
            Full medical detail + the re-check escape hatch expand on tap. */}
        {petData.bodyConditionScore != null && !estimating && estimate?.advisory && (
          <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.advisoryCard}>
            <TouchableOpacity
              style={styles.advisoryHeader}
              activeOpacity={0.7}
              onPress={() => {
                setAdvisoryOpen((v) => {
                  track('ui_button_tapped', {
                    button_name: v ? 'weight_advisory_collapse' : 'weight_advisory_expand',
                    screen: 'goal',
                  });
                  return !v;
                });
              }}
            >
              <MaterialIcons name="medical-services" size={16} color={color.alertDeep} />
              <Text style={styles.advisorySummary}>{advisorySummary}</Text>
              <MaterialIcons
                name={advisoryOpen ? 'expand-less' : 'expand-more'}
                size={18}
                color={color.alertDeep}
              />
            </TouchableOpacity>
            {advisoryOpen && (
              <Animated.View entering={FadeIn.duration(motion.duration.fast)} style={styles.advisoryBody}>
                <Text style={styles.alertBannerText}>
                  {estimate.advisory}
                  {estimate.band ? ` Healthy range: ${estimate.band.low.toFixed(1)}–${estimate.band.high.toFixed(1)} kg.` : ''}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    track('ideal_weight_conflict_go_back', { current_weight_kg: currentWeight, breed: petData.breed || null, bcs: petData.bodyConditionScore });
                    router.back();
                  }}
                >
                  <Text style={styles.advisoryLink}>
                    Entered something wrong? Re-check weight or breed
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </Animated.View>
        )}

        {/* Final confirmation area */}
        <View style={styles.confirmationArea}>
          {isSevereCondition && (
            <Animated.View style={gateStyle}>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.vetConsultGate}
                onPress={() => {
                  setVetConfirmedSevereCondition((v) => {
                    track('onboarding_option_selected', {
                      step: 'goal',
                      option: 'vet_confirmed',
                      value: !v,
                      classification: estimate?.classification ?? null,
                    });
                    return !v;
                  });
                }}
              >
                <View style={[styles.vetConsultCheckbox, vetConfirmedSevereCondition && styles.vetConsultCheckboxOn]}>
                  {vetConfirmedSevereCondition && <MaterialIcons name="check" size={16} color={color.alertDeep} />}
                </View>
                <Text style={styles.vetConsultText}>
                  {estimate?.classification === 'underweight'
                    ? `${petData.name?.trim() || 'Your pet'}'s condition calls for vet-supervised weight gain — bloodwork first rules out underlying causes. `
                    : `${petData.name?.trim() || 'Your pet'}'s condition calls for vet-supervised weight loss. `}
                  <Text style={styles.vetConsultBold}>I&apos;ve reviewed this plan with our vet.</Text>
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {failure && (
            <View style={{ marginBottom: space.lg }}>
              <ErrorState
                copy={failure}
                variant="banner"
                icon="error-outline"
                onAction={(a) => { if (a === 'retry') { setFailure(null); handleComplete(); } }}
                onDismiss={() => setFailure(null)}
                errorContext="pet_save"
                screen="/onboarding/goal"
              />
            </View>
          )}

          <PawtchiButton
            title={loading ? 'Building plan…' : `Start ${petData.name?.trim() ? `${petData.name.trim()}'s` : 'the'} journey`}
            variant="primary"
            iconName="auto-awesome"
            iconPosition="right"
            onPress={handleCtaPress}
            loading={loading}
            // Only truly missing inputs disable the CTA. Out-of-range weights
            // are health indicators, not errors — those get an advisory and
            // (when severe) the vet acknowledgment above, never a dead button.
            disabled={currentWeight <= 0 || petData.bodyConditionScore == null}
          />

          <Text style={styles.disclaimer}>
            By completing your profile, you agree to our <Text style={styles.link}>Health Guidelines</Text> and <Text style={styles.link}>Privacy Policy</Text>.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: space.xxl,
    paddingBottom: 48,
  },

  eyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  title: {
    fontFamily: font.display,
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: 0.5,
    color: color.ink,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.slateMuted,
    marginTop: space.md,
    marginBottom: space.lg,
    maxWidth: 320,
  },

  lifeStageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: color.yellowSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: space.lg,
  },
  lifeStageChipText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.navy,
  },
  lifeStageChipBold: { fontFamily: font.bold },

  heroSection: {
    alignItems: 'center',
    marginBottom: space.xxl,
  },
  avatarContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurBlob: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 100,
    backgroundColor: color.yellowSoft,
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    backgroundColor: color.surface,
    borderRadius: radius.xxl,
    borderWidth: 4,
    borderColor: color.surface,
    overflow: 'hidden',
    ...makeShadow(8, 20, 0.08),
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  // Initials fallback — brand-tinted disc with a single big letter, used when
  // the user skipped the photo. Honest > stock dog dissonance at commit time.
  avatarFallback: {
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: font.display,
    fontSize: 84,
    lineHeight: 88,
    color: color.navy,
    letterSpacing: 2,
  },
  overlapBadge: {
    position: 'absolute',
    bottom: -12,
    left: -4,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 6,
    borderColor: color.surface,
    backgroundColor: color.yellow,
    justifyContent: 'center',
    alignItems: 'center',
    ...makeShadow(8, 20, 0.08),
  },

  questionLabel: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.slate,
  },

  reproSection: {
    marginBottom: space.xl,
    gap: space.md,
  },
  reproRow: {
    flexDirection: 'row',
    gap: 10,
  },
  reproChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  reproChipSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  reproChipText: {
    fontFamily: font.bold,
    fontSize: 13,
    textAlign: 'center',
    color: color.slateMuted,
  },
  reproChipTextSelected: { color: color.ink },
  weekChip: {
    minWidth: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  weekChipText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.slateMuted,
  },
  weekHint: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateFaint,
    paddingHorizontal: 4,
  },

  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.alertSoft,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.25)',
  },
  alertBannerText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.alertDeep,
  },

  bcsSection: {
    marginBottom: space.xl,
    gap: space.md,
  },
  // Provenance strip — the score exists; this just says where it came from
  // and keeps a quiet path back to the hands-on check.
  bcsProvenanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    marginBottom: space.xl,
  },
  bcsProvenanceTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
  },
  bcsProvenanceSub: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 1,
  },
  bcsProvenanceLink: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
    textDecorationLine: 'underline',
  },
  bcsRow: {
    gap: 10,
    paddingHorizontal: 4,
  },
  // Fixed width (not minWidth) so a partial card always peeks at the right
  // edge — the oldest "there's more" signal there is.
  bcsCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    borderRadius: radius.lg,
    gap: space.sm,
    width: 100,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  bcsCardSelected: {
    backgroundColor: color.surface,
    borderColor: color.yellow,
    borderWidth: 2,
  },
  // Photo-suggested card — warm tint, quieter than the selected state so the
  // suggestion reads as "start here", not "already answered".
  bcsCardSuggested: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  bcsSuggestBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.yellow,
  },
  bcsSuggestChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.yellow,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bcsSuggestText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.slate,
  },
  bcsSuggestBold: {
    fontFamily: font.bold,
    color: color.ink,
  },
  bcsCardText: {
    fontFamily: font.bold,
    fontSize: 12,
    textAlign: 'center',
    color: color.slateMuted,
  },
  bcsCardTextSelected: { color: color.ink },
  bcsFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 36,
  },
  bcsDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  bcsDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: color.hairline,
  },
  bcsDotActive: {
    width: 14,
    backgroundColor: color.navy,
  },

  controlsCard: {
    padding: space.xxl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surfaceSubtle,
  },
  weightHeader: {
    alignItems: 'center',
    gap: 4,
  },
  weightLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: color.slateFaint,
  },
  weightSkeleton: {
    width: 128,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: color.track,
    marginVertical: 8,
  },
  estimatePhase: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    color: color.slateMuted,
  },
  weightValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // The from-number is deliberately quieter than the destination — the eye
  // should land on where the journey ends.
  journeyFrom: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 46,
    letterSpacing: 1,
    color: color.slateFaint,
  },
  weightValue: {
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 46,
    letterSpacing: 1,
    color: color.ink,
  },
  weightUnit: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.slateMuted,
  },
  journeyCaption: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  journeyMapWrap: {
    marginTop: space.lg,
  },
  milestoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: space.md,
  },
  milestoneChipText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.navy,
    flexShrink: 1,
    textAlign: 'center',
  },
  milestoneChipBold: {
    fontFamily: font.bold,
  },
  adjustToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 8,
    marginTop: space.sm,
  },
  adjustToggleText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  idealBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.lg,
    marginTop: 4,
    backgroundColor: color.yellowSoft,
  },
  idealBadgeText: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.navy,
  },
  idealHint: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateFaint,
    marginTop: 4,
  },
  sliderContainer: {
    paddingVertical: space.sm,
  },
  sliderMarkers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingHorizontal: 4,
  },
  markerText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slateMuted,
  },

  advisoryCard: {
    marginTop: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.alertSoft,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.25)',
  },
  advisoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: space.md,
  },
  advisorySummary: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.alertDeep,
  },
  advisoryBody: {
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    paddingLeft: space.md + 24,
    gap: 8,
  },
  advisoryLink: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.alertDeep,
    textDecorationLine: 'underline',
  },

  assessmentStrip: {
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    gap: 4,
  },
  assessmentText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.ink,
  },
  assessmentHint: {
    fontFamily: font.medium,
    fontSize: 12,
    lineHeight: 17,
    color: color.slateMuted,
  },

  confirmationArea: {
    marginTop: space.xxxl,
    gap: space.lg,
  },
  disclaimer: {
    fontFamily: font.medium,
    fontSize: 11.5,
    textAlign: 'center',
    paddingHorizontal: space.xxxl,
    lineHeight: 17,
    color: color.slateFaint,
  },
  link: {
    fontFamily: font.bold,
    color: color.slate,
    textDecorationLine: 'underline',
  },

  vetConsultGate: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.alertSoft,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.35)',
  },
  vetConsultCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: color.alertDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  vetConsultCheckboxOn: {
    backgroundColor: color.alertSoft,
  },
  vetConsultText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 18,
    color: color.alertDeep,
  },
  vetConsultBold: {
    fontFamily: font.bold,
  },
});
