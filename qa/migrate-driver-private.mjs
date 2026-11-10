#!/usr/bin/env node
/* One-off: moves drivers' private details off drivers/{id} and sets up the
   other privacy documents (see functions/privacy.js).

     driverPrivate/{id}  bank details, NI number, date of birth, home address,
                         phone, email, emergency contact, payout account
     driverFiles/{id}    document links, right to work share code
     riderPublic/{id}    a passenger's name, photo and rating
     fleetJobOffers/{id} phone jobs waiting for a driver right now

   Read-only unless run with --apply. --apply backs up every driver and
   passenger record it reads to a private JSON file first, and writes the
   private documents and removes the old fields in the same atomic batch, so
   a driver is never left with neither.

   Run from the App folder:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
       node qa/migrate-driver-private.mjs --project <project-id>           # dry run
     ... node qa/migrate-driver-private.mjs --project <project-id> --apply

   Options: --backup-dir <folder> (default ~/takearoute-privacy-backups). The
   backup holds people's bank details: keep it private and delete it once the
   migration is confirmed.

   Safe to run twice: a field already on the private document is not
   overwritten by an older value left on the driver record. */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const { FIELDS } = require('./privacy.js');
const { FieldValue } = require('firebase-admin/firestore');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const project = arg('--project');
if (!project) {
  console.error('Usage: node qa/migrate-driver-private.mjs --project <project-id> [--apply] [--backup-dir <folder>]');
  process.exit(1);
}

admin.initializeApp({ projectId: project });
const db = admin.firestore();
const { PRIVATE_FIELDS, FILE_FIELDS, RIDER_PUBLIC_FIELDS, OFFER_FIELDS } = FIELDS;
const BATCH_LIMIT = 300; // each driver is up to 3 writes

const pick = (data, fields) => {
  const out = {};
  fields.forEach((f) => { if (data[f] !== undefined) out[f] = data[f]; });
  return out;
};

class Writer {
  constructor() { this.batch = db.batch(); this.count = 0; this.total = 0; }
  async add(fn, n = 1) {
    if (this.count + n > BATCH_LIMIT) await this.flush();
    fn(this.batch);
    this.count += n;
    this.total += n;
  }
  async flush() {
    if (!this.count) return;
    await this.batch.commit();
    this.batch = db.batch();
    this.count = 0;
  }
}

async function main() {
  console.log(`Project ${project}. ${apply ? 'APPLY: will write.' : 'Dry run: nothing will be written (add --apply to migrate).'}`);

  const [drivers, riders, offers] = await Promise.all([
    db.collection('drivers').get(),
    db.collection('riders').get(),
    db.collection('rides').where('source', '==', 'phone').where('status', '==', 'dispatching').get(),
  ]);
  console.log(`Read ${drivers.size} drivers, ${riders.size} passengers, ${offers.size} phone jobs on offer.`);

  if (apply) {
    const dir = arg('--backup-dir') || join(homedir(), 'takearoute-privacy-backups');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `backup-${project}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({
      project, takenAt: new Date().toISOString(),
      drivers: Object.fromEntries(drivers.docs.map((d) => [d.id, d.data()])),
      riders: Object.fromEntries(riders.docs.map((d) => [d.id, d.data()])),
    }));
    chmodSync(file, 0o600);
    console.log(`Backed up to ${file} (private: holds bank details).`);
  }

  const writer = new Writer();
  let moved = 0;
  let fieldsMoved = 0;
  const fieldCounts = {};
  for (const d of drivers.docs) {
    const data = d.data();
    const privateData = pick(data, PRIVATE_FIELDS);
    const fileData = pick(data, FILE_FIELDS);
    const names = [...Object.keys(privateData), ...Object.keys(fileData)];
    if (!names.length) continue;
    moved += 1;
    fieldsMoved += names.length;
    names.forEach((n) => { fieldCounts[n] = (fieldCounts[n] || 0) + 1; });
    if (!apply) continue;

    // A value already on the private documents is newer: keep it.
    const privateRef = db.collection('driverPrivate').doc(d.id);
    const filesRef = db.collection('driverFiles').doc(d.id);
    const [havePrivate, haveFiles] = await Promise.all([privateRef.get(), filesRef.get()]);
    const keep = (incoming, have) => Object.fromEntries(
      Object.entries(incoming).filter(([k]) => !have.exists || have.data()[k] === undefined)
    );
    const privateWrite = keep(privateData, havePrivate);
    const fileWrite = keep(fileData, haveFiles);
    const removals = Object.fromEntries(names.map((n) => [n, FieldValue.delete()]));

    await writer.add((batch) => {
      if (Object.keys(privateWrite).length) batch.set(privateRef, privateWrite, { merge: true });
      if (Object.keys(fileWrite).length) batch.set(filesRef, fileWrite, { merge: true });
      batch.update(d.ref, removals);
    }, 3);
  }

  let riderCards = 0;
  for (const r of riders.docs) {
    riderCards += 1;
    if (!apply) continue;
    await writer.add((batch) => batch.set(db.collection('riderPublic').doc(r.id), pick(r.data(), RIDER_PUBLIC_FIELDS)));
  }

  let jobOffers = 0;
  for (const ride of offers.docs) {
    const data = ride.data();
    if (data.riderId || typeof data.fleetId !== 'string') continue;
    jobOffers += 1;
    if (!apply) continue;
    await writer.add((batch) => batch.set(db.collection('fleetJobOffers').doc(ride.id), {
      ...pick(data, OFFER_FIELDS),
      customer: { name: (data.customer && data.customer.name) || '' },
    }));
  }
  await writer.flush();

  console.log(`${apply ? 'Moved' : 'Would move'} private details for ${moved} of ${drivers.size} drivers (${fieldsMoved} fields).`);
  Object.keys(fieldCounts).sort().forEach((n) => console.log(`  ${n}: ${fieldCounts[n]}`));
  console.log(`${apply ? 'Wrote' : 'Would write'} ${riderCards} passenger public cards and ${jobOffers} job offers.`);

  if (apply) {
    const after = await db.collection('drivers').get();
    let left = 0;
    after.forEach((d) => {
      if (Object.keys(pick(d.data(), [...PRIVATE_FIELDS, ...FILE_FIELDS])).length) left += 1;
    });
    console.log(left ? `WARNING: ${left} drivers still hold private fields. Run again.` : 'Check passed: no driver record holds a private field.');
    if (left) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
