import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PantryLabelEditor } from './PantryLabelEditor';
import type { PantryItem } from '../store/useActivePetStore';

const item = {
  id: 'pantry-1',
  pet_id: 'pet-1',
  brand: 'Readable Brand',
  product_name: 'Chicken Dinner',
  food_type: 'wet_food',
  kcal_per_serving: null,
  kcal_per_100g_as_fed: 120,
  serving_grams: null,
  serving_size_raw: 'one tray',
  serving_unit: 'tray',
  protein_pct: 10,
  fat_pct: 5,
  fibre_pct: 1,
  moisture_pct: 75,
  key_ingredients: ['Chicken'],
  allergy_flags: null,
  is_primary: true,
  scan_count: 1,
  first_scanned_at: '',
  last_scanned_at: '',
} as PantryItem;

describe('PantryLabelEditor save ownership', () => {
  test('keeps the editor open when the caller reports a failed save', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn().mockResolvedValue(false);
    render(
      <PantryLabelEditor
        visible
        item={item}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('does not run the cancel callback after a parent-owned successful save', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn().mockResolvedValue(true);
    render(
      <PantryLabelEditor
        visible
        item={item}
        onClose={onClose}
        onSave={onSave}
        closeOnSave={false}
      />,
    );

    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('retains automatic closing for the ordinary pantry-edit flow', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn().mockResolvedValue(true);
    render(
      <PantryLabelEditor
        visible
        item={item}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
