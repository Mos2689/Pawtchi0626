import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
    ReactNode,
} from 'react';
import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage, PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { useAuth } from './AuthProvider';

// Subscription status types
export type SubscriptionStatus = 'loading' | 'trial' | 'active' | 'expired' | 'none';

interface SubscriptionState {
    status: SubscriptionStatus;
    daysLeft: number | null;
    isTrialActive: boolean;
    isPro: boolean;
    daysSinceCreation: number;
    isFreemiumActive: boolean;
    hasFullAccess: boolean;
}

export interface SubscriptionContextValue extends SubscriptionState {
    restorePurchases: () => Promise<void>;
    purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
    getOfferings: () => Promise<PurchasesPackage[]>;
    refresh: () => Promise<void>;
}

const ENTITLEMENT_ID = 'Pawtchi Pro'; // Must match the RevenueCat entitlement identifier
const FREEMIUM_DAYS = 30; // Everyone gets full access for this many days — no gating before it elapses

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

// Single source of truth for subscription/entitlement state. Mount once near the app
// root (inside AuthProvider) so detection runs exactly one time and every screen reads
// the same state via `useSubscription()`.
export function SubscriptionProvider({ children }: { children: ReactNode }) {
    const { session } = useAuth();

    // Default to full access so we NEVER gate before the live state is known.
    const [state, setState] = useState<SubscriptionState>({
        status: 'loading',
        daysLeft: null,
        isTrialActive: false,
        isPro: false,
        daysSinceCreation: 0,
        isFreemiumActive: true,
        hasFullAccess: true,
    });

    // Translate a RevenueCat CustomerInfo snapshot into our state.
    // Access rule: a subscriber always has access; everyone else has full access for the
    // first FREEMIUM_DAYS days (no gating in that window), then is gated.
    const processCustomerInfo = useCallback(
        (customerInfo: CustomerInfo) => {
            let daysSinceCreation = 0;
            let isFreemiumActive = true; // fail open if we can't determine account age
            if (session?.user?.created_at) {
                const createdAt = new Date(session.user.created_at);
                daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
                isFreemiumActive = daysSinceCreation <= FREEMIUM_DAYS;
            }

            const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

            if (entitlement) {
                const isTrial = entitlement.periodType === 'TRIAL';
                const expirationDate = entitlement.expirationDate ? new Date(entitlement.expirationDate) : null;
                const daysLeft = expirationDate
                    ? Math.ceil((expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;

                setState({
                    status: isTrial ? 'trial' : 'active',
                    daysLeft,
                    isTrialActive: isTrial,
                    isPro: true,
                    daysSinceCreation,
                    isFreemiumActive,
                    hasFullAccess: true, // a subscriber always has access
                });
            } else {
                // Distinguish "subscription lapsed" from "never subscribed".
                const allEntitlements = customerInfo.entitlements.all[ENTITLEMENT_ID];
                const hasExpired = allEntitlements && !allEntitlements.isActive;

                setState({
                    status: hasExpired ? 'expired' : 'none',
                    daysLeft: 0,
                    isTrialActive: false,
                    isPro: false,
                    daysSinceCreation,
                    isFreemiumActive,
                    // No gating during the first 30 days; gated only once freemium has elapsed.
                    hasFullAccess: isFreemiumActive,
                });
            }
        },
        [session?.user?.created_at],
    );

    // Keep a live ref so the listener and purchase/restore callbacks always run the
    // latest processor (with the current session) without re-subscribing the listener.
    const processRef = useRef(processCustomerInfo);
    useEffect(() => {
        processRef.current = processCustomerInfo;
    }, [processCustomerInfo]);

    useEffect(() => {
        // RevenueCat is configured in the layout effect, which can run after this provider
        // mounts. Rather than bail when not configured, poll briefly until it is, then
        // attach the listener and read the live entitlement — removing the race that left
        // already-subscribed users unrecognized.
        let cancelled = false;
        let listenerCb: ((info: CustomerInfo) => void) | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempts = 0;
        const MAX_ATTEMPTS = 15; // ~6s; in Expo Go RC never configures, so we stop quietly

        const attach = async () => {
            if (cancelled) return;
            try {
                const configured = await Purchases.isConfigured();
                if (!configured) {
                    if (attempts++ < MAX_ATTEMPTS && !cancelled) {
                        retryTimer = setTimeout(attach, 400);
                    }
                    return;
                }

                if (!listenerCb) {
                    try {
                        listenerCb = (info: CustomerInfo) => {
                            if (!cancelled) processRef.current(info);
                        };
                        Purchases.addCustomerInfoUpdateListener(listenerCb);
                    } catch (e) {
                        console.warn('RevenueCat listener attach failed:', e);
                        listenerCb = null;
                    }
                }

                // Android: reconcile Google Play purchases to the current app user.
                if (Platform.OS === 'android') {
                    try {
                        await Purchases.syncPurchases();
                    } catch {
                        // best-effort
                    }
                }

                const customerInfo = await Purchases.getCustomerInfo();
                if (!cancelled) processRef.current(customerInfo);
            } catch (e: any) {
                if (e?.message && String(e.message).includes('singleton')) {
                    if (attempts++ < MAX_ATTEMPTS && !cancelled) {
                        retryTimer = setTimeout(attach, 400);
                    }
                    return;
                }
                console.error('RevenueCat getCustomerInfo error:', e);
                // Fail open so a transient error never locks users out.
                if (!cancelled) {
                    setState((prev) => ({
                        ...prev,
                        status: 'active',
                        daysLeft: null,
                        isTrialActive: false,
                        isPro: true,
                        hasFullAccess: true,
                    }));
                }
            }
        };

        attach();

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
            if (listenerCb) {
                try {
                    Purchases.removeCustomerInfoUpdateListener(listenerCb);
                } catch {
                    // best-effort
                }
            }
        };
        // Re-run when the identified user changes so entitlements reload after logIn.
    }, [session?.user?.id]);

    const restorePurchases = useCallback(async () => {
        try {
            const customerInfo = await Purchases.restorePurchases();
            processRef.current(customerInfo);
        } catch (e) {
            console.error('Restore error:', e);
        }
    }, []);

    const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
        try {
            const { customerInfo } = await Purchases.purchasePackage(pkg);
            processRef.current(customerInfo);
            return true;
        } catch (e: any) {
            if (e?.userCancelled) {
                return false;
            }
            // The user already owns this subscription (e.g. Play "ITEM_ALREADY_OWNED").
            // Recover by syncing/restoring and reading the live entitlement.
            const alreadyOwned =
                e?.code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR ||
                (typeof e?.message === 'string' && /already (own|subscrib|purchas)/i.test(e.message));
            if (alreadyOwned) {
                try {
                    if (Platform.OS === 'android') {
                        await Purchases.syncPurchases();
                    }
                    const info = await Purchases.getCustomerInfo();
                    processRef.current(info);
                    if (info.entitlements.active[ENTITLEMENT_ID]) {
                        return true;
                    }
                    const restored = await Purchases.restorePurchases();
                    processRef.current(restored);
                    return !!restored.entitlements.active[ENTITLEMENT_ID];
                } catch (recoverErr) {
                    console.warn('Already-owned recovery failed:', recoverErr);
                    // Treat as success to avoid trapping a genuine owner in a buy loop.
                    return true;
                }
            }
            console.error('Purchase error:', e);
            return false;
        }
    }, []);

    const getOfferings = useCallback(async (): Promise<PurchasesPackage[]> => {
        try {
            const offerings = await Purchases.getOfferings();
            if (offerings.current) {
                return offerings.current.availablePackages;
            }
            return [];
        } catch (e) {
            console.error('Offerings error:', e);
            return [];
        }
    }, []);

    const refresh = useCallback(async () => {
        try {
            if (!(await Purchases.isConfigured())) return;
            if (Platform.OS === 'android') {
                try {
                    await Purchases.syncPurchases();
                } catch {
                    // best-effort
                }
            }
            const info = await Purchases.getCustomerInfo();
            processRef.current(info);
        } catch (e) {
            console.warn('Subscription refresh failed:', e);
        }
    }, []);

    const value = useMemo<SubscriptionContextValue>(
        () => ({ ...state, restorePurchases, purchasePackage, getOfferings, refresh }),
        [state, restorePurchases, purchasePackage, getOfferings, refresh],
    );

    return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription(): SubscriptionContextValue {
    const ctx = useContext(SubscriptionContext);
    if (!ctx) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return ctx;
}
