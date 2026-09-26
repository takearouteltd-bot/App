// components/RouteDirections.jsx
// Draws the driving route on a map, through any stops. A drop-in replacement
// for react-native-maps-directions, which only speaks the retired Directions
// API: same props, and onReady gets the same { distance (km), duration (min),
// coordinates }.
//
// The route is fetched again only when a point moves by more than ~10 m, so a
// driver's GPS jitter does not turn into a stream of paid requests.
import React, { useEffect, useRef, useState } from 'react';
import { Polyline } from 'react-native-maps';
import { fetchRoute } from '../utils/routes';
import { isCoord } from './ui/kit';

const round = (p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

export default function RouteDirections({
  origin,
  destination,
  waypoints,
  strokeWidth = 4,
  strokeColor,
  onReady,
  onError,
}) {
  const [coordinates, setCoordinates] = useState([]);
  // Latest callbacks without refetching when a parent re-renders.
  const handlers = useRef({ onReady, onError });
  handlers.current = { onReady, onError };

  const stops = (waypoints || []).filter(isCoord);
  const ready = isCoord(origin) && isCoord(destination);
  const key = ready ? [origin, ...stops, destination].map(round).join('|') : '';

  useEffect(() => {
    if (!key) {
      setCoordinates([]);
      return undefined;
    }
    const controller = new AbortController();
    fetchRoute({ origin, destination, waypoints: stops, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted || !result) return;
        setCoordinates(result.coordinates);
        handlers.current.onReady?.(result);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.log('Route error:', error?.message || error);
        handlers.current.onError?.(error);
      });
    return () => controller.abort();
  }, [key]); // `key` captures every coordinate that matters.

  if (coordinates.length < 2) return null;
  return <Polyline coordinates={coordinates} strokeWidth={strokeWidth} strokeColor={strokeColor} />;
}
