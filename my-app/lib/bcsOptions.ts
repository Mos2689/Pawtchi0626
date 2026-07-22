/**
 * Shared body-condition picker options and owner-facing condition labels.
 * Used by the onboarding goal screen and the milestone BCS re-score sheet —
 * one source so the silhouette → BCS mapping can never drift between them.
 */

import type { BodyShape } from '../components/icons/BodyShapeIcon';
import type { WeightClassification } from './idealWeight';

// Silhouette options map to WSAVA-style bands the kcal math expects.
// 5 buckets so BCS 8 and 9 are distinguishable (they need very different
// weight-loss targets and different severe-obesity messaging). The severe-
// condition vet gate triggers at BCS ≥ 8.
export const BCS_OPTIONS: { label: string; bcs: number; shape: BodyShape }[] = [
  { label: 'A bit thin', bcs: 3, shape: 'thin' },
  { label: 'Just right', bcs: 5, shape: 'ideal' },
  { label: 'A bit chunky', bcs: 7, shape: 'chunky' },
  { label: 'Overweight', bcs: 8, shape: 'heavy' },
  { label: 'Very overweight', bcs: 9, shape: 'veryHeavy' },
];

// Owner-facing condition labels. Verb phrases so they read as
// "<name> looks a bit over ideal", warm rather than clinical.
export const CLASSIFICATION_LABEL: Record<WeightClassification, string> = {
  underweight: 'looks underweight',
  ideal: 'looks just right',
  overweight: 'looks a bit over ideal',
  obese: 'needs weight-loss support',
};
