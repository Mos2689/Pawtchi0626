/**
 * The walk Live Activity's widget extension.
 *
 * `@bacons/apple-targets` generates the Xcode target from this folder on every
 * prebuild, so the extension never has to live in a checked-in `/ios`
 * directory — the same managed-workflow contract as the rest of the app. The
 * whole folder is synchronized into the target, so the .swift files, the
 * bundled Montserrat faces and Assets.xcassets are picked up with no manifest.
 *
 * Deployment target is 16.2, not the plugin's 18.0 default and not ActivityKit's
 * own 16.1 floor: `ActivityContent` — the type the app module uses to attach a
 * staleDate to every update — landed in 16.2, and a Live Activity with no
 * staleDate is one that can visibly outlive its walk.
 *
 * `frameworks` is omitted because the plugin already links WidgetKit, SwiftUI,
 * ActivityKit and AppIntents for every `widget` target.
 *
 * Note: prebuild logs a warning that this target "may require the App Groups
 * entitlement". It does not. App groups are for sharing files with the main app
 * (a pet photo would need one); this card is drawn entirely from the payload
 * ActivityKit already carries, so it shares nothing and needs no extra
 * provisioning.
 */
module.exports = () => ({
  type: 'widget',
  name: 'WalkActivity',
  displayName: 'Pawtchi Walk',
  bundleIdentifier: '.WalkActivity',
  deploymentTarget: '16.2',
});
