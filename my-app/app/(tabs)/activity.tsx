import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { color, font, radius, shadow, space } from '../../constants/design';
import { supabase } from '../../lib/supabase';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { contextualizeWalk } from '../../lib/contextualizer';
import { regenerateSchedule } from '../../lib/scheduleAdjuster';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import { PawtchiModal, PawtchiSuccessModal } from '../../components/PawtchiModal';
import { PawtchiButton } from '../../components/PawtchiButton';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RING_CIRCUMFERENCE = 2 * Math.PI * 28; // r=28

// Activity Type Definitions
const ACTIVITY_TYPES = [
  { id: 'walk', label: 'Walk', icon: 'directions-walk', color: '#F7F602' },
  { id: 'play', label: 'Play', icon: 'sports-baseball', color: '#fef8c3' },
  { id: 'water', label: 'Water', icon: 'water-drop', color: '#cde0ea' },
  { id: 'medicine', label: 'Medicine', icon: 'healing', color: '#fca5a5' },
  { id: 'grooming', label: 'Grooming', icon: 'content-cut', color: '#dcfce3' },
  { id: 'training', label: 'Training', icon: 'school', color: '#e0e7ff' },
  { id: 'vet_visit', label: 'Vet Visit', icon: 'local-hospital', color: '#fee2e2' },
  { id: 'other', label: 'Other', icon: 'star', color: '#f3f4f6' },
];

// Activity types whose completion asks "how long?" before confirming.
const TIME_BASED_TYPES = ['walk', 'play', 'training'];
const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60];

interface SmartConfirmProps {
  item: any;
  petName: string;
  confirmingDuration: number;
  onSelectDuration: (mins: number) => void;
  onConfirm: (item: any, duration: number) => void;
  onCancel: () => void;
}

// Inline duration picker shown when completing a time-based activity. Memoized +
// shared by the "Up next" card and the timeline rows (was a render-prop closure).
const SmartConfirm = React.memo(function SmartConfirm({
  item, petName, confirmingDuration, onSelectDuration, onConfirm, onCancel,
}: SmartConfirmProps) {
  return (
    <View style={styles.smartConfirm}>
      <Text style={styles.smartConfirmLabel}>How long did {petName} go?</Text>
      <View style={styles.smartConfirmRow}>
        {DURATION_OPTIONS.map(mins => {
          const isScheduled = mins === (item.duration_minutes || 15);
          const isSelected = mins === confirmingDuration;
          return (
            <TouchableOpacity
              key={mins}
              style={[
                styles.smartChip,
                isSelected && styles.smartChipActive,
                isScheduled && !isSelected && styles.smartChipScheduled,
              ]}
              onPress={() => onSelectDuration(mins)}
            >
              <Text style={[styles.smartChipText, isSelected && styles.smartChipTextActive]}>{mins}m</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.smartConfirmActions}>
        <TouchableOpacity style={styles.smartDoneBtn} onPress={() => onConfirm(item, confirmingDuration)}>
          <MaterialIcons name="check" size={16} color={color.navy} />
          <Text style={styles.smartDoneBtnText}>Confirm</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smartCancelBtn} onPress={onCancel}>
          <Text style={styles.smartCancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

interface TimelineRowProps {
  item: any;
  isLast: boolean;
  isExpanded: boolean;
  isConfirming: boolean;
  confirmingDuration: number;
  petName: string;
  currentWeightKg?: number;
  onToggleExpand: (item: any, isExpanded: boolean) => void;
  onCheckTap: (item: any) => void;
  onSelectDuration: (mins: number) => void;
  onConfirm: (item: any, duration: number) => void;
  onCancel: () => void;
}

// One timeline entry (food or activity). Memoized so toggling expand/confirm on
// one row doesn't re-render the whole list. Non-affected rows receive identical
// props (callbacks are stable, confirmingDuration is normalized to -1 when not
// confirming) → React.memo skips them.
const TimelineRow = React.memo(function TimelineRow({
  item, isLast, isExpanded, isConfirming, confirmingDuration,
  petName, currentWeightKg, onToggleExpand, onCheckTap, onSelectDuration, onConfirm, onCancel,
}: TimelineRowProps) {
  const isFood = item._feedType === 'food';
  const timeStr = item.scheduled_time
    ? item.scheduled_time.slice(0, 5)
    : new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isFood) {
    return (
      <View style={styles.tlRow}>
        <View style={styles.tlRail}>
          <View style={[styles.tlDot, styles.tlDotDone]}>
            <MaterialIcons name="restaurant" size={9} color={color.navy} />
          </View>
          {!isLast && <View style={styles.tlLine} />}
        </View>
        <View style={styles.tlBody}>
          <View style={styles.tlHead}>
            <Text style={styles.tlTime}>{timeStr}</Text>
            <Text style={styles.tlMeta}>{item.ai_estimated_calories} kcal</Text>
          </View>
          <Text style={styles.tlTitle} numberOfLines={1}>
            {item.ai_identified_food || 'Food logged'}
          </Text>
        </View>
      </View>
    );
  }

  const isPending = item.status === 'pending';
  const isCompleted = item.status === 'completed';
  const isSkipped = item.status === 'skipped';
  const typeDef = ACTIVITY_TYPES.find(t => t.id === item.activity_type) || ACTIVITY_TYPES[0];
  const meta: string[] = [];
  if (item.duration_minutes) meta.push(`${item.duration_minutes} min`);
  if (item.water_ml) meta.push(`${item.water_ml} ml`);
  if (item.distance_km) meta.push(`${item.distance_km} km`);

  return (
    <View style={styles.tlRow}>
      <View style={styles.tlRail}>
        <View style={[
          styles.tlDot,
          isCompleted && styles.tlDotDone,
          isPending && styles.tlDotPending,
          isSkipped && styles.tlDotSkipped,
        ]}>
          {isCompleted && <MaterialIcons name="check" size={11} color={color.navy} />}
          {isSkipped && <MaterialIcons name="close" size={10} color={color.slateFaint} />}
        </View>
        {!isLast && <View style={styles.tlLine} />}
      </View>
      <TouchableOpacity
        style={[styles.tlBody, isExpanded && styles.tlBodyExpanded]}
        activeOpacity={0.7}
        disabled={isConfirming}
        onPress={() => { if (!isConfirming) onToggleExpand(item, isExpanded); }}
      >
        <View style={styles.tlHead}>
          <Text style={[styles.tlTime, isSkipped && { color: color.slateFaint }]}>{timeStr}</Text>
          {meta.length > 0 && (
            <Text style={[styles.tlMeta, isSkipped && { color: color.slateFaint }]}>
              {meta.join(' · ')}
            </Text>
          )}
        </View>
        <View style={styles.tlTitleRow}>
          <MaterialIcons
            name={typeDef.icon as any}
            size={14}
            color={isSkipped ? color.slateFaint : color.slateMuted}
          />
          <Text style={[styles.tlTitle, isSkipped && { color: color.slateFaint, textDecorationLine: 'line-through' }]} numberOfLines={isExpanded ? undefined : 1}>
            {item.title}
          </Text>
          {!!item.notes && !isExpanded && !isConfirming && (
            <MaterialIcons name="expand-more" size={16} color={color.slateFaint} style={{ marginLeft: 'auto' }} />
          )}
        </View>

        {/* Collapsed: single-line preview */}
        {!!item.notes && !isExpanded && !isConfirming && (
          <Text style={styles.tlNote} numberOfLines={1}>{item.notes}</Text>
        )}

        {/* Expanded: full description + contextual info + actions */}
        {isExpanded && !isConfirming && (
          <View style={styles.tlExpandedDetail}>
            {!!item.notes && (
              <Text style={styles.tlDetailDesc}>{item.notes}</Text>
            )}
            {currentWeightKg && ['walk', 'play'].includes(item.activity_type) && item.duration_minutes && (
              <Text style={styles.tlContext}>
                {contextualizeWalk(item.duration_minutes, currentWeightKg)}
              </Text>
            )}
            {item.intensity && (
              <View style={styles.tlDetailTagRow}>
                <View style={styles.tlDetailTag}>
                  <MaterialIcons name="speed" size={12} color={color.slateMuted} />
                  <Text style={styles.tlDetailTagText}>{item.intensity}</Text>
                </View>
                {item.distance_km && (
                  <View style={styles.tlDetailTag}>
                    <MaterialIcons name="straighten" size={12} color={color.slateMuted} />
                    <Text style={styles.tlDetailTagText}>{item.distance_km} km</Text>
                  </View>
                )}
              </View>
            )}
            {isPending && (
              <TouchableOpacity
                style={styles.tlDetailMarkDone}
                onPress={() => onCheckTap(item)}
                activeOpacity={0.9}
              >
                <MaterialIcons name="check" size={15} color={color.navy} />
                <Text style={styles.tlDetailMarkDoneText}>Mark done</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Collapsed context line (walk/play only) */}
        {!isExpanded && isPending && !isConfirming && currentWeightKg && ['walk', 'play'].includes(item.activity_type) && item.duration_minutes && (
          <Text style={styles.tlContext} numberOfLines={1}>
            {contextualizeWalk(item.duration_minutes, currentWeightKg)}
          </Text>
        )}
        {isConfirming && (
          <SmartConfirm
            item={item}
            petName={petName}
            confirmingDuration={confirmingDuration}
            onSelectDuration={onSelectDuration}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}
      </TouchableOpacity>
    </View>
  );
});

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const activePet = useActivePetStore(s => s.activePet);
  const awardCoins = useStreakStore(s => s.awardCoins);
  const { user } = useAuth();
  const { hasFullAccess } = useSubscription();

  const checkAccess = () => {
    if (!hasFullAccess) {
      router.push('/paywall' as any);
      return false;
    }
    return true;
  };

  const [currentDate, setCurrentDate] = useState(new Date());
  const [activities, setActivities] = useState<any[]>([]);
  const [foodScans, setFoodScans] = useState<any[]>([]);
  const [dailyLog, setDailyLog] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [weeklyStats, setWeeklyStats] = useState<{ completed: number; skipped: number; total: number } | null>(null);
  const [showAdjustBanner, setShowAdjustBanner] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustDismissed, setAdjustDismissed] = useState(false);
  const [lastBurnSummary, setLastBurnSummary] = useState<{
    weeklyKcal: number; dailyKcal: number; contributionPct: number;
    deficitPct: number; totalMinutes: number; byType: Record<string, any>;
  } | null>(null);

  // Branded schedule success modal
  const [showScheduleSuccess, setShowScheduleSuccess] = useState(false);
  const [scheduleSuccessData, setScheduleSuccessData] = useState<{
    activitiesCreated: number;
    daysGenerated: number;
    weeklyKcal: number;
    dailyKcal: number;
    deficitPct: number;
    totalMinutes: number;
  } | null>(null);

  // Branded schedule adjusted modal
  const [showAdjustSuccess, setShowAdjustSuccess] = useState(false);
  const [adjustSuccessMsg, setAdjustSuccessMsg] = useState('');

  // Branded error modal
  const [showError, setShowError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Smart Completion state
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);
  const [confirmingDuration, setConfirmingDuration] = useState(0);

  // Expanded detail view — tap a timeline item to see full description
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Modal state
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formDuration, setFormDuration] = useState(15);
  const [formDistance, setFormDistance] = useState('');
  const [formWater, setFormWater] = useState(250);
  const [formIntensity, setFormIntensity] = useState<'low' | 'moderate' | 'high'>('moderate');

  const getLocalYMD = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const dateStr = getLocalYMD(currentDate);

  // Tracks whether the screen has completed at least one fetch. Used to keep the
  // full loading state to the FIRST load only — later refetches (tab focus, date
  // change, modal close) refresh in place so the timeline never unmounts (which is
  // what caused the flicker + FadeInDown entrance-animation replay).
  const hasLoadedRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!activePet) return;
    if (!hasLoadedRef.current) setIsLoading(true);

    const startOfDay = new Date(currentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Three independent reads → run in parallel instead of a serial waterfall.
      const [logRes, scansRes, actsRes] = await Promise.all([
        supabase
          .from('daily_logs')
          .select('*')
          .eq('pet_id', activePet.id)
          .eq('log_date', dateStr)
          .single(),
        supabase
          .from('food_scans')
          .select('*')
          .eq('pet_id', activePet.id)
          .gte('created_at', startOfDay.toISOString())
          .lte('created_at', endOfDay.toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('activities')
          .select('*')
          .eq('pet_id', activePet.id)
          .eq('scheduled_date', dateStr)
          .order('scheduled_time', { ascending: true }),
      ]);
      setDailyLog(logRes.data || null);
      setFoodScans(scansRes.data || []);
      setActivities(actsRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
      hasLoadedRef.current = true;
    }
  }, [activePet, currentDate, dateStr]);

  // Check last 7 days completion rate for auto-adjustment
  const fetchWeeklyStats = useCallback(async () => {
    if (!activePet) return;
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    try {
      const { data } = await supabase
        .from('activities')
        .select('status')
        .eq('pet_id', activePet.id)
        .eq('is_ai_generated', true)
        .gte('scheduled_date', getLocalYMD(sevenDaysAgo))
        .lt('scheduled_date', getLocalYMD(today));

      if (data && data.length > 0) {
        const completed = data.filter(a => a.status === 'completed').length;
        const skipped = data.filter(a => a.status === 'skipped').length;
        setWeeklyStats({ completed, skipped, total: data.length });
        const completionRate = completed / data.length;
        if (completionRate < 0.5 && skipped > 2 && !adjustDismissed) {
          setShowAdjustBanner(true);
        }
      }
    } catch (e) {
      console.error('Weekly stats error:', e);
    }
  }, [activePet, adjustDismissed]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      fetchWeeklyStats();
    }, [fetchData, fetchWeeklyStats])
  );

  // Merge food scans + activities into timeline, sorted by time
  const timeline = useMemo(() => {
    const merged = [
      ...foodScans.map(s => ({ ...s, _feedType: 'food' })),
      ...activities.map(a => ({ ...a, _feedType: 'activity' }))
    ];
    return merged.sort((a, b) => {
      const timeA = a.scheduled_time || new Date(a.created_at).toTimeString().slice(0, 8);
      const timeB = b.scheduled_time || new Date(b.created_at).toTimeString().slice(0, 8);
      return timeA.localeCompare(timeB);
    });
  }, [foodScans, activities]);

  const changeDate = (days: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + days);
    setCurrentDate(newDate);
  };

  const isToday = new Date().toDateString() === currentDate.toDateString();

  // Keep a ref to the latest activities so confirmCompletion can snapshot for
  // rollback without taking `activities` as a useCallback dep (which would make
  // the handler — and every memoized row — churn on every list change).
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;

  // Confirm completion (with optional duration override). Defined before
  // handleCheckTap because that handler depends on it.
  const confirmCompletion = useCallback(async (item: any, durationOverride: number | null) => {
    // ── Optimistic UI FIRST — the checkmark must flip instantly, not after the
    // network round-trip(s). Snapshot prior state so we can revert on failure. ──
    const prevActivities = activitiesRef.current;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfirmingTaskId(null);
    setActivities(prev =>
      prev.map(a =>
        a.id === item.id
          ? { ...a, status: 'completed', ...(durationOverride !== null ? { duration_minutes: durationOverride } : {}) }
          : a
      )
    );
    // Award coins for activity completion (fire-and-forget)
    if (user?.id) {
      awardCoins(user.id, 'activity_complete', item.id);
    }
    // Completion changes activity minutes / completion-rate (the Home activity
    // ring), which aren't updated optimistically → force a refetch on next focus.
    usePetContextStore.getState().invalidateContext();

    try {
      const updatePayload: any = { status: 'completed' };
      if (durationOverride !== null) {
        updatePayload.duration_minutes = durationOverride;
      }

      const { error } = await supabase
        .from('activities')
        .update(updatePayload)
        .eq('id', item.id);
      if (error) throw error;

      // Update daily_logs for water and walk
      if (item.activity_type === 'water' || item.activity_type === 'walk') {
        const { data: existingLog } = await supabase
          .from('daily_logs')
          .select('*')
          .eq('pet_id', activePet!.id)
          .eq('log_date', dateStr) // Use viewed date instead of fixed Today
          .single();

        if (existingLog) {
          const updates: any = { updated_at: new Date().toISOString() };
          if (item.activity_type === 'water' && item.water_ml) {
            updates.water_ml = (existingLog.water_ml || 0) + item.water_ml;
          }
          if (item.activity_type === 'walk') {
            updates.walks_count = (existingLog.walks_count || 0) + 1;
          }
          await supabase.from('daily_logs').update(updates).eq('id', existingLog.id);

          // Update context store incrementally
          if (item.activity_type === 'water' && item.water_ml) {
            usePetContextStore.getState().updateWater((existingLog.water_ml || 0) + item.water_ml);
          }
          if (item.activity_type === 'walk') {
            usePetContextStore.getState().updateWalks((existingLog.walks_count || 0) + 1);
          }
        } else {
          const inserts: any = { pet_id: activePet!.id, log_date: dateStr }; // Use viewed date
          if (item.activity_type === 'water') inserts.water_ml = item.water_ml || 0;
          if (item.activity_type === 'walk') inserts.walks_count = 1;
          await supabase.from('daily_logs').insert(inserts);

          // Update context store for new log
          if (item.activity_type === 'water' && item.water_ml) {
            usePetContextStore.getState().updateWater(item.water_ml);
          }
          if (item.activity_type === 'walk') {
            usePetContextStore.getState().updateWalks(1);
          }
        }
      }

    } catch (e: any) {
      // Network failed — roll the optimistic completion back so the UI stays truthful.
      setActivities(prevActivities);
      setErrorMsg(e?.message || 'Failed to complete activity.');
      setShowError(true);
    }
  }, [activePet, dateStr, user, awardCoins]);

  // Handle tap on the check circle. Stable so memoized rows don't re-render.
  const handleCheckTap = useCallback((item: any) => {
    if (!hasFullAccess) { router.push('/paywall' as any); return; }
    if (TIME_BASED_TYPES.includes(item.activity_type)) {
      // Show inline duration confirmation
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setConfirmingTaskId(item.id);
      setConfirmingDuration(item.duration_minutes || 15);
    } else {
      // Instant completion for non-time tasks
      confirmCompletion(item, null);
    }
  }, [hasFullAccess, router, confirmCompletion]);

  // Stable handlers passed to memoized timeline rows.
  const handleToggleExpand = useCallback((item: any, isExpanded: boolean) => {
    setExpandedItemId(isExpanded ? null : item.id);
  }, []);
  const handleCancelConfirm = useCallback(() => setConfirmingTaskId(null), []);

  // Generate AI Schedule
  const generateSchedule = async () => {
    if (!activePet || !checkAccess()) return;
    setIsGenerating(true);

    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          petProfile: activePet,
          daysToGenerate: 7,
        }),
      });

      // Handle Supabase platform-level errors before parsing JSON
      if (!res.ok) {
        const errorText = await res.text();
        console.error('[generateSchedule] HTTP error:', res.status, errorText);

        // Supabase project paused or access denied (platform-level)
        if (res.status === 403 || errorText.includes('denied access') || errorText.includes('paused')) {
          throw new Error(
            'Your Supabase project may be paused or restricted.\n\n' +
            'Please visit your Supabase dashboard to restore the project, then try again.'
          );
        }

        // Edge Function not found / not deployed
        if (res.status === 404) {
          throw new Error(
            'Edge function not deployed.\n\nDeploy with:\nnpx supabase functions deploy generate-schedule'
          );
        }

        throw new Error(errorText || `Server error (${res.status})`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Schedule generation failed.');

      // Capture burn summary for display
      if (data.activity_burn) {
        setLastBurnSummary({
          weeklyKcal: data.activity_burn.weekly_kcal,
          dailyKcal: data.activity_burn.daily_kcal,
          contributionPct: data.activity_burn.contribution_pct,
          deficitPct: data.activity_burn.deficit_contribution_pct,
          totalMinutes: data.activity_burn.total_minutes,
          byType: data.activity_burn.by_type,
        });
      }

      // Show branded success modal instead of native Alert
      setScheduleSuccessData({
        activitiesCreated: data.activities_created,
        daysGenerated: data.days_generated,
        weeklyKcal: data.activity_burn?.weekly_kcal ?? 0,
        dailyKcal: data.activity_burn?.daily_kcal ?? 0,
        deficitPct: data.activity_burn?.deficit_contribution_pct ?? 0,
        totalMinutes: data.activity_burn?.total_minutes ?? 0,
      });
      setShowScheduleSuccess(true);
      // New schedule changes today's activities → refresh Home's "up next".
      usePetContextStore.getState().invalidateContext();
    } catch (e: any) {
      let msg = e?.message || 'Schedule generation failed.';

      // Surface common Supabase Edge Function errors with actionable guidance
      if (msg.includes('is not configured') || msg.includes('not found') || msg.includes('function not found')) {
        msg = `Edge function not deployed or missing environment variables.\n\nDeploy with:\nnpx supabase functions deploy generate-schedule`;
      } else if (msg.includes('GEMINI_API_KEY')) {
        msg = `AI API key not configured.\n\nSet GEMINI_API_KEY in Supabase Edge Function settings.`;
      }

      setErrorMsg(msg);
      setShowError(true);
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-Adjustment: delegate to shared scheduleAdjuster lib
  const adjustSchedule = async () => {
    if (!activePet || !checkAccess()) return;
    setIsAdjusting(true);

    try {
      const contextStore = usePetContextStore.getState();
      const result = await regenerateSchedule({
        pet: activePet,
        weeklyStats,
        todayCalPercent: contextStore.calPercent,
        weightTrendDirection: contextStore.weightTrend?.direction ?? null,
      });

      if (!result.success) throw new Error(result.error || 'Adjustment failed.');

      setShowAdjustBanner(false);
      setAdjustDismissed(true);

      const adjustMsg = result.fatigueDetected
        ? 'A gentler, enrichment-focused plan has been created. Small steps count.'
        : `A lighter, more achievable plan has been generated across ${result.days_generated} days.`;

      setAdjustSuccessMsg(adjustMsg);
      setShowAdjustSuccess(true);
      // Adjusted plan changes today's activities → refresh Home's "up next".
      usePetContextStore.getState().invalidateContext();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Adjustment failed.');
      setShowError(true);
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleLogActivity = async () => {
    if (!activePet || !selectedType || !checkAccess()) return;
    setIsSubmitting(true);

    let titleToSave = formTitle.trim();
    if (!titleToSave) {
      const typeDef = ACTIVITY_TYPES.find(t => t.id === selectedType);
      titleToSave = typeDef ? typeDef.label : 'Activity';
    }

    try {
      const actPayload: any = {
        pet_id: activePet.id,
        activity_type: selectedType,
        title: titleToSave,
        notes: formNotes || null,
        status: 'completed',
        scheduled_date: getLocalYMD(new Date()),
        scheduled_time: new Date().toTimeString().slice(0, 8),
        is_ai_generated: false,
        created_at: new Date().toISOString(),
      };

      if (['walk', 'play', 'training'].includes(selectedType)) {
        actPayload.duration_minutes = formDuration;
        actPayload.intensity = formIntensity;
      }
      if (selectedType === 'walk' && formDistance) {
        actPayload.distance_km = parseFloat(formDistance);
      }
      if (selectedType === 'water') {
        actPayload.water_ml = formWater;
      }

      const { error } = await supabase.from('activities').insert(actPayload);
      if (error) throw error;

      // Update daily_logs
      if (selectedType === 'water' || selectedType === 'walk') {
        const { data: existingLog } = await supabase
          .from('daily_logs')
          .select('*')
          .eq('pet_id', activePet.id)
          .eq('log_date', dateStr) // Use viewed date instead of fixed Today
          .single();

        if (existingLog) {
          const updates: any = { updated_at: new Date().toISOString() };
          if (selectedType === 'water') {
            updates.water_ml = (existingLog.water_ml || 0) + formWater;
          }
          if (selectedType === 'walk') {
            updates.walks_count = (existingLog.walks_count || 0) + 1;
          }
          await supabase.from('daily_logs').update(updates).eq('id', existingLog.id);
        } else {
          const inserts: any = { pet_id: activePet.id, log_date: dateStr }; // Use viewed date
          if (selectedType === 'water') inserts.water_ml = formWater;
          if (selectedType === 'walk') inserts.walks_count = 1;
          await supabase.from('daily_logs').insert(inserts);
        }
      }

      setIsModalVisible(false);
      resetForm();

      // Optimistic update — append new activity to local state (no reload flash)
      setActivities(prev => [...prev, { ...actPayload, id: `temp-${Date.now()}` }].sort((a, b) =>
        (a.scheduled_time || '').localeCompare(b.scheduled_time || '')
      ));

      // Award coins for logged activity
      if (user?.id) {
        awardCoins(user.id, 'activity_complete');
      }
      // A manual log changes today's activity/water stats → force a Home refetch.
      usePetContextStore.getState().invalidateContext();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to log activity.');
      setShowError(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedType(null);
    setFormTitle('');
    setFormNotes('');
    setFormDuration(15);
    setFormDistance('');
    setFormWater(250);
    setFormIntensity('moderate');
  };

  // Hero Stats
  const heroCalories = dailyLog?.calories_consumed || 0;
  const targetCalories = activePet?.target_daily_calories || 0;

  const heroWater = dailyLog?.water_ml || 0;
  const targetWater = Math.round((activePet?.current_weight_kg || 10) * 50);

  const heroPlay = activities
    .filter(a => ['walk', 'play', 'training'].includes(a.activity_type) && a.status === 'completed')
    .reduce((sum, a) => sum + (a.duration_minutes || 0), 0);

  // Calculate target play based on generated activities (or fallback to 30)
  const targetPlay = activities
    .filter(a => ['walk', 'play', 'training'].includes(a.activity_type))
    .reduce((sum, a) => sum + (a.duration_minutes || 0), 0) || 30;

  const completedCount = activities.filter(a => a.status === 'completed').length;
  const pendingCount = activities.filter(a => a.status === 'pending').length;
  const totalScheduled = completedCount + pendingCount;
  const completionPct = totalScheduled > 0 ? Math.round((completedCount / totalScheduled) * 100) : 0;

  let heroMessage = "No plan yet";
  if (totalScheduled > 0 && completionPct === 0) heroMessage = "Ready to start";
  if (completionPct > 0 && completionPct < 50) heroMessage = "Good progress";
  if (completionPct >= 50 && completionPct < 100) heroMessage = "Almost there";
  if (completionPct === 100 && totalScheduled > 0) heroMessage = "All done";
  if (totalScheduled === 0 && heroPlay > 0) heroMessage = "Active day";

  // Date slider: 5 days centered around today
  const weekDates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i - 1);
      return d;
    });
  }, []);

  const calPct = Math.min(1, targetCalories > 0 ? heroCalories / targetCalories : 0);
  const waterPct = Math.min(1, targetWater > 0 ? heroWater / targetWater : 0);
  const playPct = Math.min(1, targetPlay > 0 ? heroPlay / targetPlay : 0);

  // Pet-voiced framing — the screen is "Bruno's mission today", not "your tasks"
  const petName = activePet?.name?.trim() || 'your pet';
  const allDone = totalScheduled > 0 && completedCount === totalScheduled;

  // The single most important card on the screen: the next pending activity.
  // Decision fatigue is the enemy; we surface one clear next thing to do.
  const nextPending = activities.find(a => a.status === 'pending');

  // Friendly status line that follows goal-gradient psychology
  let missionStatus = 'Ready when you are';
  if (completedCount > 0 && !allDone) {
    if (completionPct < 30) missionStatus = 'Good start';
    else if (completionPct < 70) missionStatus = 'Halfway there';
    else missionStatus = 'Almost done';
  }
  if (allDone) missionStatus = 'All done';


  return (
    <View style={styles.container}>
      {/* ════ STATUS STRIP — slim yellow band, date navigation only ════ */}
      <View style={[styles.statusStrip, { paddingTop: insets.top + 10 }]}>
        <View style={styles.statusTopRow}>
          <Text style={styles.statusEyebrow}>ACTIVITY</Text>
          <TouchableOpacity
            style={styles.todayChip}
            onPress={() => setCurrentDate(new Date())}
            activeOpacity={0.85}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.todayChipText}>{isToday ? 'TODAY' : 'JUMP TO TODAY'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateRow}
        >
          {weekDates.map((date, idx) => {
            const isSelected = getLocalYMD(date) === dateStr;
            const isFuture = new Date(date.setHours(0, 0, 0, 0)).getTime() > new Date().setHours(0, 0, 0, 0);
            return (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.datePill,
                  isSelected && styles.datePillActive,
                  isFuture && !isSelected && { opacity: 0.55 },
                ]}
                onPress={() => setCurrentDate(new Date(date))}
                activeOpacity={0.8}
              >
                <Text style={[styles.datePillDay, isSelected && styles.datePillDayActive]}>
                  {DAY_NAMES[date.getDay()]}
                </Text>
                <Text style={[styles.datePillDate, isSelected && styles.datePillDateActive]}>
                  {date.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ════ MISSION HERO — pet-voiced, the day's narrative ════ */}
        <Animated.View entering={FadeInDown.duration(420)}>
          {activities.length === 0 && !isLoading ? (
            // Empty-state hero: prominent generate moment
            <View style={styles.missionEmpty}>
              <Text style={styles.missionEmptyEyebrow}>{petName.toUpperCase()}&apos;S WEEK</Text>
              <Text style={styles.missionEmptyTitle}>
                Build {petName}&apos;s{'\n'}first week.
              </Text>
              <Text style={styles.missionEmptyBody}>
                Pawtchi plans walks, water, play, and grooming for {petName} —
                tuned to their breed, weight, and goal.
              </Text>
              <PawtchiButton
                title={isGenerating ? 'Planning…' : 'Generate 7-day plan'}
                variant="primary"
                size="large"
                iconName={isGenerating ? undefined : 'auto-awesome'}
                iconPosition="left"
                loading={isGenerating}
                onPress={generateSchedule}
                style={{ marginTop: space.lg }}
              />
            </View>
          ) : totalScheduled > 0 ? (
            <View style={styles.mission}>
              <View style={styles.missionHead}>
                <Text style={styles.missionEyebrow}>{petName.toUpperCase()}&apos;S MISSION TODAY</Text>
                {allDone && (
                  <View style={styles.missionDoneBadge}>
                    <MaterialIcons name="check-circle" size={13} color={color.yellow} />
                    <Text style={styles.missionDoneBadgeText}>ALL DONE</Text>
                  </View>
                )}
              </View>

              {allDone ? (
                <>
                  <Text style={styles.missionDoneTitle}>All done.</Text>
                  <Text style={styles.missionDoneBody}>
                    A good day with you. Tomorrow&apos;s plan is ready when {petName} is.
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.missionFractionRow}>
                    <Text style={styles.missionFractionNum}>
                      {completedCount}
                      <Text style={styles.missionFractionOf}> / {totalScheduled}</Text>
                    </Text>
                    <Text style={styles.missionStatus}>{missionStatus}</Text>
                  </View>
                  <View style={styles.missionTrack}>
                    <View style={[styles.missionFill, { width: `${completionPct}%` }]} />
                  </View>
                </>
              )}

              {/* Stat strip: moving · water · activity-burn */}
              <View style={styles.missionStatRow}>
                <View style={styles.missionStat}>
                  <Text style={styles.missionStatValue}>{heroPlay}<Text style={styles.missionStatUnit}> min</Text></Text>
                  <Text style={styles.missionStatLabel}>moving</Text>
                </View>
                <View style={styles.missionStatDivider} />
                <View style={styles.missionStat}>
                  <Text style={styles.missionStatValue}>
                    {heroWater >= 1000 ? `${(heroWater / 1000).toFixed(1)}L` : `${heroWater}ml`}
                  </Text>
                  <Text style={styles.missionStatLabel}>water</Text>
                </View>
                <View style={styles.missionStatDivider} />
                <View style={styles.missionStat}>
                  <Text style={styles.missionStatValue}>
                    {lastBurnSummary?.dailyKcal ? `${lastBurnSummary.dailyKcal}` : '—'}
                    {lastBurnSummary?.dailyKcal ? <Text style={styles.missionStatUnit}> kcal</Text> : null}
                  </Text>
                  <Text style={styles.missionStatLabel}>activity burn</Text>
                </View>
              </View>
            </View>
          ) : (
            // Loading or fallback
            <View style={styles.missionLoading}>
              <ActivityIndicator color={color.navy} />
            </View>
          )}
        </Animated.View>

        {/* ════ UP NEXT — the single highest-priority action ════ */}
        {nextPending && (
          <Animated.View entering={FadeInDown.duration(420).delay(60)} exiting={FadeOut.duration(180)} layout={LinearTransition.duration(220)}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>UP NEXT</Text>
              <View style={styles.sectionRule} />
            </View>
            {(() => {
              const typeDef = ACTIVITY_TYPES.find(t => t.id === nextPending.activity_type) || ACTIVITY_TYPES[0];
              const timeStr = nextPending.scheduled_time
                ? nextPending.scheduled_time.slice(0, 5)
                : '';
              const meta: string[] = [];
              if (nextPending.duration_minutes) meta.push(`${nextPending.duration_minutes} min`);
              if (nextPending.intensity) meta.push(nextPending.intensity);
              if (nextPending.water_ml) meta.push(`${nextPending.water_ml} ml`);
              return (
                <View style={styles.upNextCard}>
                  <View style={styles.upNextRow}>
                    <View style={styles.upNextIcon}>
                      <MaterialIcons name={typeDef.icon as any} size={24} color={color.yellow} />
                    </View>
                    <View style={styles.upNextBody}>
                      <Text style={styles.upNextTime}>{timeStr || 'When you can'}</Text>
                      <Text style={styles.upNextTitle} numberOfLines={1}>{nextPending.title}</Text>
                      {meta.length > 0 && (
                        <Text style={styles.upNextMeta}>{meta.join(' · ')}</Text>
                      )}
                    </View>
                  </View>
                  {confirmingTaskId !== nextPending.id ? (
                    <TouchableOpacity
                      style={styles.upNextCta}
                      onPress={() => handleCheckTap(nextPending)}
                      activeOpacity={0.9}
                    >
                      <MaterialIcons name="check" size={17} color={color.navy} />
                      <Text style={styles.upNextCtaText}>Mark done</Text>
                    </TouchableOpacity>
                  ) : (
                    <SmartConfirm
                      item={nextPending}
                      petName={petName}
                      confirmingDuration={confirmingDuration}
                      onSelectDuration={setConfirmingDuration}
                      onConfirm={confirmCompletion}
                      onCancel={handleCancelConfirm}
                    />
                  )}
                </View>
              );
            })()}
          </Animated.View>
        )}

        {/* ════ ADJUST BANNER — calm, supportive tone ════ */}
        {showAdjustBanner && isToday && (
          <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.adjustBanner}>
            <View style={styles.adjustBannerHead}>
              <MaterialIcons name="spa" size={20} color={color.navy} />
              <Text style={styles.adjustBannerTitle}>Let&apos;s lighten this week</Text>
            </View>
            <Text style={styles.adjustBannerDesc}>
              {weeklyStats && weeklyStats.skipped > weeklyStats.completed
                ? `Most of last week's tasks were skipped. Pawtchi can build a gentler plan ${petName} will actually keep.`
                : `A few tasks slipped this week. Pawtchi can rebuild a lighter plan around what's been working for ${petName}.`}
            </Text>
            <View style={styles.adjustBannerActions}>
              <TouchableOpacity
                style={styles.adjustPrimary}
                onPress={adjustSchedule}
                disabled={isAdjusting}
                activeOpacity={0.9}
              >
                {isAdjusting ? (
                  <ActivityIndicator color={color.navy} size="small" />
                ) : (
                  <Text style={styles.adjustPrimaryText}>Adjust the plan</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.adjustSecondary}
                onPress={() => { setShowAdjustBanner(false); setAdjustDismissed(true); }}
              >
                <Text style={styles.adjustSecondaryText}>Not now</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* ════ TIMELINE — slim editorial, dot + rail ════ */}
        {!isLoading && activities.length > 0 && (
          <Animated.View entering={FadeInDown.duration(420).delay(120)} layout={LinearTransition.duration(220)}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>TIMELINE</Text>
              <View style={styles.sectionRule} />
              {pendingCount > 0 && (
                <Text style={styles.sectionMeta}>{pendingCount} pending</Text>
              )}
            </View>
            <View style={styles.timeline}>
              {timeline.map((item, idx) => {
                const isConfirming = confirmingTaskId === item.id;
                return (
                  <TimelineRow
                    key={item._feedType === 'food' ? `food-${item.id}` : `act-${item.id}`}
                    item={item}
                    isLast={idx === timeline.length - 1}
                    isExpanded={expandedItemId === item.id}
                    isConfirming={isConfirming}
                    // Normalize to -1 when not confirming so unrelated rows keep an
                    // identical prop and React.memo can skip them on duration changes.
                    confirmingDuration={isConfirming ? confirmingDuration : -1}
                    petName={petName}
                    currentWeightKg={activePet?.current_weight_kg}
                    onToggleExpand={handleToggleExpand}
                    onCheckTap={handleCheckTap}
                    onSelectDuration={setConfirmingDuration}
                    onConfirm={confirmCompletion}
                    onCancel={handleCancelConfirm}
                  />
                );
              })}
            </View>
          </Animated.View>
        )}

        {/* ════ ACTIVITY BURN — micro context card, only when interesting ════ */}
        {lastBurnSummary && lastBurnSummary.weeklyKcal > 0 && (
          <Animated.View entering={FadeInDown.duration(420).delay(160)} style={styles.burnCard}>
            <View style={styles.burnCardLeft}>
              <View style={styles.burnIcon}>
                <MaterialIcons name="local-fire-department" size={16} color={color.viz.calories} />
              </View>
              <View>
                <Text style={styles.burnLabel}>{petName}&apos;s burn this week</Text>
                <Text style={styles.burnSub}>{lastBurnSummary.totalMinutes} min · {lastBurnSummary.dailyKcal} kcal/day</Text>
              </View>
            </View>
            <View style={styles.burnBadge}>
              <Text style={styles.burnBadgeText}>{lastBurnSummary.deficitPct}% of deficit</Text>
            </View>
          </Animated.View>
        )}

        {isLoading && (
          <ActivityIndicator style={{ marginTop: 32 }} size="small" color={color.navy} />
        )}
      </ScrollView>

      {/* Log activity FAB — yellow pill, sticks above the tab bar */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 78 }, (isLoading || !activePet) && styles.fabDisabled]}
        activeOpacity={0.9}
        disabled={isLoading || !activePet}
        onPress={() => setIsModalVisible(true)}
      >
        <MaterialIcons name="add" size={20} color={color.navy} />
        <Text style={styles.fabText}>Log activity</Text>
      </TouchableOpacity>

      {/* LOG ACTIVITY MODAL / BOTTOM SHEET */}
      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => { setIsModalVisible(false); resetForm(); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{selectedType ? 'Log Details' : 'What did you do?'}</Text>
                <TouchableOpacity onPress={() => { setIsModalVisible(false); resetForm(); }}>
                  <MaterialIcons name="close" size={28} color="#1A1A1A" />
                </TouchableOpacity>
              </View>

              {!selectedType ? (
                <View style={styles.bentoGrid}>
                  {/* Hero Card: Walk */}
                  <TouchableOpacity
                    style={[styles.bentoHero, { backgroundColor: ACTIVITY_TYPES.find(t => t.id === 'walk')?.color }]}
                    onPress={() => setSelectedType('walk')}
                    activeOpacity={0.9}
                  >
                    <View style={styles.heroOverlay}>
                      <MaterialIcons name="directions-walk" size={56} color="#1A1A1A" />
                      <Text style={styles.heroLabel}>Walk</Text>
                      <View style={{ position: 'absolute', right: 24, top: 24, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 20, padding: 4 }}>
                        <MaterialIcons name="chevron-right" size={24} color="#1A1A1A" />
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Secondary Row: Play & Water */}
                  <View style={styles.bentoRow}>
                    <TouchableOpacity
                      style={[styles.bentoSquare, { backgroundColor: ACTIVITY_TYPES.find(t => t.id === 'play')?.color }]}
                      onPress={() => setSelectedType('play')}
                      activeOpacity={0.9}
                    >
                      <MaterialIcons name="sports-baseball" size={36} color="#1A1A1A" />
                      <Text style={styles.bentoLabel}>Play</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.bentoSquare, { backgroundColor: ACTIVITY_TYPES.find(t => t.id === 'water')?.color }]}
                      onPress={() => setSelectedType('water')}
                      activeOpacity={0.9}
                    >
                      <MaterialIcons name="water-drop" size={36} color="#1A1A1A" />
                      <Text style={styles.bentoLabel}>Water</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Tertiary Scroll Row: Care & Health */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bentoTagsScroll}>
                    {ACTIVITY_TYPES.filter(t => !['walk', 'play', 'water'].includes(t.id)).map(type => (
                      <TouchableOpacity
                        key={type.id}
                        style={[styles.bentoTag, { backgroundColor: type.color }]}
                        onPress={() => setSelectedType(type.id)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.bentoTagIconBox}>
                          <MaterialIcons name={type.icon as any} size={18} color="#1A1A1A" />
                        </View>
                        <Text style={styles.bentoTagLabel}>{type.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>

                  {['medicine', 'vet_visit', 'grooming', 'other'].includes(selectedType) && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Title</Text>
                      <TextInput
                        style={styles.input}
                        value={formTitle}
                        onChangeText={setFormTitle}
                        placeholder={ACTIVITY_TYPES.find(t => t.id === selectedType)?.label}
                      />
                    </View>
                  )}

                  {['walk', 'play', 'training'].includes(selectedType) && (
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={styles.inputLabel}>Duration</Text>
                        <Text style={styles.inputLabel}>{formDuration} mins</Text>
                      </View>
                      <Slider
                        style={{ width: '100%', height: 40 }}
                        minimumValue={5}
                        maximumValue={120}
                        step={5}
                        value={formDuration}
                        onValueChange={setFormDuration}
                        minimumTrackTintColor="#F7F602"
                        maximumTrackTintColor="#f3f4f6"
                        thumbTintColor="#1A1A1A"
                      />
                    </View>
                  )}

                  {selectedType === 'walk' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Distance (km) - Optional</Text>
                      <TextInput
                        style={styles.input}
                        value={formDistance}
                        onChangeText={setFormDistance}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 2.5"
                      />
                    </View>
                  )}

                  {selectedType === 'water' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Water Amount (ml)</Text>
                      <View style={styles.presetRow}>
                        {[100, 250, 500, 1000].map(amt => (
                          <TouchableOpacity
                            key={amt}
                            style={[styles.presetBtn, formWater === amt && styles.presetBtnActive]}
                            onPress={() => setFormWater(amt)}
                          >
                            <Text style={[styles.presetBtnText, formWater === amt && { color: '#1A1A1A' }]}>{amt}ml</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {['walk', 'play', 'training'].includes(selectedType) && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Intensity</Text>
                      <View style={styles.presetRow}>
                        {(['low', 'moderate', 'high'] as const).map(lvl => (
                          <TouchableOpacity
                            key={lvl}
                            style={[styles.presetBtn, formIntensity === lvl && styles.presetBtnActive]}
                            onPress={() => setFormIntensity(lvl)}
                          >
                            <Text style={[styles.presetBtnText, formIntensity === lvl && { color: '#1A1A1A' }]}>{lvl.toUpperCase()}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Notes</Text>
                    <TextInput
                      style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                      value={formNotes}
                      onChangeText={setFormNotes}
                      placeholder="Add any details..."
                      multiline
                    />
                  </View>

                  <PawtchiButton
                    title="Save activity"
                    variant="primary"
                    loading={isSubmitting}
                    onPress={handleLogActivity}
                    style={{ marginTop: 8 }}
                  />

                  <PawtchiButton
                    title="Back"
                    variant="ghost"
                    disabled={isSubmitting}
                    onPress={resetForm}
                    style={{ marginTop: 8 }}
                  />

                </ScrollView>
              )}

            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Branded Schedule Success Modal */}
      <PawtchiSuccessModal
        visible={showScheduleSuccess}
        onClose={() => {
          setShowScheduleSuccess(false);
          fetchData();
        }}
        title="Schedule created"
        icon={{ name: 'check-circle', color: '#F7F602' }}
        lines={[
          {
            text: `${scheduleSuccessData?.activitiesCreated} activities planned across ${scheduleSuccessData?.daysGenerated} days — starting today. Your schedule begins now.`,
            type: 'normal',
          },
          ...(scheduleSuccessData && scheduleSuccessData.weeklyKcal > 0
            ? [{
                text: `This week's activities burn ~${scheduleSuccessData.weeklyKcal} kcal (~${scheduleSuccessData.dailyKcal} kcal/day, ${scheduleSuccessData.totalMinutes} minutes total). Activity covers ${scheduleSuccessData.deficitPct}% of your weekly calorie deficit goal.`,
                type: 'burn' as const,
              }]
            : []),
        ]}
        primaryAction={{
          label: 'Done',
          onPress: () => {
            setShowScheduleSuccess(false);
            fetchData();
          },
        }}
      />

      {/* Branded Schedule Adjusted Modal */}
      <PawtchiSuccessModal
        visible={showAdjustSuccess}
        onClose={() => {
          setShowAdjustSuccess(false);
          fetchData();
        }}
        title="Schedule adjusted"
        icon={{ name: 'self-improvement', color: '#F7F602' }}
        lines={[
          { text: adjustSuccessMsg, type: 'normal' },
        ]}
        primaryAction={{
          label: 'Done',
          onPress: () => {
            setShowAdjustSuccess(false);
            fetchData();
          },
        }}
      />

      {/* Branded Error Modal */}
      <PawtchiModal
        visible={showError}
        onClose={() => setShowError(false)}
        title="Something went wrong"
        icon={{ name: 'error-outline', color: '#ef4444' }}
        message={errorMsg}
        showCloseButton
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surfaceSubtle },
  scrollContent: { flexGrow: 1, paddingHorizontal: space.xxl, paddingTop: space.lg, paddingBottom: 180 },

  // ════ Status strip ════
  statusStrip: {
    backgroundColor: color.yellow,
    paddingHorizontal: space.xxl,
    paddingBottom: 0,
  },
  statusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  statusEyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 3,
    color: 'rgba(7, 32, 42, 0.62)',
  },
  todayChip: {
    borderWidth: 1,
    borderColor: 'rgba(7, 32, 42, 0.22)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  todayChipText: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: color.navy,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: space.md,
  },
  datePill: {
    width: 48,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(7, 32, 42, 0.06)',
    alignItems: 'center',
  },
  datePillActive: {
    backgroundColor: color.navy,
  },
  datePillDay: {
    fontFamily: font.semibold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: 'rgba(7, 32, 42, 0.62)',
    marginBottom: 2,
  },
  datePillDayActive: { color: color.creamDim },
  datePillDate: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
    letterSpacing: -0.3,
  },
  datePillDateActive: { color: color.cream },

  // ════ Mission hero — pet-voiced narrative ════
  mission: {
    backgroundColor: color.navy,
    borderRadius: 28,
    padding: space.xxl,
    marginTop: space.lg,
    ...shadow.raised,
  },
  missionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  missionEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2.4,
    color: color.yellow,
    flex: 1,
  },
  missionDoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.navyRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
  },
  missionDoneBadgeText: {
    fontFamily: font.bold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: color.yellow,
  },
  missionFractionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  missionFractionNum: {
    fontFamily: font.display,
    fontSize: 64,
    lineHeight: 60,
    letterSpacing: 1,
    color: color.cream,
  },
  missionFractionOf: {
    fontSize: 26,
    color: color.creamFaint,
  },
  missionStatus: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.creamDim,
    marginBottom: 6,
  },
  missionTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(244, 241, 236, 0.12)',
    overflow: 'hidden',
    marginBottom: space.xl,
  },
  missionFill: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  missionStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.hairlineOnNavy,
  },
  missionStat: { flex: 1 },
  missionStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: color.hairlineOnNavy,
    marginHorizontal: space.sm,
  },
  missionStatValue: {
    fontFamily: font.display,
    fontSize: 22,
    lineHeight: 22,
    letterSpacing: 0.4,
    color: color.cream,
  },
  missionStatUnit: {
    fontSize: 12,
    color: color.creamFaint,
  },
  missionStatLabel: {
    fontFamily: font.medium,
    fontSize: 10.5,
    letterSpacing: 0.4,
    color: color.creamFaint,
    marginTop: 3,
  },
  missionDoneTitle: {
    fontFamily: font.display,
    fontSize: 48,
    lineHeight: 48,
    letterSpacing: 1,
    color: color.cream,
    marginBottom: 6,
  },
  missionDoneBody: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: color.creamDim,
    marginBottom: space.xl,
  },
  missionLoading: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty-state hero (no schedule yet)
  missionEmpty: {
    backgroundColor: color.navy,
    borderRadius: 28,
    padding: space.xxl,
    marginTop: space.lg,
    ...shadow.raised,
  },
  missionEmptyEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2.4,
    color: color.yellow,
    marginBottom: space.md,
  },
  missionEmptyTitle: {
    fontFamily: font.display,
    fontSize: 42,
    lineHeight: 42,
    letterSpacing: 1,
    color: color.cream,
    marginBottom: space.md,
  },
  missionEmptyBody: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.creamDim,
  },

  // ════ Section heads ════
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xxl,
    marginBottom: space.md,
  },
  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: '#ece9e2',
  },
  sectionMeta: {
    fontFamily: font.bold,
    fontSize: 11,
    color: color.alert,
  },

  // ════ Up next card — the prominent action ════
  upNextCard: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    ...shadow.card,
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  upNextIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: color.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextBody: { flex: 1, minWidth: 0 },
  upNextTime: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: color.slateFaint,
    marginBottom: 2,
  },
  upNextTitle: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.ink,
    letterSpacing: -0.2,
  },
  upNextMeta: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 3,
  },
  upNextCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 11,
  },
  upNextCtaText: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.navy,
    letterSpacing: 0.2,
  },

  // ════ Smart confirm (inline duration picker) ════
  smartConfirm: {
    marginTop: space.sm,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.md,
    padding: space.md,
  },
  smartConfirmLabel: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    marginBottom: space.sm,
  },
  smartConfirmRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: space.sm,
  },
  smartChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  smartChipActive: {
    backgroundColor: color.navy,
    borderColor: color.navy,
  },
  smartChipScheduled: {
    borderColor: color.yellow,
  },
  smartChipText: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.ink,
  },
  smartChipTextActive: { color: color.cream },
  smartConfirmActions: {
    flexDirection: 'row',
    gap: 8,
  },
  smartDoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: color.yellow,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    flex: 1,
  },
  smartDoneBtnText: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.navy,
  },
  smartCancelBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  smartCancelBtnText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slateMuted,
  },

  // ════ Adjust banner ════
  adjustBanner: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space.lg,
    marginTop: space.xxl,
    ...shadow.card,
  },
  adjustBannerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  adjustBannerTitle: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.ink,
  },
  adjustBannerDesc: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: color.slateMuted,
    marginBottom: space.md,
  },
  adjustBannerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  adjustPrimary: {
    flex: 1,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  adjustPrimaryText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.navy,
  },
  adjustSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.pill,
  },
  adjustSecondaryText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slateMuted,
  },

  // ════ Timeline — slim editorial ════
  timeline: {},
  tlRow: { flexDirection: 'row' },
  tlRail: {
    width: 22,
    alignItems: 'center',
  },
  tlDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.hairline,
  },
  tlDotDone: {
    backgroundColor: color.yellow,
    borderColor: color.yellow,
  },
  tlDotPending: {
    backgroundColor: color.surface,
    borderColor: color.slateFaint,
  },
  tlDotSkipped: {
    backgroundColor: color.track,
    borderColor: color.track,
  },
  tlLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: '#ece9e2',
    marginTop: 3,
    marginBottom: -3,
  },
  tlBody: {
    flex: 1,
    paddingLeft: space.md,
    paddingBottom: space.xl,
  },
  tlHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tlTime: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.slate,
    letterSpacing: 0.2,
  },
  tlMeta: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateMuted,
  },
  tlTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  tlTitle: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.ink,
    letterSpacing: -0.2,
  },
  tlNote: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 3,
  },
  tlBodyExpanded: {
    backgroundColor: '#fafaf5',
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: -10,
    marginRight: -4,
  },
  tlExpandedDetail: {
    marginTop: 8,
    gap: 8,
  },
  tlDetailDesc: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.ink,
    lineHeight: 20,
  },
  tlDetailTagRow: {
    flexDirection: 'row' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  tlDetailTag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#f0f0e8',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tlDetailTagText: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.slateMuted,
    textTransform: 'capitalize' as const,
  },
  tlDetailMarkDone: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 5,
    backgroundColor: color.yellow,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  tlDetailMarkDoneText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.navy,
  },
  tlContext: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slate,
    marginTop: 4,
    fontStyle: 'italic',
  },

  // ════ Burn micro-card ════
  burnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    marginTop: space.lg,
  },
  burnCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flex: 1,
  },
  burnIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  burnLabel: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.ink,
  },
  burnSub: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.slateMuted,
    marginTop: 1,
  },
  burnBadge: {
    backgroundColor: color.track,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  burnBadgeText: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 0.4,
    color: color.slate,
  },

  // ════ Floating "Log activity" pill ════
  fab: {
    position: 'absolute',
    right: space.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.yellow,
    paddingLeft: 12,
    paddingRight: 16,
    height: 48,
    borderRadius: radius.pill,
    shadowColor: color.yellow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  fabDisabled: {
    opacity: 0.45,
  },
  fabText: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.navy,
    letterSpacing: 0.2,
  },

  // ════ Bottom-sheet modal ════
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
  },
  modalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  modalTitle: {
    fontFamily: font.bold,
    fontSize: 19,
    color: color.ink,
    letterSpacing: -0.2,
  },

  // Bento type picker
  bentoGrid: { gap: 10 },
  bentoHero: {
    height: 110,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: color.yellow,
  },
  heroOverlay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    gap: space.lg,
  },
  heroLabel: {
    fontFamily: font.extrabold,
    fontSize: 30,
    color: color.navy,
    letterSpacing: -0.6,
  },
  bentoRow: { flexDirection: 'row', gap: 10 },
  bentoSquare: {
    flex: 1,
    aspectRatio: 1.2,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bentoLabel: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.navy,
  },
  bentoTagsScroll: {
    gap: 8,
    paddingVertical: space.sm,
  },
  bentoTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  bentoTagIconBox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(7, 32, 42, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bentoTagLabel: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.navy,
  },

  // Form inputs
  inputGroup: { marginBottom: space.lg },
  inputLabel: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.slate,
    marginBottom: 8,
  },
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
  presetRow: {
    flexDirection: 'row',
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    alignItems: 'center',
  },
  presetBtnActive: {
    backgroundColor: color.yellow,
    borderColor: color.yellow,
  },
  presetBtnText: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.slateMuted,
  },
});

