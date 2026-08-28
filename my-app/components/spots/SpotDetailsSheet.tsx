/**
 * SpotDetailsSheet — everything we actually know about one place, and nothing
 * we don't.
 *
 * This is the surface where the feature's integrity is decided. Every row here
 * is conditional on the underlying field being non-null: a place with no
 * opening hours shows no hours row rather than "Unknown" or, far worse, a
 * plausible-looking guess. The two claims that could genuinely harm someone —
 * "off-leash" and "emergency vet" — are rendered only from explicit source
 * tags, never inferred (see lib/spots/classify.ts).
 *
 * The accuracy note at the bottom is not boilerplate. OSM edits can be years
 * old and our own cache adds up to three days, so a vet that closed last month
 * really can still be on this sheet.
 *
 * ── On "Walk here", which replaced "Get directions" ──
 * There was a yellow CTA here that handed the place to Apple or Google Maps.
 * It is gone on purpose: the one thing Pawtchi wants an owner to do with a
 * place is *walk their dog to it*, and a button that ejects them into another
 * app is the opposite of that — it is also the tap that made Spots a directory
 * rather than part of the walking loop. "Walk here" starts a tracked walk with
 * this place pinned on the map. It does not navigate and never pretends to.
 */

import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, space } from '../../constants/design';
import { haptic } from '../../lib/haptics';
import {
  CATEGORY_LABEL,
  DOG_ACCESS_LABEL,
  copy,
  displayName,
  formatDistance,
  showsDogAccess,
} from '../../lib/spots/copy';
import type { PawtchiSpot } from '../../lib/spots/types';
import { CATEGORY_ICON, accessTone } from './spotVisuals';

interface SpotDetailsSheetProps {
  spot: PawtchiSpot | null;
  /**
   * How many of this dog's own walks came through here. 0 means never.
   *
   * The only line on this sheet that is about the dog rather than about the
   * place, and the only one no other map app can show — so it sits above the
   * crowd-sourced detail rather than among it.
   */
  visits?: number;
  /**
   * Start a tracked walk with this place marked on the map.
   *
   * The subscription gate and the navigation both live at the call site, with
   * every other walk-start in the app — a details sheet has no business knowing
   * what a paywall is.
   */
  onWalkHere?: (spot: PawtchiSpot) => void;
  onClose: () => void;
}

/** A row that renders only when it has something true to say. */
function DetailRow({ icon, text }: { icon: React.ReactNode; text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

export function SpotDetailsSheet({
  spot,
  visits = 0,
  onWalkHere,
  onClose,
}: SpotDetailsSheetProps) {
  const insets = useSafeAreaInsets();

  if (!spot) return null;

  const title = displayName(spot.name, spot.category);
  const distance = formatDistance(spot.distanceMeters);

  // Resolved once, at normalization. The sheet cannot re-derive these from
  // provider data even if someone wanted it to — which is the point.
  const { dogWaterConfirmed, emergencyCareConfirmed } = spot;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.grabber} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            <View style={styles.head}>
              <View style={styles.headIcon}>
                <MaterialCommunityIcons
                  name={CATEGORY_ICON[spot.category]}
                  size={20}
                  color={color.ink}
                />
              </View>
              <View style={styles.headText}>
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
                <Text style={styles.subtitle}>
                  {CATEGORY_LABEL[spot.category]}
                  {distance ? ` · ${distance}` : ''}
                </Text>
              </View>
            </View>

            {/* The claim, stated once, in the language classify.ts decided. */}
            <View style={styles.badges}>
              {showsDogAccess(spot.category) && (
                <View style={styles.badge}>
                  <View
                    style={[styles.badgeDot, { backgroundColor: accessTone(spot.dogAccess) }]}
                  />
                  <Text style={styles.badgeText}>{DOG_ACCESS_LABEL[spot.dogAccess]}</Text>
                </View>
              )}
              {dogWaterConfirmed && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{copy.dogWaterBadge}</Text>
                </View>
              )}
              {emergencyCareConfirmed && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{copy.emergencyVetBadge}</Text>
                </View>
              )}
            </View>

            {/* The dog's own history with this place, from its own traces.
                Above the source data because it is the only thing on this
                sheet we can actually vouch for. */}
            {visits > 0 && (
              <View style={styles.visited}>
                <MaterialCommunityIcons name="paw" size={15} color={color.navy} />
                <Text style={styles.visitedText}>
                  {visits === 1
                    ? copy.details.visitedOnce
                    : copy.details.visitedTimes(visits)}
                </Text>
              </View>
            )}

            {/* Free text from the source, when there was any worth showing. It
                supplements the badge above and never replaces it. */}
            {!!spot.accessDescription && (
              <Text style={styles.note}>{spot.accessDescription}</Text>
            )}

            <View style={styles.rows}>
              <DetailRow
                icon={<MaterialIcons name="place" size={16} color={color.slateMuted} />}
                text={spot.address}
              />
              <DetailRow
                icon={<MaterialIcons name="schedule" size={16} color={color.slateMuted} />}
                // Says so plainly rather than implying the place is open.
                text={spot.openingHours ?? copy.details.hoursUnavailable}
              />
              <DetailRow
                icon={
                  <MaterialCommunityIcons name="fence" size={16} color={color.slateMuted} />
                }
                text={
                  spot.fenced === null
                    ? null
                    : spot.fenced
                      ? copy.details.fenced
                      : copy.details.notFenced
                }
              />
              <DetailRow
                icon={
                  <MaterialIcons name="lightbulb-outline" size={16} color={color.slateMuted} />
                }
                text={spot.lit === null ? null : spot.lit ? copy.details.lit : copy.details.notLit}
              />
              <DetailRow
                icon={<MaterialIcons name="terrain" size={16} color={color.slateMuted} />}
                text={spot.surface}
              />
              <DetailRow
                icon={<MaterialIcons name="call" size={16} color={color.slateMuted} />}
                text={spot.phone}
              />
              <DetailRow
                icon={<MaterialIcons name="language" size={16} color={color.slateMuted} />}
                text={spot.website}
              />
            </View>

            {/* The one action. Yellow, because on this surface it is the thing
                that matters — everything above it is information. */}
            {!!onWalkHere && (
              <TouchableOpacity
                style={styles.cta}
                activeOpacity={0.9}
                onPress={() => {
                  haptic.tap();
                  onWalkHere(spot);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${copy.actions.walkHere}: ${title}`}
              >
                <MaterialCommunityIcons name="paw" size={18} color={color.navy} />
                <Text style={styles.ctaText}>{copy.actions.walkHere}</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.disclaimer}>{copy.details.accuracyNote}</Text>
            <Text style={styles.source}>{copy.details.source}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.sm,
    maxHeight: '82%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairline,
    marginBottom: space.md,
  },
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 18,
    color: color.ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.slateMuted,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  badgeText: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.ink,
  },
  visited: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.yellowSoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  visitedText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.navy,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.slate,
    lineHeight: 19,
  },
  rows: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  rowIcon: {
    width: 20,
    alignItems: 'center',
    paddingTop: 1,
  },
  rowText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.slate,
    lineHeight: 19,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 15,
    marginTop: space.xs,
  },
  ctaText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
  },
  disclaimer: {
    marginTop: space.xs,
    fontFamily: font.regular,
    fontSize: 11.5,
    color: color.slateMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  source: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.slateFaint,
    textAlign: 'center',
  },
});
