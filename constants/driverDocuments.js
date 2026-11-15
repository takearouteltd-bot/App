// constants/driverDocuments.js
// The driver documents the app knows about. `expiryKey` matches the keys the
// admin dashboard writes to drivers/{id}.documentExpiry (YYYY-MM-DD strings).
// `urlField` is where the approved file lives on the driver record.
export const DRIVER_DOCUMENTS = [
// Names and order exactly as the operator asked (M&S, 16 Nov 2026).
  { id: 'drivingLicenceFront', label: 'Drivers licence front', icon: 'card-outline', urlField: 'driverLicenseFrontUrl', expiryKey: 'drivingLicence' },
  { id: 'drivingLicenceBack', label: 'Drivers licence back', icon: 'card-outline', urlField: 'driverLicenseBackUrl', expiryKey: 'drivingLicence' },
  { id: 'pcoLicence', label: 'Private hire (badge)', icon: 'ribbon-outline', urlField: 'pcoLicenseUrl', expiryKey: 'privateHireLicence' },
  { id: 'pcoPaper', label: 'Private hire (paper)', icon: 'document-outline', urlField: 'pcoPaperUrl', expiryKey: 'privateHireLicence' },
  { id: 'mot', label: 'MOT Certificate', icon: 'construct-outline', urlField: 'motUrl', expiryKey: 'mot' },
  { id: 'insurance', label: 'Insurance certificate', icon: 'shield-checkmark-outline', urlField: 'insuranceUrl', expiryKey: 'insurance' },
  { id: 'vehicleLicence', label: 'Vehicle paper licence', icon: 'car-outline', urlField: 'vehicleLicenceUrl', expiryKey: 'vehicleLicence' },
  { id: 'v5c', label: 'V5C Vehicle details (second Page)', icon: 'book-outline', urlField: 'v5cUrl', expiryKey: null },
  // Only when a company owns the car (drivers.ownershipType "company").
  { id: 'companyAgreement', label: 'Company hire permission letter (if applies)', icon: 'document-text-outline', urlField: 'companyAgreementUrl', expiryKey: null, companyOnly: true },
];

// Unique expiry entries, for alerts (the two licence sides share one date).
export const EXPIRY_LABELS = {
  drivingLicence: 'Drivers licence',
  privateHireLicence: 'Private hire licence',
  vehicleLicence: 'Vehicle paper licence',
  insurance: 'Insurance certificate',
  mot: 'MOT Certificate',
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
