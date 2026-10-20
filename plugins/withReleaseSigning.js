// plugins/withReleaseSigning.js
// Store builds are signed with the Play upload key. Gradle only switches to it
// when the UPLOAD_* properties are passed in (the AAB workflow does that from
// repository secrets); plain `assembleRelease` test APKs stay debug-signed.
const { withAppBuildGradle } = require('expo/config-plugins');

function insertReleaseSigningConfig(contents) {
  const start = contents.indexOf('signingConfigs {');
  if (start < 0) throw new Error('withReleaseSigning: signingConfigs block not found');
  let depth = 0;
  let i = contents.indexOf('{', start);
  for (; i < contents.length; i++) {
    if (contents[i] === '{') depth++;
    if (contents[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const releaseBlock = `    release {
            if (project.hasProperty('UPLOAD_STORE_FILE')) {
                storeFile file(UPLOAD_STORE_FILE)
                storePassword UPLOAD_STORE_PASSWORD
                keyAlias UPLOAD_KEY_ALIAS
                keyPassword UPLOAD_KEY_PASSWORD
            }
        }
    `;
  return contents.slice(0, i) + releaseBlock + contents.slice(i);
}

function pointReleaseBuildTypeAtIt(contents) {
  const buildTypes = contents.indexOf('buildTypes {');
  const release = contents.indexOf('release {', buildTypes);
  const sig = contents.indexOf('signingConfig signingConfigs.debug', release);
  if (buildTypes < 0 || release < 0 || sig < 0) {
    throw new Error('withReleaseSigning: release buildType signingConfig not found');
  }
  const replacement =
    "signingConfig project.hasProperty('UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug";
  return (
    contents.slice(0, sig) + replacement + contents.slice(sig + 'signingConfig signingConfigs.debug'.length)
  );
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected a Groovy app/build.gradle');
    }
    let s = cfg.modResults.contents;
    if (!s.includes('signingConfigs.release')) {
      s = insertReleaseSigningConfig(s);
      s = pointReleaseBuildTypeAtIt(s);
    }
    cfg.modResults.contents = s;
    return cfg;
  });
};
