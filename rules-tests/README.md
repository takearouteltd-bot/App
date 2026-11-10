Firestore rules tests (emulator). From App/: `cd rules-tests && npm install && cd .. && npm --prefix rules-tests test`.
Needs Java 21 on PATH for the emulator (`/opt/homebrew/opt/openjdk@21/bin`).

End-to-end fleet flow (functions + rules, real Google Routes/Places calls):
`firebase emulators:exec --config <firebase.json plus "auth": {"port": 9099}> --only auth,firestore,functions --project demo-tar "node rules-tests/fleet-e2e.mjs"`
(set `no_proxy=127.0.0.1,localhost` if a proxy is configured). The wallet credit in index.js
cannot run in the emulator (its admin.firestore.FieldValue is missing there), so the test seeds it.

The e2e also needs the Pub/Sub emulator (scheduled functions are triggered through it), so use
`--only auth,firestore,functions,pubsub` with `"pubsub": {"port": 8085}` in the config. Functions that
declare Stripe secrets stall in the emulator unless `functions/.secret.local` holds dummy values
(STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PAYOUT_WEBHOOK_SECRET); create it for the run and
delete it after (it is gitignored). Leave Resend and Twilio out: the tests expect them switched off.

Fleet billing (plans, card charge, grace period, pause, pay to resume), with a fake Stripe:
`firebase emulators:exec --only firestore --project demo-tar "node rules-tests/fleet-billing.mjs"`

Deleting an account (deleteMyAccount): same set-up, `node rules-tests/account-delete.mjs`, on a fresh emulator (it creates the same test logins as fleet-e2e).

Fleet office phone (fleetPhone.js): `node rules-tests/fleet-phone.mjs`, same set-up plus a fake Twilio it starts on :8999. For this run only, add TWILIO_SID=AC + 32 zeros, TWILIO_TOKEN=testtoken, TWILIO_NUMBER=+441000000000 to functions/.secret.local and put TWILIO_API_BASE and TWILIO_NUMBERS_BASE=http://127.0.0.1:8999 in functions/.env.local; delete both after.

New app bookings checked by the server (cities, price against the route, payment method, bidding, promo codes): `node rules-tests/booking-checks.mjs`, same set-up as fleet-phone with ROUTES_API_BASE=http://127.0.0.1:8999 in functions/.env.local (it starts its own fake Routes on :8999, so run it before fleet-phone, not alongside).

Rules unit tests can also be run from App/ with `firebase emulators:exec --only firestore --project demo-tar 'node --test rules-tests/*.test.mjs'`.

Web booker (fleetWeb.js: sign-in codes, booking, card hold/capture/release, tracking, texts): `node rules-tests/web-booker.mjs`, same set-up as booking-checks plus STRIPE_API_BASE=http://127.0.0.1:8999 in functions/.env.local (fake Twilio, Google and Stripe on :8999).

Admin's no-show fee and the driver cancel penalty (functions/driverPenalty.js, cancelRidePayment): `node rules-tests/driver-cancel.mjs`, same set-up as booking-checks plus STRIPE_API_BASE=http://127.0.0.1:8999 in functions/.env.local (fake Routes and Stripe on :8999). Rules for it are in fleet.test.mjs: keep rules tests in that one file, because `node --test` runs files at the same time and each clears the emulator.

Fleet portal driver numbers (fleetDriverPhones: private record, app account, then sign-in): `node rules-tests/fleet-phones.mjs`, same set-up as booking-checks, no fakes needed.
