import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { track } from '@/lib/analytics';
import {
  engagementSendFromUrl,
  isAppSchemeLink,
  routeForUrl,
} from '@/lib/notifications/deepLink';

/**
 * Routes an emailed universal link to the right screen.
 *
 * ── Why this hook exists ────────────────────────────────────────────────────
 *
 * `routeForUrl()` and the `.well-known` association files were both in place
 * before this, and neither did anything: the OS would hand the app a
 * `https://pawtchi.com/app/health` URL and nothing was listening, so every
 * emailed link opened the app on whatever screen it happened to restore to.
 * That is the same class of bug the August 2026 audit found on the push side,
 * where `routeFromNotification` branched on a key nobody set and every tap fell
 * through to nowhere.
 *
 * A link that opens the app but lands in the wrong place is arguably worse than
 * one that opens Safari — the owner was promised a specific thing ("see where
 * she kept stopping") and gets a home screen.
 *
 * ── Both entry points are needed ────────────────────────────────────────────
 *
 * `getInitialURL()` covers a cold start: the app was not running, the OS
 * launched it with the URL. The `url` event covers a warm one: the app was
 * already backgrounded and is being foregrounded with a new link. Handling only
 * the second is the more common mistake and it breaks the more common case,
 * because an owner reading email on their phone usually does not have Pawtchi
 * open behind it.
 *
 * Deliberately mirrors `handleNotificationResponse` in usePushNotifications:
 * same tracking shape, and the same rule that no route beats an arbitrary one.
 */
export function useEmailDeepLinks() {
  const router = useRouter();
  // Guards against the cold-start URL being handled twice — on some Android
  // builds getInitialURL() resolves and the `url` event also fires for the
  // same link, which would push the route onto the stack twice.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handle = (url: string | null) => {
      if (!url || cancelled) return;
      if (handled.current === url) return;
      handled.current = url;

      const route = routeForUrl(url);
      // `pawtchi:///(tabs)/health` — what engagement-click redirects to. Expo
      // Router resolves it natively through the same getStateFromPath that
      // router.push() uses, so pushing it again here would put the same screen
      // on the stack twice and leave a back gesture that goes nowhere.
      const routedByExpoRouter = isAppSchemeLink(url);

      track('email_link_opened', {
        routed: Boolean(route),
        route,
        // The path only. Never the full URL: the unsubscribe token and any
        // future query parameters are per-owner secrets and must not reach
        // an analytics sink.
        path: safePath(url),
        // A ledger row id, so a session can be joined back to the email that
        // started it. Not a secret and not an identifier for the person.
        engagementSend: engagementSendFromUrl(url),
        source: routedByExpoRouter ? 'app_scheme' : 'universal_link',
      });

      if (route && !routedByExpoRouter) router.push(route as never);
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [router]);
}

/** Path without host, query or fragment — safe to put in an analytics event. */
function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
