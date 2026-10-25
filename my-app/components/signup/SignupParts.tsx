/**
 * The small pieces sign-up v2 is made of: the heading with its yellow end
 * mark, the dog card that fills in as answers arrive, and the two kinds of
 * choice (chips for lists, tiles for a binary that moves on by itself).
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { color, font, motion, radius, signupType, space } from '../../constants/design';
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
            <Animated.View key={tag} entering={ZoomIn.springify().damping(14)} style={styles.tag}>
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
    onPressIn: () => { scale.value = withSpring(motion.scale.chip, motion.spring.press); },
    onPressOut: () => { scale.value = withSpring(1, motion.spring.press); },
  };
}

export function SignupChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePress();
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.chip, selected && styles.chipSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function SignupTile({
  label,
  selected,
  onPress,
}: {
  label: string;
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
      >
        <Text style={[styles.tileText, selected && styles.chipTextSelected]}>{label}</Text>
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
  chipText: { fontFamily: font.semibold, fontSize: 13, color: color.navy },
  chipTextSelected: { color: color.yellow },
  tileWrap: { flex: 1 },
  tile: {
    borderWidth: 1.5,
    borderColor: color.hairline,
    borderRadius: radius.lg + 2,
    paddingVertical: 18,
    paddingHorizontal: 14,
    backgroundColor: color.surface,
    minHeight: 76,
    justifyContent: 'flex-end',
  },
  tileText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
});
