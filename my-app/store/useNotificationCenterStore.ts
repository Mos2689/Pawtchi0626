/**
 * The notification center's state.
 *
 * One list, assembled from four sources:
 *
 *   nudge    — lib/nudgeEngine.ts, via the same input usePetContextStore builds
 *   banner   — lib/notificationCenter/bannerRules.ts, over pet + completeness
 *   runtime  — published by a screen that noticed something mid-session
 *   push     — lib/notificationCenter/remote.ts, over notification_history
 *
 * Everything except `runtime` is *derived*: it is recomputed from current state
 * on every rebuild rather than accumulated. That is what makes the feed
 * self-healing — log the missing meal and the "meals missing" item is simply
 * not produced next time, with nothing to clean up.
 *
 * Read state is the one thing that must survive a rebuild, which is why item
 * ids are built from the rule rather than from the data (see ./stableId).
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { computeNudges } from '../lib/nudgeEngine';
import { WALK_TRACKING_ENABLED } from '../constants/features';
import { deriveGoal } from '../lib/healthMath';
import { getAgeMonths } from '../lib/lifeStage';
import { computeCompleteness } from '../lib/profileCompleteness';
import { checkFeature } from '../lib/health/featureRequirements';
import { getPendingCheckin, type PendingCheckin } from '../lib/askVet';
import { track } from '../lib/analytics';
import {
  buildBannerItems,
  growthPhaseDismissKey,
  merRecalibDismissKey,
  vetTunedDismissKey,
  profileCompletionDismissKey,
  MER_DISMISS_WINDOW_MS,
  PROFILE_COMPLETION_RESURFACE_MS,
} from '../lib/notificationCenter/bannerRules';
import { ACTION_ICON, ACTION_ROUTE, DEFAULT_NUDGE_ICON } from '../lib/notificationCenter/catalogue';
import {
  fetchRemoteItems,
  markAllRemoteRead,
  markRemoteRead,
} from '../lib/notificationCenter/remote';
import { dayScope, isStaleDayScoped, stableId } from '../lib/notificationCenter/stableId';
import {
  compareItems,
  isUrgentTone,
  type InboxEntry,
  type InboxItem,
} from '../lib/notificationCenter/types';
import { useActivePetStore } from './useActivePetStore';
import { usePetContextStore, buildNudgeInput } from './usePetContextStore';
import { useStreakStore } from './useStreakStore';

/**
 * Storage keys are namespaced per user, following the precedent in
 * `hooks/useFirstWalkIntro.ts` — whose own comment names this exact scenario:
 * "logging out and creating a second account on the same device".
 *
 * Both keys were previously global, and ids like
 * `banner:profile_completion:persistent` are identical for every pet. So a new
 * account inherited the previous one's read and dismissed state, and could have
 * its own profile prompt arrive pre-dismissed by someone else.
 *
 * Namespacing rather than merely clearing means signing back into the first
 * account restores *its* read state, and a missed reset can no longer leak.
 */
const readKey = (userId: string | null) => `notification_center_read_v1:${userId ?? 'anon'}`;
const dismissedKey = (userId: string | null) => `notification_center_dismissed_v1:${userId ?? 'anon'}`;

/**
 * Subscription state lives in a React context provider, not a store, so it
 * cannot be read from here. A component mirrors it in with
 * `setSubscriptionSnapshot` and the last known value is reused for background
 * rebuilds.
 */
export interface SubscriptionSnapshot {
  status: string | null;
  daysLeft: number | null;
}

interface NotificationCenterState {
  items: InboxItem[];
  /** Ids the owner has opened or explicitly marked read. */
  readIds: string[];
  /** Ids of non-sticky items the owner swiped away. Cleared with their scope. */
  dismissedIds: string[];
  /** Published by screens at runtime; the only non-derived source. */
  runtimeItems: InboxItem[];
  subscription: SubscriptionSnapshot | null;
  hydrated: boolean;
  building: boolean;
  lastBuiltAt: number | null;
  /** Whose state is currently loaded. Drives re-hydration when the account changes. */
  userId: string | null;

  hydrate: (userId: string | null) => Promise<void>;
  setSubscriptionSnapshot: (snapshot: SubscriptionSnapshot) => void;
  publish: (item: InboxItem) => void;
  retract: (id: string) => void;
  rebuild: (opts?: { includeRemote?: boolean }) => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  /** Wipes everything for the signed-out user. Named to match clearPet / clearStreak / clearContext. */
  clearCenter: () => void;
}

// ── Derivation ──────────────────────────────────────────────────────────────

/** The engine's output, as inbox items. */
function nudgeItems(now: Date): InboxItem[] {
  const nudges = computeNudges(buildNudgeInput(usePetContextStore.getState()));
  const petId = useActivePetStore.getState().activePet?.id ?? null;
  const scope = dayScope(now);
  const nowIso = now.toISOString();

  return nudges.map(n => ({
    id: stableId('nudge', n.id, scope),
    source: 'nudge' as const,
    tone: n.tone,
    title: n.title,
    body: n.message,
    icon: n.actionType ? ACTION_ICON[n.actionType] : DEFAULT_NUDGE_ICON,
    createdAt: nowIso,
    route: n.actionType ? ACTION_ROUTE[n.actionType] : undefined,
    petId,
    // The clinical tier is the app saying "involve a vet". It does not get to
    // be scrolled past once and forgotten.
    sticky: n.tone === 'clinical',
    meta: { rule: n.id, action_type: n.actionType ?? null },
  }));
}

/** Reads the AsyncStorage dismiss state the migrated banners already used. */
async function readBannerDismissals(petId: string | null): Promise<{
  vetTuned: boolean;
  growthPhase: boolean;
  merRecalibration: boolean;
  profileCompletion: boolean;
}> {
  const now = Date.now();
  const [vetTuned, growthPhase, merAt, profileAt] = await Promise.all([
    petId ? AsyncStorage.getItem(vetTunedDismissKey(petId)) : Promise.resolve(null),
    petId ? AsyncStorage.getItem(growthPhaseDismissKey(petId)) : Promise.resolve(null),
    petId ? AsyncStorage.getItem(merRecalibDismissKey(petId)) : Promise.resolve(null),
    petId ? AsyncStorage.getItem(profileCompletionDismissKey(petId)) : Promise.resolve(null),
  ]).catch(() => [null, null, null, null]);

  const within = (raw: string | null, window: number) => {
    if (!raw) return false;
    const at = parseInt(raw, 10);
    return Number.isFinite(at) && now - at < window;
  };

  return {
    vetTuned: vetTuned === '1',
    growthPhase: growthPhase === '1',
    merRecalibration: within(merAt, MER_DISMISS_WINDOW_MS),
    profileCompletion: within(profileAt, PROFILE_COMPLETION_RESURFACE_MS),
  };
}

/** Cached so a rebuild does not fire a round trip per focus change. */
let checkinCache: { petId: string; value: PendingCheckin | null } | null = null;

async function bannerItems(
  now: Date,
  subscription: SubscriptionSnapshot | null,
): Promise<InboxItem[]> {
  const pet = useActivePetStore.getState().activePet;
  const pantry = useActivePetStore.getState().foodPantry;
  const context = usePetContextStore.getState();
  const streak = useStreakStore.getState();
  const petId = pet?.id ?? null;

  const dismissed = await readBannerDismissals(petId);

  let pendingCheckin: PendingCheckin | null = null;
  if (petId) {
    if (checkinCache?.petId === petId) {
      pendingCheckin = checkinCache.value;
    } else {
      // `getPendingCheckin` has its own 60s cache; this only avoids awaiting a
      // rejected promise on every rebuild.
      pendingCheckin = await getPendingCheckin(petId).catch(() => null);
      checkinCache = { petId, value: pendingCheckin };
    }
  }

  const completeness = pet
    ? computeCompleteness(pet, { pantryCount: pantry?.length ?? 0 })
    : null;

  return buildBannerItems({
    petId,
    petName: pet?.name ?? '',
    species: pet?.species,
    goal: pet
      ? deriveGoal(pet.current_weight_kg || 0, pet.target_weight_kg, pet.body_condition_score)
      : null,
    bcs: pet?.body_condition_score,
    severeObesityVetConfirmedAt: pet?.severe_obesity_vet_confirmed_at,
    medicalConditions: pet?.medical_conditions,
    ageMonths: pet ? getAgeMonths(pet) : undefined,
    currentWeightKg: pet?.current_weight_kg,
    targetWeightKg: pet?.target_weight_kg,
    todayCalories: context.todayCalories,
    observedMer: context.observedMer,
    subscriptionStatus: subscription?.status ?? null,
    trialDaysLeft: subscription?.daysLeft ?? null,
    completeness,
    pendingCheckin: pendingCheckin
      ? { questionId: pendingCheckin.questionId, reason: pendingCheckin.reason }
      : null,
    nextActivity: context.nextActivity,
    // Mirrors useWalkEnabled(), which is a hook and so unavailable here: the
    // flag AND a dog. A cat's plan never offers walk tracking.
    walkEnabled: WALK_TRACKING_ENABLED && pet?.species === 'dog',
    // The same gate ActivityScreen wraps itself in. Plan rows can outlive the
    // profile that justified them, so their existence alone is not permission
    // to advertise them.
    activityPlanReady: checkFeature('activity_plan', pet).ready,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    dismissed,
    now,
  });
}

/** First wins on a duplicate id, so a derived item beats a stale runtime one. */
function dedupe(items: InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  const out: InboxItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function notExpired(item: InboxItem, now: Date): boolean {
  return !item.expiresAt || item.expiresAt > now.toISOString();
}

/**
 * Whether two builds say the same thing.
 *
 * Compares id, title and body rather than doing a deep equality check, because
 * `createdAt` is stamped at build time and so differs on every single rebuild —
 * a deep comparison would report "changed" every time and defeat the point.
 * Those three cover everything the screen renders that can actually vary for a
 * given rule.
 */
function sameFeed(a: InboxItem[], b: InboxItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].title !== b[i].title || a[i].body !== b[i].body) {
      return false;
    }
  }
  return true;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useNotificationCenterStore = create<NotificationCenterState>((set, get) => ({
  items: [],
  readIds: [],
  dismissedIds: [],
  runtimeItems: [],
  subscription: null,
  hydrated: false,
  building: false,
  lastBuiltAt: null,
  userId: null,

  /**
   * Loads this user's read and dismissed ids.
   *
   * Re-runs whenever the account changes. The previous version early-returned on
   * a single `hydrated` flag, so after a sign-out the next user never re-read
   * storage at all and simply inherited whatever was in memory.
   */
  hydrate: async (userId) => {
    if (get().hydrated && get().userId === userId) return;
    try {
      const [rawRead, rawDismissed] = await Promise.all([
        AsyncStorage.getItem(readKey(userId)),
        AsyncStorage.getItem(dismissedKey(userId)),
      ]);
      const now = new Date();
      // Sweep ids whose day has passed. Without this both lists grow forever,
      // and a day-scoped nudge read yesterday would never come back.
      const readIds = (safeParse(rawRead) ?? []).filter(id => !isStaleDayScoped(id, now));
      const dismissedIds = (safeParse(rawDismissed) ?? []).filter(id => !isStaleDayScoped(id, now));
      set({ readIds, dismissedIds, hydrated: true, userId });
      void persist(readKey(userId), readIds);
      void persist(dismissedKey(userId), dismissedIds);
    } catch {
      set({ hydrated: true, userId });
    }
  },

  /**
   * Everything this store holds, gone.
   *
   * `runtimeItems` is the one that actually leaked: unlike `nudge` and `banner`
   * items — rebuilt from current state every time and therefore self-healing —
   * runtime items are pushed in by screens and stay until retracted. A card the
   * Meal tab published about one account's pet survived into the next account's
   * inbox, still naming the wrong animal.
   */
  clearCenter: () => {
    set({
      items: [],
      runtimeItems: [],
      readIds: [],
      dismissedIds: [],
      subscription: null,
      hydrated: false,
      userId: null,
      lastBuiltAt: null,
    });
    invalidateNotificationCenterCaches();
  },

  setSubscriptionSnapshot: snapshot => {
    const current = get().subscription;
    if (current?.status === snapshot.status && current?.daysLeft === snapshot.daysLeft) return;
    set({ subscription: snapshot });
  },

  publish: item => {
    const runtimeItems = get().runtimeItems.filter(i => i.id !== item.id);
    set({ runtimeItems: [...runtimeItems, item] });
    void get().rebuild({ includeRemote: false });
  },

  retract: id => {
    if (!get().runtimeItems.some(i => i.id === id)) return;
    set({ runtimeItems: get().runtimeItems.filter(i => i.id !== id) });
    void get().rebuild({ includeRemote: false });
  },

  rebuild: async (opts) => {
    const includeRemote = opts?.includeRemote ?? true;
    if (get().building) return;
    set({ building: true });

    try {
      if (!get().hydrated) await get().hydrate(get().userId);

      const now = new Date();
      const subscription = get().subscription;
      const pet = useActivePetStore.getState().activePet;

      const [banners, remote] = await Promise.all([
        bannerItems(now, subscription),
        includeRemote
          ? fetchRemoteItems({ petName: pet?.name ?? null, petSex: pet?.gender as never })
          : Promise.resolve(keepExistingRemote(get().items)),
      ]);

      const dismissedIds = new Set(get().dismissedIds);

      const merged = dedupe([
        ...nudgeItems(now),
        ...banners,
        ...get().runtimeItems,
        ...remote,
      ])
        .filter(item => notExpired(item, now))
        // Sticky items ignore dismissal by design — that is what sticky means.
        .filter(item => item.sticky || !dismissedIds.has(item.id))
        .sort(compareItems);

      // Only publish a new array when the feed actually changed.
      //
      // `rebuild` runs on every Home focus and on every today-totals change, and
      // most of those runs produce an identical list. Setting a fresh array
      // regardless would hand a new reference to every subscriber — the tab bar,
      // the bell and the inbox — and re-render all three for nothing.
      const previous = get().items;
      if (!sameFeed(previous, merged)) {
        set({ items: merged, lastBuiltAt: Date.now() });
      } else {
        set({ lastBuiltAt: Date.now() });
      }
    } finally {
      set({ building: false });
    }
  },

  markRead: id => {
    if (get().readIds.includes(id)) return;
    const readIds = [...get().readIds, id];
    set({ readIds });
    void persist(readKey(get().userId), readIds);

    const item = get().items.find(i => i.id === id);
    if (item?.dedupeKey) void markRemoteRead(item.dedupeKey);
  },

  markAllRead: () => {
    const items = get().items;
    // Clinical items are never bulk-cleared. "Mark all read" is a tidying
    // gesture, and letting it silence a call-your-vet item would make the
    // tidiest owners the least informed ones.
    const ids = items.filter(i => i.tone !== 'clinical').map(i => i.id);
    const readIds = Array.from(new Set([...get().readIds, ...ids]));
    set({ readIds });
    void persist(readKey(get().userId), readIds);
    void markAllRemoteRead();
    track('notification_center_mark_all_read', { count: ids.length });
  },

  dismiss: id => {
    const item = get().items.find(i => i.id === id);
    if (!item || item.sticky) return;

    const dismissedIds = Array.from(new Set([...get().dismissedIds, id]));
    set({ dismissedIds, items: get().items.filter(i => i.id !== id) });
    void persist(dismissedKey(get().userId), dismissedIds);

    // Banners that predate the center keep writing their original AsyncStorage
    // keys, so their dismiss windows (14 days for MER, 3 days for profile)
    // continue to apply and nothing resurfaces early.
    void mirrorBannerDismissal(item);
  },
}));

// ── Selectors ───────────────────────────────────────────────────────────────

/**
 * The feed, with read state folded in.
 *
 * A hook rather than a plain selector, and that distinction is load-bearing.
 * Zustand subscribes through `useSyncExternalStore`, which requires the
 * snapshot function to return a *cached* value — React calls it repeatedly and
 * compares by identity to decide whether to re-render. A selector that built
 * `items.map(...)` inline returned a brand-new array every call, so React saw a
 * change on every render and looped until it hit the update-depth limit.
 *
 * Selecting the two raw slices (both stable references, replaced only when they
 * genuinely change) and joining them in `useMemo` gives React something stable
 * to compare while keeping the derivation in one place.
 */
export function useInboxEntries(): InboxEntry[] {
  const items = useNotificationCenterStore(s => s.items);
  const readIds = useNotificationCenterStore(s => s.readIds);
  return useMemo(() => {
    const read = new Set(readIds);
    return items.map(item => ({ ...item, read: isRead(item, read) }));
  }, [items, readIds]);
}

/**
 * Read state, from whichever source knows about it.
 *
 * Locally derived items only ever have the AsyncStorage list. Pushes also carry
 * the server's `read_at`, and that is what makes the center survive a reinstall
 * or a second device: without consulting it, a notification read on a phone
 * would come back unread on a tablet, and every historical push would arrive
 * bold on a fresh install.
 */
function isRead(item: InboxItem, readIds: Set<string>): boolean {
  return readIds.has(item.id) || item.meta?.server_read === true;
}

/**
 * The two below stay plain selectors safely: they return primitives, which
 * `useSyncExternalStore` compares with Object.is, so recomputing them per call
 * is correct even though it allocates a Set.
 */
export function selectUnreadCount(state: NotificationCenterState): number {
  const read = new Set(state.readIds);
  return state.items.reduce((n, item) => (isRead(item, read) ? n : n + 1), 0);
}

/**
 * True when anything unread needs a decision rather than just a glance.
 *
 * This is what turns the bell badge red and lights the tab dot — the entry
 * point has to carry the urgency, because the item itself is now a tap away.
 */
export function selectHasUrgentUnread(state: NotificationCenterState): boolean {
  const read = new Set(state.readIds);
  return state.items.some(item => !isRead(item, read) && isUrgentTone(item.tone));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeParse(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

async function persist(key: string, ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Best-effort. Losing read state is a cosmetic regression, not a failure
    // worth surfacing to the owner.
  }
}

/** Remote items already in the feed, so a local-only rebuild does not drop them. */
function keepExistingRemote(items: InboxItem[]): InboxItem[] {
  return items.filter(i => i.source === 'push');
}

async function mirrorBannerDismissal(item: InboxItem): Promise<void> {
  const petId = item.petId;
  try {
    if (item.id.includes('vet_tuned_nutrition') && petId) {
      await AsyncStorage.setItem(vetTunedDismissKey(petId), '1');
    } else if (item.id.includes('growth_phase') && petId) {
      await AsyncStorage.setItem(growthPhaseDismissKey(petId), '1');
    } else if (item.id.includes('mer_recalibration') && petId) {
      await AsyncStorage.setItem(merRecalibDismissKey(petId), String(Date.now()));
    } else if (item.id.includes('profile_completion') && petId) {
      await AsyncStorage.setItem(profileCompletionDismissKey(petId), String(Date.now()));
    }
  } catch {
    // Best-effort, same reasoning as `persist`.
  }
}

/** Lets a fresh pet selection re-ask for a pending check-in. */
export function invalidateNotificationCenterCaches(): void {
  checkinCache = null;
}
