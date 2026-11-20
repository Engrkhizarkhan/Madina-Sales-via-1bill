export const publicOrigin = 'https://madinaexpress.pk';
export const staffOrigin = 'https://staff.madinaexpress.pk';
export const terminalOrigin = 'https://terminal.madinaexpress.pk';
export const webOrigins = [publicOrigin, 'https://www.madinaexpress.pk', staffOrigin, terminalOrigin];
// Direct terminal TLS preserves PC certificate verification. Staff remains an
// independent, approved fallback for signed updater and machine API requests.
export function cloudOriginCandidates(origin) {
 const normalized=origin.replace(/\/$/,'');
 if(normalized===terminalOrigin)return [terminalOrigin,staffOrigin];
 if(normalized===staffOrigin)return [staffOrigin,terminalOrigin];
 return [normalized];
}
