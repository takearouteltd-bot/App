// config/maps.js
// The one Google Maps key the app uses, and the settings for Google's current
// Places and Routes services.
//
// The key lives in the takearoute-719df Google Cloud project ("TakeARoute app
// maps") and is restricted to exactly the five services the app calls: Maps
// SDK for Android and iOS, Routes, Places (New) and Geocoding. It ships inside
// the app, so it is not a secret; the restriction is what protects it. The
// same key is in app.json for the native map SDKs; change both together.
export const GOOGLE_MAPS_API_KEY = 'AIzaSyD2FkUIMuw3hkXi827QxnI8W1w2XX_KGd8';

/* Props that point react-native-google-places-autocomplete at Places API
   (New). The legacy Places API cannot be enabled on new projects.
   `fields` keeps place details on the cheapest tier that has coordinates. */
export const PLACES_NEW_PROPS = {
  isNewPlacesAPI: true,
  requestUrl: {
    useOnPlatform: 'all',
    url: 'https://places.googleapis.com',
    headers: { 'Content-Type': 'application/json' },
  },
  fields: 'location,formattedAddress,displayName',
};

// Coordinates from a Places (New) details response.
export function placeCoords(details) {
  const loc = details?.location;
  if (!loc || typeof loc.latitude !== 'number') return null;
  return { latitude: loc.latitude, longitude: loc.longitude };
}
