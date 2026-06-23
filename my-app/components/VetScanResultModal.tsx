import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity,
  TouchableWithoutFeedback, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { color, font, radius, shadow, space } from '../constants/design';
import { PulseMark } from './PulseMark';
import { possessivePronoun } from '../lib/referral';

const FALLBACK_AVATAR =
  'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=400&auto=format&fit=crop';

export interface VetScanResult {
  // What Gemini extracted from this report
  weight: number | null;
  bcs: number | null;
  newDiagnoses: string[];
  newAllergies: string[];
  medicationsCount: number;
  vaccinationsCount: number;
  nextAppointment: string | null;

  // Recalibration outcome
  prevWeight: number | null;
  weightDiff: number | null;
  prevCalories: number;
  newCalories: number | null;
  calorieDiff: number | null;
  scheduleRegenerated: boolean;
  waterMlPerSession: number | null;

  // Reward + bookkeeping
  coinsAwarded: number;
  hasUsefulData: boolean;
  cantReadHint: string | null;
}

interface PetSnapshot {
  name: string;
  imageUrl?: string | null;
  gender?: string | null;
  currentWeightKg?: number | null;
  targetWeightKg?: number | null;
  targetDailyCalories?: number | null;
  bcs?: number | null;
  activityLevel?: string | null;
  totalAllergies?: number;
  totalConditions?: number;
}

interface Props {
  visible: boolean;
  pet: PetSnapshot;
  result: VetScanResult | null;
  onClose: () => void;
  onOpenHistory: () => void;
}

// Plain-English description of a body condition score (1–9 scale).
function bcsLabel(score?: number | null): string | null {
  if (score == null) return null;
  if (score <= 3) return 'Underweight';
  if (score <= 5) return 'Ideal';
  if (score <= 7) return 'Slightly heavy';
  return 'Heavy';
}

// Calorie goal phrasing ("maintain", "trim", "build") from current vs target weight.
function goalPhrase(current?: number | null, target?: number | null): string | null {
  if (!current || !target) return 'maintain';
  const diff = target - current;
  if (diff < -0.5) return 'trim';
  if (diff > 0.5) return 'build';
  return 'maintain';
}

// Activity level → friendly label.
const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: 'Quiet',
  normal: 'Steady',
  active: 'Active',
  highly_active: 'Highly active',
};

// Format "next visit". Gemini sometimes returns natural language ("In 4-6 weeks")
// or an ISO date — both need cleaning before display.
function formatNextVisit(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // ISO date → friendly format.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  // Natural language — strip a leading "In " so the sentence reads cleanly
  // when prefixed with "in" in the UI.
  return trimmed.replace(/^in\s+/i, '');
}

// Number formatting with thousands separator (kcal).
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

export function VetScanResultModal({ visible, pet, result, onClose, onOpenHistory }: Props) {
  // Hook order must be stable — declare effects unconditionally.
  useEffect(() => {
    // No-op; reserved for future haptic / analytics hooks on open.
  }, [visible]);

  if (!result) return null;

  const their = possessivePronoun(pet.gender);
  const avatar = pet.imageUrl || FALLBACK_AVATAR;

  // ─── Calm "couldn't read" path ───
  if (!result.hasUsefulData) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <View style={styles.dimBackdrop}>
          <TouchableOpacity activeOpacity={1} style={styles.dimFill} onPress={onClose}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.calmCard}>
                <View style={styles.calmHeader}>
                  <MaterialIcons name="description" size={24} color={color.slateMuted} />
                  <Text style={styles.calmTitle}>Couldn’t read the details</Text>
                  <TouchableOpacity onPress={onClose} style={styles.calmClose}>
                    <MaterialIcons name="close" size={20} color={color.slateFaint} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.calmBody}>
                  {result.cantReadHint ||
                    `Saved to ${pet.name}’s history. Try a clearer photo so Pawtchi can pull in vitals and diagnoses.`}
                </Text>
                <TouchableOpacity style={styles.calmCta} onPress={onClose} activeOpacity={0.9}>
                  <Text style={styles.calmCtaText}>Done</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // ─── Rich result sheet ───
  const dailyKcal = result.newCalories ?? pet.targetDailyCalories ?? null;
  const weightShown = result.weight ?? pet.currentWeightKg ?? null;
  const bcsShown = result.bcs ?? pet.bcs ?? null;
  const goal = goalPhrase(weightShown, pet.targetWeightKg);
  const activity = pet.activityLevel ? ACTIVITY_LABEL[pet.activityLevel] || null : null;
  const visitText = formatNextVisit(result.nextAppointment);

  // What changed (only show when there's something to say).
  const changedRows: string[] = [];
  if (result.calorieDiff != null && result.calorieDiff !== 0 && result.newCalories != null) {
    const arrow = result.calorieDiff > 0 ? '↑' : '↓';
    changedRows.push(`Daily target: ${fmtNum(result.prevCalories)} → ${fmtNum(result.newCalories)} kcal ${arrow}`);
  }
  if (result.weightDiff != null && Math.abs(result.weightDiff) >= 0.1 && result.prevWeight != null && result.weight != null) {
    changedRows.push(`Weight: ${result.prevWeight.toFixed(1)} → ${result.weight.toFixed(1)} kg`);
  }
  if (result.scheduleRegenerated) {
    changedRows.push('Activity schedule refreshed for the new weight');
  }
  if (result.waterMlPerSession != null) {
    changedRows.push(`Each water session set to ${result.waterMlPerSession} ml`);
  }
  if (result.newDiagnoses.length) {
    changedRows.push(`${result.newDiagnoses.length} ${result.newDiagnoses.length === 1 ? 'condition' : 'conditions'} added to ${their} history`);
  }
  if (result.newAllergies.length) {
    changedRows.push(`${result.newAllergies.length} ${result.newAllergies.length === 1 ? 'allergen' : 'allergens'} added to ${their} list`);
  }

  // Captured-from-report bullets (always something here because hasUsefulData = true).
  const capturedRows: string[] = [];
  if (result.bcs != null) capturedRows.push(`Body condition: ${result.bcs}/9${bcsLabel(result.bcs) ? ` · ${bcsLabel(result.bcs)}` : ''}`);
  if (result.weight != null) capturedRows.push(`Weight: ${result.weight.toFixed(1)} kg`);
  if (result.newDiagnoses.length) capturedRows.push(`Diagnoses: ${result.newDiagnoses.slice(0, 3).join(', ')}${result.newDiagnoses.length > 3 ? '…' : ''}`);
  if (result.newAllergies.length) capturedRows.push(`Allergens: ${result.newAllergies.slice(0, 3).join(', ')}${result.newAllergies.length > 3 ? '…' : ''}`);
  if (result.medicationsCount) capturedRows.push(`${result.medicationsCount} ${result.medicationsCount === 1 ? 'medication' : 'medications'} saved for the vet summary`);
  if (result.vaccinationsCount) capturedRows.push(`${result.vaccinationsCount} ${result.vaccinationsCount === 1 ? 'vaccination' : 'vaccinations'} on file`);
  if (visitText) capturedRows.push(`Next visit in ${visitText}`);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <View style={styles.sheetHeader}>
          <View style={{ width: 32 }} />
          <Text style={styles.sheetEyebrow}>PROFILE CALIBRATED</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.sheetCloseBtn}>
            <MaterialIcons name="close" size={22} color={color.slateMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Hero: avatar + title + reward chip ── */}
          <Animated.View entering={FadeIn.duration(360)} style={styles.hero}>
            <View style={styles.avatarRing}>
              <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" transition={200} />
              <View style={styles.checkBadge}>
                <MaterialIcons name="check" size={16} color={color.navy} />
              </View>
            </View>
            <Text style={styles.heroTitle}>{pet.name} is up to date</Text>
            <Text style={styles.heroSub}>
              {result.weight != null
                ? `Pawtchi recalibrated ${their} profile against the latest vet read.`
                : `Pawtchi filed everything from this report into ${their} profile.`}
            </Text>

            {result.coinsAwarded > 0 && (
              <View style={styles.coinChip}>
                <MaterialIcons name="stars" size={14} color={color.navy} />
                <Text style={styles.coinChipText}>+{result.coinsAwarded} PawCoins</Text>
              </View>
            )}
          </Animated.View>

          {/* ── Calibration snapshot — the three numbers that prove the loop closed ── */}
          <Animated.View entering={FadeInDown.duration(380).delay(80)} style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>DAILY TARGET</Text>
              <Text style={styles.statValue}>{fmtNum(dailyKcal)}</Text>
              <Text style={styles.statUnit}>kcal</Text>
              <Text style={styles.statSub}>
                {weightShown ? `for ${weightShown.toFixed(1)} kg · ${goal}` : goal}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>WEIGHT</Text>
              <Text style={styles.statValue}>{weightShown != null ? weightShown.toFixed(1) : '—'}</Text>
              <Text style={styles.statUnit}>kg</Text>
              <Text style={styles.statSub}>
                {pet.targetWeightKg ? `goal ${pet.targetWeightKg.toFixed(1)} kg` : 'no goal set'}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>BODY</Text>
              <Text style={styles.statValue}>{bcsShown != null ? `${bcsShown}` : '—'}</Text>
              <Text style={styles.statUnit}>{bcsShown != null ? '/9' : ''}</Text>
              <Text style={styles.statSub}>{bcsLabel(bcsShown) || (activity ? activity.toLowerCase() : '—')}</Text>
            </View>
          </Animated.View>

          {/* ── What we captured from this report ── */}
          {capturedRows.length > 0 && (
            <Animated.View entering={FadeInDown.duration(380).delay(140)} style={styles.section}>
              <Text style={styles.sectionLabel}>FROM THIS REPORT</Text>
              {capturedRows.map((row, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{row}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* ── What changed in the system as a result ── */}
          {changedRows.length > 0 && (
            <Animated.View entering={FadeInDown.duration(380).delay(200)} style={[styles.section, styles.sectionAccent]}>
              <Text style={styles.sectionLabel}>WHAT CHANGED FOR {pet.name.toUpperCase()}</Text>
              {changedRows.map((row, i) => (
                <View key={i} style={styles.bulletRow}>
                  <PulseMark size={10} ringColor={color.navy} strokeColor={color.navy} />
                  <Text style={styles.bulletTextAccent}>{row}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* ── Quiet reassurance when nothing structural moved ── */}
          {changedRows.length === 0 && result.hasUsefulData && (
            <Animated.View entering={FadeInDown.duration(380).delay(200)} style={styles.calmFootnote}>
              <MaterialIcons name="check-circle-outline" size={14} color={color.slateFaint} />
              <Text style={styles.calmFootnoteText}>
                Nothing else needed recalibrating — {pet.name}’s profile already matches this report.
              </Text>
            </Animated.View>
          )}
        </ScrollView>

        {/* ── CTAs pinned to the bottom of the sheet ── */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryBtn} onPress={onOpenHistory} activeOpacity={0.9}>
            <Text style={styles.primaryBtnText}>Open vet history</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Sheet ──
  sheet: { flex: 1, backgroundColor: color.surface },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  sheetEyebrow: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: color.slateFaint,
  },
  sheetCloseBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, backgroundColor: color.track,
  },
  scroll: { paddingHorizontal: space.xxl, paddingBottom: space.xl },

  // ── Hero ──
  hero: { alignItems: 'center', paddingTop: space.lg },
  avatarRing: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 3, borderColor: color.yellow,
    padding: 3,
    ...(Platform.OS === 'ios' ? shadow.raised : { elevation: 6 }),
  },
  avatar: { width: '100%', height: '100%', borderRadius: 42 },
  checkBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: color.yellow,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: color.surface,
  },
  heroTitle: {
    fontFamily: font.extrabold,
    fontSize: 24,
    color: color.ink,
    marginTop: space.lg,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  heroSub: {
    fontFamily: font.medium,
    fontSize: 14.5,
    color: color.slateMuted,
    marginTop: space.xs,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 21,
  },
  coinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: color.yellow,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    marginTop: space.md,
  },
  coinChipText: {
    fontFamily: font.bold, fontSize: 12.5, letterSpacing: 0.2, color: color.navy,
  },

  // ── Stat row (3 cards) ──
  statRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xxl,
  },
  statCard: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    alignItems: 'flex-start',
  },
  statLabel: {
    fontFamily: font.bold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: color.slateFaint,
    marginBottom: 6,
  },
  statValue: {
    fontFamily: font.extrabold,
    fontSize: 26,
    color: color.ink,
    letterSpacing: -0.6,
    lineHeight: 30,
  },
  statUnit: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.slateMuted,
    marginTop: 2,
    letterSpacing: 0.4,
  },
  statSub: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.slateMuted,
    marginTop: space.sm,
  },

  // ── Sections ──
  section: { marginTop: space.xxl },
  sectionAccent: {
    backgroundColor: 'rgba(247, 246, 2, 0.10)',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(247, 246, 2, 0.30)',
    padding: space.lg,
    marginTop: space.lg,
  },
  sectionLabel: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    color: color.slateFaint,
    marginBottom: space.md,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginBottom: 8,
  },
  bulletDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: color.slateMuted,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14,
    color: color.ink,
    lineHeight: 21,
  },
  bulletTextAccent: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.ink,
    lineHeight: 21,
  },

  // ── Calm reassurance footnote ──
  calmFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.xl,
    paddingHorizontal: space.md,
    justifyContent: 'center',
  },
  calmFootnoteText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateFaint,
    flexShrink: 1,
  },

  // ── Actions ──
  actions: {
    paddingHorizontal: space.xxl,
    paddingBottom: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    backgroundColor: color.surface,
    gap: space.sm,
  },
  primaryBtn: {
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.navy,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    color: color.slateMuted,
  },

  // ── Calm "couldn't read" fallback (centered card) ──
  dimBackdrop: { flex: 1, backgroundColor: 'rgba(7, 32, 42, 0.4)' },
  dimFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxl },
  calmCard: {
    width: '100%',
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    ...shadow.card,
  },
  calmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  calmTitle: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 16,
    color: color.ink,
  },
  calmClose: { padding: 4 },
  calmBody: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.slateMuted,
    lineHeight: 21,
    marginBottom: space.lg,
  },
  calmCta: {
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calmCtaText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
  },
});
