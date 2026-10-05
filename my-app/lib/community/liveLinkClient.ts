/**
 * The app's Supabase client, as the live-walk room link (liveLink.ts) sees it.
 *
 * liveLink takes its client by injection so its state machine is tested
 * without a socket. The real client fits that shape everywhere except
 * `channel().on`, whose dozen overloads TypeScript cannot match against one
 * loose signature — hence the single cast on the channel. Behaviour is the
 * SDK's own; nothing here wraps or changes it.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { ChannelLike, RealtimeClientLike } from './liveLink';

export const liveRealtimeClient: RealtimeClientLike = {
  channel: (topic, opts) => supabase.channel(topic, opts) as unknown as ChannelLike,
  removeChannel: channel => supabase.removeChannel(channel as unknown as RealtimeChannel),
  realtime: {
    isConnected: () => supabase.realtime.isConnected(),
    setAuth: token => supabase.realtime.setAuth(token),
  },
};
