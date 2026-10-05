/**
 * The retired "Your meetups" screen — now a doorway into Connect.
 *
 * This was a full list of meetups, invitations and a username card. Connect on
 * Home (TogetherPanel and its waiting sheet) replaced every part of it, so two
 * screens were showing the same things differently, and the old one carried
 * its own duplicate "Plan a meetup" buttons. Its last unique action, typing
 * an invitation code, now sits at the foot of the Connect sheet.
 *
 * The route stays, because things still point here: invitation pushes already
 * sitting in people's trays (SQL-authored with `/(tabs)/community`), and any
 * screen of an older build. They land on Connect with the waiting sheet open
 * when there is something to answer.
 */

import React from 'react';
import { Redirect } from 'expo-router';

export default function RetiredMeetupsScreen() {
  return <Redirect href={{ pathname: '/(tabs)', params: { segment: 'together', open: 'waiting' } } as never} />;
}
