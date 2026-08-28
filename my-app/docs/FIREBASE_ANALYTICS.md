# Firebase Analytics in Pawtchi

## Purpose

PostHog remains Pawtchi's primary product analytics system, including product events and screen analytics. Firebase exists only as a narrow Google Ads acquisition and subscription-value measurement bridge. The Firebase adapter is a runtime allowlist; it never forwards arbitrary PostHog event names or properties.

Firebase Analytics also emits its platform-reserved lifecycle/attribution events, such as `first_open` and `session_start`. Automatic Firebase screen reporting is disabled on both platforms.

## Native configuration

The app requires these files at the Expo app root:

- `./GoogleService-Info.plist` for iOS bundle ID `com.heymousami.myapp`
- `./google-services.json` for Android package `com.pawtchi.app`

Do not edit these service files. `app.config.ts` references both files and configures the official React Native Firebase Expo plugins. iOS uses static frameworks, links only `RNFBApp` and `RNFBAnalytics`, omits Firebase AdSupport/IDFA support, and includes the supported event-data on-device conversion measurement pod. Android disables Firebase Advertising ID collection and ad-personalisation signals. Firebase automatic screen reporting is disabled in native configuration and `firebase.json`.

React Native Firebase is native code and does not run in Expo Go. Use a development or production build.

## Event contract

| Firebase event | Genuine success boundary | Firebase parameters |
| --- | --- | --- |
| `sign_up` | Supabase creates a new account and returns a session | `method: "password"` |
| `pet_profile_completed` | The onboarding `pets` insert succeeds — from either the full health onboarding or the walk-first path | None |
| `calorie_goal_created` | The same successful insert persists `target_daily_calories` | None |
| `first_food_logged` | The user's lifetime-first food scan and daily intake save succeed | None |
| `first_walk_completed` | The user's lifetime-first walk the validator calls `valid`, confirmed saved | None |
| `activity_plan_created` | `generate-schedule` confirms the personalised plan was saved | None |
| `trial_started` | RevenueCat returns an active trial entitlement with a verified response | None |
| `purchase` | RevenueCat returns an active paid entitlement with a verified response | `transaction_id`; optional `currency`, `value`, and `items[0].item_id` product ID |

`pet_profile_completed` fires from both onboarding routes. The walk-first route (a dog owner leaving after step two) additionally does **not** emit `calorie_goal_created`, because it sets no `target_daily_calories` — the health profile is deferred behind per-feature gates. Before this mapping existed the walk-first route emitted nothing at all, which since the walk-first pivot meant the moment most new owners activate was invisible to Google Ads.

`first_walk_completed` is the walk-side activation counterpart to `first_food_logged`. Both sides of "first" use the validator's `valid` verdict, so an owner whose first outing was too short or GPS-junk still activates on their first real walk. It is gated on a confirmed save: a walk still sitting in the offline sync queue does not count, because a conversion reported for a row that may never land is a lie told to a bidding algorithm. The trade is that a first walk finished entirely offline is never counted.

`purchase` is deduplicated by store transaction ID for the running app session. RevenueCat entitlement verification runs in informational mode so Pawtchi's existing access behavior is preserved; Firebase trial/purchase measurement requires `VERIFIED` or `VERIFIED_ON_DEVICE`.

Because informational mode still grants access, an unverified entitlement is a silent conversion loss: the owner is subscribed, the app behaves normally, and only Google Ads is missing the revenue. `SubscriptionProvider` therefore emits the product-analytics event `purchase_conversion_unverified` (with the verification status and period type) on that branch. It is not in the Firebase allowlist and never reaches Google Ads — it exists so the loss is diagnosable in PostHog instead of invisible. A non-zero rate means checking RevenueCat's verification configuration.

## Privacy exclusions

Firebase must never receive emails, names, pet names, pet photos, breed, weight, medical or health notes, calorie values, food names, activity details, walk routes, coordinates, place labels, walk distances or durations, free-form text, screen views, touch events, or arbitrary PostHog properties. The adapter rebuilds every parameter object from the table above and drops everything else.

Firebase identity accepts only a Supabase-format internal UUID. It is set after authentication and cleared when the session ends. Email is never used as a Firebase user ID. Do not call Firebase's email/phone on-device conversion APIs; this integration uses only de-identified event-data conversion measurement. Do not add AdMob, Google Mobile Ads, ATT, IDFA, remarketing audiences, or manual screen tracking for Firebase.

## Build commands

Install a fresh development binary after any native Firebase/config change:

```sh
npx eas build --platform android --profile development
npx eas build --platform ios --profile development
npx expo start --dev-client
```

Local native builds, when the required Android/macOS tooling is available:

```sh
npx expo run:android
npx expo run:ios
```

Production:

```sh
npx eas build --platform all --profile production
```

Do not use Expo Go for validation. Do not run a destructive `expo prebuild --clean` over native work; EAS can generate from the checked-in Expo configuration.

## Realtime and DebugView validation

1. Install a newly built development binary, sign in with a test account, and open Firebase Console > Analytics > Realtime. Exercise each genuine success flow and confirm only the contract above appears from Pawtchi code.
2. For Android DebugView, run `adb shell setprop debug.firebase.analytics.app com.pawtchi.app`, restart the app, then open Firebase Console > Analytics > DebugView. Disable afterward with `adb shell setprop debug.firebase.analytics.app .none.`
3. For iOS DebugView, run a local development build from Xcode with `-FIRDebugEnabled` in the scheme's launch arguments. Disable with `-FIRDebugDisabled`. An EAS development build can still be checked in Realtime without this Xcode argument.
4. Inspect `sign_up` and `purchase` parameters. Confirm milestone events contain no parameters, `purchase` contains only the approved value contract, and the Firebase user ID is the internal UUID.
5. Confirm no `screen_view` events are emitted while navigating. Platform-reserved lifecycle/attribution events are expected.

Official reference: [Firebase DebugView](https://firebase.google.com/docs/analytics/debugview).

## Google Ads linking and conversion import

This is console configuration only; it does not require campaign creation or changes.

1. Wait until the validated events appear in the linked GA4/Firebase property. In GA4 Admin > Events, mark only the approved optimization events as key events. Keep `purchase` configured with its event value/currency.
2. In Google Ads, open Admin/Data manager, choose Google Analytics (GA4) and Firebase, select the Pawtchi property/project, and link it. Keep audience import/sharing disabled because this integration is measurement-only and not for remarketing.
3. In Google Ads, open Goals > Summary > Create conversion action, select the linked Google Analytics property, choose the desired Pawtchi key events, and save. Review primary/secondary action settings before using any event for bidding.
4. Imported conversions start collecting after import; historical events are not backfilled. Recheck conversion diagnostics after live production traffic arrives.

Official references: [link Firebase/GA4 to Google Ads](https://support.google.com/google-ads/answer/15929380) and [create conversions from Analytics events](https://support.google.com/google-ads/answer/2375435).
