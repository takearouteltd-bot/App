// plugins/withNotificationColorOverride.js
// expo-notifications and @react-native-firebase/messaging both declare the
// default_notification_color meta-data, so the Android manifest merger fails
// ("is also present at [:react-native-firebase_messaging]"). This marks our
// value as the one that wins, which is what the merger's own suggestion asks
// for. Keep it in the plugins list after expo-notifications.
const { withAndroidManifest } = require('expo/config-plugins');

const META = 'com.google.firebase.messaging.default_notification_color';

module.exports = function withNotificationColorOverride(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const app = manifest.application && manifest.application[0];
    if (!app) return cfg;
    app['meta-data'] = app['meta-data'] || [];
    const entry = app['meta-data'].find((item) => item.$ && item.$['android:name'] === META);
    if (entry) {
      entry.$['tools:replace'] = 'android:resource';
    } else {
      app['meta-data'].push({
        $: {
          'android:name': META,
          'android:resource': '@color/notification_icon_color',
          'tools:replace': 'android:resource',
        },
      });
    }
    return cfg;
  });
};
