// plugins/withPodsMinimumIos.js
// Xcode 27 refuses any target set below iOS 15, and several pods (Stripe,
// Google Maps, Firebase helpers, AsyncStorage) still declare 9 to 14 for
// their resource bundles. Raise every pod target that is below the app's
// minimum to it after `pod install`.
// Xcode 27's clang also rejects fmt's compile-time format checks (consteval),
// which React Native pulls in; fmt is built as C++17, where fmt leaves them
// out.
const { withPodfile } = require('expo/config-plugins');

const MIN_IOS = '15.1';
const MARK = '# withPodsMinimumIos';

module.exports = function withPodsMinimumIos(config) {
  return withPodfile(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    cfg.modResults.contents = src.replace(
      // After react_native_post_install, which sets every pod's C++ standard.
      /react_native_post_install\([\s\S]*?\n {4}\)\n/,
      (m) => `${m}    ${MARK}
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |c|
        v = c.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}' if v.nil? || Gem::Version.new(v) < Gem::Version.new('${MIN_IOS}')
        c.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' if t.name == 'fmt'
      end
    end
`,
    );
    return cfg;
  });
};
