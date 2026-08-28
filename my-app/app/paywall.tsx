/**
 * The paywall route. One route, two presentations.
 *
 * Eleven call sites across the app push `/paywall` — the tabs, ask, inbox,
 * vet-report, support, the walk dock, the split tab bar. None of them changed
 * when the win-back offer was added, and none of them should ever have to: the
 * decision about which price a given person sees belongs here, next to the
 * subscription state, not smeared across every screen that happens to gate a
 * feature.
 *
 * The default is the standard $9.99 screen. `useProOffer` returns 'winback'
 * only after every check passes affirmatively — kill switch on, live grant,
 * variant cohort, window open, impressions remaining, spacing elapsed, not a
 * subscriber, and the discounted offering actually present on this store. Any
 * one of them failing lands here on 'standard'.
 *
 * While the offer is still resolving we render the standard paywall rather than
 * a spinner. It is the correct screen for ~99% of openers, it is what everyone
 * saw before this feature existed, and a loading state in front of the paywall
 * would cost real conversions to save a rare flash.
 */

import React from 'react';
import { StandardPaywall } from '../components/paywall/StandardPaywall';
import { WinbackPaywall } from '../components/paywall/WinbackPaywall';
import { useProOffer } from '../hooks/useProOffer';

export default function PaywallScreen() {
    const { variant, offerPackage, pricing, expiresAt, analyticsProps, markShown } = useProOffer();

    // `offerPackage` and `pricing` are re-checked here as well as inside the
    // hook so the types narrow — and so a future change to the hook cannot
    // produce a win-back screen with a missing or unresolved price on it.
    if (variant === 'winback' && offerPackage && pricing) {
        return (
            <WinbackPaywall
                offerPackage={offerPackage}
                pricing={pricing}
                expiresAt={expiresAt}
                analyticsProps={analyticsProps}
                markShown={markShown}
            />
        );
    }

    return <StandardPaywall />;
}
