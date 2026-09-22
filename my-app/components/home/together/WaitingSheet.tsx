/**
 * WaitingSheet — everything owed a reply, in one place.
 *
 * ── Why these left the trails list ──────────────────────────────────────────
 *
 * Invitations and join requests used to sit inline between the Up Next card
 * and the trails, which put two irreversible buttons in the middle of a list
 * people scroll. They are also a different KIND of thing: a trail is somewhere
 * you already belong, an invitation is a question, and mixing them meant the
 * list's length changed as you answered and the row under your thumb moved.
 *
 * They live behind the pill on the map now — counted there, answered here.
 *
 * ── Three kinds of question, deliberately not merged ───────────────────────
 *
 *   An invitation   somebody asked YOU to join their trail. You answer for
 *                   yourself, and accepting adds a trail to your list.
 *   A walk ask      you are in the pack already; somebody wants to know if you
 *                   are coming on Sunday. An RSVP, not a membership.
 *   A request       somebody asked to join a trail YOU host. You answer for
 *                   the pack, and approving lets a person in.
 *
 * The first and the last look alike and are opposites — one is about your
 * membership, the other about someone else's. The section headings are the
 * whole safeguard against approving a stranger while thinking you accepted a
 * friend, which is why the middle one gets its own heading and its own verbs
 * rather than borrowing "Accept" from either neighbour.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { color, space, type } from '../../../constants/design';
import type {
  CommunityInvitation,
  ExternalInviteClaim,
  WalkInvitation,
} from '../../../lib/communityWalks';
import { DogAvatar } from '../../community/CommunityUI';

interface WaitingSheetProps {
  visible: boolean;
  invitations: CommunityInvitation[];
  /** Walks on trails this owner is already in, still unanswered. */
  walkInvites: WalkInvitation[];
  claims: ExternalInviteClaim[];
  onClose: () => void;
  onRespondInvite: (invitationId: string, accept: boolean) => Promise<void>;
  onRespondWalk: (walkId: string, coming: boolean) => Promise<void>;
  onRespondClaim: (invitationId: string, approve: boolean) => Promise<void>;
}

/** "Sunday 7:15 AM · Baga beach", or as much of it as has been decided. */
function walkWhen(invite: WalkInvitation): string {
  const where = invite.meetingLabel?.trim() || null;
  if (!invite.scheduledFor) return [where, 'date to be confirmed'].filter(Boolean).join(' · ');
  const at = new Date(invite.scheduledFor);
  if (Number.isNaN(at.getTime())) return where ?? '';
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', hour: 'numeric', minute: '2-digit',
  }).format(at);
  return [when, where].filter(Boolean).join(' · ');
}

export function WaitingSheet({
  visible,
  invitations,
  walkInvites,
  claims,
  onClose,
  onRespondInvite,
  onRespondWalk,
  onRespondClaim,
}: WaitingSheetProps) {
  /**
   * Which row is mid-answer, by id.
   *
   * Per row rather than per sheet: answering one invitation must not freeze
   * the other three, and a spinner over the whole list would hide the thing
   * you are about to tap next.
   */
  const [busy, setBusy] = React.useState<string | null>(null);

  const answer = async (id: string, run: () => Promise<void>) => {
    setBusy(id);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  const total = invitations.length + walkInvites.length + claims.length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <Text style={styles.title}>Waiting on you</Text>
          <Pressable
            onPress={onClose}
            style={styles.close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={color.navy} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {total === 0 ? (
            <Text style={styles.empty}>Nothing is waiting on you.</Text>
          ) : null}

          {invitations.length ? (
            <Text style={styles.section}>INVITATIONS TO YOU</Text>
          ) : null}
          {invitations.map(invitation => {
            const from =
              invitation.inviter?.full_name
              || (invitation.inviter?.username ? `@${invitation.inviter.username}` : 'A friend');
            return (
              <Row
                key={invitation.id}
                title={invitation.pack?.name ?? 'A new trail'}
                detail={`${from} invited you`}
                dogs={invitation.dogs ?? []}
                busy={busy === invitation.id}
                yesLabel="Accept"
                onYes={() => void answer(invitation.id, () => onRespondInvite(invitation.id, true))}
                onNo={() => void answer(invitation.id, () => onRespondInvite(invitation.id, false))}
              />
            );
          })}

          {walkInvites.length ? (
            <Text style={[styles.section, invitations.length ? styles.sectionGap : null]}>
              ASKED TO A WALK
            </Text>
          ) : null}
          {walkInvites.map(invite => (
            <Row
              key={invite.walkId}
              title={invite.title || invite.packName}
              detail={walkWhen(invite)}
              dogs={[]}
              busy={busy === invite.walkId}
              yesLabel="Coming"
              // Not "Accept". Saying yes to a walk is an answer about Sunday,
              // and the row above it is an answer about belonging — borrowing
              // one verb for both is how somebody joins a trail they meant to
              // decline.
              onYes={() => void answer(invite.walkId, () => onRespondWalk(invite.walkId, true))}
              onNo={() => void answer(invite.walkId, () => onRespondWalk(invite.walkId, false))}
            />
          ))}

          {claims.length ? (
            <Text style={[styles.section, (invitations.length || walkInvites.length) ? styles.sectionGap : null]}>
              ASKING TO JOIN YOUR TRAIL
            </Text>
          ) : null}
          {claims.map(claim => (
            <Row
              key={claim.invitation_id}
              title={claim.full_name || (claim.username ? `@${claim.username}` : 'A Pawtchi owner')}
              detail={
                claim.dogs.length
                  ? `Walks with ${claim.dogs.map(dog => dog.name).join(' & ')}`
                  : 'No dog profile yet'
              }
              dogs={claim.dogs}
              busy={busy === claim.invitation_id}
              yesLabel="Approve"
              onYes={() => void answer(claim.invitation_id, () => onRespondClaim(claim.invitation_id, true))}
              onNo={() => void answer(claim.invitation_id, () => onRespondClaim(claim.invitation_id, false))}
            />
          ))}

          {claims.length ? (
            // The promise the external-invite path has to keep, said where the
            // decision is actually made rather than on the screen that sent it.
            <Text style={styles.note}>
              Only approve someone you meant to invite. A forwarded link cannot add anyone on its own.
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Row({
  title,
  detail,
  dogs,
  busy,
  yesLabel,
  onYes,
  onNo,
}: {
  title: string;
  detail: string;
  dogs: { id: string; name: string; image_url: string | null }[];
  busy: boolean;
  yesLabel: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const face = dogs[0] ?? { id: title, name: title, image_url: null };
  return (
    <View style={styles.row}>
      <DogAvatar dog={face} size={44} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text>
      </View>
      <Pressable
        onPress={onNo}
        disabled={busy}
        style={({ pressed }) => [styles.no, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Decline ${title}`}
      >
        <Ionicons name="close" size={18} color={color.navy} />
      </Pressable>
      <Pressable
        onPress={onYes}
        disabled={busy}
        style={({ pressed }) => [styles.yes, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${yesLabel} ${title}`}
      >
        <Ionicons name="checkmark" size={19} color={color.surface} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,32,42,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    backgroundColor: color.surfaceSubtle,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  grip: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: color.slateFaint,
    alignSelf: 'center',
    marginTop: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { ...type.heading, fontSize: 19, color: color.navy },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  section: { ...type.caption, fontSize: 10, letterSpacing: 1.4, color: color.slateFaint, marginBottom: space.sm },
  sectionGap: { marginTop: space.xl },
  empty: { ...type.body, color: color.slateMuted, paddingVertical: space.xl, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 10,
    marginBottom: space.sm,
    borderRadius: 17,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.bodyMedium, fontSize: 14, color: color.navy },
  rowDetail: { ...type.caption, fontSize: 11, letterSpacing: 0, color: color.slateMuted, marginTop: 2 },
  no: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yes: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: color.electric,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  note: { ...type.caption, fontSize: 10, lineHeight: 15, letterSpacing: 0, color: color.slateFaint, marginTop: space.md },
});
