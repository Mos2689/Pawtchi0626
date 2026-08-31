import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { dietTagsFromPantry } from '../lib/hydration';
import { withTimeout } from '../lib/withTimeout';
import type { WeightPlanStatus } from '../lib/weightPlan';

export interface PantryItem {
    id: string;
    pet_id: string;
    brand: string;
    product_name: string;
    food_type: 'kibble' | 'wet_food' | 'treat' | 'raw' | 'supplement' | 'human_food';
    kcal_per_serving: number | null;
    kcal_per_100g_as_fed: number | null;   // from label's "X kcal ME/kg" ÷ 10; null if label doesn't state
    moisture_pct: number | null;             // from label's "Moisture (max.) X%"; null if label doesn't state
    serving_unit: string | null;
    protein_pct: number | null;
    fat_pct: number | null;
    fibre_pct: number | null;
    key_ingredients: string[] | null;
    allergy_flags: string[] | null;
    is_primary: boolean;
    image_url?: string;
    scan_count: number;
    first_scanned_at: string;
    last_scanned_at: string;
    is_archived?: boolean;
    expiry_date?: string | null;
    is_favorite?: boolean;

    // ── Provenance (migration 20260831000001) ──
    /**
     * The manufacturer's serving weight, for ANY unit — a pouch, can or cup
     * prints one just as a gram-measured food does. Authoritative when present,
     * and never clamped: a 4.6 g supplement dose is a real serving.
     */
    serving_grams?: number | null;
    /** Verbatim label text ("1 cup / 240g"), kept so a bad parse is auditable. */
    serving_size_raw?: string | null;
    /**
     * Per-field evidence source. Only `label` and `owner_corrected` count as
     * independently observed; anything else (or a missing entry) means a
     * consistency check on that field would be circular.
     */
    nutrition_provenance?: Partial<Record<NutritionField, Provenance>> | null;
    /** Trigger-maintained. Never write this from the client. */
    label_consistency?: 'consistent' | 'inconsistent' | 'unverifiable' | null;
    /** Trigger-maintained. Snapshotted onto a meal so it stays auditable. */
    nutrition_revision?: number | null;
    /** How much of this the owner usually serves. NOT a label fact. */
    usual_portion?: { mode: string; quantity: number; gramsFed?: number } | null;
}

/** Where a nutrition figure came from. */
export type Provenance = 'label' | 'owner_corrected' | 'derived' | 'estimated' | 'default';

export type NutritionField =
    | 'kcal_per_serving'
    | 'kcal_per_100g_as_fed'
    | 'serving_grams'
    | 'protein_pct'
    | 'fat_pct'
    | 'fibre_pct'
    | 'moisture_pct';

export interface Pet {
    id: string;
    owner_id: string;
    name: string;
    species: 'dog' | 'cat';
    breed?: string;
    gender?: 'male' | 'female';
    is_neutered: boolean;
    age_years?: number;
    age_months?: number | null;
    current_weight_kg: number;
    target_weight_kg?: number | null;
    activity_level: 'sedentary' | 'normal' | 'active' | 'highly_active';
    image_url?: string;
    target_daily_calories?: number;
    body_condition_score?: number | null;
    allergies?: string[];
    medical_conditions?: string[];
    /**
     * @deprecated Retired Aug 2026 with the pet-voice notification copy that
     * was its only consumer ("Hey Dad, my tummy is rumbling"). Pawtchi now
     * speaks about the animal, never as it, so there is no surface for a
     * parent title. The `pets.parent_title` column is intentionally kept —
     * 19 owners set a real value — but nothing reads it.
     */
    parent_title?: string;
    diet_type?: string[];
    food_brands?: {
        kibble?: string[];
        treats?: string[];
        wet_food?: string[];
        other?: string[];
    };
    bowl_size?: 'small' | 'medium' | 'large' | 'xl';
    unlocked_items?: string[];
    equipped_items?: string[];
    current_avatar_url?: string;
    created_at?: string;
    severe_obesity_vet_confirmed_at?: string | null;
    reproductive_status?: 'pregnant' | 'nursing' | 'neither' | null;
    pregnancy_weeks?: number | null;
    /** When the owner's BCS was last recorded — drives re-score prompts. */
    bcs_updated_at?: string | null;
    /** Walksign identity (dogs only) — null until assigned. */
    walksign?: string | null;
    walksign_status?: 'provisional' | 'confirmed' | null;
    walksign_assigned_at?: string | null;
    /** Append-only assignment log: { sign, status, reason, at }[]. */
    walksign_history?: { sign: string; status: string; reason: string; at: string }[];
    /** Whether this is the owner's first dog — the Newbond signal. */
    first_dog?: boolean | null;
    /** Regular walkers in the household; three or more is the Packheart signal. */
    household_walkers?: number | null;
    /** Locked destination from the active accepted weight assessment. */
    ideal_weight_kg?: number | null;
    healthy_band_low_kg?: number | null;
    healthy_band_high_kg?: number | null;
    weight_assessment_kg?: number | null;
    weight_assessment_bcs?: number | null;
    weight_assessed_at?: string | null;
    weight_assessment_source?: string | null;
    weight_assessment_confidence?: 'high' | 'low' | null;
    weight_plan_status?: WeightPlanStatus | null;
    weight_plan_revision?: number | null;
    current_weight_logged_at?: string | null;
    weight_journey_start_kg?: number | null;
    weight_journey_started_at?: string | null;
}

interface ActivePetState {
    activePet: Pet | null;
    foodPantry: PantryItem[];
    isLoading: boolean;
    error: string | null;
    fetchPet: (userId: string, options?: { silent?: boolean }) => Promise<void>;
    fetchPantry: (petId: string) => Promise<void>;
    syncDietTypeFromPantry: (petId: string) => Promise<void>;
    addPantryItem: (item: Omit<PantryItem, 'id' | 'first_scanned_at' | 'last_scanned_at' | 'scan_count'>) => Promise<PantryItem | null>;
    incrementPantryScan: (itemId: string) => Promise<void>;
    archivePantryItem: (itemId: string) => Promise<void>;
    togglePantryFavorite: (itemId: string) => Promise<void>;
    setPantryExpiry: (itemId: string, dateIso: string | null) => Promise<void>;
    clearPet: () => void;
    updatePetWeight: (weightKg: number, targetCalories: number) => void;
    applyPetPatch: (patch: Partial<Pet>) => void;
    unlockItem: (itemId: string) => Promise<boolean>;
    toggleEquipItem: (itemId: string) => Promise<boolean>;
    isTailoring: boolean;
    // True while a weight change is rebuilding the calorie target + activity
    // schedule in the background. Tabs read this to show a "recalibrating"
    // state instead of a wrong "build from scratch" empty state.
    recalibrating: boolean;
    setRecalibrating: (v: boolean) => void;
}

// Persisted snapshot (pet + pantry only — never loading/error flags) so a
// returning user's Home renders instantly from disk while fetchPet revalidates
// silently in the background. The tab layout only trusts the snapshot when
// activePet.owner_id matches the signed-in user, so a stale snapshot can never
// leak across accounts. clearPet() on sign-out wipes the persisted copy too.
export const useActivePetStore = create<ActivePetState>()(persist((set, get) => ({
    activePet: null,
    foodPantry: [],
    isLoading: true,
    isTailoring: false,
    recalibrating: false,
    error: null,
    setRecalibrating: (v: boolean) => set({ recalibrating: v }),
    fetchPet: async (userId, options) => {
        // Silent refresh (used after an optimistic write) must NOT toggle the
        // global isLoading flag: the tab layout renders a full-screen spinner and
        // unmounts the whole navigator while petLoading is true, which would blank
        // the app to a spinner on a routine edit. First-load keeps the spinner.
        const silent = options?.silent === true;
        if (!silent) {
            set({ isLoading: true, error: null });
        }

        try {
            // Fetch the most recently created pet for this user. Bounded: this
            // call gates the whole tab navigator, so a hung fetch must become a
            // catchable error (→ retry UI), never an infinite loader.
            const { data, error } = await withTimeout(
                supabase
                    .from('pets')
                    .select('*')
                    .eq('owner_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single()
                    .then(r => r),
                15_000,
                'fetchPet',
            );

            if (error && error.code !== 'PGRST116') {
                console.error('Error fetching pet:', error);
                set(silent ? { error: error.message } : { error: error.message, isLoading: false, activePet: null });
            } else {
                // Clearing isLoading is safe in BOTH modes — only isLoading:TRUE
                // unmounts the navigator (see comment above). After a
                // snapshot-backed silent revalidate this marks the store settled.
                set({ activePet: data || null, isLoading: false, error: null });
                // Also fetch pantry when pet loads
                if (data?.id) {
                    get().fetchPantry(data.id);
                }
            }
        } catch (e: any) {
            console.error('[ActivePet] fetchPet threw:', e);
            if (!silent) {
                set({ isLoading: false, error: e?.message || 'Failed to load pet', activePet: null });
            }
        }
    },
    fetchPantry: async (petId) => {
        const { data } = await supabase
            .from('food_pantry')
            .select('*')
            .eq('pet_id', petId)
            .order('is_primary', { ascending: false })
            .order('scan_count', { ascending: false });
        // Hide archived foods from every active pantry surface. Filtered
        // client-side so this is safe whether or not the column exists yet.
        set({ foodPantry: (data || []).filter((p: any) => !p.is_archived) });
        get().syncDietTypeFromPantry(petId);
    },
    // Keep pets.diet_type mirroring what's actually in the pantry. The diet
    // moisture profile drives the drinking-water target (lib/hydration.ts) —
    // a wet-fed cat gets most of its water from food and needs a much lower
    // bowl target. Persisted on the pet row so the edge functions (schedule
    // generation, ask-vet, health insights) see the same diet the app does.
    // Fire-and-forget: hydration targets self-correct on the next sync.
    syncDietTypeFromPantry: async (petId) => {
        try {
            const pet = get().activePet;
            if (!pet || pet.id !== petId) return;
            const tags = dietTagsFromPantry(get().foodPantry);
            if (tags.length === 0) return; // empty pantry proves nothing — keep whatever is stored
            const current = [...(pet.diet_type ?? [])].sort();
            if (JSON.stringify(tags) === JSON.stringify(current)) return;
            set({ activePet: { ...pet, diet_type: tags } });
            const { error } = await supabase
                .from('pets')
                .update({ diet_type: tags })
                .eq('id', petId);
            if (error) throw error;
        } catch (e) {
            console.warn('[ActivePet] diet_type sync failed (non-fatal):', e);
        }
    },
    archivePantryItem: async (itemId) => {
        const petId = get().foodPantry.find(p => p.id === itemId)?.pet_id;
        // Optimistic removal from the active rail; history (food_scans) stays.
        set({ foodPantry: get().foodPantry.filter(p => p.id !== itemId) });
        const { error } = await supabase
            .from('food_pantry')
            .update({ is_archived: true })
            .eq('id', itemId);
        if (error) {
            console.error('Failed to archive pantry item:', error);
        } else if (petId) {
            get().syncDietTypeFromPantry(petId);
        }
    },
    addPantryItem: async (item) => {
        const { data, error } = await supabase
            .from('food_pantry')
            .insert({
                pet_id: item.pet_id,
                brand: item.brand,
                product_name: item.product_name,
                food_type: item.food_type,
                kcal_per_serving: item.kcal_per_serving,
                kcal_per_100g_as_fed: item.kcal_per_100g_as_fed,
                moisture_pct: item.moisture_pct,
                serving_unit: item.serving_unit,
                protein_pct: item.protein_pct,
                fat_pct: item.fat_pct,
                fibre_pct: item.fibre_pct,
                key_ingredients: item.key_ingredients,
                allergy_flags: item.allergy_flags,
                is_primary: item.is_primary,
                image_url: item.image_url,
                expiry_date: item.expiry_date ?? null,
                is_favorite: item.is_favorite ?? false,
            })
            .select()
            .single();
        if (error) {
            console.error('Failed to add pantry item:', error);
            return null;
        }
        // Refresh pantry
        set({ foodPantry: [...get().foodPantry, data] });
        get().syncDietTypeFromPantry(item.pet_id);
        return data;
    },
    incrementPantryScan: async (itemId) => {
        const current = get().foodPantry.find(p => p.id === itemId);
        const newCount = (current?.scan_count || 0) + 1;
        const now = new Date().toISOString();
        await supabase
            .from('food_pantry')
            .update({ scan_count: newCount, last_scanned_at: now })
            .eq('id', itemId);
        set({
            foodPantry: get().foodPantry.map(p =>
                p.id === itemId ? { ...p, scan_count: newCount, last_scanned_at: now } : p
            ),
        });
    },
    togglePantryFavorite: async (itemId) => {
        const current = get().foodPantry.find(p => p.id === itemId);
        const next = !(current?.is_favorite ?? false);
        set({
            foodPantry: get().foodPantry.map(p =>
                p.id === itemId ? { ...p, is_favorite: next } : p
            ),
        });
        const { error } = await supabase
            .from('food_pantry')
            .update({ is_favorite: next })
            .eq('id', itemId);
        if (error) {
            // Roll back the optimistic flip on failure.
            set({
                foodPantry: get().foodPantry.map(p =>
                    p.id === itemId ? { ...p, is_favorite: !next } : p
                ),
            });
            console.error('Failed to toggle favorite:', error);
        }
    },
    setPantryExpiry: async (itemId, dateIso) => {
        const prev = get().foodPantry.find(p => p.id === itemId)?.expiry_date ?? null;
        set({
            foodPantry: get().foodPantry.map(p =>
                p.id === itemId ? { ...p, expiry_date: dateIso } : p
            ),
        });
        const { error } = await supabase
            .from('food_pantry')
            .update({ expiry_date: dateIso })
            .eq('id', itemId);
        if (error) {
            set({
                foodPantry: get().foodPantry.map(p =>
                    p.id === itemId ? { ...p, expiry_date: prev } : p
                ),
            });
            console.error('Failed to set expiry:', error);
        }
    },
    clearPet: () => set({ activePet: null, foodPantry: [], isLoading: true, error: null }),
    updatePetWeight: (weightKg: number, targetCalories: number) => {
        const { activePet } = get();
        if (!activePet) return;
        set({ activePet: { ...activePet, current_weight_kg: weightKg, target_daily_calories: targetCalories } });
    },
    applyPetPatch: (patch: Partial<Pet>) => {
        const { activePet } = get();
        if (!activePet) return;
        set({ activePet: { ...activePet, ...patch } });
    },

    unlockItem: async (itemId: string) => {
        const { activePet } = get();
        if (!activePet) return false;

        const currentUnlocked = activePet.unlocked_items || [];
        if (currentUnlocked.includes(itemId)) return true; // Already unlocked

        const newUnlocked = [...currentUnlocked, itemId];

        // Optimistic UI update (Unlock only, DO NOT auto-equip to force the tailor process)
        set({ activePet: { ...activePet, unlocked_items: newUnlocked } });

        const { error } = await supabase
            .from('pets')
            .update({ unlocked_items: newUnlocked })
            .eq('id', activePet.id);

        if (error) {
            console.error('Failed to unlock item', error);
            // Revert on fail
            set({ activePet });
            return false;
        }
        return true;
    },

    toggleEquipItem: async (itemId: string) => {
        const { activePet } = get();
        if (!activePet) return false;

        const currentEquipped = activePet.equipped_items || [];
        let newEquipped;
        if (currentEquipped.includes(itemId)) {
            newEquipped = currentEquipped.filter(i => i !== itemId);
        } else {
            newEquipped = [...currentEquipped, itemId];
        }

        set({ activePet: { ...activePet, equipped_items: newEquipped } });

        const { error } = await supabase
            .from('pets')
            .update({ equipped_items: newEquipped })
            .eq('id', activePet.id);

        if (error) {
            console.error('Failed to equip item', error);
            set({ activePet });
            return false;
        }

        // Trigger AI Tailoring
        set({ isTailoring: true });
        try {
            const { data, error: fnError } = await withTimeout(
                supabase.functions.invoke('generate-wearable-avatar', {
                    body: { petId: activePet.id, items: newEquipped }
                }),
                45_000,
                'generate-wearable-avatar',
            );

            if (fnError) throw fnError;
            if (data && data.success) {
                const activePetId = get().activePet?.id;
                if (activePetId) {
                    const refreshedPet = { ...get().activePet!, current_avatar_url: data.url };
                    set({ activePet: refreshedPet });

                    // Persist the new Avatar payload to Supabase so it persists everywhere
                    await supabase
                        .from('pets')
                        .update({ current_avatar_url: data.url })
                        .eq('id', activePetId);
                }
            }
        } catch (e) {
            console.error("AI Tailoring failed:", e);
        } finally {
            set({ isTailoring: false });
        }

        return true;
    }
}), {
    name: 'active-pet-snapshot',
    storage: createJSONStorage(() => AsyncStorage),
    version: 1,
    // Data only — actions and transient flags (isLoading, error, isTailoring,
    // recalibrating) must never round-trip through disk.
    partialize: (s) => ({ activePet: s.activePet, foodPantry: s.foodPantry }),
    // Unknown version → drop the snapshot rather than guess at its shape.
    migrate: (persisted, version) => (version === 1 ? (persisted as Partial<ActivePetState>) : undefined),
}));
