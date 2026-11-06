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
