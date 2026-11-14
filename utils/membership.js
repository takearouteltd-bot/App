/* Driver membership plans: weekly or monthly, with auto-renew.

   The server decides every price and every change (functions/index.js:
   activateDriverMembership, updateDriverMembership, collectMembership,
   renewDriverMemberships). Drivers cannot write drivers.subscription.

   drivers/{id}.subscription
     tier        "weekly" | "monthly" (no tier = monthly, the original plan)
     nextTier    a plan change that starts at the next renewal
     autoRenew   false: the membership ends ("expired") at the end of the
                 period instead of renewing; nothing is charged
   Purchases are driverWallets/{id}/transactions with type
   subscription_deduction (wallet) or subscription_card_payment (card),
   carrying plan, periodStart and periodEnd. */
import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';

export const tierOf = (sub) => (sub?.tier === 'weekly' ? 'weekly' : 'monthly');

export const weeklyOffered = (config) => Number(config?.subscription?.weeklyPrice) > 0;

/** Price of one period of a plan, from the dashboard settings. */
export function planPrice(config, tier) {
  return tier === 'weekly' && weeklyOffered(config)
    ? Number(config.subscription.weeklyPrice)
    : Number(config?.subscription?.monthlyPrice) || 0;
}

export const planName = (tier) => (tier === 'weekly' ? 'Weekly driver plan' : 'Monthly driver plan');
export const perPeriod = (tier) => (tier === 'weekly' ? 'per week' : 'per month');
export const periodWord = (tier) => (tier === 'weekly' ? 'week' : 'month');

/** The plans a driver can pick, in order. */
export function plansOffered(config) {
  return [
    { tier: 'weekly', price: planPrice(config, 'weekly') },
    { tier: 'monthly', price: planPrice(config, 'monthly') },
  ].filter((p) => p.tier === 'monthly' || weeklyOffered(config));
}

/** True when the driver pays their own membership (not a fleet or an admin). */
export const ownPlan = (sub) =>
  Boolean(sub) && !['fleet', 'admin_granted'].includes(sub.paymentMethod);

/** Start, re-buy or re-activate: pays the chosen plan now (wallet, then card). */
export async function buyMembership(tier) {
  const { data } = await httpsCallable(functions, 'activateDriverMembership')({ tier });
  return data;
}

/** { autoRenew } and/or { tier }. */
export async function updateMembership(change) {
  const { data } = await httpsCallable(functions, 'updateDriverMembership')(change);
  return data;
}

const PURCHASE_TYPES = ['subscription_deduction', 'subscription_card_payment'];

/** The driver's last membership purchases, newest first. */
export function useMembershipPurchases(driverId, count = 10) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!driverId) return undefined;
    return onSnapshot(
      query(
        collection(db, 'driverWallets', driverId, 'transactions'),
        where('type', 'in', PURCHASE_TYPES),
        orderBy('createdAt', 'desc'),
        limit(count)
      ),
      (snap) =>
        setItems(
          snap.docs.map((d) => {
            const t = d.data();
            return {
              id: d.id,
              at: t.createdAt,
              plan: t.plan || null,
              amount: Math.abs(Number(t.cardAmount ?? t.amount) || 0),
              method: t.type === 'subscription_card_payment' ? 'card' : 'wallet',
              periodStart: t.periodStart || null,
              periodEnd: t.periodEnd || null,
            };
          })
        ),
      () => setItems([])
    );
  }, [driverId, count]);
  return items;
}

export function shortDate(t) {
  if (!t) return '—';
  try {
    const d = t.toDate ? t.toDate() : new Date(t);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

/** One line for the driver's profile: plan, renews/ends date, auto-renew. */
export function membershipSummary(sub, fleetName) {
  if (!sub?.status) return 'Not set up';
  if (sub.paymentMethod === 'admin_granted') return 'Given by TakeARoute';
  if (sub.paymentMethod === 'fleet') return `Paid by ${fleetName || 'your fleet'}`;
  const plan = tierOf(sub) === 'weekly' ? 'Weekly' : 'Monthly';
  if (sub.status === 'expired') return `${plan} · ended, buy again to drive`;
  if (sub.status === 'suspended') return `${plan} · paused, payment needed`;
  if (sub.status === 'past_due') return `${plan} · payment due`;
  const when = shortDate(sub.nextBillingDate);
  return sub.autoRenew === false ? `${plan} · ends ${when} · auto-renew off` : `${plan} · renews ${when}`;
}
