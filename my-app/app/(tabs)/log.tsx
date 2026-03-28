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
  calories_per_serving: number;
  serving_size: string;
  is_allergy_trigger: boolean;
  allergy_warnings: string[];
  ingredients_of_concern: string[];
  recommendation: string;
  confidence: number;
}

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const { activePet } = useActivePetStore();
  const { pawCoins, awardCoins } = useStreakStore();
  const { user } = useAuth();

  // Scanner state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isLogging, setIsLogging] = useState(false);
  const [recentScans, setRecentScans] = useState<{id: string, ai_identified_food: string, ai_estimated_calories: number, created_at: string}[]>([]);

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
      const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
          imageBase64: base64,
          mimeType,
          petProfile: activePet,
        },
      });

      if (error) {
        console.error('[Scanner] Supabase invoke error:', JSON.stringify(error));
        throw error;
      }

      console.log('[Scanner] Response:', JSON.stringify(data).substring(0, 300));

      if (data?.success && data.analysis) {
        // Check if it was a parse error fallback
        if (data.analysis.parse_error) {
          Alert.alert(
            'Partial Analysis', 
            `AI could not return structured data.\n\nRaw: ${data.analysis.raw_response?.substring(0, 200) || 'Empty response'}`
          );
        }
        setScanResult(data.analysis);
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
      });

      // 2. Upsert today's daily_log
      if (existingLog) {
        await supabase.from('daily_logs').update({
          calories_consumed: (existingLog.calories_consumed || 0) + scanResult.calories_per_serving,
          updated_at: new Date().toISOString(),
        }).eq('id', existingLog.id);
      } else {
        await supabase.from('daily_logs').insert({
          pet_id: activePet.id,
          log_date: today,
          calories_consumed: scanResult.calories_per_serving,
        });
      }

      // Update context store with new calorie total
      const newCalTotal = (existingLog?.calories_consumed || 0) + scanResult.calories_per_serving;
      usePetContextStore.getState().updateCalories(newCalTotal);

      Alert.alert(
        'Logged Successfully! 🎉',
        `${scanResult.calories_per_serving} kcal from ${scanResult.food_name} has been added to ${activePet.name}'s daily tracker.`,
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

          {/* Scan Result Card */}
          {scanResult && !isAnalyzing && (
            <View style={[styles.resultCard, { backgroundColor: 'rgba(255,255,255,0.97)' }]}>
              <View style={styles.estHeader}>
                <View>
                  <Text style={styles.estLabel}>ESTIMATED</Text>
                  <View style={styles.estValueRow}>
                    <Text style={styles.estValue}>{scanResult.calories_per_serving}</Text>
                    <Text style={styles.estUnit}>kcal</Text>
                  </View>
                </View>
                <LinearGradient 
                  colors={scanResult.is_allergy_trigger ? ['#ef4444', '#dc2626'] : ['#FFFC00', '#fac129']} 
                  style={styles.estIconBg}
                >
                  <MaterialIcons 
                    name={scanResult.is_allergy_trigger ? "warning" : "check"} 
                    size={20} 
                    color={scanResult.is_allergy_trigger ? '#FFFFFF' : '#000000'} 
                  />
                </LinearGradient>
              </View>
              <Text style={styles.estDesc}>{scanResult.food_name}</Text>

              {/* Allergy Warnings */}
              {scanResult.is_allergy_trigger && scanResult.allergy_warnings?.length > 0 && (
                <View style={styles.warningCard}>
                  <MaterialIcons name="error" size={20} color="#dc2626" />
                  <Text style={styles.warningText}>
                    {scanResult.allergy_warnings.join('. ')}
                  </Text>
                </View>
              )}

              {/* Recommendation */}
              <Text style={styles.recommendationText}>{scanResult.recommendation}</Text>

              {/* Confidence Badge */}
              <View style={styles.confidenceRow}>
                <Text style={styles.confidenceLabel}>AI Confidence:</Text>
                <Text style={[styles.confidenceValue, { color: scanResult.confidence > 0.7 ? '#16a34a' : '#f59e0b' }]}>
                  {Math.round(scanResult.confidence * 100)}%
                </Text>
              </View>
              
              <TouchableOpacity 
                style={[styles.confirmBtn, { opacity: isLogging ? 0.7 : 1 }]} 
                activeOpacity={0.9}
                onPress={confirmLog}
                disabled={isLogging}
              >
                <LinearGradient colors={['#FFFC00', '#fac129']} style={styles.confirmBtnGradient}>
                  {isLogging ? (
                    <ActivityIndicator color="#000000" />
                  ) : (
                    <Text style={styles.confirmBtnText}>CONFIRM LOG</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
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
});
