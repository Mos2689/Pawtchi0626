import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { color, font, radius, shadow, space } from '../../constants/design';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../providers/AuthProvider';
import { useActivePetStore } from '../../store/useActivePetStore';
import { BOWL_SIZES } from '../../constants/brandData';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useSubscription } from '../../hooks/useSubscription';
import { openManageSubscription } from '../../lib/manageSubscription';
import { useWalkthrough } from '../../providers/WalkthroughContext';
import { PawtchiButton } from '../../components/PawtchiButton';
import { computeCompleteness } from '../../lib/profileCompleteness';

// Profile — the pet's identity card. A navy hero carries who they are; the
// light sections below are quiet, single-recipe rows. One yellow per surface:
// the "complete profile" action in the hero.

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
  const { activePet, clearPet, foodPantry, addPantryItem, fetchPantry } = useActivePetStore();
  const { clearStreak } = useStreakStore();
  const { clearContext } = usePetContextStore();
  const { status: subStatus, daysLeft: subDaysLeft, isPro, hasFullAccess } = useSubscription();
  // Subscribers manage their plan in the store; everyone else sees the purchase paywall.
  const openBilling = () => (isPro ? openManageSubscription() : router.push('/paywall' as any));
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
    setIsScanningLabel(true);
    try {
      let result;
      if (useCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Camera access is needed to scan food labels.');
          setIsScanningLabel(false);
          return;
        }
        result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, allowsEditing: true });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, allowsEditing: true, mediaTypes: ['images'] });
      }

      if (result.canceled || !result.assets[0]) {
        setIsScanningLabel(false);
        return;
      }

      const asset = result.assets[0];
      const { data, error } = await supabase.functions.invoke('gemini-proxy', {
        body: {
          imageBase64: asset.base64!,
          mimeType: asset.mimeType || 'image/jpeg',
          petProfile: { ...activePet, food_pantry: foodPantry },
        },
      });

      if (error || !data?.success || !data.analysis) {
        Alert.alert('Scan Failed', data?.error || 'Could not analyze the food label.');
        setIsScanningLabel(false);
        return;
      }

      const a = data.analysis;
      if (!a.brand && !a.product_name && !a.food_name) {
        Alert.alert('No Label Found', 'Could not identify a food product. Try scanning the label on the packaging.');
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
      const message = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Error', message);
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
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Account deletion failed. Please try again.');
            }
          },
        },
      ]
    );
  };

  const updateParentTitle = async (title: string) => {
    if (!activePet || !checkAccess()) return;

    // Optistic update
    useActivePetStore.setState({
      activePet: { ...activePet, parent_title: title }
    });

    const { error } = await supabase
      .from('pets')
      .update({ parent_title: title })
      .eq('id', activePet.id);

    if (error) {
      console.error('Failed to update parent title:', error);
      // Revert if error
      useActivePetStore.setState({ activePet });
    }
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
      setEditImageUri(result.assets[0].uri);
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
      Alert.alert('Error', error.message);
    } else {
      setEditModalVisible(false);
      useActivePetStore.getState().fetchPet(user.id, { silent: true });
    }
  };

  const openInlineEdit = (dbColumn: string, label: string, value: string, placeholder: string, keyboardType: 'default' | 'numeric' | 'email-address' = 'default') => {
    if (!checkAccess()) return;
    setInlineEditField({ dbColumn, label, value, placeholder, keyboardType });
    setInlineEditValue(value.toString());
    setInlineEditVisible(true);
  };

  const handleInlineSave = async () => {
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

    // Optimistic Update
    useActivePetStore.setState({
      activePet: { ...activePet, [inlineEditField.dbColumn]: parsedValue }
    });

    const { error } = await supabase
      .from('pets')
      .update({ [inlineEditField.dbColumn]: parsedValue })
      .eq('id', activePet.id);

    setIsUpdatingProfile(false);

    if (error) {
      Alert.alert('Error', error.message);
      useActivePetStore.getState().fetchPet(user.id, { silent: true }); // rollback
    } else {
      setInlineEditVisible(false);
      useActivePetStore.getState().fetchPet(user.id, { silent: true });
    }
  };

  // Generic optimistic field setter (mirrors updateParentTitle / handleUpdateBowlSize).
  const persistPetField = async (column: string, value: any) => {
    if (!activePet) return;
    useActivePetStore.setState({ activePet: { ...activePet, [column]: value } as any });
    const { error } = await supabase.from('pets').update({ [column]: value }).eq('id', activePet.id);
    if (error) {
      console.error(`Failed to update ${column}:`, error);
      useActivePetStore.setState({ activePet });
    }
  };

  const handleSetGender = () => {
    if (!activePet || !checkAccess()) return;
    Alert.alert(`${activePet.name || 'Your pet'}'s sex`, undefined, [
      { text: 'Male', onPress: () => persistPetField('gender', 'male') },
      { text: 'Female', onPress: () => persistPetField('gender', 'female') },
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
    setIsSavingBcs(true);
    await persistPetField('body_condition_score', selectedBcs);
    setIsSavingBcs(false);
    setBcsModalVisible(false);
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
      case 'allergies': openInlineEdit('allergies', 'Allergies (comma separated)', (activePet.allergies || []).join(', '), 'e.g. Chicken, Beef', 'default'); break;
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
      {loading && <ActivityIndicator size="small" color={danger ? color.error : color.navy} />}
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
                source={{ uri: activePet?.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop' }}
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
            foodPantry.map((item, i) => (
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
                  <TouchableOpacity onPress={() => handleDeletePantryItem(item.id, item.brand)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="delete-outline" size={20} color={color.slateFaint} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <View style={styles.pantryFooter}>
            <PawtchiButton
              title="Scan a food label"
              variant="black"
              size="medium"
              iconName="add-a-photo"
              onPress={promptAddFood}
              loading={isScanningLabel}
            />
          </View>
        </View>

        {/* ─── Bowl size ─── */}
        <Text style={styles.sectionLabel}>BOWL SIZE</Text>
        <View style={[styles.card, styles.bowlCard]}>
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

        {/* ─── Health ─── */}
        <Text style={styles.sectionLabel}>HEALTH</Text>
        <View style={styles.card}>
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
          <Row
            icon="coronavirus"
            label="Known allergies"
            sub={activePet?.allergies && activePet.allergies.length > 0 ? activePet.allergies.join(', ') : 'None specified'}
            trailing="edit"
            onPress={() => openInlineEdit('allergies', 'Allergies (comma separated)', (activePet?.allergies || []).join(', '), 'e.g. Chicken, Beef', 'default')}
          />
          <Row
            icon="local-hospital"
            label="Medical conditions"
            sub={activePet?.medical_conditions && activePet.medical_conditions.length > 0 ? activePet.medical_conditions.join(', ') : 'None specified'}
            trailing="edit"
            last
            onPress={() => openInlineEdit('medical_conditions', 'Medical Conditions', (activePet?.medical_conditions || []).join(', '), 'e.g. Arthritis, Diabetes', 'default')}
          />
        </View>

        {/* ─── Account ─── */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <Row
            icon="favorite-border"
            label="Parent title"
            sub={activePet?.parent_title || 'Mom / Dad'}
            trailing="edit"
            onPress={() => {
              Alert.alert('Parent Title', `What does ${petName} call you?`, [
                { text: 'Mom', onPress: () => updateParentTitle('Mom') },
                { text: 'Dad', onPress: () => updateParentTitle('Dad') },
                { text: 'Buddy', onPress: () => updateParentTitle('Buddy') },
                { text: 'Cancel', style: 'cancel' }
              ]);
            }}
          />
          <Row icon="person-outline" label="Owner profile" onPress={() => router.push('/owner' as any)} />
          <Row
            icon="credit-card"
            label={isPro ? 'Manage subscription' : 'Billing & subscription'}
            sub={subStatus === 'active' ? 'Pawtchi Plus — active' : subStatus === 'trial' ? `Trial — ${subDaysLeft} days left` : 'Upgrade to Pawtchi Plus'}
            onPress={openBilling}
          />
          <Row icon="group-add" label="Invite a friend" onPress={() => router.push('/invite' as any)} />
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
              <TextInput
                style={styles.editInput}
                placeholder="Pet name"
                placeholderTextColor={color.slateFaint}
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
                  <TouchableOpacity
                    key={opt.score}
                    style={[styles.bcsOption, isSelected && styles.bcsOptionSelected]}
                    onPress={() => setSelectedBcs(opt.score)}
                    activeOpacity={0.85}
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
                  </TouchableOpacity>
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
              <TextInput
                style={styles.editInput}
                placeholder={inlineEditField?.placeholder}
                placeholderTextColor={color.slateFaint}
                value={inlineEditValue}
                onChangeText={setInlineEditValue}
                keyboardType={inlineEditField?.keyboardType || 'default'}
                autoFocus
              />

              <PawtchiButton
                title="Save"
                variant="primary"
                loading={isUpdatingProfile}
                onPress={handleInlineSave}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.surfaceSubtle },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    paddingBottom: 120, // accommodate tab bar
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

  // ─── Bowl size ───
  bowlCard: { padding: space.lg },
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
  editInput: {
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    height: 52,
    fontFamily: font.medium,
    fontSize: 15,
    color: color.ink,
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
