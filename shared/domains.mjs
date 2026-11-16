export const publicOrigin = 'https://madinaexpress.pk';
export const staffOrigin = 'https://staff.madinaexpress.pk';
export const legacyPublicOrigin = 'https://madinaexpress.duckdns.org';
export const legacyStaffOrigin = 'https://staff.madinaexpress.duckdns.org';
export const webOrigins = [publicOrigin, 'https://www.madinaexpress.pk', staffOrigin, legacyPublicOrigin, legacyStaffOrigin];

// Fallbacks are approved in the signed application, never supplied by a web page.
export function cloudOriginCandidates(origin) {
  const normalized = origin.replace(/\/$/, '');
  if (normalized === staffOrigin) return [staffOrigin, legacyStaffOrigin];
  if (normalized === legacyStaffOrigin) return [legacyStaffOrigin, staffOrigin];
  return [normalized];
}
