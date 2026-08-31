import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { color, font, radius, shadow, space } from '../constants/design';
import type { ProfileMembershipPresentation } from '../lib/profileMembership';

interface ProfileMembershipCardProps {
  presentation: ProfileMembershipPresentation;
  onPress: () => void;
}

/**
 * Three states, three materials.
 *
 * ── What was wrong ──
 * Every state rendered as the same white card, distinguished only by the tint
 * behind a 21px icon. So the card read as one thing — "membership: some words"
 * — and a free user scrolling past had no reason to stop, while a paying one
 * got no acknowledgement that they had paid. A status surface that looks
 * identical whether you have paid or not is not a status surface.
 *
 * ── What each one is now ──
 *   free   Warm, tinted, and the only card here with a real button. This is the
 *          one state where the card is asking for something, so it is the one
 *          state allowed to look like it.
 *   trial  The same warm material, plus the number that matters: a running
 *          trial is the only state with a deadline, and it now says so in a
 *          size you can read without stopping.
 *   plus   Navy. A different substance entirely, echoing the profile header
 *          above it. It sells nothing — it has nothing left to sell — it just
 *          confirms, quietly and expensively, that this account is different.
 *
 * ── The line that is not crossed ──
 * No prices, no trial lengths, no "50% off" anywhere in here. Those must come
 * from RevenueCat at the point of purchase; hardcoding them in a profile card
 * is how a store listing and an app disagree, which is a rejection and, worse,
 * a lie to somebody about money.
 */
export function ProfileMembershipCard({
  presentation,
  onPress,
}: ProfileMembershipCardProps) {
  const isPlus = presentation.tone === 'plus';
  const isTrial = presentation.tone === 'trial';
  const isFree = presentation.tone === 'free';
  const isLocked = presentation.tone === 'locked';
  const isLoading = presentation.tone === 'loading';
  /** Both states where the card is asking, and so both that carry a button. */
  const isOffering = isFree || isLocked;
  const accessibilityAction =
    isPlus || isTrial ? 'Manage subscription' : 'Explore Pawtchi Plus';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isFree && styles.cardFree,
        isLocked && styles.cardLocked,
        isTrial && styles.cardTrial,
        isPlus && styles.cardPlus,
        isLoading && styles.cardLoading,
      ]}
      activeOpacity={0.78}
      onPress={onPress}
      disabled={isLoading}
      accessibilityRole="button"
      accessibilityState={{ disabled: isLoading }}
      accessibilityLabel={`${presentation.planLabel}. ${presentation.detail}. ${
        isLoading ? '' : accessibilityAction
      }`}
      accessibilityHint={
        isPlus
          ? 'Opens subscription management'
          : 'Opens Pawtchi Plus plans and benefits'
      }
    >
      {/* On a trial the mark's job goes to the number — days remaining is the
          single most useful thing this card can say, and a medal icon beside it
          would be decoration competing with information. */}
      {isTrial && presentation.daysLeft != null ? (
        <View style={styles.countdown}>
          <Text style={styles.countdownNumber}>{presentation.daysLeft}</Text>
          <Text style={styles.countdownUnit}>
            {presentation.daysLeft === 1 ? 'day' : 'days'}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.mark,
            isPlus && styles.markPlus,
            isLocked && styles.markLocked,
            isTrial && styles.markTrial,
            isLoading && styles.markLoading,
          ]}
        >
          <MaterialIcons
            name={
              isLoading ? 'more-horiz' : isLocked ? 'lock-outline' : 'workspace-premium'
            }
            size={21}
            color={isPlus ? color.yellow : isLoading ? color.slateFaint : color.navy}
          />
        </View>
      )}

      <View style={styles.copyBlock}>
        <View style={styles.titleRow}>
          <Text style={[styles.planLabel, isPlus && styles.planLabelPlus]}>
            {presentation.planLabel}
          </Text>
          {!!presentation.statusLabel && (
            <View
              style={[
                styles.statusPill,
                isPlus && styles.statusPillPlus,
                isLocked && styles.statusPillLocked,
                isTrial && styles.statusPillTrial,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  isPlus && styles.statusTextPlus,
                  isLocked && styles.statusTextLocked,
                  isTrial && styles.statusTextTrial,
                ]}
              >
                {presentation.statusLabel}
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.detail, isPlus && styles.detailPlus]} numberOfLines={2}>
          {presentation.detail}
        </Text>
      </View>

      {/* A button only where the card is asking for something. Plus and trial
          get the quiet chevron they had — "Manage" is housekeeping, and dressing
          housekeeping as a call to action is how a paid product starts feeling
          like it is still selling to you after you bought it. */}
      {!!presentation.actionLabel &&
        (isOffering ? (
          <View style={styles.ctaPill}>
            <Text style={styles.ctaPillText}>{presentation.actionLabel}</Text>
          </View>
        ) : (
          <View style={styles.action}>
            <Text style={[styles.actionText, isPlus && styles.actionTextPlus]}>
              {presentation.actionLabel}
            </Text>
            <MaterialIcons
              name="chevron-right"
              size={18}
              color={isPlus ? color.creamDim : color.navy}
            />
          </View>
        ))}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    marginBottom: space.xxl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.surface,
    ...shadow.card,
  },
  /** The asking state: warm fill and a brand-coloured edge, so it reads as an offer. */
  cardFree: {
    backgroundColor: color.yellowSoft,
    borderColor: color.yellow,
  },
  /**
   * Access has ended. Warm like `free`, because it is still an invitation — but
   * on the neutral paper rather than the yellow, with a solid ink edge.
   *
   * Deliberately not alarming. Nothing has gone wrong and nobody is in trouble:
   * a feature is paused and can be turned back on. Red here would tell someone
   * their pet's data was at risk, which would be both false and the fastest way
   * to lose the person this card most wants to reach.
   */
  cardLocked: {
    backgroundColor: color.surfaceSubtle,
    borderColor: color.ink,
  },
  /** Same warmth, amber edge — a deadline rather than an offer. */
  cardTrial: {
    backgroundColor: color.alertSoft,
    borderColor: color.alert,
  },
  /**
   * The earned state. A different substance from everything else on Profile,
   * echoing the pet header above it — which is the point: you are not being
   * sold to on this row any more, you are being acknowledged.
   */
  cardPlus: {
    backgroundColor: color.navy,
    borderColor: color.hairlineOnNavy,
    ...shadow.raised,
  },
  cardLoading: {
    opacity: 0.72,
  },
  /** The trial's headline. Replaces the mark; see the note at the call site. */
  countdown: {
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontFamily: font.bold,
    fontSize: 24,
    lineHeight: 27,
    color: color.alertDeep,
    fontVariant: ['tabular-nums'],
  },
  countdownUnit: {
    fontFamily: font.semibold,
    fontSize: 10,
    lineHeight: 13,
    color: color.alertDeep,
  },
  mark: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.yellowSoft,
  },
  markPlus: {
    // Yellow on navy, not navy on navy: on the dark card the mark is the only
    // brand colour, and it has to be the thing the eye lands on first.
    backgroundColor: color.navyRaised,
  },
  markLocked: {
    backgroundColor: color.track,
  },
  markTrial: {
    backgroundColor: color.alertSoft,
  },
  markLoading: {
    backgroundColor: color.track,
  },
  copyBlock: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  planLabel: {
    fontFamily: font.bold,
    fontSize: 14.5,
    lineHeight: 19,
    color: color.ink,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: color.track,
  },
  statusPillPlus: {
    backgroundColor: color.yellow,
  },
  statusPillTrial: {
    backgroundColor: color.alert,
  },
  statusPillLocked: {
    backgroundColor: color.ink,
  },
  statusTextLocked: {
    color: color.cream,
  },
  planLabelPlus: {
    color: color.cream,
  },
  detailPlus: {
    color: color.creamDim,
  },
  actionTextPlus: {
    color: color.cream,
  },
  statusTextTrial: {
    color: color.cream,
  },
  /**
   * The one real button on this card, and only in the free state.
   *
   * The action used to be a text link in every state, which meant the moment
   * the card was actually asking for something it asked in the same voice it
   * used to say "Manage". A filled pill is the difference between a label and
   * an invitation.
   */
  ctaPill: {
    flexShrink: 0,
    marginLeft: space.xs,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    ...shadow.card,
  },
  ctaPillText: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.navy,
  },
  statusText: {
    fontFamily: font.bold,
    fontSize: 8.5,
    lineHeight: 11,
    letterSpacing: 0.8,
    color: color.slateMuted,
  },
  statusTextPlus: {
    color: color.navy,
  },
  detail: {
    marginTop: 3,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 16,
    color: color.slateMuted,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: space.xs,
  },
  actionText: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: color.navy,
  },
});
