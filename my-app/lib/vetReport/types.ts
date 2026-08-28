// ─────────────────────────────────────────────────────────────────────────────
// Vet-report data model.
//
// The shape of everything that goes into the owner-facing "Pet Health Summary"
// PDF that gets shared with a vet. Assembled in app/vet-report.tsx from the
// pet stores + Supabase, then rendered to HTML by buildVetReportHTML().
//
// Keep this serialisable and free of RN/Supabase types so the HTML builder
// stays pure and unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportSignalment {
  name: string;
  species: 'dog' | 'cat' | string;
  breed: string | null;
  /** "Male", "Female" or null. */
  sex: string | null;
  isNeutered: boolean | null;
  /** Pre-formatted age string, e.g. "3 yr" or "8 mo". null when unknown. */
  ageLabel: string | null;
  /** Owner-entered; not stored on the pet today, so optional. */
  microchip: string | null;
}

export interface ReportOwner {
  name: string | null;
  email: string | null;
}

export interface ReportVitals {
  currentWeightKg: number | null;
  /** Next staged milestone, not the final clinical destination. */
  targetWeightKg: number | null;
  idealWeightKg?: number | null;
  healthyBandLowKg?: number | null;
  healthyBandHighKg?: number | null;
  weightPlanStatus?: string | null;
  weightAssessedAt?: string | null;
  weightAssessmentSource?: string | null;
  /** Body condition score, 1–9. */
  bcs: number | null;
  /** Human label, e.g. "Normal", "Highly active". */
  activityLevel: string | null;
}

export interface WeightHistoryEntry {
  /** ISO date or any pre-formatted date string. */
  date: string;
  weightKg: number;
  notes: string | null;
}

export interface DietItem {
  brand: string | null;
  productName: string;
  /** e.g. "Kibble", "Wet food", "Treat". */
  foodType: string;
  isPrimary: boolean;
}

export interface WeeklyStats {
  /** Daily calorie target from the pet profile. */
  targetDailyCalories: number | null;
  /** 7-day average calories consumed. */
  avgDailyCalories: number | null;
  /** Share of weekly calories from treats, 0–100. */
  treatCaloriesPercent: number | null;
  /** 7-day average water intake, ml. */
  avgWaterMl: number | null;
  /** Water target for current weight, ml. */
  waterTargetMl: number | null;
  /** Average daily activity minutes over the week. */
  avgActivityMinutes: number | null;
}

export interface Medication {
  name: string;
  dosage: string | null;
}

export interface Vaccination {
  name: string;
  /** Pre-formatted date string, or null when unknown. */
  date: string | null;
}

export interface RecentVetVisit {
  /** Pre-formatted date string. */
  date: string;
  diagnoses: string[];
  medications: Medication[];
  nextAppointment: string | null;
}

export interface VetReportData {
  signalment: ReportSignalment;
  owner: ReportOwner;
  vitals: ReportVitals;
  weightHistory: WeightHistoryEntry[];
  diet: DietItem[];
  weekly: WeeklyStats;
  allergies: string[];
  conditions: string[];
  medications: Medication[];
  vaccinations: Vaccination[];
  recentVetHistory: RecentVetVisit[];
  /** Free-text reason for the visit / owner concerns. */
  reason: string | null;
  /** Optional base64 data URI for the pet photo (already inlined). */
  petPhotoDataUri: string | null;
  /** Pre-formatted generation date, e.g. "17 June 2026". */
  generatedAt: string;
}
