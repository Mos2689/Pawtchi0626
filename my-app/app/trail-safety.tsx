/**
 * Trails: how they work and who is responsible.
 *
 * ── What this screen is for ────────────────────────────────────────────────
 *
 * A Trail arranges for people to meet in a physical place, with dogs, and it
 * shares live location between them while they walk. None of that was covered
 * anywhere a user could read it: the Terms of Service (April 2026) contain no
 * mention of community, trails, meeting points or meeting in person, and the
 * Privacy Policy describes location without saying it is shared with anybody.
 *
 * This is the document those flows link to. The host agrees to it when starting
 * a trail; the location section is what the join notice points at.
 *
 * ── Every statement here was checked against the code ──────────────────────
 *
 * Same rule as app/privacy.tsx, and for the same reason. A safety document that
 * overstates what the app does is worse than one that admits the truth — and
 * this project has already shipped one screen telling people their route was
 * private at the moment it was shared. Do not add a reassuring claim unless the
 * code does it:
 *
 *   • live positions really are readable only by attendees, only while the walk
 *     is `active` — community_locations_read_attendees;
 *   • there really is no people search — lookup_community_username takes an
 *     exact handle and there is no browse, directory or proximity surface;
 *   • photos really are published only when the shutter was in shared mode —
 *     selectSharedCaptures treats an absent choice as a refusal.
 *
 * ── Not a substitute for the Terms ─────────────────────────────────────────
 *
 * This explains responsibilities in plain language. It is not the contract and
 * must not be drafted as one. The Terms amendment covering Community is with
 * counsel; when it lands, this screen must not contradict it.
 *
 * Copy follows the locked spec: sentence case, no exclamation marks, plain
 * Australian English, calm rather than urgent.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { color, font, radius, space } from '../constants/design';

const B = { fontWeight: 'bold' } as const;

export default function TrailSafetyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Header title="Meetups and responsibility" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.legalBox}>
          <Text style={styles.companyName}>Walking together</Text>
          <Text style={styles.companyAddress}>
            What a meetup is, what Pawtchi does, and what stays with you.
          </Text>
          <Text style={[styles.companyAddress, { marginTop: space.md, color: color.yellow }]}>
            Last updated: September 2026
          </Text>
        </View>

        <Text style={styles.sectionTitle}>1. What a meetup is</Text>
        <Text style={styles.paragraph}>
          A meetup is a private group you create and invite people into. Inside it, anyone can plan a
          walk: a time, a meeting place, and whoever the group is.
          {'\n\n'}The walk is arranged by the person who plans it, not by Pawtchi. It runs between the
          start and the end they set. Getting there, getting home, and anything the group does before
          or after is outside it.
        </Text>

        <Text style={styles.sectionTitle}>2. What Pawtchi does, and does not do</Text>
        <Text style={styles.paragraph}>
          Pawtchi gives you the tools to arrange a walk with people you already know. That is the
          whole of it.
          {'\n\n'}Pawtchi does not organise the walk, supervise it, or attend it. We do not pick the
          meeting place or the route, and we cannot tell you whether either is suitable on the day.
          {'\n\n'}We do not check anyone, and we do not vouch for anyone. That goes for the dogs as
          well as the people: we do not know whether a dog coming on a walk is vaccinated, healthy,
          trained, or good with other dogs. Nobody on Pawtchi has been verified by us.
          {'\n\n'}There is no way to search for people on Pawtchi. No directory, no browsing, no
          owners near you. Someone joins your meetup because you typed their exact username, or sent
          them a link yourself — and because they accepted.
          {'\n\n'}We may remove or cancel a walk, or stop someone using trails, where we think that is
          needed for safety, legal or policy reasons.
        </Text>

        <Text style={styles.sectionTitle}>3. If you plan a meetup</Text>
        <Text style={styles.paragraph}>
          Planning a meetup makes you its host, and a few things sit with you rather than with us:
          {'\n\n'}• You choose who to invite. Invite people you know, or people you are comfortable
          meeting and walking with.
          {'\n'}• You choose the place and the time, and you are responsible for what you tell people
          about them.
          {'\n'}• You are responsible for your own dog: behaviour, staying under control, and
          vaccinations.
          {'\n'}• You follow the leash and dog control laws where you are walking, and the rules of
          wherever you meet. They differ between councils and states, and checking them is yours
          to do.
          {'\n\n'}Hosting does not make you a Pawtchi employee, agent or representative, and it does
          not make Pawtchi responsible for the walk.
        </Text>

        <Text style={styles.sectionTitle}>4. If you join a walk</Text>
        <Text style={styles.paragraph}>
          You are choosing to meet other people, in a public place, with dogs. That is an ordinary
          thing to do, and it carries real risks worth naming: dogs can bite, scratch or fight, people
          and dogs can be hurt, a dog can get loose or go missing, things can be damaged, ground can
          be uneven and traffic is traffic.
          {'\n\n'}You stay responsible for yourself and for your dog, including how your dog behaves
          around other dogs and other people. Take the same care you would take on any walk.
          {'\n\n'}Only accept invitations from people you know, or people you are comfortable meeting
          in person. Pawtchi cannot tell you who is safe to meet.
        </Text>

        <Text style={styles.sectionTitle}>5. Location while you walk</Text>
        <Text style={styles.paragraph}>
          A meetup walk shares location. This is what happens, and it is different from a walk you take
          on your own:
          {'\n\n'}• <Text style={B}>While the walk is running</Text>, your live position is visible to
          the others walking it. It stops being visible to them when the host ends the walk.
          {'\n'}• <Text style={B}>Your recorded route</Text> — where you went, how fast, where you
          stopped, and the names of the places you started and finished — becomes part of that walk’s
          shared memory, and stays there.
          {'\n'}• <Text style={B}>Photos you share to the walk</Text> carry the spot they were taken.
          {'\n\n'}All of this is visible to the people on that walk, and to nobody else. It is never
          public, and it is never used for advertising.
          {'\n\n'}A walk you take on your own is not shared with anyone.
        </Text>

        <Text style={styles.sectionTitle}>6. Photos</Text>
        <Text style={styles.paragraph}>
          Every photo you take on a walk is personal unless you chose to share it with the walk when
          you pressed the shutter. If you did not choose, it stays personal.
          {'\n\n'}Photos you shared stay in the walk’s memory until you remove them. Think about who
          else is in the frame before you share.
        </Text>

        <Text style={styles.sectionTitle}>7. If something goes wrong</Text>
        <Text style={styles.paragraph}>
          If you are in danger or someone is hurt, contact emergency services on 000. Pawtchi is an
          app and cannot help in an emergency.
          {'\n\n'}If something serious happens on a walk — a dog attack, an injury, a medical
          emergency, damage to property — the people there are the ones who have to act, and to
          report it where the law says it must be reported: emergency services, your local council,
          police, a doctor or a vet.
          {'\n\n'}You can also report it to us when it involves someone’s conduct on Pawtchi or a walk
          listed here. Telling us is not the same as telling the authorities, and it does not stand in
          for it. We do not investigate incidents or decide who was at fault.
          {'\n\n'}If someone behaves badly, you can block and report them from the trail’s settings,
          and a host can remove anyone from a meetup. Reports come to us and we read them.
        </Text>

        <Text style={styles.sectionTitle}>8. How this sits with our other terms</Text>
        <Text style={styles.paragraph}>
          This page explains responsibilities in plain language. Our Privacy Policy covers what we
          collect and how we handle it, and our Terms of Service cover using Pawtchi generally.
          {'\n\n'}Nothing on this page takes away rights you have under the Australian Consumer Law
          that cannot be excluded or limited.
          {'\n\n'}Questions about any of it: privacy@heylivingclub.com
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
  },
  scrollContent: {
    padding: space.xxl,
    paddingBottom: 40,
  },
  legalBox: {
    backgroundColor: color.navy,
    borderRadius: radius.xl,
    padding: space.xxl,
    marginBottom: space.xxxl,
  },
  companyName: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: color.cream,
    marginBottom: space.sm,
  },
  companyAddress: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: color.slateFaint,
    lineHeight: 22,
    marginTop: space.xs,
  },
  sectionTitle: {
    fontFamily: font.extrabold,
    fontSize: 16,
    color: color.ink,
    marginBottom: space.md,
    marginTop: space.sm,
  },
  paragraph: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.slate,
    lineHeight: 24,
    marginBottom: space.xxl,
  },
});
