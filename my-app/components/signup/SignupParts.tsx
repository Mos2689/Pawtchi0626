/**
 * The small pieces sign-up v2 is made of: the heading with its yellow end
 * mark, the dog card that fills in as answers arrive, and the two kinds of
 * choice (chips for lists, tiles for a binary that moves on by itself).
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { color, font, radius, signupType, space } from '../../constants/design';
import { PRESS_SCALE, PRESS_TIMING, settleIn } from './signupMotion';
import { fillCopy, type Heading } from '../../lib/signup/copy';
import { dogNameOrFallback } from '../../lib/signup/signupFlow';

export function SignupHeading({
  heading,
  name,
  compact = false,
}: {
  heading: Heading;
  name: string;
  compact?: boolean;
}) {
  return (
    <Text
      style={[styles.heading, compact && styles.headingCompact]}
      accessibilityRole="header"
    >
      {fillCopy(heading.title, { name: dogNameOrFallback(name) })}
      <Text style={styles.headingEnd}>{heading.end}</Text>
    </Text>
  );
}

/**
 * The dog as described so far. Empty until there is a name; each answer then
 * lands on it — the photo in the avatar, the rest as tags that pop in.
 */
export function DogCard({ name, imageUri, tags }: { name: string; imageUri: string | null; tags: string[] }) {
  return (
    <View style={styles.card} accessible accessibilityLabel={[name, ...tags].filter(Boolean).join(', ')}>
      <View style={[styles.avatar, imageUri ? styles.avatarFilled : null]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.avatarImg} />
        ) : (
          <MaterialCommunityIcons name="paw" size={18} color={color.slateFaint} />
        )}
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardName} numberOfLines={1}>
          {name.trim()}
        </Text>
        <View style={styles.tags}>
          {tags.map(tag => (
            <Animated.View key={tag} entering={settleIn()} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </Animated.View>
          ))}
        </View>
      </View>
    </View>
  );
}

function usePress() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => { scale.value = withTiming(PRESS_SCALE, PRESS_TIMING); },
    onPressOut: () => { scale.value = withTiming(1, PRESS_TIMING); },
  };
}

export function SignupChip({
  label,
  selected = false,
  onPress,
  more = false,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** A "see the rest" chip: quiet fill and a chevron, never selected. */
  more?: boolean;
}) {
  const press = usePress();
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.chip, more && styles.chipMore, selected && styles.chipSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <View style={styles.chipRow}>
          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
          {more && <MaterialCommunityIcons name="chevron-right" size={16} color={color.navy} />}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A two-way answer as a proper card: an icon in a soft circle, the answer,
 * and a short caption, with a tick once chosen. Both tiles in a pair share a
 * height so the row reads as one decision, not two stray boxes.
 */
export function SignupTile({
  label,
  caption,
  icon,
  selected,
  onPress,
}: {
  label: string;
  caption: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePress();
  return (
    <Animated.View style={[styles.tileWrap, press.style]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.tile, selected && styles.chipSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label}. ${caption}`}
      >
        <View style={styles.tileTop}>
          <View style={[styles.tileIcon, selected && styles.tileIconSelected]}>
            <MaterialCommunityIcons name={icon} size={22} color={color.navy} />
          </View>
          {selected && (
            <Animated.View entering={settleIn()} style={styles.tileCheck}>
              <MaterialCommunityIcons name="check" size={14} color={color.navy} />
            </Animated.View>
          )}
        </View>
        <Text style={[styles.tileText, selected && styles.chipTextSelected]}>{label}</Text>
        <Text style={[styles.tileCaption, selected && styles.tileCaptionSelected]}>{caption}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heading: { ...signupType.heading, color: color.navy },
  headingCompact: { ...signupType.headingCompact },
  headingEnd: { color: color.yellow },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarFilled: { backgroundColor: color.yellow },
  avatarImg: { width: 40, height: 40 },
  cardText: { flex: 1, minWidth: 0 },
  cardName: { fontFamily: font.memoryBold, fontSize: 15, letterSpacing: -0.3, color: color.navy },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 3 },
  tag: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: color.cream,
  },
  tagText: { fontFamily: font.semibold, fontSize: 11, color: color.navy },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: color.hairline,
    backgroundColor: color.surface,
  },
  chipSelected: { backgroundColor: color.navy, borderColor: color.navy },
  chipMore: { backgroundColor: color.cream, borderColor: color.cream, paddingRight: 10 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  chipText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  chipTextSelected: { color: color.yellow },
  tileWrap: { flex: 1 },
  tile: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: color.hairline,
    borderRadius: radius.xl,
    padding: space.lg,
    backgroundColor: color.surface,
    minHeight: 152,
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.lg },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconSelected: { backgroundColor: color.yellow },
  tileCheck: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { fontFamily: font.bold, fontSize: 15, lineHeight: 20, color: color.navy },
  tileCaption: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: color.slateMuted, marginTop: 4 },
  tileCaptionSelected: { color: color.creamDim },
});
