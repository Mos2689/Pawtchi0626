import React, { useState, useEffect, useRef } from 'react';
import { withTimeout } from '../../lib/withTimeout';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { PawLoader } from '../../components/loader/PawLoader';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { color, font, radius, shadow, space, motion } from '../../constants/design';
import { supabase } from '../../lib/supabase';
import { resolvePetImage } from '../../lib/petFallbackImage';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { BOWL_SIZES } from '../../constants/brandData';
import { useSubscription } from '../../hooks/useSubscription';
import { openManageSubscription } from '../../lib/manageSubscription';
import { WRITE_TO_FOUNDER_LABEL } from '../../lib/founderLetters';
import { SUPPORT_LABEL } from '../../lib/support/copy';
import { useWalkthrough } from '../../providers/WalkthroughContext';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SelectableChip } from '../../components/SelectableChip';
import { computeCompleteness } from '../../lib/profileCompleteness';
import { useOwnerPrefsStore } from '../../store/useOwnerPrefsStore';
import { RoutineSheet } from '../../components/RoutineSheet';
import type { OwnerPrefsRow } from '../../lib/routineDefaults';
import { prepareImageForUpload } from '../../lib/imagePrep';
import { PawtchiModal } from '../../components/PawtchiModal';
import { FailureModal } from '../../components/FailureModal';
import type { FailureMeta } from '../../lib/support/handoff';
import {
  appError, errorCopy, extractInvokeErrorCode, fromEdgeBody, isAppError, reportError, toAppError,
  type ErrorContext, type ErrorCopy, type RecoveryActionId,
} from '../../lib/appError';
import { useFocusEffect } from '@react-navigation/native';
import { WalksignCrest } from '../../components/walksign/WalksignCrest';
import { WalksignShareModal } from '../../components/walksign/WalksignShareModal';
import {
  WALKSIGN_COPY,
  buildStatusLine,
} from '../../lib/walksign/copy';
import type { WalksignId } from '../../lib/walksign/types';
import { maybeEvaluateWalksign } from '../../lib/walksign/walksignSync';
import { track } from '../../lib/analytics';
import {
  recordWeightAssessment,
  recordWeightMeasurement,
  requestWeightPlanReassessment,
} from '../../lib/weightPlanService';
import { weightPlanViewModelFromRecord } from '../../lib/weightPlanRecord';
import { TextField } from '../../components/ui/TextField';
import { isAssessableWeightKg } from '../../lib/weightPlan';
import { TAB_BAR_CLEARANCE } from '../../components/navigation/SplitTabBar';
import { ProfileMembershipCard } from '../../components/ProfileMembershipCard';
import { buildProfileMembershipPresentation } from '../../lib/profileMembership';

// Profile — the pet's identity card. A navy hero carries who they are; the
// light sections below are quiet, single-recipe rows. One yellow per surface:
// the "complete profile" action in the hero.

// Strip ':SS' tail from 'HH:MM:SS' for display.
function stripSeconds(t: string | null | undefined): string {
  if (!t) return '--:--';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

// Friendly body-shape label from the 1–9 BCS scale.
function bcsLabel(score?: number | null): string {
  if (!score || score <= 0) return 'Not set';
  if (score <= 3) return 'A bit thin';
  if (score <= 6) return 'Just right';
  if (score <= 8) return 'A bit chunky';
  return 'Overweight';
}

// WSAVA-aligned 1–9 BCS scale with owner-readable descriptions.
// One source of truth for the picker modal and any vet-export rendering later.
const BCS_OPTIONS: { score: number; title: string; desc: string }[] = [
  { score: 1, title: 'Emaciated', desc: 'Ribs, spine and hip bones visible from a distance; no body fat; obvious muscle loss.' },
  { score: 2, title: 'Very thin', desc: 'Ribs, spine and hip bones easily seen; minimal fat; some muscle loss.' },
  { score: 3, title: 'Thin', desc: 'Ribs easily felt with no fat cover; obvious waist and tucked belly.' },
  { score: 4, title: 'Lean', desc: 'Ribs easily felt with light fat cover; clear waist when viewed from above.' },
  { score: 5, title: 'Ideal', desc: 'Ribs felt without excess fat; waist visible behind the ribs; healthy weight.' },
  { score: 6, title: 'Above ideal', desc: 'Ribs felt with a slight fat cover; waist discernible but not pronounced.' },
  { score: 7, title: 'Heavy', desc: 'Ribs hard to feel under fat; waist barely visible; soft belly.' },
  { score: 8, title: 'Obese', desc: 'Ribs not easily felt; clear fat deposits; rounded belly with no waist.' },
  { score: 9, title: 'Severely obese', desc: 'Heavy fat deposits over spine, ribs and tail base; distended belly.' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { user, isSigningOut, signOut } = useAuth();
  const profileWeightSubmissionRef = React.useRef<{
    id: string;
    measuredAt: string;
    weightKg: number;
  } | null>(null);
  // Fine-grained selectors — re-render only on the fields this screen reads,
  // not on any unrelated store mutation. Actions are stable references.
  const activePet = useActivePetStore(s => s.activePet);
  const foodPantry = useActivePetStore(s => s.foodPantry);
  const addPantryItem = useActivePetStore(s => s.addPantryItem);
  const fetchPantry = useActivePetStore(s => s.fetchPantry);
  const togglePantryFavorite = useActivePetStore(s => s.togglePantryFavorite);
  const setPantryExpiry = useActivePetStore(s => s.setPantryExpiry);
  const { status: subStatus, daysLeft: subDaysLeft, isPro, hasFullAccess } = useSubscription();
  const membershipImpressionRef = useRef<string | null>(null);
  useEffect(() => {
    if (subStatus === 'loading') return;
    const plan = isPro ? 'plus' : 'free';
    const signature = `${plan}:${subStatus}:${hasFullAccess}`;
    if (membershipImpressionRef.current === signature) return;
    membershipImpressionRef.current = signature;
    track('profile_membership_viewed', {
      plan,
      subscription_status: subStatus,
      has_full_access: hasFullAccess,
    });
  }, [hasFullAccess, isPro, subStatus]);
  // Subscribers manage their plan in the store; everyone else sees the purchase paywall.
  //
  // For subscribers this now stops once to offer the founder letter. Leaving is
  // the single highest-signal moment we will ever get to hear why. The offer is
  // strictly a detour: `openManageSubscription()` stays one tap away and is the
  // primary action, so nothing about cancelling is obstructed.
  const [showLeavingSheet, setShowLeavingSheet] = useState(false);
  const openBilling = () => {
    track('profile_membership_tapped', {
      plan: isPro ? 'plus' : 'free',
      subscription_status: subStatus,
      action: isPro ? 'manage' : 'explore',
    });
    if (!isPro) {
      router.push({ pathname: '/paywall', params: { source: 'profile_membership' } } as never);
      return;
    }
    setShowLeavingSheet(true);
  };

  const continueToStore = () => {
    setShowLeavingSheet(false);
    openManageSubscription();
  };

  const writeBeforeLeaving = () => {
    setShowLeavingSheet(false);
    router.push({ pathname: '/letter', params: { source: 'cancel_intent' } } as never);
  };

  // Routine sheet — re-opened with current prefs for inline editing.
  const ownerPrefs = useOwnerPrefsStore(s => s.prefs);
  const fetchPrefs = useOwnerPrefsStore(s => s.fetchPrefs);
  const upsertPrefs = useOwnerPrefsStore(s => s.upsertPrefs);
  const [routineSheetOpen, setRoutineSheetOpen] = useState(false);

  // Branded failure sheet — all failure paths on this screen land here via
  // errorCopy(). OS alerts remain only for confirmations and success notes.
  const [failure, setFailure] = useState<ErrorCopy | null>(null);
  // What the failure was, for the support composer: the area chip arrives
  // preselected and the kind rides along into diagnostics.
  const [failureMeta, setFailureMeta] = useState<FailureMeta | null>(null);
  // Replays whatever failed when "Try again" is tapped. Every presentFailure
  // call passes one — a retry button that does nothing is the same bug as a
  // support button that does nothing.
  const retryRef = useRef<null | (() => void)>(null);
  const presentFailure = (err: unknown, context: ErrorContext, retry?: () => void) => {
    const appErr = isAppError(err) ? err : toAppError(err);
    reportError(appErr, context);
    retryRef.current = retry ?? null;
    setFailureMeta({ kind: appErr.kind, context });
    setFailure(errorCopy(appErr, { context, petName: activePet?.name }));
  };
  // Only the action this screen owns — FailureModal handles contact support,
  // settings and back.
  const handleRecovery = (action: RecoveryActionId) => {
    if (action === 'retry') retryRef.current?.();
  };
  const [routineSubmitting, setRoutineSubmitting] = useState(false);
  useEffect(() => { if (user?.id) fetchPrefs(user.id); }, [user?.id, fetchPrefs]);
  const handleRoutineSubmit = async (row: OwnerPrefsRow) => {
    if (!user?.id) return;
    setRoutineSubmitting(true);
    const ok = await upsertPrefs(user.id, row);
    setRoutineSubmitting(false);
    setRoutineSheetOpen(false);
    if (!ok) {
      retryRef.current = () => void handleRoutineSubmit(row);
      setFailureMeta({ context: 'account' });
      setFailure({
        title: 'The routine didn’t save',
        message: 'Nothing was lost — try saving again in a moment.',
        actions: [{ label: 'Try again', action: 'retry' }, { label: 'Not now', action: 'dismiss' }],
      });
    }
  };
  const routineSubtitle = ownerPrefs
    ? `Wake ${stripSeconds(ownerPrefs.wake_time)} · Sleep ${stripSeconds(ownerPrefs.bedtime)}`
    : 'Not set';
  const { replayWalkthrough } = useWalkthrough();
  const { focus } = useLocalSearchParams<{ focus?: string }>();

  const completeness = computeCompleteness(activePet, { pantryCount: foodPantry?.length ?? 0 });

  const [feedingToggle, setFeedingToggle] = useState(true);
  const [walkToggle, setWalkToggle] = useState(true);
  const [hydrationToggle, setHydrationToggle] = useState(false);

  const [mealTime, setMealTime] = useState<Date>(new Date(new Date().setHours(18, 0, 0, 0))); // 6 PM
  const [walkTime, setWalkTime] = useState<Date>(new Date(new Date().setHours(7, 0, 0, 0))); // 7 AM
  const [showPickerFor, setShowPickerFor] = useState<'meal' | 'walk' | null>(null);

  // Pantry scan state
  const [isScanningLabel, setIsScanningLabel] = useState(false);

  // Expiry date picker — opens for a specific pantry item id.
  const [expiryPickerForId, setExpiryPickerForId] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState<Date>(new Date());

  // Edit Profile State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editImageUri, setEditImageUri] = useState<string | null>(null);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // BCS picker state
  const [bcsModalVisible, setBcsModalVisible] = useState(false);
  const [selectedBcs, setSelectedBcs] = useState<number | null>(null);
  const [isSavingBcs, setIsSavingBcs] = useState(false);

  // Inline Edit State
  const [inlineEditVisible, setInlineEditVisible] = useState(false);
  const [inlineEditField, setInlineEditField] = useState<{
    dbColumn: string;
    label: string;
    value: string;
    placeholder: string;
    keyboardType: 'default' | 'numeric' | 'email-address';
  } | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');

  // Chips picker — shared modal for allergies and medical conditions.
  type ChipsKind = 'allergies' | 'medical_conditions';
  const [chipsKind, setChipsKind] = useState<ChipsKind | null>(null);
  const [chipsSelected, setChipsSelected] = useState<string[]>([]);
  const [chipsCustomInput, setChipsCustomInput] = useState('');
  const [isSavingChips, setIsSavingChips] = useState(false);

  // Sync with DB
  useEffect(() => {
    if (!activePet) return;
    supabase.from('schedules').select('*').eq('pet_id', activePet.id).then(({ data }) => {
      if (data && data.length > 0) {
        const meal = data.find(d => d.event_type === 'meal');
        if (meal) {
          const [h, m] = meal.scheduled_time.split(':');
          const d = new Date(); d.setHours(parseInt(h), parseInt(m), 0, 0);
          setMealTime(d);
          setFeedingToggle(meal.is_active);
        }
        const walk = data.find(d => d.event_type === 'walk');
        if (walk) {
          const [h, m] = walk.scheduled_time.split(':');
          const d = new Date(); d.setHours(parseInt(h), parseInt(m), 0, 0);
          setWalkTime(d);
          setWalkToggle(walk.is_active);
        }
        const hydration = data.find(d => d.event_type === 'hydration');
        if (hydration) {
          setHydrationToggle(hydration.is_active);
        }
      }
    });
  }, [activePet?.id]);

  const updateSchedule = async (type: 'meal' | 'walk' | 'hydration', time: Date | null, isActive: boolean) => {
    if (!activePet) return;
    const timeStr = time
      ? `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:00`
      : '08:00:00';
    await supabase.from('schedules').upsert({
      pet_id: activePet.id,
      event_type: type,
      scheduled_time: timeStr,
      is_active: isActive,
    }, { onConflict: 'pet_id, event_type' });
  };

  const onChangeTime = (event: DateTimePickerEvent, selectedDate?: Date) => {
    const currentMode = showPickerFor;
    setShowPickerFor(null);
    if (!selectedDate || !currentMode) return;

    if (currentMode === 'meal') {
      setMealTime(selectedDate);
      updateSchedule('meal', selectedDate, feedingToggle);
    } else {
      setWalkTime(selectedDate);
      updateSchedule('walk', selectedDate, walkToggle);
    }
  };

  const handleFeedingToggle = (val: boolean) => {
    setFeedingToggle(val);
    updateSchedule('meal', mealTime, val);
  };
  const handleWalkToggle = (val: boolean) => {
    setWalkToggle(val);
    updateSchedule('walk', walkTime, val);
  };
  const handleHydrationToggle = (val: boolean) => {
    setHydrationToggle(val);
    updateSchedule('hydration', null, val);
  };

  const checkAccess = () => {
    if (!hasFullAccess) {
      router.push('/paywall' as any);
      return false;
    }
    return true;
  };

  const handleScanFoodLabel = async (useCamera: boolean) => {
    if (!checkAccess()) return;
    try {
      let result;
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          presentFailure(
            appError('permission', 'camera permission denied (pantry scan)'),
            'food_scan',
            () => void handleScanFoodLabel(useCamera),
          );
          return;
        }
        result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, allowsEditing: true });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, allowsEditing: true, mediaTypes: ['images'] });
      }

      if (result.canceled || !result.assets[0]) {
        return;
      }

      setIsScanningLabel(true);
      // Downscale before the network round trip; falls back to the picker's
      // original base64 when the manipulator can't process the image.
      const asset = await prepareImageForUpload(result.assets[0]);
      const { data, error } = await withTimeout(
        supabase.functions.invoke('gemini-proxy', {
          body: {
            imageBase64: asset.base64!,
            mimeType: asset.mimeType,
            petProfile: { ...activePet, food_pantry: foodPantry },
          },
        }),
        45_000,
        'gemini-proxy',
      );

      if (error || !data?.success || !data.analysis) {
        presentFailure(
          fromEdgeBody(data)
            ?? toAppError(error ?? new Error('scan returned no analysis'), { errorCode: await extractInvokeErrorCode(error) }),
          'food_scan',
          () => void handleScanFoodLabel(useCamera),
        );
        setIsScanningLabel(false);
        return;
      }

      const a = data.analysis;
      if (!a.brand && !a.product_name && !a.food_name) {
        setFailure({
          title: 'No label found',
          message: 'Couldn’t identify a food product. Try scanning the label on the packaging.',
          actions: [{ label: 'OK', action: 'dismiss' }],
        });
        setIsScanningLabel(false);
        return;
      }

      const foodType = a.food_type || (a.is_treat ? 'treat' : 'kibble');
      const existingForType = foodPantry.filter(p => p.food_type === foodType);
      const isPrimary = existingForType.length === 0;

      const petAllergies = (activePet?.allergies || []).map((al: string) => al.toLowerCase());
      const ingredients = a.key_ingredients || [];
      const allergyFlags = ingredients.filter((ing: string) =>
        petAllergies.some((al: string) => ing.toLowerCase().includes(al))
      );

      await addPantryItem({
        pet_id: activePet!.id,
        brand: a.brand || a.food_name || 'Unknown',
        product_name: a.product_name || a.food_name || '',
        food_type: foodType,
        kcal_per_serving: a.calories_per_serving || null,
        kcal_per_100g_as_fed: a.kcal_per_100g_as_fed || null,
        moisture_pct: a.moisture_pct || null,
        serving_unit: a.serving_unit || null,
        protein_pct: a.protein_pct || null,
        fat_pct: a.fat_pct || null,
        fibre_pct: a.fibre_pct || null,
        key_ingredients: a.key_ingredients || null,
        allergy_flags: allergyFlags.length > 0 ? allergyFlags : null,
        is_primary: isPrimary,
        image_url: asset.uri || undefined,
      });

      if (allergyFlags.length > 0) {
        Alert.alert('Added with Warning', `${a.brand || a.food_name} saved to pantry.\n\nAllergy alert: contains ${allergyFlags.join(', ')}.`);
      } else {
        Alert.alert('Added to Pantry', `${a.brand || a.food_name} has been saved.`);
      }
    } catch (err: unknown) {
      presentFailure(err, 'food_scan', () => void handleScanFoodLabel(useCamera));
    } finally {
      setIsScanningLabel(false);
    }
  };

  const handleDeletePantryItem = async (itemId: string, itemName: string) => {
    if (!checkAccess()) return;
    Alert.alert('Remove Food', `Remove ${itemName} from the pantry?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('food_pantry').delete().eq('id', itemId);
          fetchPantry(activePet!.id);
        }
      },
    ]);
  };

  const handleTogglePrimary = async (itemId: string, foodType: string) => {
    if (!checkAccess()) return;
    // Unset all other primaries for this food_type, then set this one
    await supabase.from('food_pantry').update({ is_primary: false }).eq('pet_id', activePet!.id).eq('food_type', foodType);
    await supabase.from('food_pantry').update({ is_primary: true }).eq('id', itemId);
    fetchPantry(activePet!.id);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    await signOut();
  };

  const handleDeleteAccount = () => {
    if (isSigningOut) return;
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, your pet, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) return;
              const { error } = await supabase.functions.invoke('delete-account', {});
              if (error) throw error;
              await signOut();
            } catch (e: unknown) {
              // Retry re-opens the confirmation rather than re-firing the
              // delete: this is the one action that must never happen twice
              // off a single "yes".
              presentFailure(e, 'account', handleDeleteAccount);
            }
          },
        },
      ]
    );
  };

  const handleUpdateBowlSize = async (size: string) => {
    if (!activePet || !checkAccess()) return;

    // Optimistic update
    useActivePetStore.setState({
      activePet: { ...activePet, bowl_size: size as any }
    });

    const { error } = await supabase
      .from('pets')
      .update({ bowl_size: size })
      .eq('id', activePet.id);

    if (error) {
      console.error('Failed to update bowl size:', error);
      useActivePetStore.setState({ activePet });
    }
  };

  const openEditModal = () => {
    if (!activePet || !checkAccess()) return;
    setEditName(activePet.name || '');
    setEditImageUri(activePet.image_url || null);
    setEditModalVisible(true);
  };

  const pickEditImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      // Downscale now so the storage upload later ships ~100 KB, not a full
      // camera-roll frame. Falls back to the original uri on failure.
      const prepared = await prepareImageForUpload(result.assets[0]);
      setEditImageUri(prepared.uri);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user || !activePet || !editName.trim()) return;
    setIsUpdatingProfile(true);
    let publicAvatarUrl = activePet.image_url;

    if (editImageUri && editImageUri !== activePet.image_url) {
      try {
        const ext = editImageUri.substring(editImageUri.lastIndexOf('.') + 1) || 'jpg';
        const fileName = `${user.id}_${Date.now()}.${ext}`;

        const formData = new FormData();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formData.append('file', {
          uri: editImageUri,
          name: fileName,
          type: `image/${ext === 'jpeg' ? 'jpeg' : 'jpeg'}`
        } as any);

        const { data, error } = await supabase.storage.from('avatars').upload(fileName, formData);
        if (!error && data) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
          publicAvatarUrl = urlData.publicUrl;
        }
      } catch (err) {
        console.error("Avatar update failed:", err);
      }
    }

    const { error } = await supabase
      .from('pets')
      .update({ name: editName.trim(), image_url: publicAvatarUrl })
      .eq('id', activePet.id);

    setIsUpdatingProfile(false);

    if (error) {
      presentFailure(error, 'account', () => void handleUpdateProfile());
    } else {
      setEditModalVisible(false);
      useActivePetStore.getState().fetchPet(user.id, { silent: true });
    }
  };

  const openInlineEdit = (dbColumn: string, label: string, value: string, placeholder: string, keyboardType: 'default' | 'numeric' | 'email-address' = 'default') => {
    if (!checkAccess()) return;
    if (dbColumn === 'current_weight_kg') {
      profileWeightSubmissionRef.current = null;
    }
    setInlineEditField({ dbColumn, label, value, placeholder, keyboardType });
    setInlineEditValue(value.toString());
    setInlineEditVisible(true);
  };

  const handleInlineSave = async (confirmUnusual = false) => {
    if (!activePet || !inlineEditField || !user) return;
    setIsUpdatingProfile(true);

    let parsedValue: any = inlineEditValue.trim();
    if (inlineEditField.keyboardType === 'numeric') {
      parsedValue = parseFloat(inlineEditValue) || 0;
    }

    if (inlineEditField.dbColumn === 'allergies' || inlineEditField.dbColumn === 'medical_conditions') {
        const arr = inlineEditValue.split(',').map(s => s.trim()).filter(s => s.length > 0);
        parsedValue = arr;
    }

    if (inlineEditField.dbColumn === 'current_weight_kg') {
      try {
        if (
          !profileWeightSubmissionRef.current ||
          profileWeightSubmissionRef.current.weightKg !== parsedValue
        ) {
          const measuredAt = new Date().toISOString();
          profileWeightSubmissionRef.current = {
            id: `profile:${activePet.id}:${measuredAt}:${Number(parsedValue).toFixed(3)}`,
            measuredAt,
            weightKg: parsedValue,
          };
        }
        const submission = profileWeightSubmissionRef.current;
        const result = await recordWeightMeasurement({
          pet: activePet,
          weightKg: parsedValue,
          source: 'profile',
          measuredAt: submission.measuredAt,
          sourceEventId: submission.id,
          confirmUnusual,
        });
        setIsUpdatingProfile(false);
        if (result.status === 'confirmation_required') {
          Alert.alert('Confirm weight', result.message, [
            { text: 'Check again', style: 'cancel' },
            { text: 'Save weight', onPress: () => void handleInlineSave(true) },
          ]);
          return;
        }
        profileWeightSubmissionRef.current = null;
        setInlineEditVisible(false);
        void useActivePetStore.getState().fetchPet(user.id, { silent: true });
      } catch (error) {
        setIsUpdatingProfile(false);
        presentFailure(error, 'account', () => void handleInlineSave(confirmUnusual));
      }
      return;
    }

    // Optimistic Update
    const updatedPet = { ...activePet, [inlineEditField.dbColumn]: parsedValue };
    useActivePetStore.setState({ activePet: updatedPet });

    const { error } = await supabase
      .from('pets')
      .update({ [inlineEditField.dbColumn]: parsedValue })
      .eq('id', activePet.id);

    setIsUpdatingProfile(false);

    if (error) {
      presentFailure(error, 'account', () => void handleInlineSave(confirmUnusual));
      useActivePetStore.getState().fetchPet(user.id, { silent: true }); // rollback
    } else {
      if (['breed', 'age_years'].includes(inlineEditField.dbColumn)) {
        if (!isAssessableWeightKg(updatedPet.current_weight_kg)) {
          // No measured weight yet (walk-first profile). There is nothing to
          // reassess against, so record the intent and move on silently —
          // editing a breed should not raise a failure the owner cannot act on.
          await requestWeightPlanReassessment(
            updatedPet,
            `${inlineEditField.dbColumn}_changed_without_weight`,
          );
        } else if (!activePet.body_condition_score) {
          await requestWeightPlanReassessment(
            updatedPet,
            `${inlineEditField.dbColumn}_changed_without_bcs`,
          );
        } else {
          // Named so "Try again" on the failure sheet can replay exactly this
          // and nothing else — the field itself already saved above.
          const runAssessment = async () => {
            const assessment = await recordWeightAssessment({
              pet: updatedPet,
              bcs: activePet.body_condition_score!,
              source: 'profile_change',
            });
            if (assessment.discloseIdealChange && assessment.idealWeightKg != null) {
              Alert.alert(
                'Plan updated',
                `The confirmed ideal changed from ${assessment.previousIdealWeightKg?.toFixed(1)} kg to ${assessment.idealWeightKg.toFixed(1)} kg using the corrected profile details.`,
              );
            }
          };
          try {
            await runAssessment();
          } catch (assessmentError) {
            presentFailure(assessmentError, 'account', () => void runAssessment());
            await requestWeightPlanReassessment(
              updatedPet,
              `${inlineEditField.dbColumn}_assessment_failed`,
            );
          }
        }
      }
      setInlineEditVisible(false);
      useActivePetStore.getState().fetchPet(user.id, { silent: true });
    }
  };

  // Generic optimistic field setter (mirrors handleUpdateBowlSize).
  const persistPetField = async (column: string, value: any) => {
    if (!activePet) return;
    const updatedPet = { ...activePet, [column]: value } as typeof activePet;
    useActivePetStore.setState({ activePet: updatedPet });
    const { error } = await supabase.from('pets').update({ [column]: value }).eq('id', activePet.id);
    if (error) {
      console.error(`Failed to update ${column}:`, error);
      useActivePetStore.setState({ activePet });
      return;
    }
    if (
      column === 'gender' ||
      column === 'reproductive_status'
    ) {
      if (!isAssessableWeightKg(updatedPet.current_weight_kg)) {
        // See the inline-edit path above: nothing to assess without a weight.
        await requestWeightPlanReassessment(
          updatedPet,
          `${column}_changed_without_weight`,
        );
      } else if (!activePet.body_condition_score) {
        await requestWeightPlanReassessment(
          updatedPet,
          `${column}_changed_without_bcs`,
        );
      } else try {
        const assessment = await recordWeightAssessment({
          pet: updatedPet,
          bcs: activePet.body_condition_score,
          source:
            column === 'reproductive_status'
              ? 'life_stage'
              : 'profile_change',
        });
        if (assessment.discloseIdealChange && assessment.idealWeightKg != null) {
          Alert.alert(
            'Plan updated',
            `The confirmed ideal changed from ${assessment.previousIdealWeightKg?.toFixed(1)} kg to ${assessment.idealWeightKg.toFixed(1)} kg using the corrected profile details.`,
          );
        }
      } catch (assessmentError) {
        console.error('Failed to reassess weight plan:', assessmentError);
        await requestWeightPlanReassessment(
          updatedPet,
          `${column}_assessment_failed`,
        );
      }
    }
  };

  // ─── Chips picker presets + openers ───
  const COMMON_ALLERGENS = [
    'Chicken', 'Beef', 'Grain/Wheat', 'Dairy', 'Egg',
    'Soy', 'Fish', 'Lamb', 'Corn', 'Pork',
  ];
  const COMMON_CONDITIONS = [
    'Arthritis', 'Diabetes', 'Hip dysplasia', 'Skin allergies',
    'Heart disease', 'Kidney disease', 'Dental disease', 'Obesity',
    'Epilepsy', 'Thyroid issues',
  ];
  // Per-kind config for the shared sheet. Keeps the JSX small and the rules
  // (single vs multi, copy, presets, custom input) all in one place.
  const chipsPetName = activePet?.name || 'your pet';
  const chipsConfig = chipsKind
    ? ({
        allergies: {
          title: 'Known allergies',
          subtitle: `Tap what ${chipsPetName} reacts to. Pawtchi flags these on every food scan.`,
          icon: 'coronavirus' as const,
          presets: COMMON_ALLERGENS,
          allowCustom: true,
          multi: true,
          customPlaceholder: 'Add another allergen (e.g. Salmon)',
          empty: 'No known allergies',
          saveLabel: 'Save allergies',
        },
        medical_conditions: {
          title: 'Medical conditions',
          subtitle: `Active conditions Pawtchi should keep in mind for ${chipsPetName}.`,
          icon: 'local-hospital' as const,
          presets: COMMON_CONDITIONS,
          allowCustom: true,
          multi: true,
          customPlaceholder: 'Add another condition (e.g. Pancreatitis)',
          empty: 'No active conditions',
          saveLabel: 'Save conditions',
        },
      } as const)[chipsKind]
    : null;

  const openChipsPicker = (kind: ChipsKind) => {
    if (!activePet || !checkAccess()) return;
    setChipsCustomInput('');
    if (kind === 'allergies') {
      setChipsSelected(activePet.allergies || []);
    } else if (kind === 'medical_conditions') {
      setChipsSelected(activePet.medical_conditions || []);
    }
    setChipsKind(kind);
  };

  const closeChipsPicker = () => {
    setChipsKind(null);
    setChipsCustomInput('');
  };

  const toggleChip = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    if (chipsConfig?.multi) {
      setChipsSelected((prev) =>
        prev.includes(trimmed) ? prev.filter((v) => v !== trimmed) : [...prev, trimmed],
      );
    } else {
      setChipsSelected([trimmed]);
    }
  };

  const addCustomChip = () => {
    const trimmed = chipsCustomInput.trim();
    if (!trimmed) return;
    if (!chipsSelected.includes(trimmed)) {
      setChipsSelected((prev) => [...prev, trimmed]);
    }
    setChipsCustomInput('');
  };

  const saveChipsPicker = async () => {
    if (!chipsKind) return;
    setIsSavingChips(true);
    // De-dup while preserving order.
    const cleaned = Array.from(new Set(chipsSelected.map((s) => s.trim()).filter(Boolean)));
    await persistPetField(chipsKind, cleaned);
    setIsSavingChips(false);
    closeChipsPicker();
  };

  const handleSetGender = () => {
    if (!activePet || !checkAccess()) return;
    Alert.alert(`${activePet.name || 'Your pet'}'s sex`, undefined, [
      { text: 'Male', onPress: () => persistPetField('gender', 'male') },
      { text: 'Female', onPress: () => persistPetField('gender', 'female') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSetReproductiveStatus = () => {
    if (!activePet || !checkAccess()) return;
    Alert.alert(`${activePet.name || 'Your pet'}'s life phase`, undefined, [
      {
        text: 'Not pregnant or nursing',
        onPress: () =>
          persistPetField('reproductive_status', 'neither'),
      },
      {
        text: 'Pregnant',
        onPress: () =>
          persistPetField('reproductive_status', 'pregnant'),
      },
      {
        text: 'Nursing',
        onPress: () =>
          persistPetField('reproductive_status', 'nursing'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSetBcs = () => {
    if (!activePet || !checkAccess()) return;
    setSelectedBcs(activePet.body_condition_score ?? 5);
    setBcsModalVisible(true);
  };

  const handleSaveBcs = async () => {
    if (!activePet || selectedBcs === null) return;

    // A body score describes a weight, so there is nothing to turn one into
    // until a weight exists. Walk-first profiles sit at the 0 sentinel, which
    // is exactly the value the assessment table rejects — so say what is
    // needed and offer the field, rather than attempting a doomed write and
    // reporting the failure as though something broke.
    if (!isAssessableWeightKg(activePet.current_weight_kg)) {
      const name = activePet.name?.trim();
      setBcsModalVisible(false);
      Alert.alert(
        'A weight comes first',
        name
          ? `Pawtchi needs ${name}'s current weight before a body score can become a plan.`
          : 'Pawtchi needs a current weight before a body score can become a plan.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Add weight',
            onPress: () =>
              openInlineEdit('current_weight_kg', 'Weight (kg)', '', 'e.g. 15.5', 'numeric'),
          },
        ],
      );
      return;
    }

    setIsSavingBcs(true);
    try {
      const assessment = await recordWeightAssessment({
        pet: activePet,
        bcs: selectedBcs,
        source: 'owner_bcs',
      });
      setBcsModalVisible(false);
      if (assessment.discloseIdealChange && assessment.idealWeightKg != null) {
        Alert.alert(
          'Plan updated',
          `The confirmed ideal changed from ${assessment.previousIdealWeightKg?.toFixed(1)} kg to ${assessment.idealWeightKg.toFixed(1)} kg after this body check.`,
        );
      }
      if (user) {
        void useActivePetStore.getState().fetchPet(user.id, { silent: true });
      }
    } catch (error) {
      presentFailure(error, 'account', () => void handleSaveBcs());
    } finally {
      setIsSavingBcs(false);
    }
  };

  const promptAddFood = () => {
    if (!checkAccess()) return;
    Alert.alert('Add Food', 'Scan a food label to add it to the pantry.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo Library', onPress: () => handleScanFoodLabel(false) },
      { text: 'Camera', onPress: () => handleScanFoodLabel(true) },
    ]);
  };

  // Deep-link target from the completion card (`/(tabs)/profile?focus=<key>`).
  const focusField = (key?: string) => {
    if (!key || !activePet) return;
    switch (key) {
      case 'photo': openEditModal(); break;
      case 'breed': openInlineEdit('breed', 'Breed', activePet.breed || '', 'e.g. Golden Retriever', 'default'); break;
      case 'age': openInlineEdit('age_years', 'Age (years)', activePet.age_years?.toString() || '', 'e.g. 3', 'numeric'); break;
      case 'allergies': openChipsPicker('allergies'); break;
      case 'gender': handleSetGender(); break;
      case 'bcs': handleSetBcs(); break;
      case 'pantry': promptAddFood(); break;
      default: break; // bowl_size lives in a visible section — no modal to open
    }
  };

  useEffect(() => {
    if (focus) {
      focusField(focus);
      router.setParams({ focus: undefined } as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, activePet?.id]);

  const petName = activePet?.name || 'My Pet';
  const membership = buildProfileMembershipPresentation({
    status: subStatus,
    daysLeft: subDaysLeft,
    isPro,
    hasFullAccess,
  });
  const weightPlan = activePet
    ? weightPlanViewModelFromRecord(activePet)
    : null;
  const weightPlanSummary = weightPlan
    ? [
        `${weightPlan.currentWeightKg.toFixed(1)} kg now`,
        weightPlan.targetWeightKg != null
          ? `${weightPlan.targetWeightKg.toFixed(1)} kg next`
          : null,
        weightPlan.idealWeightKg != null
          ? `${weightPlan.idealWeightKg.toFixed(1)} kg ideal`
          : 'body check needed',
        weightPlan.healthyBand
          ? `${weightPlan.healthyBand.low.toFixed(1)}–${weightPlan.healthyBand.high.toFixed(1)} kg healthy range`
          : null,
        activePet?.weight_assessed_at
          ? `assessed ${new Date(activePet.weight_assessed_at).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}${activePet.weight_assessment_source ? ` via ${activePet.weight_assessment_source.replace(/_/g, ' ')}` : ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No plan yet';

  // ── Walksign identity (dogs only) ──
  const walksignId: WalksignId | null =
    activePet?.species === 'dog' && activePet?.walksign
      ? (activePet.walksign as WalksignId)
      : null;
  const [walksignModalOpen, setWalksignModalOpen] = useState(false);
  const [walksignShareOpen, setWalksignShareOpen] = useState(false);
  // Re-run the sticky state machine on focus — staleness-guarded inside, so
  // this is a cheap no-op most visits but catches life transitions (a dog
  // ages into seniority with no walk to trigger the evaluation).
  useFocusEffect(
    React.useCallback(() => {
      if (activePet?.id && activePet.species === 'dog') {
        maybeEvaluateWalksign(activePet.id, user?.id).catch(() => {});
      }
    }, [activePet?.id, activePet?.species, user?.id]),
  );
  const breedLine = [
    activePet?.breed || (activePet?.species ? activePet.species : null),
    activePet?.age_years ? `${activePet.age_years} years` : null,
  ].filter(Boolean).join(' · ');

  // ─── Row recipe — single consistent settings row ───
  const Row = ({
    icon,
    label,
    sub,
    onPress,
    last,
    danger,
    trailing = 'chevron',
    disabled,
    loading,
  }: {
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    sub?: string;
    onPress: () => void;
    last?: boolean;
    danger?: boolean;
    trailing?: 'chevron' | 'edit' | 'none';
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast, (disabled || loading) && { opacity: 0.5 }]}
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <MaterialIcons name={icon} size={19} color={danger ? color.error : color.navy} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && { color: color.error }]}>{label}</Text>
        {!!sub && <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text>}
      </View>
      <PawLoader visible={loading} message={`Updating ${label.toLowerCase()}…`} />
      {!loading && trailing === 'chevron' && <MaterialIcons name="chevron-right" size={20} color={color.slateFaint} />}
      {!loading && trailing === 'edit' && <MaterialIcons name="edit" size={17} color={color.slateFaint} />}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Identity hero — navy, the pet carries the screen ─── */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroEyebrow}>PROFILE</Text>
            <TouchableOpacity onPress={openEditModal} style={styles.heroEditBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="edit" size={16} color={color.cream} />
              <Text style={styles.heroEditText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroIdentity}>
            <TouchableOpacity onPress={openEditModal} activeOpacity={0.9} style={styles.heroAvatarWrap}>
              <Image
                source={{ uri: resolvePetImage(activePet?.image_url, activePet?.species, 1000) }}
                style={styles.heroAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            </TouchableOpacity>
            <View style={styles.heroNameBlock}>
              <Text style={styles.heroName} numberOfLines={1}>{petName.toUpperCase()}</Text>
              {!!breedLine && (
                <TouchableOpacity onPress={() => openInlineEdit('breed', 'Breed', activePet?.breed || '', 'e.g. Golden Retriever', 'default')}>
                  <Text style={styles.heroBreed} numberOfLines={1}>{breedLine}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ─── Walksign — the identity Pawtchi discovered ─── */}
          {walksignId && (
            <TouchableOpacity
              style={styles.walksignRow}
              activeOpacity={0.85}
              onPress={() => setWalksignModalOpen(true)}
            >
              <WalksignCrest sign={walksignId} size={40} color={color.cream} />
              <View style={styles.walksignTextBlock}>
                <Text style={styles.walksignName}>{WALKSIGN_COPY[walksignId].displayName}</Text>
                <Text style={styles.walksignStatus}>
                  {buildStatusLine(activePet?.walksign_status === 'confirmed' ? 'confirmed' : 'provisional', null)}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={color.creamFaint} />
            </TouchableOpacity>
          )}

          {/* The one yellow action on this surface */}
          {!completeness.isAccurateEnough ? (
            <TouchableOpacity
              style={styles.completeBtn}
              activeOpacity={0.9}
              onPress={() => focusField(completeness.missing[0]?.focus)}
            >
              <View style={styles.completeTrack}>
                <View style={[styles.completeFill, { width: `${completeness.score}%` }]} />
              </View>
              <View style={styles.completeRow}>
                <Text style={styles.completeText}>Complete {petName}&apos;s profile</Text>
                <Text style={styles.completePct}>{completeness.score}%</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.completeDone}>
              <MaterialIcons name="check-circle" size={15} color={color.yellow} />
              <Text style={styles.completeDoneText}>Profile complete — {petName}&apos;s results are at full accuracy</Text>
            </View>
          )}
        </View>

        <ProfileMembershipCard presentation={membership} onPress={openBilling} />

        {/* ─── Vitals — 2×2, every tile edits ─── */}
        <View style={styles.vitalsGrid}>
          <TouchableOpacity
            style={styles.vitalTile}
            activeOpacity={0.8}
            onPress={() => openInlineEdit('current_weight_kg', 'Weight (kg)', activePet?.current_weight_kg?.toString() || '0', 'e.g. 15.5', 'numeric')}
          >
            <Text style={styles.vitalLabel}>WEIGHT</Text>
            <Text style={styles.vitalValue}>{activePet?.current_weight_kg ? `${activePet.current_weight_kg} kg` : '—'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.vitalTile}
            activeOpacity={0.8}
            onPress={() => openInlineEdit('age_years', 'Age (years)', activePet?.age_years?.toString() || '', 'e.g. 3', 'numeric')}
          >
            <Text style={styles.vitalLabel}>AGE</Text>
            <Text style={styles.vitalValue}>{activePet?.age_years ? `${activePet.age_years} yrs` : '—'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.vitalTile} activeOpacity={0.8} onPress={handleSetBcs}>
            <Text style={styles.vitalLabel}>BODY SHAPE</Text>
            <Text style={styles.vitalValue}>
              {activePet?.body_condition_score ? `${activePet.body_condition_score}/9` : '—'}
            </Text>
            <Text style={styles.vitalSub}>{bcsLabel(activePet?.body_condition_score)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.vitalTile} activeOpacity={0.8} onPress={handleSetGender}>
            <Text style={styles.vitalLabel}>SEX</Text>
            <Text style={styles.vitalValue}>
              {activePet?.gender === 'male' ? 'Male' : activePet?.gender === 'female' ? 'Female' : '—'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ─── Pantry ─── */}
        <Text style={styles.sectionLabel}>PANTRY</Text>
        <View style={styles.card}>
          {foodPantry.length === 0 ? (
            <View style={styles.pantryEmpty}>
              <MaterialIcons name="kitchen" size={28} color={color.slateFaint} />
              <Text style={styles.pantryEmptyTitle}>No foods saved yet</Text>
              <Text style={styles.pantryEmptyDesc}>
                Scan the labels {petName} eats most — it keeps every scan and portion accurate.
              </Text>
            </View>
          ) : (
            foodPantry.map((item, i) => {
              const expiryDate = item.expiry_date ? new Date(item.expiry_date) : null;
              const daysToExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
              const expiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7;
              const expired = daysToExpiry !== null && daysToExpiry < 0;
              const expiryLabel = expiryDate
                ? `Exp ${expiryDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                : null;
              return (
                <View key={item.id} style={[styles.pantryRow, i === foodPantry.length - 1 && styles.rowLast]}>
                  <Image
                    source={{ uri: item.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&q=80&w=200' }}
                    style={styles.pantryThumb}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={200}
                  />
                  <View style={styles.pantryInfo}>
                    <View style={styles.pantryNameRow}>
                      <Text style={styles.pantryBrand} numberOfLines={1}>{item.brand}</Text>
                      {item.is_primary && (
                        <View style={styles.primaryBadge}>
                          <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                        </View>
                      )}
                    </View>
                    {!!item.product_name && <Text style={styles.pantryProduct} numberOfLines={1}>{item.product_name}</Text>}
                    <View style={styles.pantryMetaRow}>
                      {!!item.kcal_per_serving && <Text style={styles.pantryMeta}>{item.kcal_per_serving} kcal</Text>}
                      {!!item.protein_pct && <Text style={styles.pantryMeta}>· {item.protein_pct}% protein</Text>}
                      {expiryLabel && (
                        <Text style={[
                          styles.pantryMeta,
                          { marginLeft: 4 },
                          (expiringSoon || expired) && { color: color.error, fontFamily: font.semibold }
                        ]}>
                          · {expired ? 'Expired' : expiryLabel}
                        </Text>
                      )}
                      {item.allergy_flags && item.allergy_flags.length > 0 && (
                        <View style={styles.allergyFlag}>
                          <MaterialIcons name="warning" size={11} color={color.error} />
                          <Text style={styles.allergyFlagText} numberOfLines={1}>{item.allergy_flags.join(', ')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.pantryActions}>
                    {!item.is_primary && (
                      <TouchableOpacity onPress={() => handleTogglePrimary(item.id, item.food_type)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="star-outline" size={20} color={color.slateFaint} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => togglePantryFavorite(item.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons
                        name={item.is_favorite ? 'favorite' : 'favorite-border'}
                        size={20}
                        color={item.is_favorite ? color.error : color.slateFaint}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setExpiryDraft(expiryDate ?? new Date());
                        setExpiryPickerForId(item.id);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons
                        name={item.expiry_date ? 'event' : 'event-available'}
                        size={20}
                        color={expiringSoon || expired ? color.error : color.slateFaint}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeletePantryItem(item.id, item.brand)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <MaterialIcons name="delete-outline" size={20} color={color.slateFaint} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={styles.pantryFooter}>
            <PawtchiButton
              title="Scan a food label"
              variant="black"
              size="medium"
              iconName="add-a-photo"
              onPress={promptAddFood}
              loading={isScanningLabel}
              loadingMessage="Scanning food label…"
            />
          </View>

          {/* Bowl size — an extension of Pantry rather than its own section.
              What's fed and what it's served in are the same fact from the
              portion engine's point of view, so they now live in one card
              under one label; the top hairline is what marks the hand-off. */}
          <View style={styles.bowlSection}>
            <Text style={styles.bowlSectionLabel}>BOWL SIZE</Text>
            <Text style={styles.bowlHint}>The bowl {petName} usually eats from — it sharpens portion estimates.</Text>
            <View style={styles.bowlRow}>
              {BOWL_SIZES.map(s => {
                const isSelected = activePet?.bowl_size === s.value;
                return (
                  <TouchableOpacity
                    key={s.value}
                    style={[styles.bowlPill, isSelected && styles.bowlPillSelected]}
                    onPress={() => handleUpdateBowlSize(s.value)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.bowlPillLabel, isSelected && styles.bowlPillLabelSelected]}>{s.label}</Text>
                    <Text style={[styles.bowlPillDesc, isSelected && styles.bowlPillDescSelected]}>{s.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* ─── Health ─── */}
        <Text style={styles.sectionLabel}>HEALTH</Text>
        <View style={styles.card}>
          <Row
            icon="timeline"
            label="Weight plan"
            sub={weightPlanSummary}
            onPress={() => router.push('/(tabs)/health')}
          />
          <Row
            icon="monitor-weight"
            label="Body condition score"
            sub={
              activePet?.body_condition_score
                ? `${activePet.body_condition_score}/9 · ${bcsLabel(activePet.body_condition_score)}`
                : 'Not set — informs calorie targets and weight goals'
            }
            trailing="edit"
            onPress={handleSetBcs}
          />
          {activePet?.gender === 'female' &&
            !activePet.is_neutered && (
              <Row
                icon="pets"
                label="Life phase"
                sub={
                  activePet.reproductive_status === 'pregnant'
                    ? 'Pregnant · supervised weight plan'
                    : activePet.reproductive_status === 'nursing'
                      ? 'Nursing · supervised weight plan'
                      : 'Not pregnant or nursing'
                }
                trailing="edit"
                onPress={handleSetReproductiveStatus}
              />
            )}
          <Row
            icon="coronavirus"
            label="Known allergies"
            sub={activePet?.allergies && activePet.allergies.length > 0 ? activePet.allergies.join(', ') : 'None specified'}
            trailing="edit"
            onPress={() => openChipsPicker('allergies')}
          />
          <Row
            icon="local-hospital"
            label="Medical conditions"
            sub={activePet?.medical_conditions && activePet.medical_conditions.length > 0 ? activePet.medical_conditions.join(', ') : 'None specified'}
            trailing="edit"
            last
            onPress={() => openChipsPicker('medical_conditions')}
          />
        </View>

        {/* ─── Account ─── */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <Row icon="person-outline" label="Owner profile" onPress={() => router.push('/owner' as any)} />
          <Row
            icon="schedule"
            label="Routine"
            sub={routineSubtitle}
            trailing="edit"
            onPress={() => setRoutineSheetOpen(true)}
          />
          <Row
            icon="notifications-none"
            label="Notifications"
            onPress={() => router.push('/notifications' as any)}
          />
          <Row icon="group-add" label="Invite a friend" onPress={() => router.push('/invite' as any)} />
          {/* The two human doors sit together, functional first: support is for
              "something is wrong", the letter for "here is what I think". */}
          <Row
            icon="help-outline"
            label={SUPPORT_LABEL}
            sub="Report a problem, ask a question, or read common answers"
            onPress={() => router.push({ pathname: '/support', params: { source: 'profile' } } as never)}
          />
          <Row
            icon="drafts"
            label={WRITE_TO_FOUNDER_LABEL}
            sub="A letter straight to the people who make Pawtchi"
            onPress={() => router.push({ pathname: '/letter', params: { source: 'profile' } } as never)}
          />
          <Row icon="security" label="Privacy & security" last onPress={() => router.push('/privacy' as any)} />
        </View>

        {/* ─── Sign out / danger — kept apart, quiet ─── */}
        <View style={[styles.card, styles.dangerCard]}>
          <Row
            icon="logout"
            label={isSigningOut ? 'Signing out…' : 'Sign out'}
            trailing="none"
            onPress={handleSignOut}
            loading={isSigningOut}
          />
          <Row
            icon="delete-forever"
            label="Delete account"
            sub="Permanently removes all your data"
            trailing="none"
            danger
            last
            onPress={handleDeleteAccount}
            disabled={isSigningOut}
          />
        </View>
      </ScrollView>

      {/* Walksign detail — the full manifesto */}
      {walksignId && (
        <PawtchiModal
          visible={walksignModalOpen && !walksignShareOpen}
          onClose={() => setWalksignModalOpen(false)}
          title={WALKSIGN_COPY[walksignId].displayName}
          actions={[
            {
              label: 'Share',
              onPress: () => {
                track('walksign_shared', { sign: walksignId, surface: 'profile' });
                setWalksignShareOpen(true);
              },
            },
            { label: 'Close', onPress: () => setWalksignModalOpen(false), variant: 'secondary' },
          ]}
        >
          <View style={styles.walksignModalBody}>
            <WalksignCrest sign={walksignId} size={88} color={color.ink} />
            <Text style={styles.walksignModalTagline}>{WALKSIGN_COPY[walksignId].tagline}</Text>
            <Text style={styles.walksignModalManifesto}>{WALKSIGN_COPY[walksignId].manifesto}</Text>
            <Text style={styles.walksignModalCaption}>A Pawtchi Walksign</Text>
          </View>
        </PawtchiModal>
      )}
      {walksignId && (
        <WalksignShareModal
          visible={walksignShareOpen}
          onClose={() => setWalksignShareOpen(false)}
          sign={walksignId}
          petName={activePet?.name}
        />
      )}

      <RoutineSheet
        visible={routineSheetOpen}
        onClose={() => setRoutineSheetOpen(false)}
        petName={activePet?.name?.trim() || 'your pet'}
        species={activePet?.species === 'cat' ? 'cat' : 'dog'}
        existingPrefs={ownerPrefs}
        primaryLabel="Save changes"
        onSubmit={handleRoutineSubmit}
        isSubmitting={routineSubmitting}
      />

      {/* Offered once on the way to the store's subscription screen. Cancelling
          must never feel like a trap: "Continue" is the primary action, it is
          always visible, it is one tap, and the backdrop dismisses too. This is
          an invitation, not a retention gate. */}
      <PawtchiModal
        visible={showLeavingSheet}
        onClose={continueToStore}
        title="Before you go"
        icon={{ name: 'drafts', color: color.navy }}
        message="If Pawtchi isn't earning its place, we'd genuinely like to know why — it's the most useful thing anyone sends."
        actions={[
          { label: 'Continue to subscriptions', onPress: continueToStore },
          { label: `${WRITE_TO_FOUNDER_LABEL} first`, onPress: writeBeforeLeaving, variant: 'ghost' },
        ]}
      />

      {/* Branded failure sheet — every failure path on this screen. The copy's
          own actions render as written now: this used to collapse everything
          that wasn't a permission prompt down to a single "OK", which quietly
          threw away both the retry and the support door. */}
      <FailureModal
        copy={failure}
        onClose={() => setFailure(null)}
        onAction={handleRecovery}
        meta={{ ...failureMeta, screen: '/(tabs)/profile' }}
      />

      {/* Edit Profile Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent={true}>
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Edit profile</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>
            <View style={styles.editModalBody}>
              <View style={{ alignItems: 'center', marginBottom: space.xxl }}>
                <TouchableOpacity onPress={pickEditImage} style={styles.editAvatarPicker} activeOpacity={0.8}>
                  {editImageUri ? (
                    <Image source={{ uri: editImageUri }} style={styles.editAvatarImg} />
                  ) : (
                    <View style={styles.editAvatarPlaceholder}>
                      <MaterialIcons name="add-a-photo" size={30} color={color.slateFaint} />
                    </View>
                  )}
                  <View style={styles.editAvatarBadge}>
                    <MaterialIcons name="edit" size={13} color={color.navy} />
                  </View>
                </TouchableOpacity>
                <Text style={styles.editAvatarHint}>Tap to change photo</Text>
              </View>

              <Text style={styles.editFieldLabel}>Pet name</Text>
              <TextField
                containerStyle={styles.editFieldSpacing}
                height={52}
                fontSize={15}
                placeholder="Pet name"
                value={editName}
                onChangeText={setEditName}
              />

              <PawtchiButton
                title="Save changes"
                variant="primary"
                loading={isUpdatingProfile}
                onPress={handleUpdateProfile}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* BCS Picker Modal */}
      <Modal visible={bcsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.editModalOverlay}>
          <View style={[styles.editModalContent, { maxHeight: '88%' }]}>
            <View style={styles.editModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editModalTitle}>Body condition score</Text>
                <Text style={styles.bcsSubtitle}>
                  The 1–9 scale vets use. Pawtchi uses this to tune calorie targets.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setBcsModalVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.bcsList}
              contentContainerStyle={{ paddingBottom: space.lg }}
              showsVerticalScrollIndicator={false}
            >
              {BCS_OPTIONS.map((opt) => {
                const isSelected = selectedBcs === opt.score;
                const tier =
                  opt.score <= 3 ? color.viz.amber : opt.score <= 5 ? color.success : opt.score <= 7 ? color.viz.amber : color.error;
                return (
                  <SelectableChip
                    key={opt.score}
                    selected={isSelected}
                    style={styles.bcsOption}
                    selectedStyle={styles.bcsOptionSelected}
                    scaleTo={motion.scale.press}
                    onPress={() => setSelectedBcs(opt.score)}
                  >
                    <View style={[styles.bcsScoreBadge, { backgroundColor: tier }]}>
                      <Text style={styles.bcsScoreText}>{opt.score}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bcsOptionTitle, isSelected && { color: color.navy }]}>
                        {opt.title}
                      </Text>
                      <Text style={styles.bcsOptionDesc} numberOfLines={3}>{opt.desc}</Text>
                    </View>
                    {isSelected && (
                      <MaterialIcons name="check-circle" size={20} color={color.navy} />
                    )}
                  </SelectableChip>
                );
              })}
            </ScrollView>
            <View style={styles.editModalBody}>
              <PawtchiButton
                title="Save"
                variant="primary"
                loading={isSavingBcs}
                disabled={selectedBcs === null}
                onPress={handleSaveBcs}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Chips Picker Modal — allergies, medical conditions, parent title */}
      <Modal visible={!!chipsKind} animationType="slide" transparent onRequestClose={closeChipsPicker}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.editModalOverlay}
        >
          <View style={[styles.editModalContent, { maxHeight: '88%' }]}>
            <View style={styles.editModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editModalTitle}>{chipsConfig?.title}</Text>
                {!!chipsConfig?.subtitle && (
                  <Text style={styles.bcsSubtitle}>{chipsConfig.subtitle}</Text>
                )}
              </View>
              <TouchableOpacity onPress={closeChipsPicker} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.bcsList}
              contentContainerStyle={{ paddingBottom: space.lg }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Combined preset + custom-already-selected list. */}
              <View style={styles.chipsGrid}>
                {(() => {
                  const presets = chipsConfig?.presets ?? [];
                  const customSelected = chipsSelected.filter((s) => !presets.includes(s));
                  const all = [...presets, ...customSelected];
                  return all.map((label) => {
                    const isSelected = chipsSelected.includes(label);
                    const isCustom = !presets.includes(label);
                    return (
                      <SelectableChip
                        key={label}
                        selected={isSelected}
                        style={styles.profileChip}
                        selectedStyle={styles.profileChipSelected}
                        onPress={() => toggleChip(label)}
                      >
                        {isSelected && (
                          <MaterialIcons
                            name={isCustom ? 'close' : 'check'}
                            size={14}
                            color={color.navy}
                            style={{ marginRight: 4 }}
                          />
                        )}
                        <Text style={[styles.profileChipText, isSelected && styles.profileChipTextSelected]}>
                          {label}
                        </Text>
                      </SelectableChip>
                    );
                  });
                })()}
              </View>

              {/* "No known X" quick action for multi-select kinds. */}
              {chipsConfig?.multi && (
                <TouchableOpacity
                  style={[
                    styles.profileNoneRow,
                    chipsSelected.length === 0 && styles.profileNoneRowActive,
                  ]}
                  onPress={() => setChipsSelected([])}
                  activeOpacity={0.85}
                >
                  <MaterialIcons
                    name={chipsSelected.length === 0 ? 'check-circle' : 'radio-button-unchecked'}
                    size={18}
                    color={chipsSelected.length === 0 ? color.navy : color.slateFaint}
                  />
                  <Text style={styles.profileNoneText}>{chipsConfig.empty}</Text>
                </TouchableOpacity>
              )}

              {/* Free-text add row */}
              {chipsConfig?.allowCustom && (
                <View style={styles.profileCustomRow}>
                  <TextField
                    containerStyle={styles.profileCustomFieldSpacing}
                    height={48}
                    fontSize={14}
                    value={chipsCustomInput}
                    onChangeText={setChipsCustomInput}
                    placeholder={chipsConfig.customPlaceholder}
                    returnKeyType="done"
                    onSubmitEditing={addCustomChip}
                  />
                  <TouchableOpacity
                    style={[styles.profileAddBtn, !chipsCustomInput.trim() && styles.profileAddBtnDisabled]}
                    onPress={addCustomChip}
                    disabled={!chipsCustomInput.trim()}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="add" size={20} color={color.navy} />
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            <View style={styles.editModalBody}>
              <PawtchiButton
                title={chipsConfig?.saveLabel || 'Save'}
                variant="primary"
                loading={isSavingChips}
                disabled={!chipsConfig?.multi && chipsSelected.length === 0}
                onPress={saveChipsPicker}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Inline Edit Modal */}
      <Modal visible={inlineEditVisible} animationType="slide" transparent={true}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Edit {inlineEditField?.label?.toLowerCase()}</Text>
              <TouchableOpacity onPress={() => setInlineEditVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={22} color={color.ink} />
              </TouchableOpacity>
            </View>
            <View style={styles.editModalBody}>
              <Text style={styles.editFieldLabel}>{inlineEditField?.label}</Text>
              <TextField
                containerStyle={styles.editFieldSpacing}
                height={52}
                fontSize={15}
                placeholder={inlineEditField?.placeholder}
                value={inlineEditValue}
                onChangeText={setInlineEditValue}
                keyboardType={inlineEditField?.keyboardType || 'default'}
                autoFocus
              />

              <PawtchiButton
                title="Save"
                variant="primary"
                loading={isUpdatingProfile}
                onPress={() => void handleInlineSave()}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {showPickerFor && (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="fade" visible={!!showPickerFor}>
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerSheet}>
                <Text style={styles.pickerTitle}>
                  {showPickerFor === 'meal' ? 'Feeding time' : 'Walk time'}
                </Text>
                <DateTimePicker
                  value={showPickerFor === 'meal' ? mealTime : walkTime}
                  mode="time"
                  display="spinner"
                  onChange={(event, date) => {
                     if (date) {
                        if (showPickerFor === 'meal') setMealTime(date);
                        else setWalkTime(date);
                     }
                  }}
                  textColor={color.ink}
                />
                <TouchableOpacity
                  onPress={() => onChangeTime(null as any, showPickerFor === 'meal' ? mealTime : walkTime)}
                  style={styles.pickerDoneBtn}
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={showPickerFor === 'meal' ? mealTime : walkTime}
            mode="time"
            display="default"
            onChange={onChangeTime}
          />
        )
      )}

      {/* Pantry expiry date picker */}
      {expiryPickerForId && (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="fade" visible={!!expiryPickerForId}>
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerSheet}>
                <Text style={styles.pickerTitle}>Expiry date</Text>
                <DateTimePicker
                  value={expiryDraft}
                  mode="date"
                  display="spinner"
                  minimumDate={new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)}
                  onChange={(_event, date) => { if (date) setExpiryDraft(date); }}
                  textColor={color.ink}
                />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <TouchableOpacity
                    onPress={() => {
                      const id = expiryPickerForId;
                      setExpiryPickerForId(null);
                      if (id) setPantryExpiry(id, null);
                    }}
                    style={[styles.pickerDoneBtn, { flex: 1, backgroundColor: color.track }]}
                  >
                    <Text style={[styles.pickerDoneText, { color: color.slate }]}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const id = expiryPickerForId;
                      const iso = expiryDraft.toISOString().slice(0, 10);
                      setExpiryPickerForId(null);
                      if (id) setPantryExpiry(id, iso);
                    }}
                    style={[styles.pickerDoneBtn, { flex: 1 }]}
                  >
                    <Text style={styles.pickerDoneText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={expiryDraft}
            mode="date"
            display="default"
            onChange={(event, date) => {
              const id = expiryPickerForId;
              setExpiryPickerForId(null);
              if (event.type === 'set' && date && id) {
                setPantryExpiry(id, date.toISOString().slice(0, 10));
              }
            }}
          />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surfaceSubtle },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    paddingBottom: 120 + TAB_BAR_CLEARANCE, // floating tab bar overlaps content
  },

  // ─── Hero ───
  hero: {
    backgroundColor: color.navy,
    borderRadius: radius.xxl,
    padding: space.xxl,
    marginTop: space.md,
    marginBottom: space.lg,
    ...shadow.raised,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xl,
  },
  heroEyebrow: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.creamFaint,
  },
  heroEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  heroEditText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.cream,
  },
  heroIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  heroAvatarWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2.5,
    borderColor: color.yellow,
    padding: 3,
  },
  heroAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  heroNameBlock: { flex: 1, minWidth: 0 },
  heroName: {
    fontFamily: font.display,
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: 1,
    color: color.cream,
  },
  heroBreed: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: color.creamDim,
    marginTop: 4,
    textTransform: 'capitalize',
  },

  // Walksign identity row (navy hero) + detail modal
  walksignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.lg,
  },
  walksignTextBlock: { flex: 1 },
  walksignName: {
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: 0.5,
    color: color.cream,
  },
  walksignStatus: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.creamFaint,
    marginTop: 2,
  },
  walksignModalBody: {
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.lg,
  },
  walksignModalTagline: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.slate,
    textAlign: 'center',
    marginTop: space.sm,
  },
  walksignModalManifesto: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: color.slateMuted,
    textAlign: 'center',
  },
  walksignModalCaption: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2,
    color: color.slateFaint,
    textTransform: 'uppercase',
    marginTop: space.sm,
  },

  // Completion — the surface's one yellow action
  completeBtn: {
    marginTop: space.xxl,
    backgroundColor: color.navyRaised,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
  },
  completeTrack: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(244, 241, 236, 0.12)',
    overflow: 'hidden',
    marginBottom: space.md,
  },
  completeFill: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
  },
  completeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  completeText: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.cream,
  },
  completePct: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.yellow,
  },
  completeDone: {
    marginTop: space.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  completeDoneText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.creamDim,
    flex: 1,
  },

  // ─── Vitals ───
  vitalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginBottom: space.xxl,
  },
  vitalTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    ...shadow.card,
  },
  vitalLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: color.slateFaint,
    marginBottom: 6,
  },
  vitalValue: {
    fontFamily: font.bold,
    fontSize: 18,
    color: color.ink,
    letterSpacing: -0.3,
  },
  vitalSub: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateMuted,
    marginTop: 2,
  },

  // ─── Sections ───
  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: color.slateFaint,
    marginBottom: space.sm,
    marginLeft: 4,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    marginBottom: space.xxl,
    overflow: 'hidden',
    ...shadow.card,
  },

  // Row recipe
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: color.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: color.errorSoft },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: {
    fontFamily: font.semibold,
    fontSize: 14.5,
    color: color.ink,
  },
  rowSub: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
    marginTop: 2,
  },

  // ─── Pantry ───
  pantryEmpty: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.xxl,
    gap: 6,
  },
  pantryEmptyTitle: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.ink,
    marginTop: 6,
  },
  pantryEmptyDesc: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slateMuted,
    textAlign: 'center',
  },
  pantryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  pantryThumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: color.track,
  },
  pantryInfo: { flex: 1, minWidth: 0 },
  pantryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pantryBrand: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
    flexShrink: 1,
  },
  primaryBadge: {
    backgroundColor: color.yellowSoft,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  primaryBadgeText: {
    fontFamily: font.bold,
    fontSize: 8.5,
    letterSpacing: 0.8,
    color: color.navy,
  },
  pantryProduct: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 1,
  },
  pantryMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  pantryMeta: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: color.slate,
  },
  allergyFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 4,
  },
  allergyFlagText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: color.error,
  },
  pantryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  pantryFooter: {
    padding: space.lg,
  },

  // ─── Bowl size — nested inside the Pantry card, not its own section ───
  bowlSection: {
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
  },
  bowlSectionLabel: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 1.8,
    color: color.slateFaint,
    marginBottom: space.sm,
  },
  bowlHint: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: color.slateMuted,
    marginBottom: space.md,
  },
  bowlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  bowlPill: {
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bowlPillSelected: {
    backgroundColor: color.navy,
    borderColor: color.navy,
  },
  bowlPillLabel: {
    fontFamily: font.bold,
    fontSize: 13,
    color: color.ink,
  },
  bowlPillLabelSelected: { color: color.cream },
  bowlPillDesc: {
    fontFamily: font.regular,
    fontSize: 10.5,
    color: color.slateFaint,
    marginTop: 2,
  },
  bowlPillDescSelected: { color: color.creamDim },

  // ─── Danger card ───
  dangerCard: {
    marginBottom: space.xxxl,
  },

  // ─── Modals ───
  editModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
  },
  editModalContent: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingBottom: 36,
  },
  editModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
    paddingTop: space.xxl,
    paddingBottom: space.lg,
  },
  editModalTitle: {
    fontFamily: font.bold,
    fontSize: 18,
    color: color.ink,
    letterSpacing: -0.2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModalBody: {
    paddingHorizontal: space.xxl,
  },
  editAvatarPicker: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  editAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
  },
  editAvatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
    backgroundColor: color.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: color.surface,
  },
  editAvatarHint: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
    marginTop: space.md,
  },
  editFieldLabel: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.slate,
    marginBottom: space.sm,
    marginLeft: 4,
  },
  // Spacing only — the box itself is TextField's. A height here would put us
  // straight back into the bug documented in lib/ui/textFieldLayout.ts.
  editFieldSpacing: {
    marginBottom: space.xl,
  },

  // ─── BCS picker ───
  bcsSubtitle: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: color.slateMuted,
    marginTop: 4,
    marginRight: space.lg,
  },
  bcsList: {
    paddingHorizontal: space.xxl,
  },
  bcsOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    marginBottom: space.sm,
  },
  bcsOptionSelected: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  bcsScoreBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bcsScoreText: {
    fontFamily: font.extrabold,
    fontSize: 14,
    color: color.surface,
  },
  bcsOptionTitle: {
    fontFamily: font.bold,
    fontSize: 14.5,
    color: color.ink,
  },
  bcsOptionDesc: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: color.slateMuted,
    marginTop: 1,
  },

  // ─── Chips picker (allergies / conditions / parent title) ───
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingTop: space.xs,
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  profileChipSelected: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  profileChipText: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.slate,
  },
  profileChipTextSelected: {
    color: color.navy,
  },
  profileNoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  profileNoneRowActive: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  profileNoneText: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.ink,
  },
  profileCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
  },
  profileCustomFieldSpacing: {
    flex: 1,
  },
  profileAddBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAddBtnDisabled: {
    opacity: 0.4,
  },

  // ─── Time picker ───
  pickerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(7, 32, 42, 0.55)',
  },
  pickerSheet: {
    backgroundColor: color.surface,
    padding: space.xxl,
    borderRadius: radius.xxl,
    width: '82%',
    alignItems: 'center',
  },
  pickerTitle: {
    fontFamily: font.bold,
    fontSize: 17,
    color: color.ink,
    marginBottom: space.lg,
  },
  pickerDoneBtn: {
    marginTop: space.xl,
    backgroundColor: color.yellow,
    paddingVertical: 14,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
  },
  pickerDoneText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
  },
});
