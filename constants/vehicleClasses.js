// constants/vehicleClasses.js
// Job categories, vehicle classes, and which jobs a driver is offered.
//
// The passenger books a job category: rides/{id}.rideType. The driver's car is
// approved as a vehicle class: drivers/{id}.vehicleType. On top of what their
// car allows, a driver ticks the categories they want: drivers/{id}.jobTypes
// (missing means everything their car allows).
//
// Ids are kept from the first version (RouteMini is now "Normal") so old
// rides, phone bookings and drivers keep working. Plus and Eco are no longer
// booked; drivers approved as Plus or Eco count as Normal.
//
// Matching runs in several places and they must agree:
//   this file                      the driver app's own job list (DriverHomeScreen)
//   functions/index.js             push offers (offerRideToDrivers) and canServe for fleet.js
//   Admin-Dashboard FleetPortal    the office's driver picker
// Change one, change the others.

// What a passenger can book, in the order the booking screen shows them.
export const RIDE_CLASSES = [
  { id: 'RouteMini', label: 'Normal', seats: 4, icon: 'car-hatchback', description: 'Everyday rides' },
  { id: 'RoutePriority', label: 'Priority', seats: 4, icon: 'car-clock', description: 'Shown to drivers as a priority job' },
  { id: 'RouteUrgent', label: 'Urgent', seats: 4, icon: 'car-emergency', description: 'Shown to drivers as an urgent job' },
  { id: 'RouteXL', label: 'XL', seats: 6, icon: 'van-passenger', description: '6 seats, room for luggage' },
  { id: 'RouteExecutive', label: 'Executive', seats: 4, icon: 'car-side', description: 'Premium cars' },
];

// What a driver's car can be registered as.
export const VEHICLE_CLASSES = [
  { id: 'RouteMini', label: 'Normal', seats: 4, description: 'Normal, Priority and Urgent jobs' },
  { id: 'RouteXL', label: 'XL 6 seater', seats: 6, description: '6 seater jobs, plus Normal, Priority and Urgent' },
  { id: 'RouteExecutive', label: 'Executive', seats: 4, description: 'Executive jobs, plus Normal, Priority and Urgent' },
];

// Old ids, still on some rides and drivers.
const LEGACY_LABELS = { RoutePlus: 'Plus', RouteEco: 'Eco' };

// Any car can do these.
const EVERY_CAR = ['RouteMini', 'RoutePriority', 'RouteUrgent'];

// Which job categories each vehicle class may be offered. Only a 6 seater is
// sent XL work and only an Executive is sent Executive work. Plus and Eco
// stay listed so jobs booked on an older app still find a car.
export const SERVES = {
  RouteMini: [...EVERY_CAR],
  RoutePlus: ['RoutePlus', ...EVERY_CAR],
  RouteEco: ['RouteEco', ...EVERY_CAR],
  RouteXL: ['RouteXL', 'RoutePlus', ...EVERY_CAR],
  RouteExecutive: ['RouteExecutive', 'RoutePlus', ...EVERY_CAR],
};

// Drivers approved before vehicle classes existed have no vehicleType and
// count as Normal.
export const DEFAULT_VEHICLE_CLASS = 'RouteMini';

// Likewise for rides booked before the class was recorded.
export const DEFAULT_RIDE_CLASS = 'RouteMini';

const KNOWN_RIDE_TYPES = new Set(Object.values(SERVES).flat());

export function canServe(vehicleType, rideType) {
  const vehicle = SERVES[vehicleType] ? vehicleType : DEFAULT_VEHICLE_CLASS;
  const ride = KNOWN_RIDE_TYPES.has(rideType) ? rideType : DEFAULT_RIDE_CLASS;
  return SERVES[vehicle].includes(ride);
}

// The tick boxes a driver gets: their own class first (XL or Executive),
// then Normal, Priority and Urgent.
export function jobChoices(vehicleType) {
  const own = vehicleType === 'RouteXL' || vehicleType === 'RouteExecutive' ? [vehicleType] : [];
  return [...own, ...EVERY_CAR].map((id) => RIDE_CLASSES.find((c) => c.id === id));
}

// Whether the driver ticked this job category. No choice saved yet means
// every category their car allows. Old Plus and Eco jobs count as Normal.
export function wantsJobType(jobTypes, rideType) {
  if (!Array.isArray(jobTypes)) return true;
  const known = RIDE_CLASSES.some((c) => c.id === rideType);
  return jobTypes.includes(known ? rideType : DEFAULT_RIDE_CLASS);
}

export function classLabel(id) {
  const found = RIDE_CLASSES.find((c) => c.id === id);
  return found ? found.label : LEGACY_LABELS[id] || 'Normal';
}

export function vehicleLabel(id) {
  const found = VEHICLE_CLASSES.find((c) => c.id === id);
  return found ? found.label : 'Normal';
}
