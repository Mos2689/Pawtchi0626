import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Switch, Alert, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors } from '../../constants/Theme';
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

// Screen 6: Profile & Settings
export default function ProfileScreen() {
  const router = useRouter();
  const theme = Colors.light;
  const insets = useSafeAreaInsets();

  const { user } = useAuth();
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
    clearPet();
    clearStreak();
    clearContext();
    await AsyncStorage.removeItem('walkthrough_completed');
    await supabase.auth.signOut();
    // Wait for the auth listener in `_layout` to kick us out
  };

  const handleDeleteAccount = () => {
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
              // Clear local state
              clearPet();
              clearStreak();
              clearContext();
              await AsyncStorage.removeItem('walkthrough_completed');
              await supabase.auth.signOut();
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
      useActivePetStore.getState().fetchPet(user.id);
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
      useActivePetStore.getState().fetchPet(user.id); // rollback
    } else {
      setInlineEditVisible(false);
      useActivePetStore.getState().fetchPet(user.id);
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
    Alert.alert(`${activePet.name || 'Your pet'}'s body shape`, 'How would you describe their shape?', [
      { text: 'A bit thin', onPress: () => persistPetField('body_condition_score', 3) },
      { text: 'Just right', onPress: () => persistPetField('body_condition_score', 5) },
      { text: 'A bit chunky', onPress: () => persistPetField('body_condition_score', 7) },
      { text: 'Overweight', onPress: () => persistPetField('body_condition_score', 9) },
      { text: 'Cancel', style: 'cancel' },
    ]);
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

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarMini, { borderColor: '#1a1a00' }]}>
            <Image
              source={{ uri: activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=1000&auto=format&fit=crop' }}
              style={styles.avatarMiniImg}
            />
          </View>
          <Text style={[styles.headerTitle, { color: '#1a1a00' }]}>PAWTCHI</Text>
        </View>
        <TouchableOpacity style={styles.bellBtn} onPress={() => router.push('/profile' as any)}>
          <MaterialIcons name="notifications" size={28} color="#1a1a00" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Hero Profile Section */}
        <View style={styles.heroSection}>
          <LinearGradient colors={['#FFFC00', '#e6e300']} style={styles.heroGradient}>
            {/* Background Blob */}
            <View style={[styles.heroBlob, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />

            <View style={styles.heroContent}>
              <View style={[styles.mainAvatar, { borderColor: '#FFFFFF' }]}>
                <Image
                  source={{ uri: activePet?.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop' }}
                  style={styles.mainAvatarImg}
                />
              </View>
              <View style={styles.heroInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[styles.heroName, { color: '#1a1a00' }]}>{activePet?.name || 'My Pet'}</Text>
                  <TouchableOpacity onPress={openEditModal} style={{ padding: 6, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 12, marginLeft: 12 }}>
                    <MaterialIcons name="edit" size={18} color="#1a1a00" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => openInlineEdit('breed', 'Breed', activePet?.breed || '', 'e.g. Golden Retriever', 'default')}>
                  <Text style={[styles.heroDesc, { color: '#4d4d00', textTransform: 'capitalize', textDecorationLine: 'underline' }]}>
                    {activePet?.breed || activePet?.species} • {activePet?.age_years ? `${activePet.age_years} Years Old` : 'Age Unknown'}
                  </Text>
                </TouchableOpacity>

                <View style={styles.tagsRow}>
                  {!completeness.isAccurateEnough && (
                    <TouchableOpacity
                      style={[styles.tagPill, { backgroundColor: '#1a1a00', borderColor: '#1a1a00' }]}
                      activeOpacity={0.85}
                      onPress={() => focusField(completeness.missing[0]?.focus)}
                    >
                      <Text style={[styles.tagText, { color: '#FFFC00' }]}>Complete profile · {completeness.score}%</Text>
                    </TouchableOpacity>
                  )}
                  <View style={[styles.tagPill, { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' }]}>
                    <Text style={[styles.tagText, { color: '#1a1a00' }]}>Active Walker</Text>
                  </View>
                  <View style={[styles.tagPill, { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'rgba(255,255,255,0.2)' }]}>
                    <Text style={[styles.tagText, { color: '#1a1a00' }]}>Pro Eater</Text>
                  </View>
                </View>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Bento Grid: Pet Details */}
        <View style={styles.bentoGrid}>
          {/* Weight */}
          <TouchableOpacity activeOpacity={0.8} onPress={() => openInlineEdit('current_weight_kg', 'Weight (kg)', activePet?.current_weight_kg?.toString() || '0', 'e.g. 15.5', 'numeric')} style={[styles.bentoCard, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
            <MaterialIcons name="monitor-weight" size={32} color="#1a1a00" />
            <Text style={[styles.bentoValue, { color: '#0f172a' }]}>{activePet?.current_weight_kg || 0} kg</Text>
            <Text style={[styles.bentoLabel, { color: '#64748b' }]}>Weight</Text>
          </TouchableOpacity>
          {/* Age */}
          <TouchableOpacity activeOpacity={0.8} onPress={() => openInlineEdit('age_years', 'Age (years)', activePet?.age_years?.toString() || '', 'e.g. 3', 'numeric')} style={[styles.bentoCard, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
            <MaterialIcons name="cake" size={32} color="#1a1a00" />
            <Text style={[styles.bentoValue, { color: '#0f172a' }]}>{activePet?.age_years || '?'} yrs</Text>
            <Text style={[styles.bentoLabel, { color: '#64748b' }]}>Age</Text>
          </TouchableOpacity>
        </View>
        {/* Food Pantry Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="kitchen" size={24} color="#0f172a" />
            <Text style={[styles.sectionTitle, { color: '#0f172a' }]}>Food Pantry</Text>
          </View>

          <View style={[styles.pantryContainer, { backgroundColor: '#f8fafc', borderColor: '#f1f5f9' }]}>
            <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#64748b', marginBottom: 16 }}>Saved foods</Text>
            {foodPantry.length === 0 ? (
              <View style={styles.pantryEmpty}>
                <MaterialIcons name="no-food" size={40} color="#cbd5e1" />
                <Text style={styles.pantryEmptyTitle}>No foods saved yet</Text>
                <Text style={styles.pantryEmptyDesc}>
                  Scan food labels to build {activePet?.name}'s pantry — this helps the AI give more accurate results.
                </Text>
              </View>
            ) : (
              <View style={styles.pantryBentoGrid}>
                {foodPantry.map((item) => (
                  <View key={item.id} style={styles.pantryBentoCard}>
                    {/* Image Hero Section */}
                    <View style={styles.pantryBentoImageContainer}>
                      <Image 
                        source={{ uri: item.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&q=80&w=400' }} 
                        style={styles.pantryBentoImage} 
                      />
                      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={styles.pantryBentoGradient} />
                      
                      {/* Top Badges overlay */}
                      <View style={styles.pantryBentoTopRow}>
                        {item.is_primary ? (
                          <View style={styles.pantryBentoPrimaryBadge}>
                              <Text style={styles.pantryBentoPrimaryText}>Primary</Text>
                          </View>
                        ) : <View />}
                        <View style={styles.pantryBentoActionRow}>
                          {!item.is_primary && (
                            <TouchableOpacity onPress={() => handleTogglePrimary(item.id, item.food_type)} style={styles.pantryBentoGlassBtn}>
                              <MaterialIcons name="star-outline" size={16} color="#FFF" />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity onPress={() => handleDeletePantryItem(item.id, item.brand)} style={styles.pantryBentoGlassBtn}>
                            <MaterialIcons name="delete-outline" size={16} color="#FFF" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Brand Info overlay */}
                      <View style={styles.pantryBentoBrandOverlay}>
                        <Text style={styles.pantryBentoBrandName} numberOfLines={1}>{item.brand}</Text>
                        <Text style={styles.pantryBentoProductName} numberOfLines={1}>{item.product_name}</Text>
                      </View>
                    </View>

                    {/* Details Section */}
                    <View style={styles.pantryBentoDetails}>
                      <View style={styles.pantryBentoMacroRow}>
                         <View style={styles.pantryBentoMacroPill}>
                           <MaterialIcons name="local-fire-department" size={14} color="#FFFC00" />
                           <Text style={styles.pantryBentoMacroText}>{item.kcal_per_serving || '--'} kcal</Text>
                         </View>
                         {item.protein_pct && (
                           <View style={styles.pantryBentoMacroPill}>
                             <MaterialIcons name="fitness-center" size={14} color="#FFFC00" />
                             <Text style={styles.pantryBentoMacroText}>{item.protein_pct}% P</Text>
                           </View>
                         )}
                         {item.fat_pct && (
                           <View style={styles.pantryBentoMacroPill}>
                             <MaterialIcons name="opacity" size={14} color="#FFFC00" />
                             <Text style={styles.pantryBentoMacroText}>{item.fat_pct}% F</Text>
                           </View>
                         )}
                      </View>

                      {item.allergy_flags && item.allergy_flags.length > 0 && (
                        <View style={styles.pantryBentoAllergyRow}>
                           <MaterialIcons name="warning" size={12} color="#dc2626" />
                           <Text style={styles.pantryBentoAllergyText} numberOfLines={1}>{item.allergy_flags.join(', ')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Add Food Button */}
            <PawtchiButton
              title="Scan Food Label"
              iconName="add-a-photo"
              onPress={() => {
                Alert.alert('Add Food', 'Scan a food label to add it to the pantry.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Photo Library', onPress: () => handleScanFoodLabel(false) },
                  { text: 'Camera', onPress: () => handleScanFoodLabel(true) },
                ]);
              }}
              loading={isScanningLabel}
              style={{ marginBottom: 16 }}
            />

            {/* Bowl Size Integrations */}
            <View style={{ marginBottom: 24, marginTop: 16 }}>
              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#64748b', marginBottom: 8 }}>Standard bowl size</Text>
              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Helps AI estimate portions more accurately</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {BOWL_SIZES.map(s => {
                  const isSelected = activePet?.bowl_size === s.value;
                  return (
                    <TouchableOpacity
                      key={s.value}
                      style={[{ 
                        backgroundColor: isSelected ? '#FFFC00' : '#FFFFFF',
                        borderWidth: 1,
                        borderColor: isSelected ? '#e6e300' : '#e2e8f0',
                        borderRadius: 16,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        flexGrow: 1,
                        alignItems: 'center',
                      }]}
                      onPress={() => handleUpdateBowlSize(s.value)}
                    >
                      <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: isSelected ? '800' : '600', fontSize: 14, color: '#0f172a' }}>
                        {s.label}
                      </Text>
                      <Text style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 11, color: isSelected ? '#a1a1aa' : '#94a3b8', marginTop: 2 }}>
                        {s.description}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* Health Context */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="health-and-safety" size={24} color="#0f172a" />
            <Text style={[styles.sectionTitle, { color: '#0f172a' }]}>Health & Allergies</Text>
          </View>

          <View style={[styles.settingsGroup, { backgroundColor: '#f8fafc', borderColor: '#f1f5f9' }]}>
            <TouchableOpacity
              style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}
              activeOpacity={0.7}
              onPress={() => openInlineEdit('allergies', 'Allergies (comma separated)', (activePet?.allergies || []).join(', '), 'e.g. Chicken, Beef', 'default')}
            >
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#fee2e2' }]}>
                  <MaterialIcons name="coronavirus" size={24} color="#ef4444" />
                </View>
                <View style={{ flex: 1, paddingRight: 16 }}>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Known Allergies</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]} numberOfLines={2}>
                    {activePet?.allergies && activePet.allergies.length > 0 ? activePet.allergies.join(', ') : 'None specified'}
                  </Text>
                </View>
              </View>
              <MaterialIcons name="edit" size={20} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9', borderBottomWidth: 0 }]}
              activeOpacity={0.7}
              onPress={() => openInlineEdit('medical_conditions', 'Medical Conditions', (activePet?.medical_conditions || []).join(', '), 'e.g. Arthritis, Diabetes', 'default')}
            >
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#e0e7ff' }]}>
                  <MaterialIcons name="local-hospital" size={24} color="#4f46e5" />
                </View>
                <View style={{ flex: 1, paddingRight: 16 }}>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Medical Conditions</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]} numberOfLines={2}>
                    {activePet?.medical_conditions && activePet.medical_conditions.length > 0 ? activePet.medical_conditions.join(', ') : 'None specified'}
                  </Text>
                </View>
              </View>
              <MaterialIcons name="edit" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Notification Settings Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="notifications-active" size={24} color="#0f172a" />
            <Text style={[styles.sectionTitle, { color: '#0f172a' }]}>Preferences</Text>
          </View>

          <View style={[styles.settingsGroup, { backgroundColor: '#f8fafc', borderColor: '#f1f5f9' }]}>

            {/* Relationship Title */}
            <TouchableOpacity
              style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}
              activeOpacity={0.7}
              onPress={() => {
                Alert.alert('Parent Title', `What does ${activePet?.name || 'your pet'} call you?`, [
                  { text: 'Mom', onPress: () => updateParentTitle('Mom') },
                  { text: 'Dad', onPress: () => updateParentTitle('Dad') },
                  { text: 'Buddy', onPress: () => updateParentTitle('Buddy') },
                  { text: 'Cancel', style: 'cancel' }
                ]);
              }}
            >
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#fee2e2' }]}>
                  <MaterialIcons name="favorite" size={24} color="#ef4444" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Parent Title</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]}>{activePet?.parent_title || 'Mom/Dad'}</Text>
                </View>
              </View>
              <MaterialIcons name="edit" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {/* Billing & Subscription */}
            <TouchableOpacity
              style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}
              activeOpacity={0.7}
              onPress={openBilling}
            >
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#ede9fe' }]}>
                  <MaterialIcons name="credit-card" size={24} color="#7c3aed" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>{isPro ? 'Manage subscription' : 'Billing & Subscription'}</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]}>
                    {subStatus === 'active' ? 'Pawtchi Plus — Active' : subStatus === 'trial' ? `Free trial — ${subDaysLeft} days left` : 'Upgrade to Pawtchi Plus'}
                  </Text>
                </View>
              </View>
              <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {/* Feeding Times - HIDDEN TEMPORARILY
            <View style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#fef8c3' }]}>
                  <MaterialIcons name="restaurant" size={24} color="#605d34" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Feeding Times</Text>
                  <TouchableOpacity onPress={() => setShowPickerFor('meal')}>
                    <Text style={[styles.settingSub, { color: '#3b82f6', textDecorationLine: 'underline' }]}>
                      Next: {mealTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Switch
                value={feedingToggle}
                onValueChange={handleFeedingToggle}
                trackColor={{ false: '#e2e8f0', true: '#FFFC00' }}
                thumbColor={feedingToggle ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>

            <View style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: 'rgba(255,252,0,0.2)' }]}>
                  <MaterialIcons name="directions-walk" size={24} color="#1a1a00" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Walk Schedule</Text>
                  <TouchableOpacity onPress={() => setShowPickerFor('walk')}>
                    <Text style={[styles.settingSub, { color: '#3b82f6', textDecorationLine: 'underline' }]}>
                      Daily at {walkTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Switch
                value={walkToggle}
                onValueChange={handleWalkToggle}
                trackColor={{ false: '#e2e8f0', true: '#FFFC00' }}
                thumbColor={walkToggle ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>

            <View style={[styles.settingRow, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
              <View style={styles.settingRowLeft}>
                <View style={[styles.settingIconBg, { backgroundColor: '#f1f5f9' }]}>
                  <MaterialIcons name="water-drop" size={24} color="#94a3b8" />
                </View>
                <View>
                  <Text style={[styles.settingName, { color: '#0f172a' }]}>Hydration Tracker</Text>
                  <Text style={[styles.settingSub, { color: '#64748b' }]}>Every 4 hours</Text>
                </View>
              </View>
              <Switch
                value={hydrationToggle}
                onValueChange={handleHydrationToggle}
                trackColor={{ false: '#e2e8f0', true: '#FFFC00' }}
                thumbColor={hydrationToggle ? '#FFFFFF' : '#FFFFFF'}
              />
            </View>
            */}

          </View>
        </View>

        {/* Account Settings */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="manage-accounts" size={24} color="#0f172a" />
            <Text style={[styles.sectionTitle, { color: '#0f172a' }]}>Account Info</Text>
          </View>

          <View style={[styles.accountGroup, { backgroundColor: '#FFFFFF', borderColor: '#f1f5f9' }]}>
            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7} onPress={() => router.push('/owner' as any)}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="person" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>Owner Profile</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7} onPress={openBilling}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="payment" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>{isPro ? 'Manage subscription' : 'Billing & Subscription'}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>



            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7} onPress={() => router.push('/invite' as any)}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="group-add" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>Invite a friend</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.accountRow} activeOpacity={0.7} onPress={() => router.push('/privacy' as any)}>
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="security" size={24} color="#94a3b8" />
                <Text style={[styles.accountName, { color: '#0f172a' }]}>Privacy & Security</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#94a3b8" />
            </TouchableOpacity>


            <TouchableOpacity
              style={[styles.accountRow, { borderBottomWidth: 0 }]}
              activeOpacity={0.7}
              onPress={handleSignOut}
            >
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="logout" size={24} color="#b02500" />
                <Text style={[styles.accountName, { color: '#b02500' }]}>Logout</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.accountRow, { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: '#fee2e2', marginTop: 8 }]}
              activeOpacity={0.7}
              onPress={handleDeleteAccount}
            >
              <View style={styles.accountRowLeft}>
                <MaterialIcons name="delete-forever" size={24} color="#dc2626" />
                <View>
                  <Text style={[styles.accountName, { color: '#dc2626' }]}>Delete Account</Text>
                  <Text style={[styles.settingSub, { color: '#ef4444', fontSize: 11 }]}>Permanently removes all your data</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent={true}>
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={24} color="#0f172a" />
              </TouchableOpacity>
            </View>
            <View style={styles.editModalBody}>
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <TouchableOpacity onPress={pickEditImage} style={styles.editAvatarPicker} activeOpacity={0.8}>
                  {editImageUri ? (
                    <Image source={{ uri: editImageUri }} style={styles.editAvatarImg} />
                  ) : (
                    <View style={styles.editAvatarPlaceholder}>
                      <MaterialIcons name="add-a-photo" size={32} color="#adadab" />
                    </View>
                  )}
                  <View style={styles.editAvatarBadge}>
                    <MaterialIcons name="edit" size={14} color="#000" />
                  </View>
                </TouchableOpacity>
                <Text style={{ fontFamily: 'Plus Jakarta Sans', color: '#64748b', fontSize: 13, marginTop: 12 }}>Tap to change photo</Text>
              </View>

              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#334155', marginBottom: 8, marginLeft: 4 }}>Pet Name</Text>
              <TextInput
                style={styles.editInput}
                placeholder="Pet Name"
                placeholderTextColor="#94a3b8"
                value={editName}
                onChangeText={setEditName}
              />

              <PawtchiButton
                title="Save Changes"
                variant="primary"
                loading={isUpdatingProfile}
                onPress={handleUpdateProfile}
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
              <Text style={styles.editModalTitle}>Edit {inlineEditField?.label}</Text>
              <TouchableOpacity onPress={() => setInlineEditVisible(false)} style={styles.modalCloseBtn}>
                <MaterialIcons name="close" size={24} color="#0f172a" />
              </TouchableOpacity>
            </View>
            <View style={styles.editModalBody}>
              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#334155', marginBottom: 8, marginLeft: 4 }}>{inlineEditField?.label}</Text>
              <TextInput
                style={styles.editInput}
                placeholder={inlineEditField?.placeholder}
                placeholderTextColor="#94a3b8"
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
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <View style={{ backgroundColor: '#FFFFFF', padding: 24, borderRadius: 24, width: '80%', alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 18, color: '#0f172a', marginBottom: 16 }}>
                  {showPickerFor === 'meal' ? 'Feeding Time' : 'Walk Time'}
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
                  textColor="#0f172a"
                />
                <TouchableOpacity 
                  onPress={() => onChangeTime(null as any, showPickerFor === 'meal' ? mealTime : walkTime)} 
                  style={{ marginTop: 24, backgroundColor: '#FFFC00', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 16, width: '100%', alignItems: 'center' }}
                >
                  <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 16, color: '#041015' }}>Done</Text>
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
  avatarMini: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    backgroundColor: '#FFFC00',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarMiniImg: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  bellBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 120, // accommodate tab bar
  },
  heroSection: {
    marginBottom: 24,
  },
  heroGradient: {
    borderRadius: 24,
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  heroBlob: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    zIndex: 10,
  },
  mainAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  mainAvatarImg: {
    width: '100%',
    height: '100%',
  },
  heroInfo: {
    flex: 1,
  },
  heroName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 32,
    letterSpacing: -0.5,
  },
  heroDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 14,
    marginTop: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  tagPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
  },
  bentoGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  bentoCard: {
    flex: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  bentoSpanCard: {
    width: '100%',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  bentoValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 24,
    marginTop: 8,
  },
  bentoLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 4,
  },
  medicalNudgeCard: {
    marginHorizontal: 0,
    marginBottom: 32,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  medicalGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 24,
  },
  medicalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  medicalTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 18,
    color: '#FFFC00',
    marginBottom: 2,
  },
  medicalSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#94a3b8',
  },
  sectionContainer: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  sectionTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
  },
  settingsGroup: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  settingRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  settingIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 2,
  },
  settingSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    fontStyle: 'italic',
  },
  accountGroup: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  accountRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  accountName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
  },
  // Pantry styles
  pantryContainer: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  pantryEmpty: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  pantryEmptyTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
    color: '#64748b',
  },
  pantryEmptyDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  pantryBentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 16,
    marginBottom: 16,
    justifyContent: 'space-between',
  },
  pantryBentoCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  pantryBentoImageContainer: {
    height: 120,
    position: 'relative',
    backgroundColor: '#f1f5f9',
  },
  pantryBentoImage: {
    width: '100%',
    height: '100%',
  },
  pantryBentoGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
  },
  pantryBentoTopRow: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pantryBentoPrimaryBadge: {
    backgroundColor: '#FFFC00',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  pantryBentoPrimaryText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 9,
    color: '#1a1a00',
    letterSpacing: 0.5,
  },
  pantryBentoActionRow: {
    flexDirection: 'column',
    gap: 6,
  },
  pantryBentoGlassBtn: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pantryBentoBrandOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  pantryBentoBrandName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 13,
    color: '#FFFFFF',
  },
  pantryBentoProductName: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 11,
    color: '#e2e8f0',
  },
  pantryBentoDetails: {
    padding: 10,
    gap: 8,
  },
  pantryBentoMacroRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  pantryBentoMacroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  pantryBentoMacroText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 10,
    color: '#f8fafc',
  },
  pantryBentoAllergyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef2f2',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  pantryBentoAllergyText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 9,
    color: '#dc2626',
    flexShrink: 1,
  },
  pantryAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFC00',
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 4,
  },
  pantryAddBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 15,
    color: '#041015',
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  editModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingBottom: 40,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  editModalTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 20,
    color: '#0f172a',
  },
  modalCloseBtn: {
    padding: 8,
    backgroundColor: '#f8fafc',
    borderRadius: 20,
  },
  editModalBody: {
    padding: 24,
  },
  editAvatarPicker: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#F9F9F9',
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 60,
  },
  editAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFFC00',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editInput: {
    width: '100%',
    height: 64,
    borderWidth: 1,
    borderColor: 'rgba(209,213,225,0.7)',
    borderRadius: 16,
    paddingHorizontal: 20,
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 16,
    backgroundColor: '#f8fafc',
    marginBottom: 32,
  },
  editSaveBtn: {
    backgroundColor: '#FFFC00',
    paddingVertical: 20,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 16,
    color: '#0f172a',
  }
});
