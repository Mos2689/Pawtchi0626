import { useState, useEffect, useCallback } from 'react';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { useAuth } from '../providers/AuthProvider';

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

const ENTITLEMENT_ID = 'pro'; // Must match your RevenueCat entitlement identifier

export function useSubscription(): SubscriptionState & {
    restorePurchases: () => Promise<void>;
    purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
    getOfferings: () => Promise<PurchasesPackage[]>;
} {
    const { session } = useAuth();
    const [state, setState] = useState<SubscriptionState>({
        status: 'loading',
        daysLeft: null,
        isTrialActive: false,
        isPro: false,
        daysSinceCreation: 0,
        isFreemiumActive: true,
        hasFullAccess: true,
    });

    useEffect(() => {
        checkSubscription();

        // Listen for subscription changes (may fail in Expo Go)
        let listener: any = null;
        try {
            listener = Purchases.addCustomerInfoUpdateListener((info) => {
                processCustomerInfo(info);
            });
        } catch (e) {
            console.warn('RevenueCat listener not available (Expo Go):', e);
        }

        return () => {
            if (listener && typeof listener.remove === 'function') {
                listener.remove();
            }
        };
    }, []);

    const processCustomerInfo = (customerInfo: CustomerInfo) => {
        let currentDaysSinceCreation = 0;
        let isFreemiumActive = true;
        
        if (session?.user?.created_at) {
            const createdAt = new Date(session.user.created_at);
            currentDaysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            // Freemium is active if less than 30 days old and they don't have a subscription
            isFreemiumActive = currentDaysSinceCreation <= 30;
        }

        const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];

        if (entitlement) {
            const isTrial = entitlement.periodType === 'TRIAL';
            const expirationDate = entitlement.expirationDate
                ? new Date(entitlement.expirationDate)
                : null;
            const now = new Date();
            const daysLeft = expirationDate
                ? Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                : null;

            setState(prev => ({
                ...prev,
                status: isTrial ? 'trial' : 'active',
                daysLeft,
                isTrialActive: isTrial,
                isPro: true,
                daysSinceCreation: currentDaysSinceCreation,
                isFreemiumActive,
                hasFullAccess: true, // Pro always has full access
            }));
        } else {
            // Check if user ever had a subscription (expired) vs never subscribed
            const allEntitlements = customerInfo.entitlements.all[ENTITLEMENT_ID];
            const hasExpired = allEntitlements && !allEntitlements.isActive;
            const newStatus = hasExpired ? 'expired' : 'none';

            setState(prev => ({
                ...prev,
                status: newStatus,
                daysLeft: 0,
                isTrialActive: false,
                isPro: false,
                daysSinceCreation: currentDaysSinceCreation,
                isFreemiumActive,
                hasFullAccess: isFreemiumActive, // If no pro, full access only if freemium is active
            }));
        }
    };

    const checkSubscription = async () => {
        try {
            const isConfigured = await Purchases.isConfigured();
            if (!isConfigured) {
                // Skip if not yet configured, a listener will typically catch them once configured
                return;
            }
            const customerInfo = await Purchases.getCustomerInfo();
            processCustomerInfo(customerInfo);
        } catch (e: any) {
            if (e?.message && e.message.includes('singleton')) {
                // Ignore early unconfigured errors
                return;
            }
            console.error('RevenueCat getCustomerInfo error:', e);
            // Default to allowing access on error to avoid locking users out
            setState(prev => ({
                ...prev,
                status: 'active',
                daysLeft: null,
                isTrialActive: false,
                isPro: true,
                hasFullAccess: true,
            }));
        }
    };

    const restorePurchases = useCallback(async () => {
        try {
            const customerInfo = await Purchases.restorePurchases();
            processCustomerInfo(customerInfo);
        } catch (e) {
            console.error('Restore error:', e);
        }
    }, []);

    const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
        try {
            const { customerInfo } = await Purchases.purchasePackage(pkg);
            processCustomerInfo(customerInfo);
            return true;
        } catch (e: any) {
            if (!e.userCancelled) {
                console.error('Purchase error:', e);
            }
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

    return { ...state, restorePurchases, purchasePackage, getOfferings };
}
