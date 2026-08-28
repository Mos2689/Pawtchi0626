/**
 * The Profile tab's glyph — the dog's own face, not a generic person.
 *
 * Every other tab in the pill is an Ionicon, and this deliberately is not. The
 * profile someone opens is their dog's, so showing the dog is both more
 * accurate and the fastest thing to find in a row of line drawings — the same
 * reason Instagram puts your avatar there rather than a silhouette.
 *
 * It reads its own pet from the store rather than taking a prop, so
 * (tabs)/_layout.tsx can keep declaring `tabBarIcon` as a pure render function
 * with no extra wiring.
 *
 * ── Why the active state is a ring, not a fill ──
 * The other four tabs switch outline → filled when selected. A photograph
 * cannot do that, so this uses a ring instead. Without it the Profile tab would
 * be the one tab in the bar with no selected state at all.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { color } from '../../constants/design';
import { resolvePetImage } from '../../lib/petFallbackImage';
import { useActivePetStore } from '../../store/useActivePetStore';

interface ProfileTabIconProps {
  focused: boolean;
  /** Matched to the Ionicons around it so the row stays optically even. */
  size?: number;
}

export function ProfileTabIcon({ focused, size = 22 }: ProfileTabIconProps) {
  const activePet = useActivePetStore(s => s.activePet);

  // Same resolution order Home's avatar uses: a freshly-cropped avatar wins,
  // then the profile photo, then the species fallback illustration.
  const uri =
    activePet?.current_avatar_url ||
    resolvePetImage(activePet?.image_url, activePet?.species, 100);

  // A hair larger than a glyph: a photo at exactly 22 reads as a smudge next to
  // line icons, which carry their weight in stroke rather than in area.
  const outer = size + 2;

  return (
    <View
      style={[
        styles.ring,
        { width: outer, height: outer, borderRadius: outer / 2 },
        focused && styles.ringActive,
      ]}
    >
      <Image
        source={{ uri }}
        style={styles.image}
        contentFit="cover"
        // Cached and decoded once; this mounts on every tab, on every screen.
        cachePolicy="memory-disk"
        transition={120}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 2,
    // Transparent rather than absent, so selecting a tab does not resize the
    // avatar and nudge the label under it.
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: color.surfaceSubtle,
  },
  ringActive: {
    borderColor: color.ink,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
