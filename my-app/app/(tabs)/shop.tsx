import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Typography } from '../../components/Typography';
import { Header } from '../../components/Header';
import { MaterialIcons } from '@expo/vector-icons';
import { useStreakStore } from '../../store/useStreakStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useAuth } from '../../providers/AuthProvider';
import * as Haptics from 'expo-haptics';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming, 
  withSequence
} from 'react-native-reanimated';

// ------------------------------------------------------------------
// MOCK DATA: STITCH WEARABLES
// ------------------------------------------------------------------
const REWARDS = [
  {
    id: 'wearable_bandana',
    category: 'Featured',
    name: 'Neon Bondi Bandana',
    description: 'Limited Summer Edition',
    cost: 450,
    image: 'https://mbvpjbwukhypvmgeuyyw.supabase.co/storage/v1/object/public/wearables/neon_bandana_asset.png',
    type: 'large',
    tag: 'NEW ARRIVAL'
  },
  {
    id: 'wearable_hat',
    category: 'Hats',
    name: 'Retro Propeller Hat',
    description: 'Classic spin.',
    cost: 120,
    image: 'https://mbvpjbwukhypvmgeuyyw.supabase.co/storage/v1/object/public/wearables/propeller_hat_asset.png',
    type: 'small',
  },
  {
    id: 'wearable_bg',
    category: 'Backgrounds',
    name: 'Golden Hour BG',
    description: 'Cozy sunbeam.',
    cost: 300,
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=400',
    type: 'small',
  },
  {
    id: 'wearable_scarf',
    category: 'Premium',
    name: 'Royal Silk Scarf',
    description: 'Unlocks \'Elegant\' tag.',
    cost: 850,
    image: 'https://images.unsplash.com/photo-1605050519965-4f400787aade?auto=format&fit=crop&q=80&w=800',
    type: 'medium',
  },
  {
    id: 'wearable_sweater',
    category: 'Clothing',
    name: 'Cozy Crimson',
    description: 'Warm knit.',
    cost: 210,
    image: 'https://mbvpjbwukhypvmgeuyyw.supabase.co/storage/v1/object/public/wearables/cozy_sweater_asset.png',
    type: 'small',
  },
  {
    id: 'wearable_glasses',
    category: 'Accessories',
    name: 'Rad Shades',
    description: 'Cool tinted.',
    cost: 180,
    image: 'https://mbvpjbwukhypvmgeuyyw.supabase.co/storage/v1/object/public/wearables/rad_shades_asset.png',
    type: 'small',
  },
];

// ------------------------------------------------------------------
// REWARD CARD COMPONENT
// ------------------------------------------------------------------
const RewardCard = ({ 
  item, 
  userCoins, 
  isUnlocked,
  isEquipped,
  onPurchase,
  onToggleEquip
}: { 
  item: typeof REWARDS[0], 
  userCoins: number, 
  isUnlocked: boolean,
  isEquipped: boolean,
  onPurchase: (id: string, cost: number) => void,
  onToggleEquip: (id: string) => void
}) => {
  const scale = useSharedValue(1);
  const glowOpacity = useSharedValue(isUnlocked ? 1 : 0);

  const canAfford = userCoins >= item.cost;

  const handlePressIn = () => {
    if (!isUnlocked && canAfford) {
      scale.value = withSpring(0.96);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const handleAction = () => {
    if (isUnlocked) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onToggleEquip(item.id);
      return;
    }

    if (!canAfford) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      scale.value = withSequence(
        withTiming(1.05, { duration: 50 }),
        withTiming(0.95, { duration: 50 }),
        withTiming(1.05, { duration: 50 }),
        withTiming(1, { duration: 50 })
      );
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onPurchase(item.id, item.cost);
    glowOpacity.value = withTiming(1, { duration: 500 });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isUnlocked ? '#F7F602' : '#f0f0f0',
    borderWidth: isUnlocked ? 2 : 1,
  }));

  const renderContent = () => {
    if (item.type === 'large') {
      return (
        <View style={styles.cardLarge}>
          <View style={styles.largeImageContainer}>
            <Image source={{ uri: item.image }} style={styles.largeImage} contentFit="cover" cachePolicy="memory-disk" transition={200} />
            {item.tag && (
              <View style={styles.tagBadge}>
                <Text style={styles.tagText}>{item.tag}</Text>
              </View>
            )}
          </View>
          <View style={styles.largeFooter}>
            <View style={{ flex: 1 }}>
              <Typography variant="headline" size={20} weight="bold" color="on-surface">{item.name}</Typography>
              <Typography variant="body" size={12} color="on-surface-variant">{item.description}</Typography>
            </View>
            <TouchableOpacity 
              activeOpacity={0.9} onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handleAction}
              style={[styles.buyPill, { backgroundColor: isUnlocked ? (isEquipped ? '#1A1A1A' : '#F7F602') : (canAfford ? '#1A1A1A' : '#f0f0f0') }]}
            >
              {isUnlocked ? (
                <View style={styles.costRow}>
                  {isEquipped && <MaterialIcons name="check" size={16} color="#FFF" />}
                  <Typography variant="label" weight="bold" color={isEquipped ? 'on-primary' : 'on-surface'} style={isEquipped ? { color: '#FFF' } : undefined} size={12}>
                    {isEquipped ? 'EQUIPPED' : 'EQUIP'}
                  </Typography>
                </View>
              ) : (
                <View style={styles.costRow}>
                  <MaterialIcons name="toll" size={16} color={canAfford ? '#FFF' : '#999'} />
                  <Typography variant="label" weight="bold" color={canAfford ? undefined : 'on-surface-variant'} style={canAfford ? { color: '#FFF' } : undefined}>{item.cost}</Typography>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (item.type === 'medium') {
      return (
        <View style={styles.cardMedium}>
          <View style={styles.mediumImageContainer}>
            <Image source={{ uri: item.image }} style={styles.mediumImage} contentFit="cover" cachePolicy="memory-disk" transition={200} />
          </View>
          <View style={styles.mediumInfo}>
            <Typography variant="headline" size={18} weight="bold" color="on-surface">{item.name}</Typography>
            <Typography variant="body" size={12} color="on-surface-variant" style={{ marginBottom: 12 }}>{item.description}</Typography>
            <TouchableOpacity 
              activeOpacity={0.9} onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handleAction}
              style={[styles.buyPill, { alignSelf: 'flex-start', backgroundColor: isUnlocked ? (isEquipped ? '#1A1A1A' : '#F7F602') : (canAfford ? '#1A1A1A' : '#f0f0f0') }]}
            >
              {isUnlocked ? (
                <View style={styles.costRow}>
                  {isEquipped && <MaterialIcons name="check" size={16} color="#FFF" />}
                  <Typography variant="label" weight="bold" color={isEquipped ? 'on-primary' : 'on-surface'} style={isEquipped ? { color: '#FFF' } : undefined} size={12}>
                    {isEquipped ? 'EQUIPPED' : 'EQUIP'}
                  </Typography>
                </View>
              ) : (
                <View style={styles.costRow}>
                  <MaterialIcons name="toll" size={16} color={canAfford ? '#FFF' : '#999'} />
                  <Typography variant="label" weight="bold" color={canAfford ? undefined : 'on-surface-variant'} style={canAfford ? { color: '#FFF' } : undefined}>{item.cost}</Typography>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.cardSmall}>
        <View style={styles.smallImageContainer}>
          <Image source={{ uri: item.image }} style={styles.smallImage} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </View>
        <Typography variant="headline" size={14} weight="bold" color="on-surface" numberOfLines={1}>{item.name}</Typography>
        <TouchableOpacity 
          activeOpacity={0.9} onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handleAction}
          style={[styles.smallBuyPill, { marginTop: 8, backgroundColor: isUnlocked ? (isEquipped ? '#1A1A1A' : '#F7F602') : (canAfford ? '#f8f8f8' : '#f0f0f0') }]}
        >
          {isUnlocked ? (
            <View style={styles.costRow}>
              {isEquipped && <MaterialIcons name="check" size={10} color="#FFF" />}
              <Typography variant="label" weight="bold" color={isEquipped ? 'on-primary' : 'on-surface'} style={isEquipped ? { color: '#FFF' } : undefined} size={10}>
                {isEquipped ? 'EQUIPPED' : 'EQUIP'}
              </Typography>
            </View>
          ) : (
            <View style={styles.costRow}>
              <MaterialIcons name="toll" size={14} color={canAfford ? '#F7F602' : '#999'} />
              <Typography variant="label" weight="bold" color={canAfford ? 'on-surface' : 'on-surface-variant'} size={12}>{item.cost}</Typography>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Animated.View style={[
      animatedStyle, 
      styles.cardBase, 
      item.type === 'large' ? { width: '100%', aspectRatio: 0.9 } : 
      item.type === 'medium' ? { width: '100%' } : { flex: 1 }
    ]}>
      {renderContent()}
    </Animated.View>
  );
};

// ------------------------------------------------------------------
// MAIN SCREEN
// ------------------------------------------------------------------
export default function ShopScreen() {
  const { user } = useAuth();
  const { pawCoins, deductCoins } = useStreakStore();
  const { activePet, unlockItem, toggleEquipItem, isTailoring } = useActivePetStore();

  const handlePurchase = async (itemId: string, cost: number) => {
    if (!user || !activePet) return;
    const success = await deductCoins(user.id, cost);
    if (!success) {
      console.error('Failed to deduct coins in DB');
      return;
    }
    await unlockItem(itemId);
  };

  const handleToggleEquip = async (itemId: string) => {
    await toggleEquipItem(itemId);
  };

  const renderRewardCard = (item: typeof REWARDS[0]) => {
    const isUnlocked = activePet?.unlocked_items?.includes(item.id) || false;
    const isEquipped = activePet?.equipped_items?.includes(item.id) || false;

    return (
      <RewardCard 
        key={item.id}
        item={item} 
        userCoins={pawCoins || 0} 
        isUnlocked={isUnlocked}
        isEquipped={isEquipped}
        onPurchase={handlePurchase} 
        onToggleEquip={handleToggleEquip}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#ffffff' }]}>
      <Header title="Wearables" showBack={false} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* LIVE FITTING ROOM MIRROR */}
        {activePet && (
          <View style={styles.fittingRoomContainer}>
            <View style={styles.fittingRoomFrame}>
              <Image
                source={{ uri: activePet.current_avatar_url || activePet.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=1000' }}
                style={styles.fittingRoomImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
              {isTailoring && (
                <View style={[StyleSheet.absoluteFill, styles.tailoringOverlay]}>
                  <ActivityIndicator size="large" color="#F7F602" />
                  <Typography variant="label" weight="bold" style={{ marginTop: 8, color: '#F7F602' }}>Tailoring...</Typography>
                </View>
              )}
            </View>
            <View style={styles.fittingRoomBadge}>
              <MaterialIcons name="auto-fix-high" size={16} color="#000" />
              <Typography variant="label" weight="bold" color="on-surface" size={12} style={{ marginLeft: 4 }}>LIVE PREVIEW</Typography>
            </View>
          </View>
        )}

        {/* TOP COMPACT VAULT (Since hero takes space) */}
        <View style={styles.compactVault}>
          <MaterialIcons name="toll" size={24} color="#fac129" />
          <Typography variant="headline" size={20} weight="bold" color="on-surface">
            {pawCoins.toLocaleString()} PawCoins
          </Typography>
        </View>

        {/* HERO NUDGE */}
        <View style={styles.heroSection}>
          <View style={styles.heroContent}>
            <Typography variant="headline" size={32} weight="bold" style={styles.heroTitle}>Want more coins?</Typography>
            <Typography variant="body" size={14} style={styles.heroSub}>Complete today&apos;s 5k walk to unlock a bonus 500 PawCoins</Typography>
            <TouchableOpacity style={styles.heroButton} activeOpacity={0.8}>
              <Text style={styles.heroButtonText}>Start journey</Text>
            </TouchableOpacity>
          </View>
          <MaterialIcons name="pets" size={120} color="rgba(255,255,255,0.4)" style={styles.heroIcon1} />
          <MaterialIcons name="toll" size={80} color="rgba(255,255,255,0.8)" style={styles.heroIcon2} />
        </View>

        {/* CATEGORIES */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          <TouchableOpacity style={[styles.categoryPill, styles.categoryPillActive]}><Text style={styles.categoryPillTextActive}>All Items</Text></TouchableOpacity>
          <TouchableOpacity style={styles.categoryPill}><Text style={styles.categoryPillText}>Bandanas</Text></TouchableOpacity>
          <TouchableOpacity style={styles.categoryPill}><Text style={styles.categoryPillText}>Hats</Text></TouchableOpacity>
          <TouchableOpacity style={styles.categoryPill}><Text style={styles.categoryPillText}>Backgrounds</Text></TouchableOpacity>
          <TouchableOpacity style={styles.categoryPill}><Text style={styles.categoryPillText}>Premium</Text></TouchableOpacity>
        </ScrollView>

        {/* BENTO GRID */}
        <View style={styles.bentoGrid}>
          {renderRewardCard(REWARDS[0])}
          <View style={styles.bentoRow}>
            {renderRewardCard(REWARDS[1])}
            {renderRewardCard(REWARDS[2])}
          </View>
          {renderRewardCard(REWARDS[3])}
          <View style={styles.bentoRow}>
            {renderRewardCard(REWARDS[4])}
            {renderRewardCard(REWARDS[5])}
          </View>
        </View>
        
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  
  compactVault: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: '#f8f8f8',
    marginHorizontal: 24,
    borderRadius: 24,
    marginBottom: 24,
  },
  
  // Fitting Room
  fittingRoomContainer: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 8,
  },
  fittingRoomFrame: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    backgroundColor: '#F8F9FA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  fittingRoomImage: {
    width: '100%',
    height: '100%',
  },
  tailoringOverlay: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  fittingRoomBadge: {
    position: 'absolute',
    bottom: -12,
    backgroundColor: '#F7F602',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#1A1A1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },

  // Hero Nudge
  heroSection: {
    marginHorizontal: 24,
    backgroundColor: '#F7F602',
    borderRadius: 24,
    padding: 24,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 24,
    shadowColor: '#F7F602',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
  heroContent: {
    zIndex: 10,
    width: '70%',
  },
  heroTitle: {
    fontFamily: 'Montserrat_800ExtraBold',
    letterSpacing: -1,
    lineHeight: 34,
    color: '#1A1A1A',
    marginBottom: 8,
  },
  heroSub: {
    color: '#1A1A1A',
    opacity: 0.8,
    marginBottom: 20,
    lineHeight: 20,
  },
  heroButton: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignSelf: 'flex-start',
  },
  heroButtonText: {
    color: '#FFF',
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 12,
    letterSpacing: 1,
  },
  heroIcon1: {
    position: 'absolute',
    right: -20,
    bottom: -20,
    transform: [{ rotate: '12deg' }],
  },
  heroIcon2: {
    position: 'absolute',
    right: 40,
    bottom: 20,
    transform: [{ rotate: '-12deg' }],
  },

  // Categories
  categoriesRow: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  categoryPill: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },
  categoryPillActive: {
    backgroundColor: '#F7F602',
  },
  categoryPillText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: '#5b5c5a',
  },
  categoryPillTextActive: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: '#1A1A1A',
  },

  // Bento Grid
  bentoGrid: {
    paddingHorizontal: 24,
    gap: 16,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  
  // Cards
  cardBase: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
    overflow: 'hidden',
  },
  
  // Large Type
  cardLarge: {
    flex: 1,
    padding: 20,
  },
  largeImageContainer: {
    flex: 1,
    backgroundColor: '#f8f8f8',
    borderRadius: 16,
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  largeImage: {
    width: '100%',
    height: '100%',
  },
  tagBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#fac129',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 10,
    color: '#553e00',
    letterSpacing: 1,
  },
  largeFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  buyPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // Medium Type (Horizontal)
  cardMedium: {
    flexDirection: 'row',
    padding: 16,
    gap: 16,
    alignItems: 'center',
  },
  mediumImageContainer: {
    width: 100,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#f8f8f8',
    overflow: 'hidden',
  },
  mediumImage: {
    width: '100%',
    height: '100%',
  },
  mediumInfo: {
    flex: 1,
    justifyContent: 'center',
  },

  // Small Type
  cardSmall: {
    flex: 1,
    padding: 16,
  },
  smallImageContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: '#f8f8f8',
    marginBottom: 12,
    overflow: 'hidden',
  },
  smallImage: {
    width: '100%',
    height: '100%',
  },
  smallBuyPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
});
