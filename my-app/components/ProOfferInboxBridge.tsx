/**
 * Publishes the win-back offer into the notification centre, and retracts it
 * when the window closes.
 *
 * ── Why the inbox and not a push ────────────────────────────────────────────
 *
 * The offer's primary surface is the paywall itself: an eligible user who taps
 * a gated feature lands on the win-back screen instead of the standard one.
 * That is contextual and unavoidable in the good sense — they went looking for
 * the thing they cannot have.
 *
 * This entry is the quiet second surface, for someone who is eligible but does
 * not happen to hit a gate during the window. A push was the alternative and
 * was deliberately not built: a price notification reads as a sale, which is
 * the one register this product does not use. The inbox is the version of
 * "there is something for you" that waits to be found.
 *
 * It is one persistent entry for the whole window, not a repeat impression —
 * `stableId` with the grant's expiry as scope keeps it a single item, and
 * `expiresAt` drops it out of the feed automatically when the window ends.
 *
 * Reading this item never burns an offer impression. Impressions are spent by
 * the paywall painting, in `record_pro_offer_impression`.
 */

import { useEffect, useRef } from 'react';
import { useNotificationCenterStore } from '../store/useNotificationCenterStore';
import { useActivePetStore } from '../store/useActivePetStore';
import { useProOffer } from '../hooks/useProOffer';
import { stableId } from '../lib/notificationCenter/stableId';
import { track } from '../lib/analytics';
import {
    OFFER_INBOX_ICON,
    OFFER_INBOX_TITLE,
    offerInboxBody,
} from '../lib/proOffer/copy';

const ITEM_KEY = 'pro_offer';

export function ProOfferInboxBridge() {
    const { variant, config, grant, expiresAt, analyticsProps } = useProOffer();
    const publish = useNotificationCenterStore(s => s.publish);
    const retract = useNotificationCenterStore(s => s.retract);
    const activePet = useActivePetStore(s => s.activePet);

    // The id currently in the feed, so a closing window retracts the exact item
    // it published rather than guessing at a scope that may have moved.
    const publishedIdRef = useRef<string | null>(null);

    useEffect(() => {
        const shouldShow = variant === 'winback' && config.inboxEnabled && !!grant && !!expiresAt;

        if (!shouldShow) {
            if (publishedIdRef.current) {
                retract(publishedIdRef.current);
                publishedIdRef.current = null;
            }
            return;
        }

        // Scoped to the window rather than the day: this is one offer with one
        // deadline, and a day-scoped id would mark it unread every morning.
        const id = stableId('runtime', ITEM_KEY, grant!.expiresAt);
        if (publishedIdRef.current === id) return;

        publish({
            id,
            source: 'runtime',
            // `info`, not `action`. An `action` tone turns the bell badge red
            // and lights the tab dot, and a red badge is what the app uses to
            // say "a vet should be involved". A price is not that.
            tone: 'info',
            title: OFFER_INBOX_TITLE,
            body: offerInboxBody({ name: activePet?.name, gender: activePet?.gender }),
            icon: OFFER_INBOX_ICON,
            createdAt: new Date().toISOString(),
            route: '/paywall',
            petId: activePet?.id ?? null,
            // Falls out of the feed on the first rebuild after the window ends,
            // even if this bridge never re-runs.
            expiresAt: grant!.expiresAt,
            meta: {
                cohort: grant!.cohort,
                config_version: config.configVersion,
            },
        });
        publishedIdRef.current = id;
        track('pro_offer_inbox_shown', analyticsProps);
    }, [
        variant,
        config.inboxEnabled,
        config.configVersion,
        grant,
        expiresAt,
        activePet?.id,
        activePet?.name,
        activePet?.gender,
        publish,
        retract,
        analyticsProps,
    ]);

    return null;
}
