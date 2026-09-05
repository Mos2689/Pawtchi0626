/**
 * Wiring tests for MealHero's opening portion.
 *
 * lib/resolveInitialPortion.test.ts already proves the resolver clamps a
 * poisoned learned portion. It cannot prove that MealHero *asks* it to — and
 * "a component computed the portion itself instead of calling the shared
 * helper" is exactly the bug this whole change exists to prevent. That is what
 * these tests cover: the seam, not the arithmetic.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { MealHero } from './MealHero';
import * as portionLearning from '../lib/portionLearning';
import * as resolver from '../lib/resolveInitialPortion';
import type { PantryItem } from '../store/useActivePetStore';

// PRIME100 SPD Kangaroo & Pumpkin — the food from the original report.
// 120 kcal per serving at 120 kcal/100 g, so one serving is 100 g.
const gramItem: PantryItem = {
  id: 'pantry-1',
  pet_id: 'pet-1',
  brand: 'PRIME100',
  product_name: 'SPD Kangaroo & Pumpkin',
  food_type: 'wet_food',
  kcal_per_serving: 120,
  kcal_per_100g_as_fed: 120,
  moisture_pct: 72,
  serving_unit: 'gram',
  protein_pct: 9,
  fat_pct: 4,
  fibre_pct: 1,
  key_ingredients: ['Kangaroo', 'Pumpkin'],
  allergy_flags: null,
  is_primary: true,
  scan_count: 4,
  first_scanned_at: '',
  last_scanned_at: '',
} as PantryItem;

afterEach(() => {
  jest.restoreAllMocks();
});

function renderHero() {
  return render(
    <MealHero
      eyebrow="DINNER"
      item={gramItem}
      species="dog"
      dailyKcalTarget={1115}
      onLog={jest.fn()}
    />,
  );
}

describe('MealHero routes its opening portion through the shared resolver', () => {
  test('calls resolveInitialPortion rather than computing the portion itself', async () => {
    const spy = jest.spyOn(resolver, 'resolveInitialPortion');
    jest.spyOn(portionLearning, 'getSuggestion').mockResolvedValue(null);

    renderHero();

    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  test('asks portionLearning for a bounded suggestion, not a raw value', async () => {
    const getSuggestion = jest
      .spyOn(portionLearning, 'getSuggestion')
      .mockResolvedValue(null);

    renderHero();

    await waitFor(() => expect(getSuggestion).toHaveBeenCalled());
    // The bounds argument is what makes an out-of-range stored portion
    // unreturnable. Calling getSuggestion without it would compile but would
    // reinstate the original defect.
    const [, bounds] = getSuggestion.mock.calls[0];
    expect(bounds).toMatchObject({ mode: 'weight', min: 5, max: 500 });
  });
});

describe('MealHero and a poisoned learned portion', () => {
  test('a stale 200x portion does not open the card at 20,000 g', async () => {
    // What a device that logged 200 g on the pre-fix build would hold.
    jest
      .spyOn(portionLearning, 'getSuggestion')
      .mockResolvedValue({ mode: 'weight', quantity: 20000 });

    renderHero();

    // 500 g is the stepper's own ceiling; 24,000 kcal is what the unclamped
    // path produced. Both assertions matter: the first says it was clamped,
    // the second says it was clamped to something the UI would have allowed.
    // (The gram figure renders in both the card subtitle and the portion row,
    // hence getAllByText.)
    await waitFor(() => expect(screen.getAllByText(/500 g/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/24000 kcal/)).toBeNull();
    expect(screen.queryByText(/20000 g/)).toBeNull();
  });

  test('an in-range learned portion is still honoured', async () => {
    jest
      .spyOn(portionLearning, 'getSuggestion')
      .mockResolvedValue({ mode: 'weight', quantity: 150 });

    renderHero();

    await waitFor(() => expect(screen.getAllByText(/150 g/).length).toBeGreaterThan(0));
  });
});
