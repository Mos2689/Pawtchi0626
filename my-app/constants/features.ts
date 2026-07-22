import featureFlags from './featureFlags.json';

/**
 * The single source of truth for release-level feature availability.
 *
 * `app.config.ts` consumes the same JSON manifest to add/remove permissions,
 * background modes, and Expo plugin options. Runtime entry points consume the
 * aliases below. A feature must never need a second release toggle elsewhere.
 */
export const FEATURE_FLAGS = Object.freeze(featureFlags);

export const WALK_TRACKING_ENABLED = FEATURE_FLAGS.walkTracking;
