// utils/useWaitingClock.js
// Live waiting timer shown to driver and passenger once the driver has
// pressed "I've Arrived". Uses the ride's own waiting terms (saved at booking)
// and the same maths the payment function charges with.
import { useEffect, useState } from "react";
import { getAppConfig, money, waitingCharge } from "./appConfig";

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Returns null until the driver has arrived.
export function useWaitingClock(ride) {
  const [now, setNow] = useState(Date.now());
  const arrivedMs = ride?.status === "arrived" ? toMillis(ride?.arrivedAt) : null;

  useEffect(() => {
    if (!arrivedMs) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [arrivedMs]);

  if (!arrivedMs) return null;

  const policy = ride.waitingPolicy || getAppConfig().waiting;
  const waitedMs = Math.max(0, now - arrivedMs);
  const freeMs = Number(policy.freeMinutes || 0) * 60000;
  const charge = waitingCharge(waitedMs, policy);
  const code = ride.currency || ride.fare?.currency;

  if (waitedMs < freeMs) {
    const left = Math.ceil((freeMs - waitedMs) / 1000);
    return {
      inFreeTime: true,
      charge: 0,
      label: `Free waiting: ${Math.floor(left / 60)}:${pad(left % 60)} left`,
      detail: `Then ${money(policy.ratePerMinute, code)}/min, up to ${money(policy.maxCharge, code)}`,
    };
  }

  const capped = charge >= Number(policy.maxCharge || 0);
  return {
    inFreeTime: false,
    charge,
    label: `Waiting charge: ${money(charge, code)}`,
    detail: capped
      ? "Maximum waiting charge reached"
      : `${money(policy.ratePerMinute, code)} per minute after ${policy.freeMinutes} free minutes`,
  };
}
