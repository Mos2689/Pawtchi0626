/**
 * The visual vocabulary for spots — icon and pin tone per category.
 *
 * Separate from lib/spots/copy.ts because these are rendering decisions that
 * import from @expo/vector-icons and the design tokens, and lib/spots is pure
 * logic under ts-jest where react-native is a stub.
 *
 * ── On colour ──
 * Spot pins use the same `color.marker` pastels as walk pins, but assigned by
 * CATEGORY rather than round-robin. That is the one place spots differ from
 * sniffs: sniff stops have no taxonomy, so colouring them by meaning would
 * imply a distinction the data does not make. Categories genuinely differ, so
 * here the colour earns its keep.
 *
 * `ink` stays reserved for the selected pin on both. Yellow never appears on a
 * pin at all — it marks the one action per surface, and a map full of yellow
 * dots would spend that budget on decoration.
 */

import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { color } from '../../constants/design';
import type { WalkMapSpotTone } from '../../lib/walk/mapSpot';
import type { SpotCategory } from '../../lib/spots/types';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Icons chosen to be legible at 12px inside a pin, which rules out most of the
 * literal options — a veterinary cross reads at that size, a stethoscope does
 * not.
 */
export const CATEGORY_ICON: Record<SpotCategory, IconName> = {
  off_leash_park: 'dog-side',
  dog_friendly_park: 'tree',
  dog_friendly_beach: 'beach',
  walking_trail: 'hiking',
  veterinary: 'medical-bag',
  pet_store: 'storefront-outline',
  drinking_water: 'water',
};

/**
 * Pin tone per category. Only four pastels exist, so categories share:
 * green things (parks, beaches, trails) take mint, care (vets) takes pink,
 * commerce takes butter, water takes sky. Off-leash parks take sky as the
 * odd one out so the category owners most care about is visually distinct
 * from the generic parks around it.
 */
export const CATEGORY_TONE: Record<SpotCategory, WalkMapSpotTone> = {
  off_leash_park: 'sky',
  dog_friendly_park: 'mint',
  dog_friendly_beach: 'mint',
  walking_trail: 'mint',
  veterinary: 'pink',
  pet_store: 'butter',
  drinking_water: 'sky',
};

/**
 * Colour for the dog-access badge.
 *
 * `unknown` gets muted slate rather than an amber warning tone. An unconfirmed
 * dog policy is the ordinary case for most parks on earth, not a hazard, and
 * painting the majority of results in a caution colour would train people to
 * ignore it — which is exactly when it would matter.
 */
export function accessTone(status: string): string {
  switch (status) {
    case 'off_leash':
      return color.success;
    case 'on_leash':
    case 'dog_friendly':
      return color.slate;
    default:
      return color.slateFaint;
  }
}
