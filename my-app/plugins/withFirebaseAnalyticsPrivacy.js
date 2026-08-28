const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const ANDROID_FIREBASE_PRIVACY_METADATA = {
  google_analytics_adid_collection_enabled: 'false',
  google_analytics_default_allow_ad_personalization_signals: 'false',
  google_analytics_automatic_screen_reporting_enabled: 'false',
};

const TOOLS_NAMESPACE = 'http://schemas.android.com/tools';

function addToolsReplaceAttribute(metaDataItem) {
  const attributes = metaDataItem.$ ?? (metaDataItem.$ = {});
  const replacedAttributes = new Set(
    String(attributes['tools:replace'] ?? '')
      .split(',')
      .map((attribute) => attribute.trim())
      .filter(Boolean),
  );

  replacedAttributes.add('android:value');
  attributes['tools:replace'] = Array.from(replacedAttributes).join(',');
}

function applyFirebaseAndroidPrivacyManifest(androidManifest) {
  const manifestAttributes =
    androidManifest.manifest.$ ?? (androidManifest.manifest.$ = {});
  manifestAttributes['xmlns:tools'] = TOOLS_NAMESPACE;

  const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
    androidManifest,
  );

  for (const [name, value] of Object.entries(ANDROID_FIREBASE_PRIVACY_METADATA)) {
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      mainApplication,
      name,
      value,
    );

    const metaDataItem = mainApplication['meta-data']?.find(
      (item) => item.$?.['android:name'] === name,
    );

    if (!metaDataItem) {
      throw new Error(`Unable to configure Firebase Analytics metadata: ${name}`);
    }

    // RNFirebase declares these same entries in its library manifest with
    // Gradle placeholders. Explicitly keep Pawtchi's privacy-safe values when
    // Android merges the generated app manifest with the library manifest.
    addToolsReplaceAttribute(metaDataItem);
  }

  return androidManifest;
}

function withFirebaseAndroidPrivacy(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyFirebaseAndroidPrivacyManifest(modConfig.modResults);
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

module.exports.applyFirebaseAndroidPrivacyManifest =
  applyFirebaseAndroidPrivacyManifest;
