import type { ExpoConfig } from 'expo/config';

/**
 * Expo config as TypeScript rather than JSON, because two values here genuinely
 * differ per developer and per deployment and must not be hardcoded:
 *
 *   • APPLE_TEAM_ID — required to build the iOS share extension. A placeholder in
 *     committed JSON would produce a silently broken build.
 *   • APP_ORIGIN — where the API routes are served from.
 *
 * Neither is a secret, so both are ordinary build-time env vars.
 */

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'https://repurpose.example.com';

/** The iOS app and its share extension exchange the payload through this group. */
const APP_GROUP = 'group.app.repurpose.mvp';

const config: ExpoConfig = {
  name: 'Repurpose',
  slug: 'repurpose',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'repurpose',
  userInterfaceStyle: 'dark',
  // The new architecture is the only one from SDK 54 onward; the opt-in flag is gone.

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'app.repurpose.mvp',
    // Omitted rather than faked when unset: an obviously-wrong team id fails later
    // and less clearly than a missing one.
    ...(APPLE_TEAM_ID ? { appleTeamId: APPLE_TEAM_ID } : {}),
    entitlements: {
      'com.apple.security.application-groups': [APP_GROUP],
    },
  },

  android: {
    package: 'app.repurpose.mvp',
    adaptiveIcon: {
      backgroundColor: '#0B0D10',
      foregroundImage: './assets/images/adaptive-icon.png',
    },
    // Edge-to-edge is the default from SDK 54 onward; the opt-in flag is gone.
  },

  web: {
    // 'server' so the API routes deploy alongside the app.
    output: 'server',
    bundler: 'metro',
    favicon: './assets/images/favicon.png',
  },

  plugins: [
    ['expo-router', { origin: APP_ORIGIN }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B0D10',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Repurpose needs access to your videos so it can turn a saved workout video into a workout you can follow.',
      },
    ],
    [
      'expo-share-intent',
      {
        // What a shared fitness video actually carries: a link, the video itself,
        // or a sentence with the link inside it.
        iosActivationRules: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsMovieWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
        },
        iosShareExtensionName: 'Repurpose',
        iosAppGroupIdentifier: APP_GROUP,
        androidIntentFilters: ['text/*', 'video/*'],
      },
    ],
  ],

  experiments: {
    typedRoutes: false,
  },
};

export default config;
