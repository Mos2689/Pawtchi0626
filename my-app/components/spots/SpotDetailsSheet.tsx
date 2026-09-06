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
 * this place pinned on the map.
 *
 * ── The compass line and the maps link (Aug 2026) ──
 * Two things were added without disturbing that. A bearing and a rough time at
 * this dog's pace sit under the name, because "1.7 km" never answered which way
 * to set off. And `directions.ts` came back off the shelf as a plain text link
 * under the CTA, for the owner who is actually lost rather than merely curious.
 *
 * The hierarchy is what carries the original decision: one filled yellow button,
 * and everything else quieter than it. A link is an exit for someone who needs
 * one; a button is a recommendation.
 *
 * ── The preview state, and why "Walk here" became "Start" ──
 * "Walk here" was a single tap with no middle. The walk began, the timer ran,
 * and the route line caught up afterwards — so the owner was committed before
 * they had seen where they were going, and the first seconds of a walk were
 * spent reading a screen instead of looking at the dog.
 *
 * Now opening a place draws the way there on the map behind this sheet and puts
 * the real routed distance and a dog-paced time at the top. Nothing has started.
 * The sheet is shorter and the scrim lighter than they were, because the map is
 * now part of the answer rather than something to dim. The word is "Start"
 * because by then it means exactly one thing.
 *
 * ── Two kinds of place ──
 * A park is somewhere you take the dog; a vet is somewhere you have to get to.
 * `spotAction.ts` decides which is which, and this sheet renders accordingly:
 * a park gets the route preview and Start, a vet gets a filled "Get directions"
 * that hands off to Apple or Google Maps.
 *
 * That last part reverses the original decision above ON PURPOSE, and only for
 * errands. Pawtchi has no traffic, no opening hours and no turn-by-turn; for
 * someone trying to reach a vet, offering the worse tool to keep them in-app is
 * how a walking app loses the trust it earned. The directory risk the header
 * describes was about parks — and for parks, nothing has changed.
 *
 * ── Two kinds of OWNER (Sep 2026) ──
 * And then it changed, because the sheet had been reading the wrong variable.
 * Every decision above is about the PLACE. But two owners can open the same
 * beach with completely different journeys in mind: one sets off from the front
 * door with the lead in their hand, the other loads the dog into the car and
 * drives twenty minutes. The first is the only one this sheet was built for.
 *
 * The second was being served by an underlined grey link at the bottom, which
 * is what you offer someone whose need you have decided is marginal. It is not
 * marginal — for a beach an hour away it is the ONLY way the walk happens.
 *
 * So "Start" became "Walk", "Open in Maps" became "Get directions", and the two
 * sit side by side at equal width. The hierarchy still exists and still says the
 * same thing — Walk is filled in yellow, Get directions is outlined — but the
 * difference is now a recommendation between two real options rather than a
 * button and an apology.
 *
 * What makes this safe, and what the old header was right to worry about: the
 * maps handoff is no longer an exit. Tapping it writes an arrival note
 * (lib/spots/arrivalIntent.ts), and when the owner reopens Pawtchi standing at
 * that beach, Home offers to start the walk. Both buttons now lead to a tracked
 * walk. Only one of them goes via a car.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Modal,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, shadow, space } from '../../constants/design';
import { BrandLasso } from '../BrandLasso';
import { haptic } from '../../lib/haptics';
import {
  CATEGORY_LABEL,
  DOG_ACCESS_LABEL,
  copy,
  displayName,
  formatDistance,
  showsDogAccess,
} from '../../lib/spots/copy';
import { directionsFallbackUrl, directionsUrl } from '../../lib/spots/directions';
import { isWalkToSpot } from '../../lib/spots/spotAction';
import type { PawtchiSpot } from '../../lib/spots/types';
import { arrivalAt, type WayDescription } from '../../lib/walk/wayfinding';
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
   * Navigation lives at the call site with every other walk-start in the app.
   * The details sheet has no subscription concept because tracking is free.
   */
  onWalkHere?: (spot: PawtchiSpot) => void;
  /**
   * The owner is driving there instead.
   *
   * Fired alongside the maps handoff, never in place of it: this sheet still
   * owns opening the URL, because the link has to work whether or not anyone is
   * listening. What the call site does with the notice is arm the arrival
   * prompt, which is the half of this journey that happens outside the sheet.
   *
   * Only ever called for a walkable place. A vet is not a walk with a car in
   * front of it, and nothing should be waiting for the owner when they get there.
   */
  onDirections?: (spot: PawtchiSpot) => void;
  /**
   * Which way the place is, and roughly how long at this dog's pace.
   *
   * Resolved at the call site rather than here, for the same reason `visits` is:
   * the bearing must be measured from the OWNER's position, and only the screen
   * that owns the map knows the difference between where the owner is and where
   * the map happens to be pointing. Null whenever that distinction cannot be
   * made — a heading measured from a suburb someone is merely looking at would
   * point confidently at nothing.
   */
  way?: WayDescription | null;
  /** For the pace line. Omitted, and the line simply says "at a walking pace". */
  petName?: string | null;
  /**
   * How far it actually is along the drawn route, in metres.
   *
   * Null until the preview resolves, and null forever for a maps handoff. Worth
   * distinguishing from `spot.distanceMeters`, which is a straight line and
   * always shorter than the walk — a river or a fenced reserve can put half a
   * kilometre between the two.
   */
  routeDistanceM?: number | null;
  /** Drives the preview block's loading and unavailable states. */
  routeStatus?: 'idle' | 'loading' | 'ready' | 'unavailable';
  /**
   * How tall this sheet actually is, so the map can frame the route in what is
   * left of the screen.
   *
   * Reported rather than agreed. The previous arrangement had the sheet cap
   * itself at a fraction and the map inset its camera by the same fraction
   * written out a second time in another file — two constants describing one
   * rectangle, which drifted apart the moment the sheet's content changed. A
   * sheet with an address and opening hours is a different height from a beach
   * with neither, and only the sheet has ever known which.
   */
  onHeightChange?: (height: number) => void;
  onClose: () => void;
}

/** Matches the endpoint chips, so the lasso runs along their centreline. */
const LASSO_HEIGHT = 26;

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
  onDirections,
  way = null,
  petName = null,
  routeDistanceM = null,
  routeStatus = 'idle',
  onHeightChange,
  onClose,
}: SpotDetailsSheetProps) {
  const insets = useSafeAreaInsets();

  /**
   * Report the measured height, but only when it has meaningfully moved.
   *
   * onLayout fires for sub-pixel changes and for re-layouts that settle on the
   * same size. Forwarding every one of them would push a new camera inset into
   * the map on each, and the map re-frames when its inset changes — a loop that
   * shows up as a quietly twitching route rather than as an error.
   */
  const lastReportedHeight = useRef(0);
  const onSheetLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height;
      if (Math.abs(next - lastReportedHeight.current) < 4) return;
      lastReportedHeight.current = next;
      onHeightChange?.(next);
    },
    [onHeightChange],
  );

  /**
   * How much room is left between the two ends, so the lasso can be drawn at
   * real pixel width rather than stretched to fit.
   *
   * Rounded and compared before setting: the gap re-measures whenever the
   * destination label reflows, and a state write on every sub-pixel settle
   * would re-render the sheet mid-layout.
   */
  const [trailWidth, setTrailWidth] = useState(0);
  const onTrailLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setTrailWidth((prev) => (prev === next ? prev : next));
  }, []);

  if (!spot) return null;

  const title = displayName(spot.name, spot.category);
  // Prefer the routed distance once it lands: it is the distance actually
  // walked, and the straight line under it was only ever a stand-in.
  const distance = formatDistance(routeDistanceM ?? spot.distanceMeters);
  const walkable = isWalkToSpot(spot.category);

  /**
   * "7:36" — when you would get there.
   *
   * The device's own locale decides 24h against am/pm, which is why the
   * formatting lives here and `arrivalAt` only does the arithmetic. Absent
   * whenever there is no estimate to project from, rather than showing a
   * clock time that means "now".
   */
  const arrivalLabel = way?.etaMinutes
    ? arrivalAt(new Date(), way.etaMinutes).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  // "North-east · about 30 min at Bruno's pace". A heading, not a route — the
  // map behind this sheet carries the rest, and nothing here claims to know
  // which streets to take.
  const wayLine = way
    ? `${way.direction[0].toUpperCase()}${way.direction.slice(1)}${
        way.eta ? ` · ${way.eta} at ${petName ? `${petName}’s` : 'a walking'} pace` : ''
      }`
    : null;

  const openInMaps = () => {
    haptic.tap();
    // The notice goes out BEFORE the handoff, and is not awaited. `openURL`
    // backgrounds this app immediately on both platforms; anything queued after
    // it runs in a process that is already on its way out, and on a cold return
    // would never have run at all. Arming first costs nothing if the URL then
    // fails — a note for a place the owner never drove to simply expires.
    if (walkable) onDirections?.(spot);
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    // `maps://` and `geo:` have no handler on a device with no map app at all —
    // rare but real. The OSM web fallback always opens, so the link never
    // silently does nothing.
    Linking.openURL(directionsUrl(spot, platform)).catch(() => {
      Linking.openURL(directionsFallbackUrl(spot)).catch(() => {});
    });
  };

  // Resolved once, at normalization. The sheet cannot re-derive these from
  // provider data even if someone wanted it to — which is the point.
  const { dogWaterConfirmed, emergencyCareConfirmed } = spot;

  /**
   * Does any section below have something to say?
   *
   * Both wrappers carry a `gap`, and the body they sit in carries another, so
   * an empty one is not free — it is a visible hole exactly where the content
   * an owner expected would have been. Now that the sheet only speaks when it
   * knows something, most places leave at least one of these empty.
   */
  const hasBadges =
    (showsDogAccess(spot.category) && spot.dogAccess !== 'unknown') ||
    dogWaterConfirmed ||
    emergencyCareConfirmed;

  const hasRows = Boolean(
    spot.address ||
      spot.openingHours ||
      spot.fenced !== null ||
      spot.lit !== null ||
      spot.surface ||
      spot.phone ||
      spot.website,
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* On a walkable place the map behind is part of the answer — the route
          is drawn up there — so the scrim lifts and the sheet gives back the
          top half of the screen. An errand has no route to look at, so it keeps
          the original framing. */}
      <View style={[styles.overlay, walkable && styles.overlayPreview]}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        {/* The bottom inset is paid ONCE, here.
            `body` used to add its own paddingBottom on top of this, so every
            sheet ended in the home indicator's clearance twice over — the band
            of empty white under the attribution line. */}
        <View
          onLayout={onSheetLayout}
          style={[
            styles.sheet,
            walkable && styles.sheetPreview,
            { paddingBottom: insets.bottom + space.sm },
          ]}
        >
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
                  {/* The distance belongs to the preview block on a walkable
                      place, where it sits beside the time it explains. Saying
                      it twice, four lines apart, made the header look like a
                      summary of a summary. */}
                  {!walkable && distance ? ` · ${distance}` : ''}
                </Text>
              </View>

              {/* A deliberate target for dismissing, next to the thing being
                  dismissed. Swiping the sheet and tapping the scrim both still
                  work; neither is discoverable, and the scrim is now light
                  enough on a walkable place that it barely reads as a surface
                  to tap at all. */}
              <TouchableOpacity
                style={styles.close}
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={copy.actions.close}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="close" size={19} color={color.slateMuted} />
              </TouchableOpacity>
            </View>

            {/* ── Where from, where to ──
                The pair every directions card opens with, and the reason it
                works: the route on the map is a shape, and this says what the
                two ends of it are.

                Laid across rather than down. Stacked, the two rows were a list
                of two places and the reader had to supply the arrow themselves;
                a journey has a left end and a right end, and the lasso between
                them is the same line drawn on the map above and in every
                campaign. It says "from here, to there" in one look instead of
                two, in the brand's own mark rather than in a generic rule.

                The left end is the constant and stays quiet; the destination
                carries the weight, because it is the only half the owner
                actually chose. */}
            {walkable && (
              <View style={styles.group}>
                <View
                  style={styles.endpoints}
                  accessible
                  accessibilityLabel={`${copy.preview.fromHere} to ${title}`}
                >
                  <View style={styles.endpoint}>
                    <View style={styles.endpointIcon}>
                      <MaterialCommunityIcons
                        name="navigation-variant"
                        size={15}
                        color={color.electric}
                      />
                    </View>
                    <Text style={styles.endpointFromText} numberOfLines={1}>
                      {copy.preview.fromHere}
                    </Text>
                  </View>

                  {/* The brand's own line, the same one drawn on the map above
                      and on every campaign: a walk is not a straight rule
                      between two pins.

                      Decorative — the grouped label already says the whole
                      sentence, and a screen reader has no use for a squiggle. */}
                  <View
                    style={styles.trail}
                    onLayout={onTrailLayout}
                    importantForAccessibility="no-hide-descendants"
                  >
                    <BrandLasso width={trailWidth} height={LASSO_HEIGHT} />
                  </View>

                  <View style={[styles.endpoint, styles.endpointTo]}>
                    <View style={styles.endpointIcon}>
                      <MaterialCommunityIcons
                        name="map-marker"
                        size={15}
                        color={color.navy}
                      />
                    </View>
                    <Text style={styles.endpointToText} numberOfLines={1}>
                      {title}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* ── The decision ──
                The numbers, on their own, above both buttons.

                The Walk pill used to sit inside this card, beside the time, so
                that "twenty minutes" and "go" read as one statement. That was
                right while there was one button. It stopped being right the
                moment there were two: a pill in the card and a button under it
                would have ranked the choice before the owner made it, and the
                card would have looked like it belonged to only one of them.

                It belongs to both — the walking time is the reason to walk, and
                the reason someone with an hour's drive decides not to. */}
            {walkable && (
              <View style={styles.summary}>
                {routeStatus === 'loading' && !way ? (
                  <Text style={styles.previewFinding}>{copy.preview.finding}</Text>
                ) : (
                  <>
                    <Text style={styles.previewEta}>
                      {way?.eta ? way.eta : distance ?? ''}
                    </Text>
                    <Text style={styles.previewMeta}>
                      {[arrivalLabel, way?.eta && distance ? distance : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    <Text style={styles.previewMetaFaint}>
                      {copy.preview.atPace(petName)}
                    </Text>
                    {routeStatus === 'unavailable' && (
                      <Text style={styles.previewNote}>{copy.preview.unavailable}</Text>
                    )}
                  </>
                )}
              </View>
            )}

            {/* ── The two ways to arrive ──
                Equal width, equal height, equal weight in the layout. The only
                thing separating them is the fill, which is the whole of the
                recommendation: Pawtchi would rather you walked, and will not
                pretend that is always possible.

                `Walk` renders only when the call site can start one; the row
                collapses to a single full-width Get directions rather than
                leaving a gap where a button was. */}
            {walkable && (
              <View style={styles.actions}>
                {!!onWalkHere && (
                  <TouchableOpacity
                    style={[styles.action, styles.actionWalk]}
                    activeOpacity={0.9}
                    onPress={() => {
                      haptic.tap();
                      onWalkHere(spot);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${copy.actions.startWalk}: ${title}`}
                  >
                    <MaterialCommunityIcons name="paw" size={17} color={color.navy} />
                    <Text style={styles.actionWalkText}>{copy.actions.startWalk}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.action, styles.actionDirections]}
                  activeOpacity={0.85}
                  onPress={openInMaps}
                  accessibilityRole="button"
                  accessibilityLabel={`${copy.actions.getDirections}: ${title}`}
                >
                  <MaterialIcons name="directions" size={17} color={color.navy} />
                  <Text style={styles.actionDirectionsText}>
                    {copy.actions.getDirections}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* On an errand the compass line stays as it was — quiet, under the
                name. There is no route drawn behind this sheet to promote. */}
            {!walkable && !!wayLine && (
              <View style={styles.way}>
                <MaterialCommunityIcons name="compass-outline" size={15} color={color.navy} />
                <Text style={styles.wayText}>{wayLine}</Text>
              </View>
            )}

            {/* The claim, stated once, in the language classify.ts decided.

                Only when there IS one. `unknown` is the commonest state by far —
                most parks on earth carry no dog tag — so badging it put "Dog
                access not confirmed" on nearly every sheet, where it read as a
                warning about this particular place rather than as the absence of
                data it actually is. A line that appears almost always carries
                almost nothing.

                The uncertainty is not dropped, only moved: the accuracy note at
                the foot says to check local signage, which is the same guidance
                and the honest place for it.

                The wrapper is conditional too. An empty row still consumes the
                body's gap, so a sheet with nothing to badge would keep the hole
                where the badges used to be. */}
            {hasBadges && (
            <View style={styles.badges}>
              {showsDogAccess(spot.category) && spot.dogAccess !== 'unknown' && (
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
            )}

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

            {hasRows && (
            <View style={styles.rows}>
              <DetailRow
                icon={<MaterialIcons name="place" size={16} color={color.slateMuted} />}
                text={spot.address}
              />
              {/* Hours when there are hours, and silence otherwise — which is
                  what this file's header always said it did. Rendering
                  "Opening hours unavailable" was the contradiction: a row whose
                  entire content is the admission that the row has no content,
                  shown on a beach that has never had opening hours to begin
                  with. DetailRow already renders nothing for a null. */}
              <DetailRow
                icon={<MaterialIcons name="schedule" size={16} color={color.slateMuted} />}
                text={spot.openingHours}
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
            )}

            {/* The underlined "Open in Maps" link that used to sit here has
                moved up into the button row, as an equal. See the header. */}

            {/* ── An errand ──
                One button, and it leaves. No tracked walk is offered for a vet
                or a pet shop: see the header, and spotAction.ts. */}
            {!walkable && (
              <TouchableOpacity
                style={styles.cta}
                activeOpacity={0.9}
                onPress={openInMaps}
                accessibilityRole="button"
                accessibilityLabel={`${copy.actions.getDirections}: ${title}`}
              >
                <MaterialIcons name="directions" size={18} color={color.navy} />
                <Text style={styles.ctaText}>{copy.actions.getDirections}</Text>
              </TouchableOpacity>
            )}

            {/* The OpenStreetMap credit used to sit here as a second line.
                It has moved to the map's own attribution chip rather than being
                deleted — ODbL is not a style choice, and the sheet is the
                densest display of OSM-derived data in the app.

                Moving it is a net gain for the licence as well as the layout:
                the chip is a tappable link to the copyright page, where this
                was flat text nobody could follow. Home lifts it clear of this
                sheet so it stays visible while a place is open. */}
            <Text style={styles.disclaimer}>{copy.details.accuracyNote}</Text>
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
  /** Enough to lift the sheet off the map, not enough to hide the route. */
  overlayPreview: {
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.sm,
    maxHeight: '82%',
  },
  /**
   * A ceiling, not a height.
   *
   * The sheet hugs its content — a beach with no address and no hours is short,
   * and should look it. This only stops a place with every field populated from
   * swallowing the route it is meant to be describing. The map learns the real
   * height from `onHeightChange` rather than assuming this number.
   */
  sheetPreview: {
    maxHeight: '62%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hairline,
    marginBottom: space.sm,
  },
  /**
   * No paddingBottom: the sheet owns the bottom inset, and adding one here was
   * how the dead band under the footer got there.
   *
   * The gap is `sm` rather than `md` because the sections are grouped cards
   * now. Filled cards already read as separate at 8pt; the 12pt gap was tuned
   * for loose rows that needed the air to be told apart, and kept afterwards
   * out of habit.
   */
  body: {
    paddingHorizontal: space.lg,
    gap: space.sm,
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
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: color.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
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
  /**
   * The decision block, and the only thing on this sheet competing with the
   * button.
   *
   * No container fill. The card it used to sit in made it one panel among
   * several on a sheet that already had too many; letting the type carry the
   * weight instead is what puts the time at the top of the hierarchy rather
   * than merely inside a box near the top.
   */
  /**
   * The grouped inset card the whole sheet is built from.
   *
   * One shape, repeated: endpoints, then the decision, then what we know about
   * the place. Grouping is what lets three sections read as three answers
   * rather than as nine loose lines, which is the entire reason a directions
   * card feels calm while a list of facts does not.
   */
  group: {
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  endpoints: {
    flexDirection: 'row',
    // The two ends align on their icons, not on their labels: the labels are
    // different lengths and one of them can wrap to the ellipsis, so anything
    // measured from the text moves the trail off the chips it connects.
    alignItems: 'flex-start',
  },
  /**
   * The origin end.
   *
   * `flexShrink: 0` — its label is a constant short string, so there is nothing
   * to gain by squeezing it, and everything to lose: truncating "Your location"
   * to make room for a long place name would shorten the half the owner cannot
   * change in order to shorten the half they can read on the map anyway.
   */
  endpoint: {
    flexShrink: 0,
    alignItems: 'flex-start',
    gap: 6,
  },
  /**
   * The destination end, right-aligned so the pair reads as two edges.
   *
   * Uncapped and shrinkable: a long name takes the trail's slack first — the
   * trail bottoms out at 24pt and is still legibly a line — and only ellipsises
   * once there is genuinely no room left.
   */
  endpointTo: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  /**
   * The white chip is what makes the dots read as a line BETWEEN two things
   * rather than as a line passing behind them.
   */
  endpointIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endpointFromText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  endpointToText: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.ink,
  },
  /**
   * `height` matches the chips so the lasso runs along their centreline.
   *
   * The clearance is a margin, not padding, because the measured width IS the
   * drawing width — padding would report a box wider than the line inside it
   * and the curve would run under the chips.
   *
   * `minWidth` is 36 rather than the 24 a dotted rule could live with: below
   * that the two bends collapse into a wobble, which looks like a rendering
   * fault rather than a route.
   */
  trail: {
    flex: 1,
    minWidth: 36,
    height: LASSO_HEIGHT,
    marginHorizontal: space.xs,
    justifyContent: 'center',
  },
  /** The decision card: the numbers, and nothing to press. */
  summary: {
    gap: 1,
    backgroundColor: color.surfaceSubtle,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  previewEta: {
    fontFamily: font.bold,
    fontSize: 28,
    lineHeight: 33,
    color: color.ink,
    letterSpacing: -0.7,
  },
  previewMeta: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    color: color.slate,
  },
  previewMetaFaint: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
  },
  /**
   * The two ways to arrive.
   *
   * `flex: 1` on both children rather than a fixed split, so the pair stays
   * even at every text size — "Get directions" is the longer label by some
   * margin, and at the largest accessibility sizes a proportional split would
   * wrap it while the Walk button sat half empty.
   */
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: radius.pill,
    // 14 + the 1.5 border below = the same 15.5 half-height as the filled
    // button, so the two sit level. A border on one of a pair is the classic
    // way to end up with buttons a hair different in height.
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    minHeight: 50,
  },
  actionWalk: {
    backgroundColor: color.yellow,
    borderWidth: 1.5,
    // Its own colour, not the navy outline: the border exists to equalise the
    // box, not to draw a line. A visible ring around the yellow would make the
    // recommendation look like a variant of the other button.
    borderColor: color.yellow,
    ...shadow.card,
  },
  actionWalkText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
    letterSpacing: 0.2,
  },
  /**
   * Outlined, not filled and not grey.
   *
   * Grey would have made it a lesser button, which is the arrangement this
   * replaced. An outline in the same navy as its own label reads as a peer of
   * the yellow — equally deliberate, equally pressable — while leaving exactly
   * one filled control on the sheet, which is the brand rule the yellow serves.
   */
  actionDirections: {
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.navy,
  },
  actionDirectionsText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.navy,
    letterSpacing: 0.2,
  },
  previewNote: {
    marginTop: space.xs,
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateMuted,
    lineHeight: 17,
  },
  previewFinding: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: color.slateMuted,
    paddingVertical: space.xs,
  },
  way: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  wayText: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 13,
    color: color.navy,
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
  /**
   * The two footer lines, quieted rather than removed.
   *
   * Neither is decoration. The accuracy note is where the dog-access
   * uncertainty now lives once the "not confirmed" badge stopped being drawn,
   * and the OpenStreetMap credit is an ODbL licence obligation — this data is
   * free because that line exists. So they stay, at the size and weight of
   * things you read once rather than every time.
   */
  disclaimer: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.slateFaint,
    textAlign: 'center',
    lineHeight: 15,
  },
});
