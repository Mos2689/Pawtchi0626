import { create } from 'zustand';
import { supabase } from '../lib/supabase';

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
}

export interface Pet {
    id: string;
    owner_id: string;
    name: string;
    species: 'dog' | 'cat';
    breed?: string;
    gender?: 'male' | 'female';
    is_neutered: boolean;
    age_years?: number;
    current_weight_kg: number;
    target_weight_kg?: number;
    activity_level: 'sedentary' | 'normal' | 'active' | 'highly_active';
    image_url?: string;
    target_daily_calories?: number;
    body_condition_score?: number;
    allergies?: string[];
    medical_conditions?: string[];
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
}

interface ActivePetState {
    activePet: Pet | null;
    foodPantry: PantryItem[];
    isLoading: boolean;
    error: string | null;
    fetchPet: (userId: string, options?: { silent?: boolean }) => Promise<void>;
    fetchPantry: (petId: string) => Promise<void>;
    addPantryItem: (item: Omit<PantryItem, 'id' | 'first_scanned_at' | 'last_scanned_at' | 'scan_count'>) => Promise<PantryItem | null>;
    incrementPantryScan: (itemId: string) => Promise<void>;
    archivePantryItem: (itemId: string) => Promise<void>;
    togglePantryFavorite: (itemId: string) => Promise<void>;
    setPantryExpiry: (itemId: string, dateIso: string | null) => Promise<void>;
    clearPet: () => void;
    updatePetWeight: (weightKg: number, targetCalories: number) => void;
    unlockItem: (itemId: string) => Promise<boolean>;
    toggleEquipItem: (itemId: string) => Promise<boolean>;
    isTailoring: boolean;
}

export const useActivePetStore = create<ActivePetState>((set, get) => ({
    activePet: null,
    foodPantry: [],
    isLoading: true,
    isTailoring: false,
    error: null,
    fetchPet: async (userId, options) => {
        // Silent refresh (used after an optimistic write) must NOT toggle the
        // global isLoading flag: the tab layout renders a full-screen spinner and
        // unmounts the whole navigator while petLoading is true, which would blank
        // the app to a spinner on a routine edit. First-load keeps the spinner.
        const silent = options?.silent === true;
        if (!silent) {
            set({ isLoading: true, error: null });
        }

        // Fetch the most recently created pet for this user
        const { data, error } = await supabase
            .from('pets')
            .select('*')
            .eq('owner_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching pet:', error);
            set(silent ? { error: error.message } : { error: error.message, isLoading: false, activePet: null });
        } else {
            set(silent ? { activePet: data || null, error: null } : { activePet: data || null, isLoading: false, error: null });
            // Also fetch pantry when pet loads
            if (data?.id) {
                get().fetchPantry(data.id);
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
    },
    archivePantryItem: async (itemId) => {
        // Optimistic removal from the active rail; history (food_scans) stays.
        set({ foodPantry: get().foodPantry.filter(p => p.id !== itemId) });
        const { error } = await supabase
            .from('food_pantry')
            .update({ is_archived: true })
            .eq('id', itemId);
        if (error) {
            console.error('Failed to archive pantry item:', error);
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
            const { data, error: fnError } = await supabase.functions.invoke('generate-wearable-avatar', {
                body: { petId: activePet.id, items: newEquipped }
            });

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
}));
