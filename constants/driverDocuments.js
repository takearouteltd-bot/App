// constants/driverDocuments.js
// The driver documents the app knows about. `expiryKey` matches the keys the
// admin dashboard writes to drivers/{id}.documentExpiry (YYYY-MM-DD strings).
// `urlField` is where the approved file lives on the driver record.
export const DRIVER_DOCUMENTS = [
  { id: 'drivingLicenceFront', label: 'Driving licence (front)', icon: 'card-outline', urlField: 'driverLicenseFrontUrl', expiryKey: 'drivingLicence' },
  { id: 'drivingLicenceBack', label: 'Driving licence (back)', icon: 'card-outline', urlField: 'driverLicenseBackUrl', expiryKey: 'drivingLicence' },
  { id: 'pcoLicence', label: 'Private hire driver licence', icon: 'ribbon-outline', urlField: 'pcoLicenseUrl', expiryKey: 'privateHireLicence' },
  { id: 'vehicleLicence', label: 'Vehicle licence (plate)', icon: 'car-outline', urlField: 'vehicleLicenceUrl', expiryKey: 'vehicleLicence' },
  { id: 'insurance', label: 'Hire and reward insurance', icon: 'shield-checkmark-outline', urlField: 'insuranceUrl', expiryKey: 'insurance' },
  { id: 'mot', label: 'MOT certificate', icon: 'construct-outline', urlField: 'motUrl', expiryKey: 'mot' },
  { id: 'dbs', label: 'DBS certificate', icon: 'document-text-outline', urlField: 'dbsCertificateUrl', expiryKey: null },
];

// Unique expiry entries, for alerts (the two licence sides share one date).
export const EXPIRY_LABELS = {
  drivingLicence: 'Driving licence',
  privateHireLicence: 'Private hire driver licence',
  vehicleLicence: 'Vehicle licence',
  insurance: 'Insurance',
  mot: 'MOT',
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// { status: 'expired' | 'expiring' | 'valid' | 'missing', daysLeft, date }
export function expiryStatus(raw, withinDays = 30) {
  if (!raw) return { status: 'missing', daysLeft: null, date: null };
  const date = typeof raw === 'string' ? new Date(`${raw}T00:00:00`) : raw?.toDate ? raw.toDate() : new Date(raw);
  if (isNaN(date)) return { status: 'missing', daysLeft: null, date: null };
  const daysLeft = Math.round((startOfDay(date) - startOfDay(new Date())) / DAY);
  const status = daysLeft < 0 ? 'expired' : daysLeft <= withinDays ? 'expiring' : 'valid';
  return { status, daysLeft, date };
}

// Every expired or soon-expiring document for a driver record, worst first.
export function expiryAlertsFor(driver, withinDays = 30) {
  const out = [];
  Object.keys(EXPIRY_LABELS).forEach((key) => {
    const e = expiryStatus(driver?.documentExpiry?.[key], withinDays);
    if (e.status === 'expired' || e.status === 'expiring') out.push({ key, label: EXPIRY_LABELS[key], ...e });
  });
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

export function describeExpiry(e) {
  if (e.status === 'missing') return 'No expiry date on file';
  const when = e.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (e.status === 'expired') return `Expired ${when}`;
  if (e.daysLeft === 0) return 'Expires today';
  if (e.status === 'expiring') return `Expires in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'} (${when})`;
  return `Valid until ${when}`;
}
