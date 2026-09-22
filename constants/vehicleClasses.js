// constants/vehicleClasses.js
// Which jobs a vehicle is allowed to be offered.
//
// A passenger who books and pays for Executive must not be sent a Mini. The
// ride carries the class they paid for as rides/{id}.rideType, and the driver
// carries the class their vehicle was approved as on drivers/{id}.vehicleType.
// Both use the same ids, set in driver onboarding (VehicleDetailsScreen) and
// at booking (FareEstimationScreen).
//
// Matching runs in two places and they must agree:
//   this file          the driver app's own job list (DriverHomeScreen)
//   functions/index.js the push notifications (offerRideToDrivers)
// Change one, change the other.

export const VEHICLE_CLASSES = [
  { id: 'RouteMini', label: 'Mini', seats: 4, description: 'Everyday rides' },
  { id: 'RoutePlus', label: 'Plus', seats: 4, description: 'Comfortable saloons' },
  { id: 'RouteXL', label: 'XL', seats: 6, description: 'Room for luggage' },
  { id: 'RouteEco', label: 'Eco', seats: 4, description: 'Hybrid and electric' },
  { id: 'RouteExecutive', label: 'Executive', seats: 4, description: 'Premium vehicles' },
];

// A vehicle may take its own class and anything it comfortably exceeds, never
// anything above it. So an Executive or an XL can pick up a Mini job — the
// passenger gets more than they paid for, and the driver sees the fare before
// accepting — but nothing except an Executive is offered an Executive job, and
// nothing except an XL is offered an XL job, because only an XL has six seats.
export const SERVES = {
  RouteMini: ['RouteMini'],
  RoutePlus: ['RoutePlus', 'RouteMini'],
  RouteXL: ['RouteXL', 'RoutePlus', 'RouteMini'],
  RouteEco: ['RouteEco', 'RouteMini'],
  RouteExecutive: ['RouteExecutive', 'RoutePlus', 'RouteMini'],
};

// Drivers approved before vehicle classes were matched have no vehicleType.
// They are treated as the entry class, so they keep receiving ordinary work
// but stop being sent Executive and XL jobs. Admins should set a class on the
// dashboard for those drivers to make them eligible again.
export const DEFAULT_VEHICLE_CLASS = 'RouteMini';

// Likewise for rides booked before the class was recorded.
export const DEFAULT_RIDE_CLASS = 'RouteMini';

export function canServe(vehicleType, rideType) {
  const vehicle = SERVES[vehicleType] ? vehicleType : DEFAULT_VEHICLE_CLASS;
  const ride = SERVES[rideType] ? rideType : DEFAULT_RIDE_CLASS;
  return SERVES[vehicle].includes(ride);
}

export function classLabel(id) {
  const found = VEHICLE_CLASSES.find((c) => c.id === id);
  return found ? found.label : 'Mini';
}
