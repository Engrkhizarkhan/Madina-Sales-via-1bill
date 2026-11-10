/** Keep internal payment/audit markers intact while using concise operational labels in the interface. */
export function presentationText(value: string): string {
  const labels: Record<string, string> = {
    'Client demo': 'Madina Express',
    'Demo web payment': 'Public website',
    'Client demonstration journey': 'Journey record',
    'Simulated demonstration refund': 'Refund recorded',
    'Simulated client demo sale': 'Ticket sale',
    'Simulated client demo refund': 'Ticket refund',
    'Synthetic client demonstration data': '',
  };
  return labels[value] ?? value.replace(/^DEMO-/i, '');
}

export function shortPaymentReference(reference: string): string {
  const text = presentationText(reference);
  const oneBill = text.match(/^1BILL-([0-9a-f]{16,})$/i);
  if (oneBill) return `1BILL-${oneBill[1].slice(0, 8)}`;
  return text.length > 24 ? `${text.slice(0, 12)}…${text.slice(-8)}` : text;
}

export function shortRouteCode(id: string): string {
  const code = presentationText(id).toUpperCase();
  const generated = code.match(/^ROUTE-([0-9A-F]{32})$/);
  return generated ? `ROUTE-${generated[1].slice(0, 8)}` : code;
}
