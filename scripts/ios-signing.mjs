// Switches the generated iOS project's app target to manual App Store signing, after
// `expo prebuild`. Only the takearoute target changes; the Pods keep their own settings.
//
//   node scripts/ios-signing.mjs "TakeARoute App Store" <TEAM_ID>
//
// The team has no registered devices, so Xcode's automatic signing (which archives with a
// development profile) can't be used. The certificate and profile are made once with
// scripts/asc-setup.mjs; CI installs them from repo secrets.
import { readFileSync, writeFileSync } from 'node:fs';

const [profile, team] = process.argv.slice(2);
if (!profile || !team) throw new Error('Usage: node scripts/ios-signing.mjs <profile name> <team id>');

const path = 'ios/takearoute.xcodeproj/project.pbxproj';
const anchor = /^(\s*)CODE_SIGN_ENTITLEMENTS = takearoute\/takearoute\.entitlements;$/gm;
let count = 0;
const out = readFileSync(path, 'utf8').replace(anchor, (line, indent) => {
  count++;
  return [
    line,
    `${indent}CODE_SIGN_STYLE = Manual;`,
    `${indent}CODE_SIGN_IDENTITY = "Apple Distribution";`,
    `${indent}"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";`,
    `${indent}DEVELOPMENT_TEAM = ${team};`,
    `${indent}PROVISIONING_PROFILE_SPECIFIER = "${profile}";`,
  ].join('\n');
});
// One Debug and one Release configuration for the app target.
if (count !== 2) throw new Error(`Expected 2 app target configurations, found ${count}`);
writeFileSync(path, out);
console.log(`App target set to manual signing with "${profile}"`);
