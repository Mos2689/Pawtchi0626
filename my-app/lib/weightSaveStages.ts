/**
 * The stages a weigh-in actually passes through, and what to call them.
 *
 * Logging a weight is not one write. It is a DB upsert, then a re-evaluation of
 * the whole weight plan and calorie target, and then — only sometimes — a
 * regeneration of the activity schedule, which is an AI-backed edge function
 * and is where nearly all the wall-clock time goes.
 *
 * Until now the sheet showed a single spinner on the Save button for all of it,
 * so a five-second wait to rebuild a week of activities looked like a five-
 * second wait to write one number. People concluded the app was broken.
 *
 * ── Why these stages and not more ──
 * Each one below corresponds to a real await in
 * lib/weightPlanService.ts#recordWeightMeasurement, and is reported when that
 * work genuinely begins. Inventing finer-grained steps would be the same lie as
 * a fake progress bar, just spelled differently.
 */

export type WeightSaveStage = 'saving' | 'recalculating' | 'rebuilding';

/**
 * The two stages every weigh-in performs, in order.
 *
 * `rebuilding` is deliberately absent: it runs only when the weight moved
 * enough to matter, the goal flipped, or the plan status changed. Listing it
 * upfront would promise work that often does not happen, and a step that
 * silently never completes is worse than one that appears late.
 */
export const ALWAYS_STAGES: WeightSaveStage[] = ['saving', 'recalculating'];

/**
 * What each stage says.
 *
 * Present continuous and concrete: the point is to explain WHY this is taking
 * a moment, so "Rebuilding this week's plan" earns the wait in a way that
 * "Please wait" never can.
 */
export const STAGE_LABEL: Record<WeightSaveStage, string> = {
  saving: 'Saving the weigh-in',
  recalculating: 'Working out the new calorie target',
  rebuilding: 'Rebuilding this week’s plan',
};

/** Past tense, for a stage that has finished. */
export const STAGE_DONE_LABEL: Record<WeightSaveStage, string> = {
  saving: 'Weigh-in saved',
  recalculating: 'Calorie target updated',
  rebuilding: 'Plan rebuilt',
};

/**
 * The stages to render, given how far the save has got.
 *
 * Grows rather than pre-filling, so `rebuilding` shows up exactly when it
 * starts and stays absent when it never runs.
 */
export function visibleStages(current: WeightSaveStage | null): WeightSaveStage[] {
  if (current === 'rebuilding') return [...ALWAYS_STAGES, 'rebuilding'];
  return [...ALWAYS_STAGES];
}

export type StageState = 'done' | 'active' | 'pending';

/** Where one stage stands relative to the stage currently running. */
export function stageState(
  stage: WeightSaveStage,
  current: WeightSaveStage | null,
): StageState {
  if (!current) return 'pending';
  const order: WeightSaveStage[] = ['saving', 'recalculating', 'rebuilding'];
  const at = order.indexOf(current);
  const mine = order.indexOf(stage);
  if (mine < at) return 'done';
  if (mine === at) return 'active';
  return 'pending';
}
