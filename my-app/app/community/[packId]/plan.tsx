/**
 * Planning a walk on a trail.
 *
 * This screen plans. It does not start — that was the flaw it shipped with: a
 * "Start now" chip sat beside "Plan ahead", and choosing a date still landed
 * the host on the walk's own screen, whose one button said "Start the walk".
 * Planning a walk for Tuesday and starting a walk on Saturday are different
 * decisions days apart, and putting them in one flow produced exactly what you
 * would expect — walks scheduled for next week, already running, hiding every
 * walk actually planned behind them.
 *
 * So: four questions, no modes, and the way out is back to the trail with the
 * new walk sitting on it. Starting belongs to the walk's own screen, on the day.
 *
 * Two entry points share this, because they ask the same questions:
 *   ?again=<id>   a fresh walk prefilled from a past one, a week later
 *   ?walkId=<id>  editing the plan of a walk that has not started
 */

import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import {
  CommunityButton,
  CommunityDogsOnly,
  DogAvatar,
  communityScreenStyles,
} from '../../../components/community/CommunityUI';
import { MeetingPointField } from '../../../components/community/MeetingPointField';
import { color, radius, space, type } from '../../../constants/design';
import { useHomeMapCenter } from '../../../hooks/useHomeMapCenter';
import { useWalkEnabled } from '../../../hooks/useWalkEnabled';
import {
  createOuting,
  inviteToWalk,
  loadOuting,
  loadPack,
  setOutingMeetingPoint,
  updateOuting,
  type CommunityPack,
  type PackMember,
} from '../../../lib/communityWalks';
import {
  EMPTY_MEETING_POINT,
  isMeetingPointReady,
  isPinned,
  type MeetingPoint,
} from '../../../lib/communityMeetingPoint';
import { useAuth } from '../../../providers/AuthProvider';
import { useActivePetStore } from '../../../store/useActivePetStore';

export default function PlanWalkScreen() {
  const router = useRouter();
  const { packId, again, walkId } = useLocalSearchParams<{ packId: string; again?: string; walkId?: string }>();
  const editing = !!walkId;
  const walkEnabled = useWalkEnabled();
  const activePet = useActivePetStore(state => state.activePet);
  const { user } = useAuth();
  const [pack, setPack] = useState<CommunityPack | null>(null);
  const [members, setMembers] = useState<PackMember[]>([]);
  /**
   * Who is being asked to this walk. Everyone starts ticked: the common case is
   * that the whole pack is welcome, and unticking the one person who is away is
   * less work than ticking the four who are not.
   */
  const [invitees, setInvitees] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [meeting, setMeeting] = useState<MeetingPoint>(EMPTY_MEETING_POINT);
  const [note, setNote] = useState('');
  const [hasDate, setHasDate] = useState(true);
  const [date, setDate] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Where the map should open when this walk has no meeting point yet.
   *
   * The no-prompt centre: this owner's own recent geography, or a cached fix
   * the OS already had. Never a location request — choosing where to meet is
   * not a reason to put a permission sheet in front of somebody.
   */
  const { center: mapCenter } = useHomeMapCenter(activePet?.id ?? null, user?.id ?? null, walkEnabled);

  useEffect(() => {
    if (!packId || !walkEnabled) return;
    loadPack(packId).then(data => {
      setPack(data.pack);
      const others = data.members.filter(member => member.user_id !== user?.id);
      setMembers(others);
      setInvitees(others.map(member => member.user_id));
    }).catch(() => {});

    const prefill = walkId ?? again;
    if (!prefill) return;
    loadOuting(prefill).then(({ walk }) => {
      setTitle(walk.title);
      setMeeting({
        label: walk.meeting_label,
        lat: walk.meeting_lat,
        lng: walk.meeting_lng,
      });
      setNote(walk.note ?? '');
      if (walkId) {
        // Editing: take the plan exactly as it stands. No date means the host
        // said "decide later", so the picker stays closed rather than
        // inventing a date they never chose.
        setHasDate(!!walk.scheduled_for);
        if (walk.scheduled_for) setDate(new Date(walk.scheduled_for));
        return;
      }
      // Walking again: the same walk a week on. If that week has already gone,
      // tomorrow — never a date in the past.
      const previous = walk.scheduled_for ? new Date(walk.scheduled_for) : new Date();
      const next = new Date(previous.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (next.getTime() <= Date.now()) next.setTime(Date.now() + 24 * 60 * 60 * 1000);
      setHasDate(true);
      setDate(next);
    }).catch(() => {});
  }, [again, walkId, packId, walkEnabled, user?.id]);

  /**
   * Write the coordinate the host actually chose.
   *
   * No geocoding here any more: the picker resolved the place before this
   * screen was ever submitted, so this is a plain update of two columns rather
   * than a network guess about what some free text might have meant. An
   * unpinned point is still legitimate — a description with no coordinate — and
   * simply writes nothing.
   */
  const writePin = (id: string) => {
    if (!isPinned(meeting)) return;
    void setOutingMeetingPoint(id, meeting.lat!, meeting.lng!);
  };

  const submit = async () => {
    if (!packId) return;
    setSaving(true);
    setError(null);
    try {
      const scheduledFor = hasDate ? date.toISOString() : null;
      const walkTitle = title.trim() || 'Pack walk';
      if (walkId) {
        await updateOuting({ walkId, title: walkTitle, scheduledFor, meetingLabel: meeting.label, note });
        writePin(walkId);
      } else {
        const outing = await createOuting({
          packId,
          title: walkTitle,
          scheduledFor,
          meetingLabel: meeting.label,
          note,
        });
        writePin(outing.id);
        // Asking people is the point of planning, but it is not worth losing
        // the walk over: a failure here leaves a real walk on the trail that
        // anyone in the pack can still see and join.
        try {
          await inviteToWalk(outing.id, invitees);
        } catch {
          // The walk stands; nobody was notified.
        }
      }
      // Back to the trail, where the walk is now listed. Deliberately NOT the
      // walk's own screen: landing there put "Start the walk" in front of
      // someone who had just planned one for next week.
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : editing
        ? 'The plan could not be changed.'
        : 'The walk could not be planned.');
    } finally {
      setSaving(false);
    }
  };

  const ready = isMeetingPointReady(meeting);

  // "Walk again" sits under a memory a cat owner can still open, so the gate
  // belongs here too: planning is where a walk nobody present can record would
  // become real.
  if (!walkEnabled) {
    return (
      <SafeAreaView style={communityScreenStyles.screen}>
        <CommunityDogsOnly petName={activePet?.name} onBack={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={communityScreenStyles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* One row with the back arrow, like every other community screen.
            The trail's name rides above the title inside that centred block
            rather than in a stacked header of its own: it is context, not the
            heading, and giving it its own line pushed the first question of
            the form below the fold. Absent while the pack loads, in which case
            the title centres on its own. */}
        <View style={styles.navRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={21} color={color.navy} />
          </Pressable>
          <View style={styles.navCopy}>
            {pack?.name ? (
              <Text style={styles.navEyebrow} numberOfLines={1}>{pack.name}</Text>
            ) : null}
            <Text style={styles.navTitle} numberOfLines={1}>
              {editing ? 'Change the plan' : 'Plan a walk'}
            </Text>
          </View>
          {/* Balances the arrow so the block is centred on the screen, not on
              what is left beside it. Not the button style — that would draw a
              second circle that looks tappable. */}
          <View style={styles.navSpacer} />
        </View>
        <ScrollView contentContainerStyle={communityScreenStyles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInput
            value={title}
            onChangeText={value => { setTitle(value); setError(null); }}
            placeholder="Name this walk"
            placeholderTextColor={color.slateFaint}
            maxLength={72}
            style={styles.field}
            accessibilityLabel="Walk name"
          />

          <MeetingPointField
            value={meeting}
            onChange={next => { setMeeting(next); setError(null); }}
            fallbackCenter={mapCenter}
          />

          <Pressable
            onPress={() => setHasDate(current => !current)}
            style={styles.field}
            accessibilityRole="switch"
            accessibilityState={{ checked: hasDate }}
            accessibilityLabel={hasDate ? 'Pick a date' : 'Decide the date later'}
          >
            <View style={styles.dateRow}>
              <Ionicons
                name={hasDate ? 'calendar' : 'calendar-outline'}
                size={21}
                color={hasDate ? color.electric : color.slateMuted}
              />
              <Text style={[styles.dateText, !hasDate && styles.dateTextMuted]} numberOfLines={1}>
                {hasDate
                  ? new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(date)
                  : 'Decide the date later'}
              </Text>
              <Ionicons
                name={hasDate ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={hasDate ? color.success : color.slateFaint}
              />
            </View>
          </Pressable>

          {hasDate ? (
            <View style={styles.pickers}>
              <DateTimePicker
                value={date}
                mode="date"
                minimumDate={new Date()}
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                onChange={(_, value) => value && setDate(current => {
                  const next = new Date(value);
                  next.setHours(current.getHours(), current.getMinutes(), 0, 0);
                  return next;
                })}
              />
              <DateTimePicker
                value={date}
                mode="time"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                onChange={(_, value) => value && setDate(current => {
                  const next = new Date(current);
                  next.setHours(value.getHours(), value.getMinutes(), 0, 0);
                  return next;
                })}
              />
            </View>
          ) : null}

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything to bring? (optional)"
            placeholderTextColor={color.slateFaint}
            maxLength={280}
            multiline
            style={[styles.field, styles.noteField]}
            accessibilityLabel="Short note"
          />

          {/* Only when planning. Editing a walk changes its plan; who was asked
              is answered on the walk itself, where the answers already live. */}
          {!editing && members.length > 0 ? (
            <View style={styles.inviteBlock}>
              <View style={styles.inviteHead}>
                <Text style={styles.inviteTitle}>Who are you asking?</Text>
                <Pressable
                  onPress={() => setInvitees(
                    invitees.length === members.length ? [] : members.map(m => m.user_id),
                  )}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.inviteToggle}>
                    {invitees.length === members.length ? 'Clear all' : 'Select all'}
                  </Text>
                </Pressable>
              </View>

              {members.map(member => {
                const picked = invitees.includes(member.user_id);
                const dog = member.dogs[0] ?? {
                  id: member.user_id,
                  name: member.person?.full_name ?? 'Friend',
                  image_url: member.person?.avatar_url ?? null,
                };
                const name = member.dogs.map(item => item.name).join(' & ')
                  || member.person?.full_name
                  || 'Friend';
                return (
                  <Pressable
                    key={member.user_id}
                    onPress={() => setInvitees(current => picked
                      ? current.filter(id => id !== member.user_id)
                      : [...current, member.user_id])}
                    style={styles.inviteRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: picked }}
                    accessibilityLabel={`Ask ${name} to this walk`}
                  >
                    <View style={picked ? undefined : styles.inviteRowMuted}>
                      <DogAvatar dog={dog} size={40} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.inviteName} numberOfLines={1}>{name}</Text>
                      <Text style={styles.inviteHandle} numberOfLines={1}>
                        {member.person?.username ? `@${member.person.username}` : 'Pack member'}
                      </Text>
                    </View>
                    <Ionicons
                      name={picked ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={picked ? color.success : color.slateFaint}
                    />
                  </Pressable>
                );
              })}

              <Text style={styles.inviteNote}>
                {invitees.length === 0
                  ? 'Nobody will be notified. The walk still appears on the trail for everyone.'
                  : 'Anyone in the pack can still join, asked or not.'}
              </Text>
            </View>
          ) : null}

          {error ? <Text style={communityScreenStyles.error}>{error}</Text> : null}

          <CommunityButton
            label={saving ? 'Saving…' : editing ? 'Save the plan' : 'Plan this walk'}
            icon="checkmark"
            onPress={() => void submit()}
            disabled={saving || !ready}
            style={styles.submit}
          />
          <Text style={styles.footnote}>
            The pack can answer. Nobody is committed, and no location is shared until the walk starts.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    marginBottom: space.md,
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  navSpacer: { width: 44, height: 44 },
  navCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  navEyebrow: { ...type.caption, fontSize: 9.5, letterSpacing: 1.1, color: color.slateFaint },
  navTitle: { ...type.heading, fontSize: 18, color: color.navy, marginTop: 1 },
  /**
   * One field style for every question. The labelled sections this replaced —
   * WALK NAME, WHEN, MEETING POINT, SHORT NOTE · OPTIONAL — doubled the words
   * on screen to say what each placeholder already says.
   */
  field: {
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    ...type.bodyMedium,
    fontSize: 17,
    color: color.ink,
    marginBottom: space.md,
  },
  noteField: { minHeight: 96, paddingTop: space.lg, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dateText: { ...type.bodyMedium, fontSize: 17, color: color.ink, flex: 1 },
  dateTextMuted: { color: color.slateFaint },
  pickers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  inviteBlock: { marginTop: space.lg },
  inviteHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  inviteTitle: { ...type.heading, fontSize: 17, color: color.navy },
  inviteToggle: { ...type.label, fontSize: 12.5, color: color.electric },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline,
  },
  inviteRowMuted: { opacity: 0.45 },
  inviteName: { ...type.bodyMedium, fontSize: 14, color: color.ink },
  inviteHandle: { ...type.caption, fontSize: 10, color: color.slateMuted, marginTop: 2 },
  inviteNote: { ...type.caption, fontSize: 10.5, lineHeight: 15, color: color.slateFaint, marginTop: space.md },
  submit: { marginTop: space.lg },
  footnote: { ...type.caption, fontSize: 10.5, lineHeight: 15, color: color.slateFaint, textAlign: 'center', marginTop: space.md },
});
