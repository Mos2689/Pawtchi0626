import React, { useCallback, useEffect, useState } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

import { Header } from '../components/Header';
import { Typography } from '../components/Typography';
import { PawtchiButton } from '../components/PawtchiButton';
import { PawtchiModal } from '../components/PawtchiModal';
import { color, font, radius, shadow, space } from '../constants/design';
import { useActivePetStore } from '../store/useActivePetStore';
import { useAuth } from '../providers/AuthProvider';
import { useSubscription } from '../hooks/useSubscription';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import { getThread } from '../lib/askVet';
import { buildVetReportHTML } from '../lib/vetReport/buildVetReportHTML';
import type {
  VetReportData, Medication, Vaccination, WeightHistoryEntry,
  DietItem, RecentVetVisit,
} from '../lib/vetReport/types';

// ─── Label maps ───
const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: 'Sedentary',
  normal: 'Normal',
  active: 'Active',
  highly_active: 'Highly active',
};
const FOOD_TYPE_LABEL: Record<string, string> = {
  kibble: 'Kibble',
  wet_food: 'Wet food',
  treat: 'Treat',
  raw: 'Raw',
  supplement: 'Supplement',
  human_food: 'Human food',
};

function ageLabel(years?: number | null): string | null {
  if (years === null || years === undefined) return null;
  if (years >= 1) {
    const whole = Math.floor(years);
    return `${whole} yr`;
  }
  const months = Math.max(1, Math.round(years * 12));
  return `${months} mo`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function cap(s?: string | null): string | null {
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Best-effort fetch of a remote image as a base64 data URI for the PDF. */
async function fetchImageDataUri(url?: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function VetReportScreen() {
  const router = useRouter();
  const { caseId } = useLocalSearchParams<{ caseId?: string }>();
  const { activePet, foodPantry } = useActivePetStore();
  const { user } = useAuth();
  const { hasFullAccess } = useSubscription();

  // Standard premium-feature gate — share PDF is Pro-only past freemium.
  const checkAccess = () => {
    if (!hasFullAccess) {
      router.push('/paywall' as any);
      return false;
    }
    return true;
  };

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Owner-editable
  const [reason, setReason] = useState('');
  // Track whether the owner has touched the reason field, so a re-entry from
  // the same case doesn't clobber their edits with a fresh prefill.
  const reasonEditedRef = React.useRef(false);
  const prefilledForCaseRef = React.useRef<string | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);

  // Auto-assembled (read-only preview)
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [weightHistory, setWeightHistory] = useState<WeightHistoryEntry[]>([]);
  const [recentVetHistory, setRecentVetHistory] = useState<RecentVetVisit[]>([]);
  const [weekly, setWeekly] = useState<VetReportData['weekly']>({
    targetDailyCalories: null, avgDailyCalories: null, treatCaloriesPercent: null,
    avgWaterMl: null, waterTargetMl: null, avgActivityMinutes: null,
  });

  const petName = activePet?.name || 'your pet';

  const loadData = useCallback(async () => {
    if (!activePet) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const now = new Date();
      const sevenAgo = new Date(now);
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const todayStr = now.toISOString().split('T')[0];
      const sevenStr = sevenAgo.toISOString().split('T')[0];

      const [profileRes, wLogsRes, vetRes, logsRes, actsRes, treatScansRes] = await Promise.all([
        user?.id
          ? supabase.from('profiles').select('full_name').eq('id', user.id).single()
          : Promise.resolve({ data: null } as any),
        supabase.from('weight_logs').select('weight_kg, logged_at, notes')
          .eq('pet_id', activePet.id).order('logged_at', { ascending: false }).limit(12),
        supabase.from('vet_reports').select('report_date, ai_extracted_data')
          .eq('pet_id', activePet.id).order('report_date', { ascending: false }).limit(5),
        supabase.from('daily_logs').select('calories_consumed, water_ml, log_date')
          .eq('pet_id', activePet.id).gte('log_date', sevenStr).lte('log_date', todayStr),
        supabase.from('activities').select('duration_minutes')
          .eq('pet_id', activePet.id).eq('status', 'completed')
          .in('activity_type', ['walk', 'play', 'training'])
          .gte('scheduled_date', sevenStr).lte('scheduled_date', todayStr),
        supabase.from('food_scans').select('ai_estimated_calories, is_treat')
          .eq('pet_id', activePet.id).eq('is_treat', true)
          .gte('created_at', `${sevenStr}T00:00:00`),
      ]);

      setOwnerName(profileRes?.data?.full_name || null);

      // Weight history
      setWeightHistory(
        (wLogsRes.data || []).map((w: any) => ({
          date: formatDate(w.logged_at),
          weightKg: Number(w.weight_kg),
          notes: w.notes || null,
        }))
      );

      // Recent vet history + pre-seed meds/vaccines from the latest report
      const reports = vetRes.data || [];
      setRecentVetHistory(
        reports.map((r: any) => {
          const d = r.ai_extracted_data || {};
          return {
            date: formatDate(r.report_date),
            diagnoses: Array.isArray(d.diagnoses) ? d.diagnoses : [],
            medications: Array.isArray(d.medications)
              ? d.medications.map((m: any) => ({ name: m.name, dosage: m.dosage || null }))
              : [],
            nextAppointment: d.next_appointment ? formatDate(d.next_appointment) : null,
          };
        })
      );
      const latest = reports[0]?.ai_extracted_data;
      if (latest) {
        if (Array.isArray(latest.medications)) {
          setMedications(latest.medications.map((m: any) => ({ name: m.name || '', dosage: m.dosage || '' })));
        }
        if (Array.isArray(latest.vaccinations)) {
          setVaccinations(latest.vaccinations.map((v: any) => ({
            name: v.name || v.vaccine || '', date: v.date ? formatDate(v.date) : '',
          })));
        }
      }

      // Weekly stats
      const logs = logsRes.data || [];
      const calLogs = logs.filter((l: any) => (l.calories_consumed || 0) > 0);
      const avgDailyCalories = calLogs.length
        ? Math.round(calLogs.reduce((s: number, l: any) => s + (l.calories_consumed || 0), 0) / calLogs.length)
        : null;
      const waterLogs = logs.filter((l: any) => (l.water_ml || 0) > 0);
      const avgWaterMl = waterLogs.length
        ? Math.round(waterLogs.reduce((s: number, l: any) => s + (l.water_ml || 0), 0) / waterLogs.length)
        : null;
      const totalWeekCals = logs.reduce((s: number, l: any) => s + (l.calories_consumed || 0), 0);
      const treatCals = (treatScansRes.data || []).reduce((s: number, t: any) => s + (t.ai_estimated_calories || 0), 0);
      const treatCaloriesPercent = totalWeekCals > 0 ? Math.round((treatCals / totalWeekCals) * 100) : null;
      const totalActMins = (actsRes.data || []).reduce((s: number, a: any) => s + (a.duration_minutes || 0), 0);
      const avgActivityMinutes = (actsRes.data || []).length ? Math.round(totalActMins / 7) : null;
      const waterTargetMl = activePet.current_weight_kg ? Math.round(activePet.current_weight_kg * 50) : null;

      setWeekly({
        targetDailyCalories: activePet.target_daily_calories ?? null,
        avgDailyCalories,
        treatCaloriesPercent,
        avgWaterMl,
        waterTargetMl,
        avgActivityMinutes,
      });
    } catch (e: any) {
      console.error('[vet-report] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [activePet, user?.id]);

  useEffect(() => {
    track('vet_report_opened', { species: activePet?.species ?? null, from_case: !!caseId });
    loadData();
  }, [loadData]);

  // Prefill the reason field from the concern the owner came in with.
  // Owner-typed text always wins — we only seed once per case id, and we never
  // overwrite a non-empty field.
  useEffect(() => {
    if (!caseId || prefilledForCaseRef.current === caseId) return;
    if (reasonEditedRef.current) return;
    let cancelled = false;
    (async () => {
      const thread = await getThread(caseId);
      if (cancelled || !thread) return;
      const head = thread.head;
      const concern = head.question.trim().replace(/\s+/g, ' ');
      const keyPoints = (head.answer?.keyPoints || [])
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 4);
      const lines = [`Presenting concern: ${concern}`];
      if (keyPoints.length) {
        lines.push('');
        lines.push('Key signs noted:');
        for (const p of keyPoints) lines.push(`• ${p}`);
      }
      const prefill = lines.join('\n');
      prefilledForCaseRef.current = caseId;
      if (!reasonEditedRef.current) setReason(prefill);
    })();
    return () => { cancelled = true; };
  }, [caseId]);

  function buildData(): VetReportData {
    const pet = activePet!;
    const diet: DietItem[] = (foodPantry || []).map((p) => ({
      brand: p.brand || null,
      productName: p.product_name,
      foodType: FOOD_TYPE_LABEL[p.food_type] || p.food_type,
      isPrimary: p.is_primary,
    }));
    return {
      signalment: {
        name: pet.name,
        species: pet.species,
        breed: pet.breed || null,
        sex: cap(pet.gender),
        isNeutered: pet.is_neutered ?? null,
        ageLabel: ageLabel(pet.age_years),
        microchip: null,
      },
      owner: { name: ownerName, email: user?.email ?? null },
      vitals: {
        currentWeightKg: pet.current_weight_kg ?? null,
        targetWeightKg: pet.target_weight_kg ?? null,
        bcs: pet.body_condition_score ?? null,
        activityLevel: ACTIVITY_LABEL[pet.activity_level] || null,
      },
      weightHistory,
      diet,
      weekly,
      allergies: pet.allergies || [],
      conditions: pet.medical_conditions || [],
      medications: medications.filter((m) => m.name.trim()),
      vaccinations: vaccinations.filter((v) => v.name.trim()),
      recentVetHistory,
      reason: reason.trim() || null,
      petPhotoDataUri: null, // filled in handleShare (async fetch)
      generatedAt: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }

  const handleShare = async () => {
    if (!checkAccess()) return;
    if (!activePet) {
      setErrorMsg('No pet found. Set up a pet profile first.');
      return;
    }
    setGenerating(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const data = buildData();
      data.petPhotoDataUri = await fetchImageDataUri(activePet.image_url);
      track('vet_report_generated', {
        species: activePet.species,
        has_reason: !!data.reason,
        meds: data.medications.length,
        vaccines: data.vaccinations.length,
      });

      const html = buildVetReportHTML(data);
      const { uri } = await Print.printToFileAsync({ html });

      if (!(await Sharing.isAvailableAsync())) {
        setErrorMsg('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: `${petName}'s health summary`,
      });
      track('vet_report_shared', { species: activePet.species });
    } catch (e: any) {
      console.error('[vet-report] share error:', e);
      setErrorMsg(e?.message || 'Could not generate the report. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  // ─── Editable list helpers ───
  const addMedication = () => setMedications((prev) => [...prev, { name: '', dosage: '' }]);
  const updateMedication = (i: number, key: keyof Medication, val: string) =>
    setMedications((prev) => prev.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)));
  const removeMedication = (i: number) =>
    setMedications((prev) => prev.filter((_, idx) => idx !== i));

  const addVaccination = () => setVaccinations((prev) => [...prev, { name: '', date: '' }]);
  const updateVaccination = (i: number, key: keyof Vaccination, val: string) =>
    setVaccinations((prev) => prev.map((v, idx) => (idx === i ? { ...v, [key]: val } : v)));
  const removeVaccination = (i: number) =>
    setVaccinations((prev) => prev.filter((_, idx) => idx !== i));

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Vet report" />
        <View style={styles.center}>
          <ActivityIndicator color={color.navy} />
        </View>
      </SafeAreaView>
    );
  }

  if (!activePet) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Vet report" />
        <View style={styles.center}>
          <Typography variant="body" color={color.slateMuted} align="center">
            Set up a pet profile to generate a vet report.
          </Typography>
        </View>
      </SafeAreaView>
    );
  }

  const summary = [
    { label: 'Patient', value: `${petName}${activePet.breed ? ` · ${activePet.breed}` : ''}` },
    { label: 'Current weight', value: activePet.current_weight_kg ? `${activePet.current_weight_kg} kg` : '—' },
    { label: 'Body condition', value: activePet.body_condition_score ? `${activePet.body_condition_score}/9` : '—' },
    { label: 'Weight history', value: `${weightHistory.length} entr${weightHistory.length === 1 ? 'y' : 'ies'}` },
    { label: 'Diet (pantry)', value: `${(foodPantry || []).length} item${(foodPantry || []).length === 1 ? '' : 's'}` },
    { label: 'Allergies', value: (activePet.allergies || []).length ? activePet.allergies!.join(', ') : 'None' },
    { label: 'Conditions', value: (activePet.medical_conditions || []).length ? activePet.medical_conditions!.join(', ') : 'None' },
    { label: 'Vet history', value: `${recentVetHistory.length} report${recentVetHistory.length === 1 ? '' : 's'}` },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Vet report" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Typography variant="title" weight="bold" style={{ marginBottom: space.xs }}>
            A summary for {petName}&apos;s vet
          </Typography>
          <Typography variant="body" color={color.slateMuted} style={{ marginBottom: space.xl }}>
            Pawtchi gathers what it already knows into a clean PDF you can send or show at the visit.
          </Typography>

          {/* Auto-included summary */}
          <View style={styles.card}>
            <Typography variant="caption" color={color.slateFaint} style={styles.cardLabel}>
              INCLUDED AUTOMATICALLY
            </Typography>
            {summary.map((r, i) => (
              <View key={i} style={[styles.summaryRow, i === summary.length - 1 && { borderBottomWidth: 0 }]}>
                <Typography variant="body" color={color.slateMuted}>{r.label}</Typography>
                <Typography variant="body" weight="semibold" style={styles.summaryVal} numberOfLines={1}>
                  {r.value}
                </Typography>
              </View>
            ))}
          </View>

          {/* Reason for visit */}
          <Typography variant="caption" color={color.slateFaint} style={styles.sectionLabel}>
            REASON FOR VISIT / CONCERNS
          </Typography>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={reason}
            onChangeText={(t) => { reasonEditedRef.current = true; setReason(t); }}
            multiline
            placeholder="e.g. Limping on right hind leg for the past week…"
            placeholderTextColor={color.slateFaint}
          />

          {/* Medications */}
          <View style={styles.sectionHeadRow}>
            <Typography variant="caption" color={color.slateFaint} style={styles.sectionLabel}>
              CURRENT MEDICATIONS
            </Typography>
            <TouchableOpacity onPress={addMedication} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="add-circle-outline" size={22} color={color.navy} />
            </TouchableOpacity>
          </View>
          {medications.length === 0 && (
            <Typography variant="body" color={color.slateFaint} style={styles.emptyHint}>
              None added. Tap + to add a medication.
            </Typography>
          )}
          {medications.map((m, i) => (
            <View key={i} style={styles.rowEditor}>
              <TextInput
                style={[styles.input, styles.flex2]}
                value={m.name}
                onChangeText={(t) => updateMedication(i, 'name', t)}
                placeholder="Medication"
                placeholderTextColor={color.slateFaint}
              />
              <TextInput
                style={[styles.input, styles.flex1]}
                value={m.dosage ?? ''}
                onChangeText={(t) => updateMedication(i, 'dosage', t)}
                placeholder="Dosage"
                placeholderTextColor={color.slateFaint}
              />
              <TouchableOpacity onPress={() => removeMedication(i)} style={styles.removeBtn}>
                <MaterialIcons name="close" size={18} color={color.slateMuted} />
              </TouchableOpacity>
            </View>
          ))}

          {/* Vaccinations */}
          <View style={styles.sectionHeadRow}>
            <Typography variant="caption" color={color.slateFaint} style={styles.sectionLabel}>
              VACCINATIONS
            </Typography>
            <TouchableOpacity onPress={addVaccination} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="add-circle-outline" size={22} color={color.navy} />
            </TouchableOpacity>
          </View>
          {vaccinations.length === 0 && (
            <Typography variant="body" color={color.slateFaint} style={styles.emptyHint}>
              None added. Tap + to add a vaccination.
            </Typography>
          )}
          {vaccinations.map((v, i) => (
            <View key={i} style={styles.rowEditor}>
              <TextInput
                style={[styles.input, styles.flex2]}
                value={v.name}
                onChangeText={(t) => updateVaccination(i, 'name', t)}
                placeholder="Vaccine"
                placeholderTextColor={color.slateFaint}
              />
              <TextInput
                style={[styles.input, styles.flex1]}
                value={v.date ?? ''}
                onChangeText={(t) => updateVaccination(i, 'date', t)}
                placeholder="Date"
                placeholderTextColor={color.slateFaint}
              />
              <TouchableOpacity onPress={() => removeVaccination(i)} style={styles.removeBtn}>
                <MaterialIcons name="close" size={18} color={color.slateMuted} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={{ height: space.xl }} />
          <PawtchiButton
            title="Share PDF"
            variant="primary"
            size="large"
            iconName="ios-share"
            loading={generating}
            onPress={handleShare}
          />
          <Typography variant="caption" color={color.slateFaint} align="center" style={styles.footnote}>
            Owner-prepared summary · not a veterinary diagnosis
          </Typography>
        </ScrollView>
      </KeyboardAvoidingView>

      <PawtchiModal
        visible={!!errorMsg}
        onClose={() => setErrorMsg(null)}
        title="Couldn’t share"
        icon={{ name: 'error-outline', color: color.error }}
        message={errorMsg || ''}
        showCloseButton
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  scroll: { paddingHorizontal: space.xxl, paddingTop: space.md, paddingBottom: 60 },

  card: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    ...shadow.card,
  },
  cardLabel: { marginBottom: space.sm },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
    gap: space.lg,
  },
  summaryVal: { flexShrink: 1, textAlign: 'right' },

  sectionLabel: { marginTop: space.xxl, marginBottom: space.sm },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyHint: { marginTop: space.xs, marginBottom: space.xs },

  input: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    fontFamily: font.medium,
    fontSize: 15,
    color: color.ink,
  },
  multiline: { height: 90, textAlignVertical: 'top', paddingTop: 12 },

  rowEditor: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  removeBtn: { padding: 6 },

  footnote: { marginTop: space.md },
});
