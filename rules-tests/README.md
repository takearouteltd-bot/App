Firestore rules tests (emulator). From App/: `cd rules-tests && npm install && cd .. && npm --prefix rules-tests test`.
Needs Java 21 on PATH for the emulator (`/opt/homebrew/opt/openjdk@21/bin`).

End-to-end fleet flow (functions + rules, real Google Routes/Places calls):
`firebase emulators:exec --config <firebase.json plus "auth": {"port": 9099}> --only auth,firestore,functions --project demo-tar "node rules-tests/fleet-e2e.mjs"`
(set `no_proxy=127.0.0.1,localhost` if a proxy is configured). The wallet credit in index.js
cannot run in the emulator (its admin.firestore.FieldValue is missing there), so the test seeds it.
