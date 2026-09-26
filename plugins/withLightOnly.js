// plugins/withLightOnly.js
// The app has one colour scheme and keeps it whatever the phone is set to.
// "userInterfaceStyle": "light" (with expo-system-ui) covers the system dark
// mode; this also stops Android's "force dark", which some Samsung and Xiaomi
// phones apply to every app and which turns input text white on a light field.
const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

module.exports = function withLightOnly(config) {
  return withAndroidStyles(config, (cfg) => {
    const appTheme = AndroidConfig.Styles.getAppThemeGroup();
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: appTheme,
      name: 'android:forceDarkAllowed',
      value: 'false',
    });
    return cfg;
  });
};
