type XmlAttributes = Record<string, string>;

type MetaDataItem = {
  $: XmlAttributes;
};

type AndroidManifestFixture = {
  manifest: {
    $: XmlAttributes;
    application: {
      $: XmlAttributes;
      'meta-data'?: MetaDataItem[];
    }[];
  };
};

// The config plugin runs in Node during Expo prebuild and is intentionally
// CommonJS so EAS can load it without a TypeScript compilation step.
const {
  applyFirebaseAndroidPrivacyManifest,
} = require('../plugins/withFirebaseAnalyticsPrivacy') as { // eslint-disable-line @typescript-eslint/no-require-imports
  applyFirebaseAndroidPrivacyManifest: (
    manifest: AndroidManifestFixture,
  ) => AndroidManifestFixture;
};

const EXPECTED_PRIVACY_VALUES = {
  google_analytics_adid_collection_enabled: 'false',
  google_analytics_default_allow_ad_personalization_signals: 'false',
  google_analytics_automatic_screen_reporting_enabled: 'false',
};

function createManifest(): AndroidManifestFixture {
  return {
    manifest: {
      $: {
        'xmlns:android': 'http://schemas.android.com/apk/res/android',
      },
      application: [
        {
          $: {
            'android:name': '.MainApplication',
          },
          'meta-data': [],
        },
      ],
    },
  };
}

describe('Firebase Analytics Android manifest privacy config', () => {
  it('sets privacy-safe values and marks them as app-level overrides', () => {
    const manifest = applyFirebaseAndroidPrivacyManifest(createManifest());
    const application = manifest.manifest.application[0];

    expect(manifest.manifest.$['xmlns:tools']).toBe(
      'http://schemas.android.com/tools',
    );

    for (const [name, value] of Object.entries(EXPECTED_PRIVACY_VALUES)) {
      const item = application['meta-data']?.find(
        (candidate) => candidate.$['android:name'] === name,
      );

      expect(item?.$['android:value']).toBe(value);
      expect(item?.$['tools:replace']?.split(',')).toContain('android:value');
    }
  });

  it('is idempotent across repeated clean Expo prebuilds', () => {
    const manifest = createManifest();

    applyFirebaseAndroidPrivacyManifest(manifest);
    applyFirebaseAndroidPrivacyManifest(manifest);

    const privacyItems = manifest.manifest.application[0]['meta-data']?.filter(
      (item) => item.$['android:name'] in EXPECTED_PRIVACY_VALUES,
    );

    expect(privacyItems).toHaveLength(3);
    for (const item of privacyItems ?? []) {
      expect(item.$['tools:replace']).toBe('android:value');
    }
  });
});
