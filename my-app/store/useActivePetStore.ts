import { create } from 'zustand';
import { supabase } from '../lib/supabase';

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
    isLoading: boolean;
    error: string | null;
    fetchPet: (userId: string) => Promise<void>;
    clearPet: () => void;
    unlockItem: (itemId: string) => Promise<boolean>;
    toggleEquipItem: (itemId: string) => Promise<boolean>;
    isTailoring: boolean;
}

export const useActivePetStore = create<ActivePetState>((set, get) => ({
    activePet: null,
    isLoading: true,
    isTailoring: false,
    error: null,
    fetchPet: async (userId) => {
        set({ isLoading: true, error: null });

        // Fetch the most recently created pet for this user
        const { data, error } = await supabase
            .from('pets')
            .select('*')
            .eq('owner_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found, which isn't a fatal error
            console.error('Error fetching pet:', error);
            set({ error: error.message, isLoading: false, activePet: null });
        } else {
            set({ activePet: data || null, isLoading: false, error: null });
        }
    },
    clearPet: () => set({ activePet: null, isLoading: true, error: null }),

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
                body: { petId: activePet.id, items: newEquipped, apiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'development_mock_key' }
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
