# Firestore and Storage rules for the 20 Sept 2026 changes

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
