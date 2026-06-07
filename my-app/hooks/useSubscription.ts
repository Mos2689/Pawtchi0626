// Subscription state now lives in a single shared provider so detection runs once for
// the whole app. This module is kept as a thin re-export so existing import paths
// (`hooks/useSubscription`) continue to work unchanged.
export { useSubscription } from '../providers/SubscriptionProvider';
export type { SubscriptionStatus, SubscriptionContextValue } from '../providers/SubscriptionProvider';
