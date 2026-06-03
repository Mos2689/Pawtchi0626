import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import type { FoodAnalysis } from '../../lib/foodVerdict';
import NutritionReferencePanel from '../../components/NutritionReferencePanel';

interface FoodScanDetails {
    id: string;
    ai_identified_food: string;
    ai_estimated_calories: number;
    ai_confidence_score: number;
    is_treat: boolean;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    ingredients: string[];
    health_score: number;
    created_at: string;
    image_url?: string;
    food_analysis?: (FoodAnalysis & { verdict?: string; verdict_category?: string }) | null;
}

export default function ScanDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const insets = useSafeAreaInsets();
    const [scan, setScan] = useState<FoodScanDetails | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchScan() {
            if (!id) return;
            const { data } = await supabase
                .from('food_scans')
                .select('*')
                .eq('id', id)
                .single();

            if (data) {
                setScan(data);
            }
            setIsLoading(false);
        }
        fetchScan();
    }, [id]);

    if (isLoading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color="#FFFC00" />
            </View>
        );
    }

    if (!scan) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 16 }}>Scan not found</Text>
                <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.back()}>
                    <Text style={{ fontFamily: 'Plus Jakarta Sans', color: '#16a34a' }}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const logDate = new Date(scan.created_at);
    const timeStr = logDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
            {/* Scan Result Top Bar */}
            <View style={[styles.srHeader, { paddingTop: insets.top + 12 }]}>
                <View style={styles.srHeaderLeft}>
                    <TouchableOpacity style={styles.srBackBtn} onPress={() => router.back()} activeOpacity={0.7}>
                        <MaterialIcons name="arrow-back" size={24} color="#041015" />
                    </TouchableOpacity>
                    <Text style={styles.srHeaderTitle}>Scan Details</Text>
                </View>
                <TouchableOpacity activeOpacity={0.7}>
                    <MaterialIcons name="more-horiz" size={24} color="#041015" />
                </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.srScrollContent} showsVerticalScrollIndicator={false}>
                {/* Placeholder Hero Image */}
                <View style={styles.srHeroContainer}>
                    {scan.image_url ? (
                        <Image source={{ uri: scan.image_url }} style={styles.srHeroImage} />
                    ) : (
                        <View style={[styles.srHeroImage, { backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' }]}>
                            <MaterialIcons name="restaurant" size={64} color="#94a3b8" />
                        </View>
                    )}
                    <View style={styles.srNutritionBadge}>
                        <MaterialIcons name="eco" size={14} color="#FFFFFF" />
                        <Text style={styles.srNutritionBadgeText}>Nutrition</Text>
                    </View>
                </View>

                {/* Result Card */}
                <View style={styles.srResultCard}>
                    <View style={styles.srAccentLine} />
                    <View style={styles.srFoodHeader}>
                        <Text style={styles.srFoodName}>{scan.ai_identified_food}</Text>
                        <View style={styles.srServingBadge}>
                            <Text style={styles.srServingCount}>1</Text>
                            <MaterialIcons name="edit" size={14} color="#041015" />
                        </View>
                    </View>

                    {/* Health Score */}
                    <View style={styles.srHealthScoreCard}>
                        <View style={styles.srHealthScoreHeader}>
                            <Text style={styles.srHealthScoreLabel}>Health Score</Text>
                            <Text style={styles.srHealthScoreValue}>{scan.health_score ?? 5}/10</Text>
                        </View>
                        <View style={styles.srProgressBarBg}>
                            <View style={[styles.srProgressBarFill, { width: `${(scan.health_score ?? 5) * 10}%` }]} />
                        </View>
                        <Text style={styles.srHealthScoreDesc}>
                            {(scan.food_analysis as { verdict?: string })?.verdict
                                ?? (scan.is_treat
                                    ? "This item is classified as a treat."
                                    : "This is a standard recorded meal.")}
                        </Text>
                    </View>

                    {/* Nutrition Grid */}
                    <View style={styles.srNutritionGrid}>
                        <View style={styles.srNutritionItem}>
                            <MaterialIcons name="local-fire-department" size={28} color="#FFFC00" />
                            <Text style={styles.srNutritionValue}>{scan.ai_estimated_calories}</Text>
                            <Text style={styles.srNutritionLabel}>Calories</Text>
                        </View>
                        <View style={styles.srNutritionItem}>
                            <MaterialIcons name="egg-alt" size={28} color="#FFFC00" />
                            <Text style={styles.srNutritionValue}>{scan.protein_g}g</Text>
                            <Text style={styles.srNutritionLabel}>Protein</Text>
                        </View>
                        <View style={styles.srNutritionItem}>
                            <MaterialIcons name="grass" size={28} color="#FFFC00" />
                            <Text style={styles.srNutritionValue}>{scan.carbs_g}g</Text>
                            <Text style={styles.srNutritionLabel}>Carbs</Text>
                        </View>
                        <View style={styles.srNutritionItem}>
                            <MaterialIcons name="opacity" size={28} color="#FFFC00" />
                            <Text style={styles.srNutritionValue}>{scan.fat_g}g</Text>
                            <Text style={styles.srNutritionLabel}>Fats</Text>
                        </View>
                    </View>

                    {/* Nutrition Reference (AAFCO + clinical adjustments) */}
                    {scan.food_analysis && (
                        <NutritionReferencePanel
                            foodAnalysis={scan.food_analysis}
                            mealKcalOverride={scan.ai_estimated_calories}
                        />
                    )}

                    {/* Ingredients */}
                    {scan.ingredients && scan.ingredients.length > 0 && (
                        <View style={styles.srIngredientsSection}>
                            <Text style={styles.srIngredientsTitle}>Ingredients</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.srIngredientsScroll}>
                                {scan.ingredients.map((item: string, idx: number) => (
                                    <View key={idx} style={styles.srIngredientChip}>
                                        <Text style={styles.srIngredientText}>{item}</Text>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    {/* Confidence */}
                    <View style={styles.srConfidenceRow}>
                        <Text style={styles.srConfidenceLabel}>AI Confidence:</Text>
                        <Text style={[styles.srConfidenceValue, { color: scan.ai_confidence_score > 70 ? '#4ade80' : '#fbbf24' }]}>
                            {scan.ai_confidence_score}%
                        </Text>
                    </View>
                </View>

                <View style={{ alignItems: 'center', marginTop: 24, paddingBottom: 40 }}>
                    <Text style={{ fontFamily: 'Plus Jakarta Sans', color: '#9ca3af', fontWeight: '600' }}>Logged today at {timeStr}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },
    // ── Scan Result (sr*) styles ──
    srHeader: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'center' as const,
        paddingHorizontal: 24,
        paddingBottom: 12,
        backgroundColor: '#FFFFFF',
        zIndex: 50,
    },
    srHeaderLeft: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 16,
    },
    srBackBtn: {
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
    },
    srHeaderTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 28,
        letterSpacing: -0.5,
        color: '#041015',
    },
    srScrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 32,
    },
    srHeroContainer: {
        width: '100%' as const,
        aspectRatio: 1,
        borderRadius: 40,
        overflow: 'hidden' as const,
        marginBottom: 24,
        position: 'relative' as const,
    },
    srHeroImage: {
        width: '100%' as const,
        height: '100%' as const,
    },
    srNutritionBadge: {
        position: 'absolute' as const,
        top: 20,
        right: 20,
        backgroundColor: '#041015',
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 40,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    srNutritionBadgeText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 14,
        color: '#FFFFFF',
    },
    srResultCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 40,
        padding: 28,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.04,
        shadowRadius: 40,
        elevation: 4,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.04)',
        overflow: 'hidden' as const,
        position: 'relative' as const,
    },
    srAccentLine: {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        height: 6,
        backgroundColor: '#FFFC00',
    },
    srFoodHeader: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'flex-start' as const,
        marginBottom: 20,
        marginTop: 8,
    },
    srFoodName: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 28,
        letterSpacing: -0.5,
        lineHeight: 34,
        color: '#041015',
        flex: 1,
        marginRight: 16,
    },
    srServingBadge: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        padding: 14,
        borderRadius: 40,
        backgroundColor: '#FFFFFF',
    },
    srServingCount: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 18,
        color: '#041015',
    },
    srHealthScoreCard: {
        backgroundColor: '#041015',
        borderRadius: 32,
        padding: 24,
        marginBottom: 20,
    },
    srHealthScoreHeader: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'flex-end' as const,
        marginBottom: 12,
    },
    srHealthScoreLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 16,
        color: 'rgba(255,255,255,0.6)',
    },
    srHealthScoreValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 28,
        color: '#FFFC00',
    },
    srProgressBarBg: {
        width: '100%' as const,
        height: 12,
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 8,
        overflow: 'hidden' as const,
    },
    srProgressBarFill: {
        height: '100%' as const,
        borderRadius: 8,
        backgroundColor: '#FFFC00',
    },
    srHealthScoreDesc: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '500' as const,
        fontSize: 14,
        color: 'rgba(255,255,255,0.6)',
        lineHeight: 20,
        marginTop: 14,
    },
    srNutritionGrid: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: 12,
        marginBottom: 24,
    },
    srNutritionItem: {
        width: '47%' as const,
        backgroundColor: '#041015',
        borderRadius: 32,
        padding: 22,
        gap: 6,
    },
    srNutritionValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 24,
        color: '#FFFFFF',
    },
    srNutritionLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 10,
        letterSpacing: 2,
        color: 'rgba(255,255,255,0.5)',
    },
    srIngredientsSection: {
        marginBottom: 20,
    },
    srIngredientsTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 18,
        color: '#041015',
        marginBottom: 14,
        paddingHorizontal: 4,
    },
    srIngredientsScroll: {
        gap: 10,
        paddingBottom: 8,
    },
    srIngredientChip: {
        backgroundColor: '#041015',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 40,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    srIngredientText: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 14,
        color: '#FFFFFF',
    },
    srConfidenceRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        marginTop: 4,
    },
    srConfidenceLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600' as const,
        fontSize: 13,
        color: 'rgba(4,16,21,0.5)',
    },
    srConfidenceValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 15,
    },
    srNutritionReference: {
        marginBottom: 24,
        paddingTop: 8,
    },
    srSectionTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 18,
        color: '#041015',
        marginBottom: 14,
        paddingHorizontal: 4,
    },
    srMealContext: {
        backgroundColor: '#F9FAFB',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
    },
    srMealContextLabel: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 11,
        letterSpacing: 1.5,
        color: '#6B7280',
    },
    srMealContextValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 14,
        color: '#041015',
        marginTop: 4,
    },
    srAdjustmentsBox: {
        backgroundColor: '#FEF3C7',
        borderRadius: 16,
        padding: 14,
    },
    srAdjustmentsTitle: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 13,
        color: '#92400e',
        textTransform: 'capitalize' as const,
    },
    srAdjustmentItem: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600' as const,
        fontSize: 13,
        color: '#92400e',
        textTransform: 'capitalize' as const,
        marginLeft: 4,
    },
    srNutrientRow: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        gap: 10,
        backgroundColor: '#F9FAFB',
        borderRadius: 16,
        padding: 12,
    },
    srNutrientName: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '800' as const,
        fontSize: 14,
        color: '#041015',
    },
    srNutrientValue: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '700' as const,
        fontSize: 13,
        color: '#374151',
        marginTop: 2,
    },
    srNutrientRef: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '500' as const,
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    srNutrientAdj: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '600' as const,
        fontSize: 12,
        color: '#92400e',
        marginTop: 4,
        lineHeight: 16,
    },
    srNotesBox: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        gap: 4,
    },
    srNoteItem: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '500' as const,
        fontSize: 12,
        color: '#6B7280',
        lineHeight: 16,
    },
    srDisclaimer: {
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: '500' as const,
        fontSize: 11,
        color: '#9CA3AF',
        lineHeight: 16,
        marginTop: 16,
        paddingHorizontal: 4,
    },
});
