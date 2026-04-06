import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/Theme';
import { KIBBLE_BRANDS, TREAT_BRANDS, WET_FOOD_BRANDS, BOWL_SIZES } from '../../constants/brandData';
import { usePetStore } from '../../store/usePetStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';

type BrandCategory = 'kibble' | 'treats' | 'wet_food';

interface BrandSelectorProps {
    title: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    brands: string[];
    selected: string[];
    onSelect: (brands: string[]) => void;
    optional?: boolean;
}

function BrandSelector({ title, icon, brands, selected, onSelect, optional }: BrandSelectorProps) {
    const [modalVisible, setModalVisible] = useState(false);
    const [search, setSearch] = useState('');
    const [customBrand, setCustomBrand] = useState('');

    const filtered = useMemo(() => {
        if (!search.trim()) return brands;
        const q = search.toLowerCase();
        return brands.filter(b => b.toLowerCase().includes(q));
    }, [brands, search]);

    const toggleBrand = (brand: string) => {
        if (selected.includes(brand)) {
            onSelect(selected.filter(b => b !== brand));
        } else {
            onSelect([...selected, brand]);
        }
    };

    const addCustom = () => {
        const val = customBrand.trim();
        if (val && !selected.includes(val)) {
            onSelect([...selected, val]);
            setCustomBrand('');
        }
    };

    return (
        <>
            <TouchableOpacity
                style={styles.selectorBtn}
                onPress={() => setModalVisible(true)}
                activeOpacity={0.8}
            >
                <View style={styles.selectorLeft}>
                    <View style={styles.selectorIconBg}>
                        <MaterialIcons name={icon} size={22} color="#041015" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.selectorTitle}>{title}</Text>
                            {optional && <Text style={styles.optionalBadge}>Optional</Text>}
                        </View>
                        <Text style={styles.selectorValue} numberOfLines={1}>
                            {selected.length > 0 ? selected.join(', ') : 'Tap to select...'}
                        </Text>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {selected.length > 0 && (
                        <View style={styles.countBadge}>
                            <Text style={styles.countBadgeText}>{selected.length}</Text>
                        </View>
                    )}
                    <MaterialIcons name="expand-more" size={24} color="#94a3b8" />
                </View>
            </TouchableOpacity>

            <Modal visible={modalVisible} animationType="slide" transparent>
                <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            {/* Header */}
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>{title}</Text>
                                <TouchableOpacity onPress={() => { setModalVisible(false); setSearch(''); }}>
                                    <MaterialIcons name="close" size={28} color="#1A1A1A" />
                                </TouchableOpacity>
                            </View>

                            {/* Search */}
                            <View style={styles.searchContainer}>
                                <MaterialIcons name="search" size={20} color="#94a3b8" style={{ marginLeft: 16 }} />
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="Search brands..."
                                    placeholderTextColor="#94a3b8"
                                    value={search}
                                    onChangeText={setSearch}
                                    autoCapitalize="none"
                                />
                            </View>

                            {/* Brand List */}
                            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                                {filtered.map(brand => {
                                    const isSelected = selected.includes(brand);
                                    return (
                                        <TouchableOpacity
                                            key={brand}
                                            style={[styles.brandItem, isSelected && styles.brandItemSelected]}
                                            onPress={() => toggleBrand(brand)}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={[styles.brandItemText, isSelected && styles.brandItemTextSelected]}>
                                                {brand}
                                            </Text>
                                            {isSelected && (
                                                <View style={styles.brandCheck}>
                                                    <MaterialIcons name="check" size={16} color="#041015" />
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    );
                                })}

                                {filtered.length === 0 && search.trim() && (
                                    <View style={{ padding: 24, alignItems: 'center' }}>
                                        <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 14, color: '#94a3b8' }}>
                                            No matching brands found
                                        </Text>
                                    </View>
                                )}

                                {/* Custom Brand Input */}
                                <View style={styles.customSection}>
                                    <Text style={styles.customLabel}>Can&apos;t find your brand?</Text>
                                    <View style={styles.customInputRow}>
                                        <TextInput
                                            style={styles.customInput}
                                            placeholder="Type brand name..."
                                            placeholderTextColor="#94a3b8"
                                            value={customBrand}
                                            onChangeText={setCustomBrand}
                                            onSubmitEditing={addCustom}
                                            returnKeyType="done"
                                        />
                                        <TouchableOpacity
                                            style={[styles.customAddBtn, !customBrand.trim() && { opacity: 0.4 }]}
                                            onPress={addCustom}
                                            disabled={!customBrand.trim()}
                                        >
                                            <MaterialIcons name="add" size={20} color="#041015" />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </ScrollView>

                            {/* Done Button */}
                            <View style={{ padding: 16 }}>
                                <TouchableOpacity
                                    style={styles.modalDoneBtn}
                                    onPress={() => { setModalVisible(false); setSearch(''); }}
                                >
                                    <LinearGradient colors={['#FFFC00', '#e6e300']} style={styles.modalDoneGradient}>
                                        <Text style={styles.modalDoneText}>
                                            Done{selected.length > 0 ? ` (${selected.length} selected)` : ''}
                                        </Text>
                                    </LinearGradient>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </>
    );
}

// Screen 5: Brand Selection (Step 5 in UI)
export default function BrandsScreen() {
    const router = useRouter();
    const theme = Colors.light;
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const { foodBrands, setFoodBrands, bowlSize, setBowlSize, name } = usePetStore();
    const { awardCoins } = useStreakStore();
    const [saving, setSaving] = useState(false);

    const updateCategory = (category: BrandCategory, brands: string[]) => {
        setFoodBrands({ ...foodBrands, [category]: brands });
    };

    const hasAnyBrand = foodBrands.kibble.length > 0 || foodBrands.treats.length > 0 || foodBrands.wet_food.length > 0;

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);

        try {
            // Get the active pet (just created on goal screen)
            const activePet = useActivePetStore.getState().activePet;
            if (!activePet) throw new Error('No active pet found');

            const brandsPayload = {
                kibble: foodBrands.kibble,
                treats: foodBrands.treats,
                wet_food: foodBrands.wet_food,
                other: foodBrands.other,
            };

            const { error } = await supabase
                .from('pets')
                .update({
                    food_brands: brandsPayload,
                    bowl_size: bowlSize,
                    medical_conditions: usePetStore.getState().medicalConditions.length > 0 ? usePetStore.getState().medicalConditions : null,
                })
                .eq('id', activePet.id);

            if (error) throw error;

            // Refresh the active pet store with the new data
            await useActivePetStore.getState().fetchPet(user.id);

            // Award coins for brand setup
            awardCoins(user.id, 'brand_setup');

            // Reset onboarding form and navigate to dashboard
            usePetStore.getState().resetForm();
            router.replace('/(tabs)');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to save brands';
            console.error('Brand save error:', message);
            // Still navigate even if save fails
            usePetStore.getState().resetForm();
            router.replace('/(tabs)');
        } finally {
            setSaving(false);
        }
    };

    const handleSkip = () => {
        usePetStore.getState().resetForm();
        router.replace('/(tabs)');
    };

    return (
        <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
            {/* Top Header */}
            <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <MaterialIcons name="arrow-back" size={24} color={theme['on-surface']} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme['on-surface'] }]}>Pet Journey</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                {/* Progress */}
                <View style={styles.progressSection}>
                    <View style={styles.progressBars}>
                        <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 24 }]} />
                        <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 24 }]} />
                        <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 24 }]} />
                        <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 24 }]} />
                        <View style={[styles.progressPill, { backgroundColor: '#E6E300', width: 24 }]} />
                        <View style={[styles.progressPill, { backgroundColor: '#E5E7EB', width: 36 }]} />
                    </View>
                    <Text style={[styles.stepText, { color: theme['on-surface-variant'] }]}>STEP 6 OF 6</Text>
                </View>

                {/* Headline */}
                <View style={styles.headlineSection}>
                    <Text style={[styles.mainHeading, { color: theme['on-surface'] }]}>
                        What does {name || 'your pet'} eat?
                    </Text>
                    <Text style={[styles.subHeading, { color: theme['on-surface-variant'] }]}>
                        Select the brands you use so our AI scanner can give accurate, context-aware nutrition analysis.
                    </Text>
                </View>

                {/* Reward Badge */}
                <View style={styles.rewardBanner}>
                    <MaterialIcons name="generating-tokens" size={24} color="#755700" />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.rewardTitle}>Earn +150 PawCoins</Text>
                        <Text style={styles.rewardSub}>Complete this step to unlock bonus coins!</Text>
                    </View>
                    <View style={styles.rewardCoinBadge}>
                        <Text style={styles.rewardCoinText}>+150</Text>
                    </View>
                </View>

                {/* Brand Selectors */}
                <View style={styles.selectorsContainer}>
                    <BrandSelector
                        title="Kibble / Dry Food"
                        icon="breakfast-dining"
                        brands={KIBBLE_BRANDS}
                        selected={foodBrands.kibble}
                        onSelect={(b) => updateCategory('kibble', b)}
                    />
                    <BrandSelector
                        title="Treats & Snacks"
                        icon="cookie"
                        brands={TREAT_BRANDS}
                        selected={foodBrands.treats}
                        onSelect={(b) => updateCategory('treats', b)}
                    />
                    <BrandSelector
                        title="Wet Food"
                        icon="soup-kitchen"
                        brands={WET_FOOD_BRANDS}
                        selected={foodBrands.wet_food}
                        onSelect={(b) => updateCategory('wet_food', b)}
                        optional
                    />
                </View>

                {/* Bowl Size */}
                <View style={styles.bowlSection}>
                    <Text style={styles.bowlTitle}>Typical Bowl Size</Text>
                    <Text style={styles.bowlSubtitle}>Helps estimate portions when scanning</Text>
                    <View style={styles.bowlGrid}>
                        {BOWL_SIZES.map((size) => {
                            const isSelected = bowlSize === size.value;
                            return (
                                <TouchableOpacity
                                    key={size.value}
                                    style={[styles.bowlCard, isSelected && styles.bowlCardSelected]}
                                    onPress={() => setBowlSize(size.value)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={[styles.bowlLabel, isSelected && styles.bowlLabelSelected]}>
                                        {size.label}
                                    </Text>
                                    <Text style={[styles.bowlDesc, isSelected && styles.bowlDescSelected]}>
                                        {size.description}
                                    </Text>
                                    {isSelected && (
                                        <View style={styles.bowlCheck}>
                                            <MaterialIcons name="check" size={14} color="#041015" />
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>

                {/* Actions */}
                <View style={styles.footerSection}>
                    <TouchableOpacity
                        style={[styles.saveBtn, { opacity: saving ? 0.7 : 1 }]}
                        onPress={handleSave}
                        activeOpacity={0.9}
                        disabled={saving || !hasAnyBrand}
                    >
                        <LinearGradient
                            colors={hasAnyBrand ? ['#FFFC00', '#e6e300'] : ['#E5E7EB', '#E5E7EB']}
                            style={styles.saveBtnGradient}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <MaterialIcons name="generating-tokens" size={24} color={hasAnyBrand ? '#041015' : '#9ca3af'} />
                                <Text style={[styles.saveBtnText, { color: hasAnyBrand ? '#041015' : '#9ca3af' }]}>
                                    Save & Earn 150 Coins
                                </Text>
                            </View>
                        </LinearGradient>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
                        <Text style={styles.skipText}>I&apos;ll do this later</Text>
                        <MaterialIcons name="arrow-forward" size={18} color="#94a3b8" />
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        backgroundColor: '#FFFFFF',
        zIndex: 50,
    },
    backBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    headerTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 20,
        letterSpacing: -0.5,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 48,
    },
    progressSection: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    progressBars: {
        flexDirection: 'row',
        gap: 6,
    },
    progressPill: {
        height: 6,
        borderRadius: 3,
    },
    stepText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 13,
        letterSpacing: 1.5,
    },
    headlineSection: {
        marginBottom: 24,
    },
    mainHeading: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 30,
        lineHeight: 36,
        letterSpacing: -1,
        marginBottom: 12,
    },
    subHeading: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 16,
        lineHeight: 24,
    },
    rewardBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: '#FFF9DB',
        borderWidth: 1,
        borderColor: '#FDE68A',
        borderRadius: 20,
        padding: 18,
        marginBottom: 28,
    },
    rewardTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 15,
        color: '#553e00',
    },
    rewardSub: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 12,
        color: '#92400e',
        marginTop: 2,
    },
    rewardCoinBadge: {
        backgroundColor: '#FFFC00',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 16,
    },
    rewardCoinText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '900',
        fontSize: 16,
        color: '#041015',
    },
    selectorsContainer: {
        gap: 12,
        marginBottom: 32,
    },
    selectorBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 20,
        padding: 18,
    },
    selectorLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        flex: 1,
    },
    selectorIconBg: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: '#FFF9DB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    selectorTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 15,
        color: '#0f172a',
    },
    optionalBadge: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600',
        fontSize: 10,
        color: '#94a3b8',
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    selectorValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 13,
        color: '#64748b',
        marginTop: 2,
    },
    countBadge: {
        backgroundColor: '#FFFC00',
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    countBadgeText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 12,
        color: '#041015',
    },
    bowlSection: {
        marginBottom: 36,
    },
    bowlTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 18,
        color: '#0f172a',
        marginBottom: 4,
    },
    bowlSubtitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 14,
        color: '#64748b',
        marginBottom: 16,
    },
    bowlGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    bowlCard: {
        width: '47%',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 16,
        padding: 16,
        position: 'relative',
    },
    bowlCardSelected: {
        backgroundColor: '#FFFFFF',
        borderColor: '#FFFC00',
        borderWidth: 3,
        padding: 14,
        shadowColor: '#FFFC00',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    bowlLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 16,
        color: '#334155',
        marginBottom: 4,
    },
    bowlLabelSelected: {
        color: '#041015',
    },
    bowlDesc: {
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 12,
        color: '#94a3b8',
    },
    bowlDescSelected: {
        color: '#64748b',
    },
    bowlCheck: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: '#FFFC00',
        width: 22,
        height: 22,
        borderRadius: 11,
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerSection: {
        gap: 16,
        marginTop: 'auto',
    },
    saveBtn: {
        width: '100%',
        borderRadius: 32,
        overflow: 'hidden',
        shadowColor: '#FFFC00',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 24,
        elevation: 8,
    },
    saveBtnGradient: {
        paddingVertical: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 32,
    },
    saveBtnText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 18,
    },
    skipBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
    },
    skipText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600',
        fontSize: 16,
        color: '#94a3b8',
    },

    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        maxHeight: '85%',
        paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 24,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    modalTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '900',
        fontSize: 22,
        color: '#0f172a',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: 14,
        marginHorizontal: 24,
        marginVertical: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    searchInput: {
        flex: 1,
        height: 48,
        paddingHorizontal: 12,
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 15,
        color: '#0f172a',
    },
    modalScroll: {
        paddingHorizontal: 16,
        maxHeight: 400,
    },
    brandItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        marginVertical: 2,
    },
    brandItemSelected: {
        backgroundColor: '#FFF9DB',
    },
    brandItemText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600',
        fontSize: 16,
        color: '#334155',
    },
    brandItemTextSelected: {
        fontWeight: '800',
        color: '#041015',
    },
    brandCheck: {
        backgroundColor: '#FFFC00',
        width: 26,
        height: 26,
        borderRadius: 13,
        justifyContent: 'center',
        alignItems: 'center',
    },
    customSection: {
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
        marginTop: 12,
        paddingTop: 16,
        paddingHorizontal: 4,
    },
    customLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700',
        fontSize: 13,
        color: '#64748b',
        marginBottom: 8,
    },
    customInputRow: {
        flexDirection: 'row',
        gap: 8,
    },
    customInput: {
        flex: 1,
        height: 48,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 14,
        paddingHorizontal: 16,
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 15,
        color: '#0f172a',
    },
    customAddBtn: {
        width: 48,
        height: 48,
        backgroundColor: '#FFFC00',
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalDoneBtn: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    modalDoneGradient: {
        paddingVertical: 16,
        alignItems: 'center',
        borderRadius: 20,
    },
    modalDoneText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800',
        fontSize: 16,
        color: '#041015',
    },
});
