import { buildVetReportHTML } from './buildVetReportHTML';
import type { VetReportData } from './types';

function makeData(overrides: Partial<VetReportData> = {}): VetReportData {
  return {
    signalment: {
      name: 'Biscuit',
      species: 'dog',
      breed: 'Labrador Retriever',
      sex: 'Male',
      isNeutered: true,
      ageLabel: '3 yr',
      microchip: '900012345678',
    },
    owner: { name: 'Alex Doe', email: 'alex@example.com' },
    vitals: {
      currentWeightKg: 24.5,
      targetWeightKg: 22,
      bcs: 6,
      activityLevel: 'Normal',
    },
    weightHistory: [
      { date: '12 Jun 2026', weightKg: 24.5, notes: 'After diet change' },
      { date: '01 May 2026', weightKg: 25.1, notes: null },
    ],
    diet: [
      { brand: 'Acme', productName: 'Adult Chicken', foodType: 'Kibble', isPrimary: true },
      { brand: null, productName: 'Dental Sticks', foodType: 'Treat', isPrimary: false },
    ],
    weekly: {
      targetDailyCalories: 900,
      avgDailyCalories: 870,
      treatCaloriesPercent: 12,
      avgWaterMl: 1100,
      waterTargetMl: 1225,
      avgActivityMinutes: 35,
    },
    allergies: ['Chicken', 'Beef'],
    conditions: ['Arthritis'],
    medications: [{ name: 'Carprofen', dosage: '75mg daily' }],
    vaccinations: [{ name: 'Rabies', date: '10 Jan 2026' }],
    recentVetHistory: [
      {
        date: '10 Jan 2026',
        diagnoses: ['Mild arthritis'],
        medications: [{ name: 'Carprofen', dosage: '75mg' }],
        nextAppointment: '10 Jul 2026',
      },
    ],
    reason: 'Limping on right hind leg for the past week.',
    petPhotoDataUri: null,
    generatedAt: '17 June 2026',
    ...overrides,
  };
}

describe('buildVetReportHTML', () => {
  it('renders all major sections and key fields', () => {
    const html = buildVetReportHTML(makeData());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Pet Health Summary');
    // Signalment
    expect(html).toContain('Biscuit');
    expect(html).toContain('Labrador Retriever');
    expect(html).toContain('Male · neutered');
    expect(html).toContain('900012345678');
    expect(html).toContain('alex@example.com');
    // Vitals
    expect(html).toContain('24.5 kg');
    expect(html).toContain('6/9');
    // Diet + weekly
    expect(html).toContain('Adult Chicken');
    expect(html).toContain('900 kcal');
    expect(html).toContain('12% of weekly calories from treats');
    // Clinical
    expect(html).toContain('Carprofen');
    expect(html).toContain('Rabies');
    expect(html).toContain('Arthritis');
    // Reason
    expect(html).toContain('Limping on right hind leg');
  });

  it('escapes HTML in user-provided text', () => {
    const html = buildVetReportHTML(
      makeData({ reason: '<script>alert("x")</script> & more' })
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; more');
  });

  it('degrades gracefully when optional data is missing', () => {
    const empty: VetReportData = {
      signalment: {
        name: 'Mochi',
        species: 'cat',
        breed: null,
        sex: null,
        isNeutered: null,
        ageLabel: null,
        microchip: null,
      },
      owner: { name: null, email: null },
      vitals: {
        currentWeightKg: null,
        targetWeightKg: null,
        bcs: null,
        activityLevel: null,
      },
      weightHistory: [],
      diet: [],
      weekly: {
        targetDailyCalories: null,
        avgDailyCalories: null,
        treatCaloriesPercent: null,
        avgWaterMl: null,
        waterTargetMl: null,
        avgActivityMinutes: null,
      },
      allergies: [],
      conditions: [],
      medications: [],
      vaccinations: [],
      recentVetHistory: [],
      reason: null,
      petPhotoDataUri: null,
      generatedAt: '17 June 2026',
    };

    const html = buildVetReportHTML(empty);
    expect(html).toContain('Mochi');
    expect(html).toContain('No weight history logged yet.');
    expect(html).toContain('No food logged in the pantry.');
    expect(html).toContain('None recorded');
    expect(html).toContain('No previous vet reports on file.');
    expect(html).toContain('No reason or concerns noted.');
    // Falls back to initial-letter avatar when no photo
    expect(html).toContain('class="photo photo-empty"');
    expect(html).toContain('>M<');
  });

  it('embeds the photo when a data URI is supplied', () => {
    const html = buildVetReportHTML(
      makeData({ petPhotoDataUri: 'data:image/jpeg;base64,AAAA' })
    );
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html).not.toContain('class="photo photo-empty"');
  });
});
