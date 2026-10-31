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
