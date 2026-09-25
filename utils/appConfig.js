// utils/appConfig.js
// Live operational settings, edited from the admin dashboard (Settings page)
// and stored in Firestore at config/app.
//
// Every value falls back to the number the app used before this file existed,
// so a missing document, a bad value, or a denied read never changes behaviour.
// Keep these in step with CONFIG_DEFAULTS in the dashboard's OperationsSettings.jsx.
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
  waiting: {
    freeMinutes: 5,
    ratePerMinute: 0.25,
    maxCharge: 10,
  },
  dispatch: {
    searchRadiusKm: 50,
    requestTimeoutSeconds: 20,
  },
  drivers: {
    maxShiftHours: 12,
    minimumPayout: 10,
  },
  subscription: {
    monthlyPrice: 99.99,
  },
  // Busy-time pricing. 1 means normal fares; 1.5 means 50% more.
  surge: {
    multiplier: 1,
  },
  // Charged when a passenger cancels before pickup, more than freeMinutes
  // after a driver accepted. 0 means no fee. Card rides only.
  cancellation: {
    fee: 0,
    freeMinutes: 2,
    driverSharePercent: 100,
  },
  // 1 lets passengers choose to pay the driver in cash.
  payments: {
    cashEnabled: 0,
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
    currency: typeof data.currency === "string" && data.currency ? data.currency.toUpperCase() : DEFAULT_APP_CONFIG.currency,
    fares: mergeSection(DEFAULT_APP_CONFIG.fares, data.fares),
    waiting: mergeSection(DEFAULT_APP_CONFIG.waiting, data.waiting),
    dispatch: mergeSection(DEFAULT_APP_CONFIG.dispatch, data.dispatch),
    drivers: mergeSection(DEFAULT_APP_CONFIG.drivers, data.drivers),
    subscription: mergeSection(DEFAULT_APP_CONFIG.subscription, data.subscription),
    surge: mergeSection(DEFAULT_APP_CONFIG.surge, data.surge),
    cancellation: mergeSection(DEFAULT_APP_CONFIG.cancellation, data.cancellation),
    payments: mergeSection(DEFAULT_APP_CONFIG.payments, data.payments),
  };
}

// The busy-time multiplier, never below normal fares.
export function surgeMultiplier(config = currentConfig) {
  const m = Number(config?.surge?.multiplier);
  return Number.isFinite(m) && m > 1 ? Math.round(m * 100) / 100 : 1;
}

export function cashEnabled(config = currentConfig) {
  return Number(config?.payments?.cashEnabled) === 1;
}

/* ---------------- shared live copy ----------------
   One listener for the whole app. Screens either use the hook (re-renders on
   change) or the plain getters below (money(), currencySymbol()), which read
   the latest copy without needing a hook. */
let currentConfig = DEFAULT_APP_CONFIG;
const subscribers = new Set();
let stopListener = null;

function startListener() {
  if (stopListener) return;
  try {
    stopListener = onSnapshot(
      doc(db, "config", "app"),
      (snap) => {
        currentConfig = normaliseAppConfig(snap.exists() ? snap.data() : null);
        subscribers.forEach((fn) => fn(currentConfig));
      },
      () => {
        // Read denied (e.g. not signed in yet) or offline: keep whatever we
        // had, defaults at worst, and allow the next screen to try again.
        stopListener = null;
      }
    );
  } catch (error) {
    stopListener = null;
  }
}

// Call once at app start so prices show the right currency straight away.
export function startAppConfigSync() {
  startListener();
}

export function getAppConfig() {
  return currentConfig;
}

export function useAppConfig() {
  const [config, setConfig] = useState(currentConfig);

  useEffect(() => {
    startListener();
    subscribers.add(setConfig);
    setConfig(currentConfig);
    return () => subscribers.delete(setConfig);
  }, []);

  return config;
}

/* ---------------- money ---------------- */
const SYMBOLS = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  CAD: "CA$",
  AUD: "A$",
  AED: "AED ",
  PKR: "Rs ",
  SAR: "SAR ",
};

// Symbol for a currency code. With no code, uses the live app currency.
export function currencySymbol(code) {
  const c = String(code || currentConfig.currency || "GBP").toUpperCase();
  return SYMBOLS[c] || `${c} `;
}

// money(12.5) -> "£12.50". Pass a code to format a stored ride in its own currency.
export function money(amount, code) {
  const n = Number(amount);
  return currencySymbol(code) + (Number.isFinite(n) ? n.toFixed(2) : "0.00");
}

/* ---------------- waiting charge ----------------
   Same maths as the chargeOnRideCompletion Cloud Function, so the figure the
   driver and passenger see is the one that gets charged. */
export function waitingCharge(waitedMs, policy) {
  const p = mergeSection(DEFAULT_APP_CONFIG.waiting, policy);
  const minutes = Math.max(0, waitedMs) / 60000;
  const chargeable = Math.max(0, Math.ceil(minutes - p.freeMinutes));
  const charge = Math.min(chargeable * p.ratePerMinute, p.maxCharge);
  return Math.round(charge * 100) / 100;
}
