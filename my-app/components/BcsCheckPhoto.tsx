import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { color, radius } from '../constants/design';
import type { BcsCheckQuestionId } from '../lib/bcsCheck';

// Static require map — Metro needs literal paths, so no template strings.
// Lifestyle photos, not diagrams: each shows a real owner doing the exact
// check on a real pet, per the locked Pawtchi visual direction. One animal,
// one room, one light per species so the four steps read as one session.
const PHOTOS: Record<'dog' | 'cat', Record<BcsCheckQuestionId, number>> = {
  dog: {
    rib: require('../assets/bcs-check/dog-rib.webp'),
    waist: require('../assets/bcs-check/dog-waist.webp'),
    tuck: require('../assets/bcs-check/dog-tuck.webp'),
    pad: require('../assets/bcs-check/dog-pad.webp'),
  },
  cat: {
    rib: require('../assets/bcs-check/cat-rib.webp'),
    waist: require('../assets/bcs-check/cat-waist.webp'),
    tuck: require('../assets/bcs-check/cat-tuck.webp'),
    pad: require('../assets/bcs-check/cat-pad.webp'),
  },
};

interface Props {
  id: BcsCheckQuestionId;
  species: 'dog' | 'cat';
}

/**
 * Guide photo for a hands-on check question. Fixed 3:2 frame so the card
 * height never jumps between question steps — the 4:3 sources center-crop
 * slightly under `cover`, which is safe because every subject is centered.
 */
export function BcsCheckPhoto({ id, species }: Props) {
  return (
    <View style={styles.frame}>
      <Image
        source={PHOTOS[species][id]}
        style={styles.photo}
        contentFit="cover"
        transition={180}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 3 / 2,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
    backgroundColor: color.surfaceSubtle,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
});
