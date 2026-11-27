#!/usr/bin/env bash
# Runs one test suite on fresh emulators, with the dummy secrets and fake
# service addresses it needs (see README.md). Used by
# .github/workflows/tests.yml, so the suites run on GitHub's machines, not a
# laptop. From App/: rules-tests/ci-suite.sh destination-change
set -uo pipefail
s="$1"
export no_proxy=127.0.0.1,localhost
cleanup() { rm -f functions/.secret.local functions/.env.local firebase.e2e.json; }
trap cleanup EXIT

python3 - <<'PY'
import json
c = json.load(open('firebase.json'))
e = c['emulators']
e['auth'] = {'port': 9099}
e['pubsub'] = {'port': 8085}
e['ui'] = {'enabled': False}
json.dump(c, open('firebase.e2e.json', 'w'), indent=2)
PY

printf 'STRIPE_SECRET_KEY=sk_test_dummy\nSTRIPE_WEBHOOK_SECRET=whsec_dummy\nSTRIPE_PAYOUT_WEBHOOK_SECRET=whsec_dummy\n' > functions/.secret.local
case $s in
  web-booker|fleet-phone)
    printf 'TWILIO_SID=AC00000000000000000000000000000000\nTWILIO_TOKEN=testtoken\nTWILIO_NUMBER=+441000000000\nRESEND_API_KEY=re_dummy\nCLOUDFLARE_ACCOUNT_ID=acct1\nCLOUDFLARE_AI_TOKEN=aitoken\n' >> functions/.secret.local;;
  card-switch)
    printf 'TWILIO_SID=AC00000000000000000000000000000000\nTWILIO_TOKEN=testtoken\nTWILIO_NUMBER=+441000000000\n' >> functions/.secret.local;;
esac

: > functions/.env.local
case $s in
  bid-jobs|network|national-desk|booking-checks|allocation-followon|driver-cancel|destination-change|min-fare|book-later)
    echo 'ROUTES_API_BASE=http://127.0.0.1:8999' >> functions/.env.local;;
  fleet-phone)
    printf 'TWILIO_API_BASE=http://127.0.0.1:8999\nTWILIO_NUMBERS_BASE=http://127.0.0.1:8999\nCF_AI_BASE=http://127.0.0.1:8999\nPLACES_API_BASE=http://127.0.0.1:8999\nROUTES_API_BASE=http://127.0.0.1:8999\n' >> functions/.env.local;;
  web-booker)
    printf 'TWILIO_API_BASE=http://127.0.0.1:8999\nPLACES_API_BASE=http://127.0.0.1:8999\nROUTES_API_BASE=http://127.0.0.1:8999\nSTRIPE_API_BASE=http://127.0.0.1:8999\n' >> functions/.env.local;;
  card-switch)
    printf 'STRIPE_API_BASE=http://127.0.0.1:8999\nTWILIO_API_BASE=http://127.0.0.1:8999\n' >> functions/.env.local;;
esac
case $s in
  driver-cancel|tips|destination-change|book-later)
    echo 'STRIPE_API_BASE=http://127.0.0.1:8999' >> functions/.env.local;;
esac

if [ "$s" = unit ]; then
  firebase emulators:exec --only firestore --project demo-tar 'node --test rules-tests/*.test.mjs'
else
  firebase emulators:exec --config firebase.e2e.json --only auth,firestore,functions,pubsub \
    --project demo-tar "node rules-tests/$s.mjs"
fi
