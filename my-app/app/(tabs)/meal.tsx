import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';

interface ScanResult {
  food_name: string;
  brand?: string | null;
  product_name?: string | null;
  food_type?: 'kibble' | 'wet_food' | 'treat' | 'raw' | 'supplement' | 'human_food';
  calories_per_serving: number;
  serving_size: string;
  serving_unit?: string | null;
  protein_pct?: number | null;
  fat_pct?: number | null;
  fibre_pct?: number | null;
  key_ingredients?: string[] | null;
  is_treat: boolean;
  is_allergy_trigger: boolean;
  allergy_warnings: string[];
  ingredients_of_concern: string[];
  recommendation: string;
  confidence: number;
  is_labeled_product?: boolean;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  health_score?: number;
  ingredients?: string[];
}

export default function MealScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const { activePet, foodPantry } = useActivePetStore();
  const { pawCoins, awardCoins } = useStreakStore();
  const { user } = useAuth();

  // Scanner state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [recentScans, setRecentScans] = useState<{ id: string, ai_identified_food: string, ai_estimated_calories: number, created_at: string }[]>([]);

  const fetchRecentScans = useCallback(() => {
    if (!activePet?.id) return;
    supabase
      .from('food_scans')
      .select('id, ai_identified_food, ai_estimated_calories, created_at')
      .eq('pet_id', activePet.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setRecentScans(data || []));
  }, [activePet?.id]);

  useFocusEffect(fetchRecentScans);

  const pickImage = async (useCamera: boolean) => {
    // Reset previous results
    setScanResult(null);

    let result;
    if (useCamera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to scan food labels.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.7,
        allowsEditing: true,
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        base64: true,
        quality: 0.7,
        allowsEditing: true,
        mediaTypes: ['images'],
      });
    }

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setCapturedImage(asset.uri);
      analyzeWithGemini(asset.base64!, asset.mimeType || 'image/jpeg');
    }
  };

  const analyzeWithGemini = async (base64: string, mimeType: string) => {
    setIsAnalyzing(true);

    try {
      // Pass pantry data alongside pet profile
      const profileWithPantry = {
        ...activePet,
        food_pantry: foodPantry,
      };

      const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
          imageBase64: base64,
          mimeType,
          petProfile: profileWithPantry,
        },
      });

      if (error) {
        console.error('[Scanner] Supabase invoke error:', JSON.stringify(error));
        throw error;
      }

      if (data?.success && data.analysis) {
        if (data.analysis.parse_error) {
          Alert.alert(
            'Partial Analysis',
            `AI could not return structured data.\n\nRaw: ${data.analysis.raw_response?.substring(0, 200) || 'Empty response'}`
          );
        }
        const normalized: ScanResult = {
          ...data.analysis,
          fat_g: data.analysis.fats_g ?? data.analysis.fat_g ?? 0,
          protein_g: data.analysis.protein_g ?? 0,
          carbs_g: data.analysis.carbs_g ?? 0,
        };
        setScanResult(normalized);
      } else {
        Alert.alert('Analysis Failed', data?.error || JSON.stringify(data) || 'Could not analyze image.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      Alert.alert('Connection Error', message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const confirmLog = async () => {
    if (!scanResult || !activePet) return;

    const today = new Date().toISOString().split('T')[0];
    const targetCal = activePet.target_daily_calories || 0;

    // Pre-check: fetch current day's consumed calories
    const { data: existingLog } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('pet_id', activePet.id)
      .eq('log_date', today)
      .single();

    const currentCal = (existingLog?.calories_consumed as number) || 0;
    const newTotal = currentCal + scanResult.calories_per_serving;

    // ⛔ Hard overage warning
    if (targetCal > 0 && newTotal > targetCal) {
      const overBy = newTotal - targetCal;
      Alert.alert(
        '⚠️ Daily Limit Exceeded',
        `${activePet.name} has already consumed ${currentCal} kcal today.\n\nAdding ${scanResult.calories_per_serving} kcal from "${scanResult.food_name}" would bring the total to ${newTotal} kcal — that's ${overBy} kcal over the daily limit of ${targetCal} kcal.\n\nOverfeeding can lead to weight gain and health issues.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log Anyway', style: 'destructive', onPress: () => executeLog(existingLog, today) },
        ]
      );
      return;
    }

    // 🟡 Approaching limit warning (90%+)
    if (targetCal > 0 && newTotal >= targetCal * 0.9 && currentCal < targetCal * 0.9) {
      Alert.alert(
        '🟡 Approaching Limit',
        `This will bring ${activePet.name} to ${newTotal} of ${targetCal} kcal (${Math.round((newTotal / targetCal) * 100)}%). After this, only light treats are recommended.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log It', onPress: () => executeLog(existingLog, today) },
        ]
      );
      return;
    }

    await executeLog(existingLog, today);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executeLog = async (existingLog: any, today: string) => {
    if (!scanResult || !activePet) return;
    setIsLogging(true);

    try {
      // 1. Insert into food_scans
      await supabase.from('food_scans').insert({
        pet_id: activePet.id,
        image_url: capturedImage || '',
        ai_identified_food: scanResult.food_name,
        ai_estimated_calories: scanResult.calories_per_serving,
        ai_confidence_score: Math.round(scanResult.confidence * 100),
        is_user_confirmed: true,
        is_treat: scanResult.is_treat === true,
        protein_g: scanResult.protein_g ?? 0,
        carbs_g: scanResult.carbs_g ?? 0,
        fat_g: scanResult.fat_g ?? 0,
        health_score: scanResult.health_score ?? 5,
        ingredients: scanResult.ingredients ?? [],
      });

      // 2. Upsert today's daily_log (with treat tracking)
      const isTreat = scanResult.is_treat === true;
      if (existingLog) {
        const updateData: Record<string, unknown> = {
          calories_consumed: (existingLog.calories_consumed || 0) + scanResult.calories_per_serving,
          updated_at: new Date().toISOString(),
        };
        if (isTreat) {
          updateData.treats_consumed = (existingLog.treats_consumed || 0) + 1;
        }
        await supabase.from('daily_logs').update(updateData).eq('id', existingLog.id);
      } else {
        await supabase.from('daily_logs').insert({
          pet_id: activePet.id,
          log_date: today,
          calories_consumed: scanResult.calories_per_serving,
          treats_consumed: isTreat ? 1 : 0,
        });
      }

      // Update context store with new calorie total
      const newCalTotal = (existingLog?.calories_consumed || 0) + scanResult.calories_per_serving;
      usePetContextStore.getState().updateCalories(newCalTotal);

      // Build success message — with dinner reduction guidance for treats
      const targetCal = activePet.target_daily_calories || 0;
      const treatKcal = scanResult.calories_per_serving;
      const dinnerReduction = isTreat && targetCal > 0
        ? `\n\n🍽 Vet tip: Reduce tonight's dinner by ~${treatKcal} kcal (about ${Math.max(1, Math.round(treatKcal / 30))} tablespoon${treatKcal >= 60 ? 's' : ''} less kibble) to keep ${activePet.name} on target.`
        : '';

      Alert.alert(
        isTreat ? 'Treat Logged 🦴' : 'Logged Successfully! 🎉',
        `${treatKcal} kcal from ${scanResult.food_name} has been added to ${activePet.name}'s daily tracker.${dinnerReduction}`,
        [{ text: 'OK', onPress: () => { setCapturedImage(null); setScanResult(null); fetchRecentScans(); } }]
      );

      // Award coins for food log
      if (user?.id) {
        awardCoins(user.id, 'food_log');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Log Error', message);
    } finally {
      setIsLogging(false);
    }
  };

  // When scan result is ready, show the full Stitch-designed result view
  if (scanResult && !isAnalyzing) {
    const healthScore = scanResult.health_score ?? Math.min(10, Math.max(1, Math.round(scanResult.confidence * 10)));
    const proteinG = scanResult.protein_g ?? 0;
    const carbsG = scanResult.carbs_g ?? 0;
    const fatG = scanResult.fat_g ?? 0;
    const ingredientsList = scanResult.ingredients ?? scanResult.ingredients_of_concern ?? [];

    return (
      <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
        {/* Scan Result Top Bar */}
        <View style={[styles.srHeader, { paddingTop: insets.top + 12 }]}>
          <View style={styles.srHeaderLeft}>
            <TouchableOpacity style={styles.srBackBtn} onPress={() => { setScanResult(null); }} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={24} color="#041015" />
            </TouchableOpacity>
            <Text style={styles.srHeaderTitle}>Scan Result</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7}>
            <MaterialIcons name="more-horiz" size={24} color="#041015" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.srScrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero Image */}
          <View style={styles.srHeroContainer}>
            {capturedImage ? (
              <Image source={{ uri: capturedImage }} style={styles.srHeroImage} />
            ) : (
              <View style={[styles.srHeroImage, { backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' }]}>
                <MaterialIcons name="restaurant" size={64} color="#94a3b8" />
              </View>
            )}
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.4)']} style={styles.srHeroGradient} />
            <View style={styles.srNutritionBadge}>
              <MaterialIcons name="eco" size={14} color="#FFFFFF" />
              <Text style={styles.srNutritionBadgeText}>Nutrition</Text>
            </View>
          </View>

          {/* Result Card */}
          <View style={styles.srResultCard}>
            <View style={styles.srAccentLine} />
            <View style={styles.srFoodHeader}>
              <Text style={styles.srFoodName}>{scanResult.food_name}</Text>
              <View style={styles.srServingBadge}>
                <Text style={styles.srServingCount}>1</Text>
                <MaterialIcons name="edit" size={14} color="#041015" />
              </View>
            </View>

            {/* Health Score */}
            <View style={styles.srHealthScoreCard}>
              <View style={styles.srHealthScoreHeader}>
                <Text style={styles.srHealthScoreLabel}>Health Score</Text>
                <Text style={styles.srHealthScoreValue}>{healthScore}/10</Text>
              </View>
              <View style={styles.srProgressBarBg}>
                <View style={[styles.srProgressBarFill, { width: `${healthScore * 10}%` }]} />
              </View>
              <Text style={styles.srHealthScoreDesc}>{scanResult.recommendation}</Text>
            </View>

            {/* Allergy Warnings */}
            {scanResult.is_allergy_trigger && scanResult.allergy_warnings?.length > 0 && (
              <View style={styles.warningCard}>
                <MaterialIcons name="error" size={20} color="#dc2626" />
                <Text style={styles.warningText}>{scanResult.allergy_warnings.join('. ')}</Text>
              </View>
            )}

            {/* Nutrition Grid */}
            <View style={styles.srNutritionGrid}>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="local-fire-department" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{scanResult.calories_per_serving}</Text>
                <Text style={styles.srNutritionLabel}>CALORIES</Text>
              </View>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="egg-alt" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{proteinG}g</Text>
                <Text style={styles.srNutritionLabel}>PROTEIN</Text>
              </View>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="grass" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{carbsG}g</Text>
                <Text style={styles.srNutritionLabel}>CARBS</Text>
              </View>
              <View style={styles.srNutritionItem}>
                <MaterialIcons name="opacity" size={28} color="#FFFC00" />
                <Text style={styles.srNutritionValue}>{fatG}g</Text>
                <Text style={styles.srNutritionLabel}>FATS</Text>
              </View>
            </View>

            {/* Ingredients */}
            {ingredientsList.length > 0 && (
              <View style={styles.srIngredientsSection}>
                <Text style={styles.srIngredientsTitle}>Ingredients</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.srIngredientsScroll}>
                  {ingredientsList.map((item, idx) => (
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
              <Text style={[styles.srConfidenceValue, { color: scanResult.confidence > 0.7 ? '#4ade80' : '#fbbf24' }]}>
                {Math.round(scanResult.confidence * 100)}%
              </Text>
            </View>
          </View>

          {/* Add to Bowl — at end of scrollable content */}
          <View style={styles.srBottomBar}>
            <TouchableOpacity
              style={[styles.srAddBtn, { opacity: isLogging ? 0.7 : 1 }]}
              activeOpacity={0.9}
              onPress={confirmLog}
              disabled={isLogging}
            >
              {isLogging ? (
                <ActivityIndicator color="#041015" />
              ) : (
                <Text style={styles.srAddBtnText}>Add to Bowl</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Food Scanner</Text>
        </View>
        <View style={[styles.coinPill, { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }]}>
          <MaterialIcons name="generating-tokens" size={18} color="#755700" />
          <Text style={styles.coinText}>{pawCoins.toLocaleString()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Psychological Weight Goal Nudge */}
        {(() => {
          if (!activePet) return null;
          const targetW = activePet.target_weight_kg || activePet.current_weight_kg || 10;
          const currentW = activePet.current_weight_kg || 10;
          const gap = currentW - targetW;

          if (gap > 0.5) {
            return (
              <View style={[styles.warningCard, { marginHorizontal: 24, marginBottom: 16, marginTop: 8 }]}>
                <MaterialIcons name="monitor-weight" size={20} color="#dc2626" />
                <Text style={styles.warningText}>
                  {activePet.name} is {gap.toFixed(1)}kg above their {targetW}kg goal. Keep portions strict!
                </Text>
              </View>
            );
          } else if (gap < -0.5) {
            return (
              <View style={[styles.warningCard, { marginHorizontal: 24, marginBottom: 16, marginTop: 8, backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                <MaterialIcons name="monitor-weight" size={20} color="#16a34a" />
                <Text style={[styles.warningText, { color: '#14532d' }]}>
                  {activePet.name} is {Math.abs(gap).toFixed(1)}kg below their {targetW}kg goal.
                </Text>
              </View>
            );
          }
          return null;
        })()}

        {/* Search Section */}
        <View style={styles.searchContainer}>
          <MaterialIcons name="search" size={24} color="#5b5c5a" style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { backgroundColor: '#f9fafb', borderColor: '#e5e7eb', color: '#2e2f2d' }]}
            placeholder="Search food, treats, or symptoms..."
            placeholderTextColor="rgba(91,92,90,0.5)"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        {/* AI Scanner Viewport */}
        <View style={[styles.scannerContainer, { backgroundColor: '#0f172a' }]}>
          {capturedImage ? (
            <Image source={{ uri: capturedImage }} style={styles.scannerImg} />
          ) : (
            <View style={styles.scannerPlaceholder}>
              <MaterialIcons name="photo-camera" size={64} color="rgba(255,255,255,0.3)" />
              <Text style={styles.scannerPlaceholderText}>Tap below to scan a food label</Text>
            </View>
          )}

          {/* Analyzing Overlay */}
          {isAnalyzing && (
            <View style={styles.analyzingOverlay}>
              <ActivityIndicator size="large" color="#FFFC00" />
              <View style={[styles.analyzingBadge, { backgroundColor: 'rgba(0,0,0,0.6)', borderColor: 'rgba(255,252,0,0.4)' }]}>
                <Text style={styles.analyzingText}>GEMINI AI ANALYZING...</Text>
              </View>
            </View>
          )}

          {/* Scanner Action Buttons */}
          <View style={styles.scannerActions}>
            <TouchableOpacity
              style={[styles.scanActionBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
              onPress={() => pickImage(false)}
            >
              <MaterialIcons name="photo-library" size={24} color="#FFFFFF" />
              <Text style={styles.scanActionText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scanActionBtnMain, { backgroundColor: '#FFFC00' }]}
              onPress={() => pickImage(true)}
            >
              <MaterialIcons name="photo-camera" size={32} color="#000000" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scanActionBtn, { backgroundColor: 'rgba(255,255,255,0.15)' }]}
              onPress={() => { setCapturedImage(null); setScanResult(null); }}
            >
              <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
              <Text style={styles.scanActionText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Scans — LIVE */}
        {recentScans.length > 0 && (
          <View style={styles.recentSection}>
            <View style={styles.recentHeader}>
              <Text style={styles.recentTitle}>Recent Scans</Text>
              <Text style={styles.recentCountBadge}>{recentScans.length} total</Text>
            </View>
            <View style={styles.logsList}>
              {recentScans.map((scan) => {
                const dt = new Date(scan.created_at);
                const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
                return (
                  <View key={scan.id} style={[styles.logItem, { backgroundColor: '#FFFFFF', borderColor: '#e5e7eb' }]}>
                    <View style={[styles.logIconWrapper, { backgroundColor: '#FFF9DB' }]}>
                      <MaterialIcons name="restaurant" size={24} color="#605e00" />
                    </View>
                    <View style={styles.logContent}>
                      <Text style={styles.logTitle} numberOfLines={1}>{scan.ai_identified_food || 'Food'}</Text>
                      <Text style={styles.logTime}>{dateStr} {timeStr} • {scan.ai_estimated_calories} kcal</Text>
                    </View>
                    <MaterialIcons name="check-circle" size={24} color="#FFFC00" />
                  </View>
                );
              })}
            </View>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 28,
    letterSpacing: -0.5,
    color: '#2e2f2d',
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  coinText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    color: '#2e2f2d',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 100,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  searchIcon: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
  },
  searchInput: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 56,
    paddingRight: 24,
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 16,
  },
  scannerContainer: {
    width: '100%',
    minHeight: 360,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  scannerImg: {
    width: '100%',
    height: 360,
  },
  scannerPlaceholder: {
    width: '100%',
    height: 360,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  scannerPlaceholderText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
    color: 'rgba(255,255,255,0.4)',
  },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  analyzingBadge: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
  },
  analyzingText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 2,
    color: '#FFFC00',
  },
  scannerActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scanActionBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 16,
    gap: 4,
  },
  scanActionText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  scanActionBtnMain: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  resultCard: {
    margin: 16,
    padding: 24,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  estHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  estLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 2,
    color: '#94a3b8',
  },
  estValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  estValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 36,
    color: '#0f172a',
  },
  estUnit: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 18,
    marginLeft: 4,
    color: '#64748b',
  },
  estIconBg: {
    padding: 10,
    borderRadius: 20,
  },
  estDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
    color: '#334155',
    marginBottom: 12,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fef2f2',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  warningText: {
    flex: 1,
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 13,
    color: '#991b1b',
    lineHeight: 18,
  },
  recommendationText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 20,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  confidenceLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 12,
    color: '#94a3b8',
  },
  confidenceValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 14,
  },
  confirmBtn: {
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnGradient: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 2,
    color: '#000000',
  },
  bentoGrid: {
    gap: 16,
    marginBottom: 32,
  },
  bentoFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
  },
  bentoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  bentoIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bentoTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 18,
  },
  bentoSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 16,
  },
  bentoHalf: {
    flex: 1,
    aspectRatio: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'space-between',
  },
  bentoSubSmall: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 12,
    marginTop: 4,
  },
  recentSection: {
    marginBottom: 32,
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  recentTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 22,
    color: '#2e2f2d',
  },
  recentCountBadge: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 13,
    color: '#94a3b8',
  },
  logsList: {
    gap: 12,
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
  },
  logIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logContent: {
    flex: 1,
    gap: 2,
  },
  logTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
    color: '#2e2f2d',
  },
  logTime: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 13,
    color: '#94a3b8',
  },
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
  srHeroGradient: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%' as const,
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
  srBottomBar: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 32,
  },
  srAddBtn: {
    width: '100%' as const,
    backgroundColor: '#FFFC00',
    paddingVertical: 20,
    borderRadius: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  srAddBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700' as const,
    fontSize: 17,
    color: '#041015',
  },

});
