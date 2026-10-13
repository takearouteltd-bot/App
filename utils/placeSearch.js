// utils/placeSearch.js
// Address search against Google Places (New), owned by the app instead of a
// library. The old autocomplete component floated its results over the screen
// (on Android the views below could cover them and swallow taps) and dropped
// Google's error replies silently, so a failed search looked like "no results".
// Screens render the results as an ordinary list and show `error` when set.
import { useEffect, useRef, useState } from 'react';
import { GOOGLE_MAPS_API_KEY, PLACES_NEW_PROPS, placeCoords } from '../config/maps';

const BASE = 'https://places.googleapis.com/v1';

// One token per search, closed by the details call, so Google bills the
// typing and the pick as a single session.
function newSessionToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function errorText(status, body) {
  const message = body?.error?.message;
  if (status === 403 || status === 401) return 'Address search is not available right now. Please try again later.';
  if (status === 429) return 'Too many searches. Please wait a moment and try again.';
  return message ? `Search failed: ${message}` : 'Search failed. Check your connection and try again.';
}

/* near: { latitude, longitude } to rank nearby places first (not a limit).
   regionCodes: e.g. ['gb'] to only return places in those countries. */
export function usePlaceSearch({ near, regionCodes, minLength = 2, debounce = 300 } = {}) {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const session = useRef(newSessionToken());
  const latest = useRef(0);

  useEffect(() => {
    const input = text.trim();
    if (input.length < minLength) {
      setResults([]);
      setError('');
      setLoading(false);
      return undefined;
    }

    const id = ++latest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const body = { input, languageCode: 'en', sessionToken: session.current };
      if (regionCodes?.length) body.includedRegionCodes = regionCodes;
      if (near && typeof near.latitude === 'number') {
        body.locationBias = {
          circle: { center: { latitude: near.latitude, longitude: near.longitude }, radius: 50000 },
        };
        body.origin = { latitude: near.latitude, longitude: near.longitude };
      }

      try {
        const res = await fetch(`${BASE}/places:autocomplete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (id !== latest.current) return;
        if (!res.ok) {
          console.warn('Places autocomplete', res.status, data?.error?.message);
          setResults([]);
          setError(errorText(res.status, data));
          return;
        }
        setError('');
        setResults(
          (data.suggestions || [])
            .map((s) => s.placePrediction)
            .filter(Boolean)
            .map((p) => ({
              placeId: p.placeId,
              description: p.text?.text || '',
              main: p.structuredFormat?.mainText?.text || p.text?.text || '',
              secondary: p.structuredFormat?.secondaryText?.text || '',
            }))
        );
      } catch (e) {
        if (id !== latest.current) return;
        console.warn('Places autocomplete failed', e);
        setResults([]);
        setError('Search failed. Check your connection and try again.');
      } finally {
        if (id === latest.current) setLoading(false);
      }
    }, debounce);

    return () => clearTimeout(timer);
    // near and regionCodes only shape the next search; typing drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  /* Coordinates and address for a chosen result, or null with `error` set. */
  const pick = async (result) => {
    try {
      const url =
        `${BASE}/places/${encodeURIComponent(result.placeId)}` +
        `?fields=${PLACES_NEW_PROPS.fields}&sessionToken=${session.current}`;
      const res = await fetch(url, { headers: { 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY } });
      const place = await res.json().catch(() => ({}));
      session.current = newSessionToken();
      if (!res.ok) {
        console.warn('Place details', res.status, place?.error?.message);
        setError(errorText(res.status, place));
        return null;
      }
      const point = placeCoords(place);
      if (!point) {
        setError('That place has no exact location. Try another result.');
        return null;
      }
      return {
        ...point,
        placeId: result.placeId,
        description: result.description,
        address: place.formattedAddress || result.description,
        name: place.displayName?.text || result.main,
      };
    } catch (e) {
      console.warn('Place details failed', e);
      setError('Search failed. Check your connection and try again.');
      return null;
    }
  };

  const clear = () => {
    latest.current += 1;
    setText('');
    setResults([]);
    setError('');
    setLoading(false);
  };

  return { text, setText, results, loading, error, pick, clear };
}
