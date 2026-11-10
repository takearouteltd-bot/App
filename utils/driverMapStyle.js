// utils/driverMapStyle.js
// The driver app's map (Home, to the pickup, to the drop-off). Drivers said
// the old one was too pale to read streets, so this is a higher-contrast
// light map like the one they know from Uber: grey land, white streets with
// a visible edge, coloured main roads (blue motorways, teal A roads), green
// parks, blue water and dark labels. Shop and business pins stay off.
export const DRIVER_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#e8eaed' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#3c4043' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#202124' }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#c8e6c4' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e1e3e6' }] },

  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#b9bec6' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#4a4f56' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: '#7fc8bd' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#a9c6f5' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#5b8fe0' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry.fill', stylers: [{ color: '#8fb2ee' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry.stroke', stylers: [{ color: '#3f74cf' }] },
  { featureType: 'road.local', elementType: 'geometry.stroke', stylers: [{ color: '#c9cdd3' }] },

  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a8cdf0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d6fa8' }] },
];
