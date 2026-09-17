// utils/appConfig.js
// Live operational settings, edited from the admin dashboard (Settings page)
// and stored in Firestore at config/app.
//
// Every value falls back to the number the app used before this file existed,
// so a missing document, a bad value, or a denied read never changes behaviour.
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../config/firebase";

export const DEFAULT_APP_CONFIG = {
  currency: "GBP",
  fares: {
    baseFare: 3.0,
    ratePerMile: 2.2,
    ratePerMinute: 0.25,
    minimumFare: 6,
    vatPercent: 20,
  },
  dispatch: {
    searchRadiusKm: 50,
  },
};

function mergeSection(defaults, incoming) {
  const merged = { ...defaults };
  if (!incoming || typeof incoming !== "object") return merged;
  Object.keys(defaults).forEach((key) => {
    const value = Number(incoming[key]);
    if (incoming[key] !== null && incoming[key] !== "" && Number.isFinite(value) && value >= 0) {
      merged[key] = value;
    }
  });
  return merged;
}

export function normaliseAppConfig(raw) {
  const data = raw || {};
  return {
    currency: typeof data.currency === "string" && data.currency ? data.currency : DEFAULT_APP_CONFIG.currency,
    fares: mergeSection(DEFAULT_APP_CONFIG.fares, data.fares),
    dispatch: mergeSection(DEFAULT_APP_CONFIG.dispatch, data.dispatch),
  };
}

export function useAppConfig() {
  const [config, setConfig] = useState(DEFAULT_APP_CONFIG);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = onSnapshot(
        doc(db, "config", "app"),
        (snap) => setConfig(normaliseAppConfig(snap.exists() ? snap.data() : null)),
        () => setConfig(DEFAULT_APP_CONFIG)
      );
    } catch (error) {
      setConfig(DEFAULT_APP_CONFIG);
    }
    return () => unsubscribe();
  }, []);

  return config;
}
