import type { Pet } from '../store/useActivePetStore';
import { getAgeMonths } from './lifeStage';
import {
  buildWeightPlanViewModel,
  type WeightMeasurementEvidence,
  type WeightPlanPet,
  type WeightPlanViewModel,
} from './weightPlan';

export function weightPlanPetFromRecord(pet: Pet): WeightPlanPet {
  return {
    species: pet.species,
    breed: pet.breed,
    gender: pet.gender,
    ageMonths: getAgeMonths(pet),
    currentWeightKg: pet.current_weight_kg,
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

export function weightPlanViewModelFromRecord(
  pet: Pet,
  measurements: WeightMeasurementEvidence[] = [],
  now = new Date(),
): WeightPlanViewModel {
  return buildWeightPlanViewModel(
    weightPlanPetFromRecord(pet),
    measurements,
    now,
  );
}
