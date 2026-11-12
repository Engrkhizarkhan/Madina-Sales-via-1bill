import { pool } from './db.js';
import { fail, parseJson } from './helpers.js';
export const defaultPolicies = Object.freeze({
  publicReservationsEnabled: true, publicExpiryEnabled: true, publicExpiryHours: 2,
  staffExpiryEnabled: false, staffExpiryHours: 2, publicAdvanceDays: 90,
  publicMaxSeats: 4, staffCanEditFare: true, staffCanDiscount: true,
  staffMaxDiscountPercent: 100, staffMaxCollection: 0,
  staffCanRefund: true, staffMaxRefundPercent: 100, staffMaxRefundAmount: 0,
});
export function validatePolicies(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Enter the booking policies.',422,'validation_error');
  const result = {};
  for (const [key, fallback] of Object.entries(defaultPolicies)) {
    const value = data[key] ?? fallback;
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') fail(`Choose a valid ${key} setting.`,422,'validation_error');
    } else {
      const max = key.endsWith('Hours') ? 168 : key.endsWith('Percent') ? 100 : key === 'publicMaxSeats' ? 10 : key === 'publicAdvanceDays' ? 365 : 10000000;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < (key.endsWith('Hours') ? .25 : key.startsWith('public') ? 1 : 0) || value > max) fail(`Enter a valid ${key}.`,422,'validation_error');
      if (['publicMaxSeats','publicAdvanceDays'].includes(key) && !Number.isInteger(value)) fail(`Enter a whole number for ${key}.`,422,'validation_error');
    }
    result[key] = value;
  }
  return result;
}
export async function getPolicies(executor = pool) {
  const [[row]] = await executor.execute("SELECT setting_value FROM settings WHERE setting_key='booking_policies'");
  return { ...defaultPolicies, ...parseJson(row?.setting_value) };
}
export function staffCollectionPolicy(policy, user, baseFares, fares, discount) {
  if (!user || user.role === 'admin') return;
  if (!policy.staffCanEditFare && fares.some((fare,index) => fare !== baseFares[index])) fail('The administrator has disabled staff fare changes.',403,'policy_denied');
  const total = fares.reduce((sum,fare)=>sum+fare,0);
  if (discount > 0 && (!policy.staffCanDiscount || discount > total * policy.staffMaxDiscountPercent / 100 + .005)) fail('The discount exceeds the staff policy. Ask an administrator.',403,'policy_denied');
  if (policy.staffMaxCollection > 0 && total-discount > policy.staffMaxCollection) fail('This collection exceeds the staff limit. Ask an administrator.',403,'policy_denied');
}
export function staffRefundPolicy(policy, user, amount, paid, alreadyRefunded) {
  if (user.role === 'admin') return;
  if (!policy.staffCanRefund || (policy.staffMaxRefundAmount > 0 && amount > policy.staffMaxRefundAmount) || alreadyRefunded+amount > paid*policy.staffMaxRefundPercent/100+.005) fail('This refund exceeds the staff policy. Ask an administrator.',403,'policy_denied');
}
export function reservationExpiry(policy, isPublic, departure, now = Date.now()) {
  const enabled = isPublic ? policy.publicExpiryEnabled : policy.staffExpiryEnabled;
  if (!enabled) return null;
  return new Date(Math.min(departure, now + (isPublic ? policy.publicExpiryHours : policy.staffExpiryHours)*3600000));
}
