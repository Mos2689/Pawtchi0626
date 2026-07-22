const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

const ANDROID_FIREBASE_PRIVACY_METADATA = {
  google_analytics_adid_collection_enabled: 'false',
  google_analytics_default_allow_ad_personalization_signals: 'false',
  google_analytics_automatic_screen_reporting_enabled: 'false',
};

function withFirebaseAndroidPrivacy(config) {
  return withAndroidManifest(config, (modConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      modConfig.modResults,
    );

    for (const [name, value] of Object.entries(ANDROID_FIREBASE_PRIVACY_METADATA)) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        mainApplication,
        name,
        value,
      );
    }

    return modConfig;
  });
}

function withFirebaseIosPrivacy(config) {
  return withInfoPlist(config, (modConfig) => {
    modConfig.modResults.FirebaseAutomaticScreenReportingEnabled = false;
    modConfig.modResults.GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS = false;
    return modConfig;
  });
}

module.exports = function withFirebaseAnalyticsPrivacy(config) {
  return withFirebaseIosPrivacy(withFirebaseAndroidPrivacy(config));
};

