// components/StaticMarker.jsx
// A map Marker drawn from views whose drawing doesn't change, only where it
// sits. On Android a Marker with child views re-renders its picture on every
// frame while tracksViewChanges is on (the default), which keeps the phone
// busy for as long as the map is mounted, even under another tab. This draws
// it for the first second (so an icon font has time to appear), then lets
// the map keep that snapshot.
import React, { useEffect, useState } from 'react';
import { Marker } from 'react-native-maps';

const DRAW_FOR_MS = 1000;

export default function StaticMarker({ children, ...props }) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setTracking(false), DRAW_FOR_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <Marker {...props} tracksViewChanges={tracking}>
      {children}
    </Marker>
  );
}
