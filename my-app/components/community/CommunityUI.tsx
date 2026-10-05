import React, { useEffect } from 'react';
import {
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';

import { color, font, makeShadow, radius, space, type } from '../../constants/design';
import type { CommunityDog } from '../../lib/communityWalks';
import {
  REPLAY_DRAW_MS,
  REPLAY_STAGGER_MS,
  projectCommunityRoutes,
  type ArtworkPoint,
  type ArtworkRoute,
} from '../../lib/communityRouteArtwork';

const AnimatedPolyline = Reanimated.createAnimatedComponent(Polyline);

export const partyColors = [color.electric, color.marker.pink, color.success, color.alert] as const;

export function CommunityHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
  action,
  inline = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: React.ReactNode;
  /**
   * Title beside the back button, in one row — the meetup screen's bar. For
   * screens with a sentence of explanation under the title, where the large
   * stacked title pushed the content below the fold. No eyebrow in this form.
   */
  inline?: boolean;
}) {
  if (inline) {
    return (
      <View style={styles.headerInline}>
        <View style={styles.inlineRow}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={22} color={color.navy} />
            </Pressable>
          ) : null}
          <Text style={styles.inlineTitle} numberOfLines={2} accessibilityRole="header">{title}</Text>
          {action ?? null}
        </View>
        {subtitle ? <Text style={styles.inlineSubtitle}>{subtitle}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={color.navy} />
          </Pressable>
        ) : <View style={styles.iconSpacer} />}
        {action ?? <View style={styles.iconSpacer} />}
      </View>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function CommunityButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /**
   * `accent` is the electric-blue fill, for the second decisive action on a
   * surface whose one yellow CTA is already taken (a host confirming someone
   * on a meetup page that also offers "Open this walk"). Matches the approve
   * button in Connect's waiting sheet.
   */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'accent';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={variant === 'accent' ? color.surface : variant === 'secondary' || variant === 'quiet' ? color.navy : color.ink}
        />
      ) : null}
      <Text style={[styles.buttonText, variant === 'quiet' && styles.buttonTextQuiet, variant === 'accent' && styles.buttonTextAccent]}>{label}</Text>
    </Pressable>
  );
}

export function DogAvatar({ dog, size = 48, ringColor }: { dog: CommunityDog; size?: number; ringColor?: string }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        ringColor ? { borderColor: ringColor, borderWidth: 3 } : null,
      ]}
    >
      {dog.image_url ? (
        <Image source={{ uri: dog.image_url }} style={styles.avatarImage} />
      ) : (
        <Text style={[styles.avatarInitial, { fontSize: Math.max(14, size * 0.34) }]}>
          {dog.name.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

export function DogStack({ dogs, max = 4 }: { dogs: CommunityDog[]; max?: number }) {
  return (
    <View style={styles.dogStack}>
      {dogs.slice(0, max).map((dog, index) => (
        <View key={dog.id} style={{ marginLeft: index === 0 ? 0 : -10, zIndex: max - index }}>
          <DogAvatar dog={dog} size={42} ringColor={color.surface} />
        </View>
      ))}
      {dogs.length > max ? (
        <View style={[styles.avatar, styles.moreAvatar]}>
          <Text style={styles.moreText}>+{dogs.length - max}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'live' | 'yes' }) {
  return (
    <View style={[styles.status, tone === 'live' && styles.statusLive, tone === 'yes' && styles.statusYes]}>
      {tone === 'live' ? <View style={styles.liveDot} /> : null}
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

/**
 * One party's path.
 *
 * The settled line carries a dash pattern, because colour alone must never be
 * the only thing telling two walking parties apart. That pattern and a draw-on
 * reveal want the same `strokeDasharray`, so they take turns: while replaying,
 * the dash is one route-length segment sliding into view; once the replay is
 * over the component falls back to the patterned line for good. Reduced motion
 * skips straight to the settled state.
 */
function PackRoutePath({ route, index, replay }: { route: ArtworkRoute; index: number; replay: boolean }) {
  const reducedMotion = useReducedMotion();
  const drawing = replay && !reducedMotion;
  const offset = useSharedValue(drawing ? route.length : 0);

  useEffect(() => {
    if (!drawing) {
      offset.value = 0;
      return;
    }
    // Rewind before drawing. Without this an encore starts from a line that is
    // already fully drawn and animates 0 → 0, which looks like a dead button.
    offset.value = route.length;
    offset.value = withDelay(
      index * REPLAY_STAGGER_MS,
      withTiming(0, { duration: REPLAY_DRAW_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [drawing, index, offset, route.length]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  const stroke = partyColors[index % partyColors.length];
  const common = {
    points: route.points,
    fill: 'none',
    stroke,
    strokeWidth: index === 0 ? 9 : 8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <>
      {drawing ? (
        <AnimatedPolyline
          {...common}
          strokeDasharray={`${route.length} ${route.length}`}
          animatedProps={animatedProps}
        />
      ) : (
        <Polyline
          {...common}
          strokeDasharray={index % 3 === 1 ? '16 9' : index % 3 === 2 ? '3 12' : undefined}
        />
      )}
      {route.start ? <Circle cx={route.start.x} cy={route.start.y} r="8" fill={color.surface} stroke={stroke} strokeWidth="5" /> : null}
    </>
  );
}

/**
 * A transformed, map-free route illustration. The line pattern changes with
 * each walking party so the paths remain distinguishable without colour.
 */
export function PackRouteArtwork({
  compact = false,
  routes = [],
  replay = false,
}: {
  compact?: boolean;
  routes?: ArtworkPoint[][];
  /** Draw the paths on rather than showing them already finished. */
  replay?: boolean;
}) {
  const height = compact ? 128 : 220;
  const projected = projectCommunityRoutes(routes);
  return (
    <View style={[styles.artwork, { height }]} accessibilityLabel="Interwoven route artwork for this pack walk">
      <Svg width="100%" height="100%" viewBox="0 0 360 220">
        {projected.length ? projected.map((route, index) => (
          <PackRoutePath
            key={`${index}-${route.points.slice(0, 12)}`}
            route={route}
            index={index}
            replay={replay}
          />
        )) : <>
        <Path
          d="M25 162 C70 115 81 37 151 48 C224 58 198 153 264 163 C310 170 335 129 344 82"
          fill="none"
          stroke={partyColors[0]}
          strokeWidth="9"
          strokeLinecap="round"
        />
        <Path
          d="M30 69 C86 89 107 191 179 174 C250 158 221 74 287 55 C316 47 335 59 348 77"
          fill="none"
          stroke={partyColors[1]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="16 9"
        />
        <Path
          d="M61 190 C88 151 142 128 188 103 C234 77 265 93 310 119"
          fill="none"
          stroke={partyColors[2]}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray="3 12"
        />
        <Circle cx="25" cy="162" r="8" fill={color.surface} stroke={partyColors[0]} strokeWidth="5" />
        <Circle cx="30" cy="69" r="8" fill={color.surface} stroke={partyColors[1]} strokeWidth="5" />
        <Circle cx="61" cy="190" r="8" fill={color.surface} stroke={partyColors[2]} strokeWidth="5" />
        </>}
      </Svg>
      <View style={styles.artworkBadge}>
        <Ionicons name="paw" size={15} color={color.navy} />
        <Text style={styles.artworkBadgeText}>THE PACK’S ROUTE</Text>
      </View>
    </View>
  );
}

export function CommunityCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/**
 * What a pack surface shows when useWalkEnabled() says no.
 *
 * Every other walk surface simply hides for a cat, and that is enough because
 * every other walk surface is only reachable from a screen that already made
 * the same check. A pack is not: an invitation push carries an explicit route,
 * so a cat owner who taps one lands here directly. Hiding would look broken, so
 * this explains the gate instead — and never starts an outing that cannot be
 * walked. The choice of profile stays the owner's.
 */
export function CommunityDogsOnly({ petName, onBack }: { petName?: string | null; onBack?: () => void }) {
  return (
    <>
      <CommunityHeader
        eyebrow="Walk with friends"
        title="Meetups are for dogs"
        subtitle={petName
          ? `${petName} is a cat, so meetups stay closed while that profile is active.`
          : 'Meetups are a dogs-only part of Pawtchi.'}
        onBack={onBack}
      />
      <View style={styles.gate}>
        <View style={styles.gateMark}><Ionicons name="paw-outline" size={30} color={color.electric} /></View>
        <Text style={communityScreenStyles.emptyBody}>
          Switch to a dog profile to open your meetups, plan a walk, or answer an invitation. Nothing is lost while you wait.
        </Text>
      </View>
    </>
  );
}

export const communityScreenStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceSubtle },
  scroll: { paddingHorizontal: space.xl, paddingBottom: 120 },
  sectionEyebrow: { ...type.caption, color: color.slateMuted, marginTop: space.xxl, marginBottom: space.md },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    ...type.bodyMedium,
    color: color.ink,
  },
  help: { ...type.body, color: color.slateMuted, marginTop: space.sm },
  error: { ...type.bodyMedium, color: color.error, marginTop: space.md },
  emptyTitle: { ...type.heading, color: color.ink, textAlign: 'center', marginTop: space.lg },
  emptyBody: { ...type.body, color: color.slateMuted, textAlign: 'center', marginTop: space.sm },
});

const styles = StyleSheet.create({
  gate: { alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.xl },
  gateMark: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: color.electricSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl },
  headerTop: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.hairline,
  },
  iconSpacer: { width: 48, height: 48 },
  eyebrow: { ...type.caption, color: color.electric, marginTop: space.lg },
  title: { fontFamily: font.bold, fontSize: 34, lineHeight: 39, letterSpacing: -1.1, color: color.navy, marginTop: space.xs },
  subtitle: { ...type.body, color: color.slateMuted, maxWidth: 330, marginTop: space.sm },
  headerInline: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
  inlineRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.md },
  inlineTitle: { ...type.heading, fontSize: 21, lineHeight: 26, letterSpacing: -0.4, color: color.navy, flex: 1 },
  inlineSubtitle: { ...type.body, color: color.slateMuted, marginTop: space.lg },
  button: {
    minHeight: 52,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  button_primary: { backgroundColor: color.yellow },
  button_secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.hairline },
  button_quiet: { backgroundColor: 'transparent' },
  button_danger: { backgroundColor: color.errorSoft },
  button_accent: { backgroundColor: color.electric },
  buttonPressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontFamily: font.bold, fontSize: 14, color: color.navy },
  buttonTextQuiet: { color: color.navy },
  buttonTextAccent: { color: color.surface },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: color.surfaceSubtle,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: font.bold, color: color.navy },
  dogStack: { flexDirection: 'row', alignItems: 'center' },
  moreAvatar: { marginLeft: -10, borderWidth: 3, borderColor: color.surface },
  moreText: { ...type.label, color: color.slate },
  status: {
    alignSelf: 'flex-start',
    minHeight: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.surfaceSubtle,
  },
  statusLive: { backgroundColor: color.errorSoft },
  statusYes: { backgroundColor: color.successSoft },
  statusText: { ...type.label, color: color.navy },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.error },
  artwork: {
    backgroundColor: '#F0F5EC',
    borderRadius: radius.xxl,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  artworkBadge: {
    position: 'absolute',
    left: space.md,
    top: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 30,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  artworkBadgeText: { ...type.caption, color: color.navy, fontSize: 9.5 },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    borderWidth: 1,
    borderColor: color.hairline,
    ...makeShadow(5, 16, 0.055),
  },
});
