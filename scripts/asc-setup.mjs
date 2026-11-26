// One-time Apple setup for the iPhone app, through the App Store Connect API.
//
//   node scripts/asc-setup.mjs <KEY_ID> <ISSUER_ID> <path/to/AuthKey_KEY_ID.p8>
//
// 1. Registers the App ID com.takearoute.app (if missing) with Push Notifications and
//    Time Sensitive Notifications.
// 2. Makes an Apple Distribution certificate (new private key + CSR made here).
// 3. Makes the "TakeARoute App Store" provisioning profile for that certificate.
// 4. Stores everything as GitHub secrets for .github/workflows/build-ipa.yml, and the team id
//    (read from the profile) as the APPLE_TEAM_ID repo variable.
//
// The key, certificate and profile are also kept in ~/Developer/takearoute/keys/ios (outside
// the repo). The key needs the Admin role. Run from the App folder with gh signed in as the
// TakeARoute account.
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BUNDLE = 'com.takearoute.app';
const PROFILE_NAME = 'TakeARoute App Store';
const OUT = join(homedir(), 'Developer/takearoute/keys/ios');

const [keyId, issuerId, p8Path] = process.argv.slice(2);
if (!keyId || !issuerId || !p8Path) {
  throw new Error('Usage: node scripts/asc-setup.mjs <KEY_ID> <ISSUER_ID> <AuthKey.p8>');
}
const p8 = readFileSync(p8Path, 'utf8');
mkdirSync(OUT, { recursive: true });

const b64url = (b) => Buffer.from(b).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`),
    { key: createPrivateKey(p8), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

async function asc(method, path, data) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify({ data }) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json.errors || json)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// 1. App ID and capabilities
let bundle = (await asc('GET', `/v1/bundleIds?filter[identifier]=${BUNDLE}&limit=5`)).data
  .find((b) => b.attributes.identifier === BUNDLE);
if (!bundle) {
  bundle = (await asc('POST', '/v1/bundleIds', {
    type: 'bundleIds',
    attributes: { identifier: BUNDLE, name: 'TakeARoute', platform: 'IOS' },
  })).data;
  console.log(`Registered App ID ${BUNDLE}`);
} else {
  console.log(`App ID ${BUNDLE} already registered`);
}
const have = new Set((await asc('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data
  .map((c) => c.attributes.capabilityType));
for (const capabilityType of ['PUSH_NOTIFICATIONS', 'USERNOTIFICATIONS_TIMESENSITIVE']) {
  if (have.has(capabilityType)) continue;
  try {
    await asc('POST', '/v1/bundleIdCapabilities', {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } },
    });
    console.log(`Turned on ${capabilityType}`);
  } catch (e) {
    // The API does not know every capability (Time Sensitive Notifications is one).
    console.log(`!! Could not turn on ${capabilityType} through the API. Tick it on the App ID in developer.apple.com, then run this again.`);
  }
}

// 2. Distribution certificate (key and CSR made here with the system openssl). A run after
//    the first reuses the certificate kept in OUT, as long as Apple still has it, so running
//    again (say after ticking a capability) only remakes the profile.
const keyPem = join(OUT, 'dist.key');
const p12 = join(OUT, 'dist.p12');
const certIdFile = join(OUT, 'dist.cert-id');
let cert = null;
let p12Password = null;
if (existsSync(certIdFile) && existsSync(p12)) {
  const id = readFileSync(certIdFile, 'utf8').trim();
  cert = await asc('GET', `/v1/certificates/${id}`).then((r) => r.data).catch(() => null);
  if (cert) {
    p12Password = readFileSync(join(OUT, 'dist.p12.password'), 'utf8').trim();
    console.log(`Reusing distribution certificate ${cert.id}`);
  }
}
if (!cert) {
  const csr = join(OUT, 'dist.csr');
  execFileSync('/usr/bin/openssl', ['genrsa', '-out', keyPem, '2048'], { stdio: 'ignore' });
  execFileSync('/usr/bin/openssl', ['req', '-new', '-key', keyPem, '-out', csr,
    '-subj', '/CN=TakeARoute Distribution/O=TakeARoute/C=GB']);
  cert = (await asc('POST', '/v1/certificates', {
    type: 'certificates',
    attributes: { certificateType: 'DISTRIBUTION', csrContent: readFileSync(csr, 'utf8') },
  })).data;
  const der = join(OUT, 'dist.cer');
  writeFileSync(der, Buffer.from(cert.attributes.certificateContent, 'base64'));
  const certPem = join(OUT, 'dist.pem');
  execFileSync('/usr/bin/openssl', ['x509', '-inform', 'DER', '-in', der, '-out', certPem]);
  p12Password = randomBytes(12).toString('hex');
  execFileSync('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', keyPem, '-in', certPem,
    '-out', p12, '-passout', `pass:${p12Password}`]);
  writeFileSync(join(OUT, 'dist.p12.password'), p12Password + '\n', { mode: 0o600 });
  writeFileSync(certIdFile, cert.id + '\n');
  console.log(`Made distribution certificate ${cert.id} (expires ${cert.attributes.expirationDate})`);
}

// 3. App Store profile (any old one with the same name is replaced)
const old = (await asc('GET', `/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}`)).data;
for (const p of old) await asc('DELETE', `/v1/profiles/${p.id}`);
const profile = (await asc('POST', '/v1/profiles', {
  type: 'profiles',
  attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
  relationships: {
    bundleId: { data: { type: 'bundleIds', id: bundle.id } },
    certificates: { data: [{ type: 'certificates', id: cert.id }] },
  },
})).data;
const profilePath = join(OUT, 'takearoute-app-store.mobileprovision');
// The time-sensitive entitlement in app.json must be in the profile, or signing fails.
writeFileSync(profilePath, Buffer.from(profile.attributes.profileContent, 'base64'));
const plist = execFileSync('/usr/bin/security', ['cms', '-D', '-i', profilePath]).toString();
const team = plist.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([A-Z0-9]+)<\/string>/)[1];
console.log(`Made profile "${PROFILE_NAME}" (team ${team}, expires ${profile.attributes.expirationDate})`);

// 4. GitHub secrets and the team id variable
const secret = (name, value) => execFileSync('gh', ['secret', 'set', name], { input: value });
secret('ASC_KEY_ID', keyId);
secret('ASC_ISSUER_ID', issuerId);
secret('ASC_KEY_P8', p8);
secret('IOS_DIST_P12_BASE64', readFileSync(p12).toString('base64'));
secret('IOS_DIST_P12_PASSWORD', p12Password);
secret('IOS_PROFILE_BASE64', readFileSync(profilePath).toString('base64'));
execFileSync('gh', ['variable', 'set', 'APPLE_TEAM_ID', '--body', team]);
console.log('GitHub secrets and APPLE_TEAM_ID set. Files kept in', OUT);
const ents = execFileSync('/usr/bin/security', ['cms', '-D', '-i', profilePath]).toString();
if (!ents.includes('com.apple.developer.usernotifications.time-sensitive')) {
  console.log('!! The profile has no Time Sensitive Notifications entitlement. Tick it on the App ID, then run this again.');
}
