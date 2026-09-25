# Firestore and Storage rules

## Vehicle classes: a driver may only accept jobs their vehicle qualifies for

Accepting a job is a client-side transaction, so filtering the job list in the
app is presentation, not enforcement. This rule is what actually stops a Mini
being sent on an Executive booking. Add it to the `rides/{rideId}` update rule.

```
// A vehicle may take its own class and anything it comfortably exceeds.
// Keep in step with constants/vehicleClasses.js and functions/index.js.
function serves(vehicleType) {
  return {
    'RouteMini':      ['RouteMini'],
    'RoutePlus':      ['RoutePlus', 'RouteMini'],
    'RouteXL':        ['RouteXL', 'RoutePlus', 'RouteMini'],
    'RouteEco':       ['RouteEco', 'RouteMini'],
    'RouteExecutive': ['RouteExecutive', 'RoutePlus', 'RouteMini'],
  }.get(vehicleType, ['RouteMini']);
}

function driverVehicleClass() {
  return get(/databases/$(database)/documents/drivers/$(request.auth.uid))
    .data.get('vehicleType', 'RouteMini');
}

// On the update that claims a job (status searching -> accepted), the ride's
// class must be one this driver's vehicle can serve.
match /rides/{rideId} {
  allow update: if request.auth != null
    && resource.data.status == 'searching'
    && request.resource.data.status == 'accepted'
    && request.resource.data.driverId == request.auth.uid
    && resource.data.get('rideType', 'RouteMini') in serves(driverVehicleClass())
    // ... your existing conditions for other kinds of update
}
```

Note: drivers approved before classes were matched have no `vehicleType`, so
both the app and this rule treat them as `RouteMini`. They keep receiving
ordinary work but stop being offered Executive and XL jobs until an admin sets
a class on their record.

---

# Rules for the 20 Sept 2026 changes

Merge these into the existing rules in Firebase console. They assume admins
are identified the same way your current rules already do; `isAdmin()` below
stands for that check.

## Firestore

```
// Settings and discount codes: any signed-in user can read, only admins write.
match /config/app {
  allow read: if request.auth != null;
  allow write: if isAdmin();
}
match /promoCodes/{code} {
  allow read: if request.auth != null;
  allow write: if isAdmin();
}

// Reports: people see and reply to their own; admins see all.
match /reports/{reportId} {
  allow create: if request.auth != null && request.resource.data.reporterId == request.auth.uid;
  allow read: if isAdmin() || resource.data.reporterId == request.auth.uid;
  allow update: if isAdmin()
    || (resource.data.reporterId == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['lastReplyAt', 'lastReplyBy', 'updatedAt']));
  match /messages/{messageId} {
    allow read: if isAdmin() || get(/databases/$(database)/documents/reports/$(reportId)).data.reporterId == request.auth.uid;
    allow create: if isAdmin()
      || (get(/databases/$(database)/documents/reports/$(reportId)).data.reporterId == request.auth.uid
          && request.resource.data.senderRole in ['driver', 'rider']
          && get(/databases/$(database)/documents/reports/$(reportId)).data.status != 'resolved');
  }
}

// Driver change requests: drivers create and read their own; admins decide.
match /changeRequests/{id} {
  allow create: if request.auth != null
    && request.resource.data.driverId == request.auth.uid
    && request.resource.data.status == 'pending';
  allow read: if isAdmin() || resource.data.driverId == request.auth.uid;
  allow update, delete: if isAdmin();
}

// Inside your existing match /drivers/{driverId}: stop drivers editing
// protected fields directly. Add this condition to the driver's own update rule.
//   && !request.resource.data.diff(resource.data).affectedKeys().hasAny([
//        'firstName', 'lastName', 'fullName', 'phoneNumber', 'email', 'address',
//        'driverLicenseFrontUrl', 'driverLicenseBackUrl', 'pcoLicenseUrl',
//        'vehicleLicenceUrl', 'insuranceUrl', 'motUrl', 'dbsCertificateUrl',
//        'documentExpiry', 'approved', 'blocked'])
// Note: onboarding writes some of these fields. Apply this condition only once
// onboarding is complete, e.g. wrap it in
//   resource.data.onboardingComplete != true || ( ...condition... )
```

```

## Added with push notifications and the dashboard revenue panel

```
// Each person saves their own phone tokens; Cloud Functions read them.
match /pushTokens/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}

// Admin subscription revenue reads wallet transactions across drivers.
match /{path=**}/transactions/{txId} {
  allow read: if isAdmin();
}

// Passengers manage their own "don't match me" list on their rider record
// (blockedDrivers, blockedDriverInfo) through their existing update rule.
```

## Storage

```
match /drivers/{driverId}/pending/{file} {
  allow write: if request.auth.uid == driverId
    && request.resource.size < 10 * 1024 * 1024
    && request.resource.contentType.matches('image/.*|application/pdf');
  allow read: if request.auth != null;
}
match /drivers/{driverId}/admin/{file} {
  allow write: if isAdmin();
  allow read: if request.auth != null;
}
match /riders/{uid}/{file} {
  allow read: if request.auth != null;
  allow write: if request.auth.uid == uid;
}
```

## Nearby cars on the passenger map (driverLocations)

Free, online drivers publish a bare position to `driverLocations/{uid}` so
passengers can see cars nearby without reading the driver record, which holds
names, phone numbers and documents. Each document holds only latitude,
longitude, heading, vehicleType, online and updatedAt.

Any signed-in user may read it; a driver may only write their own.

```
match /driverLocations/{driverId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.uid == driverId;
}
```

Without this rule the app keeps working, it just shows no nearby cars.
