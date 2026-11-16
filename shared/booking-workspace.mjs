const customerName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const customerPhone = value => String(value || '').replace(/[\s().-]/g, '').replace(/^(?:\+92|0092|92)(3\d{9})$/, '0$1');

// A customer is matched only within one dated departure, using both contact fields.
// Existing separate tickets can therefore be managed together without rewriting history.
export function sameBookingCustomer(a, b) {
  return Boolean(a.tripRunId && a.tripRunId === b.tripRunId && customerName(a.passenger) && customerPhone(a.phone) &&
    customerName(a.passenger) === customerName(b.passenger) && customerPhone(a.phone) === customerPhone(b.phone));
}

export function departureSeatCounts(bookings) {
  const booked = new Set(), reserved = new Set();
  for (const booking of bookings) {
    const target = booking.bookingStatus === 'Confirmed' ? booked : booking.bookingStatus === 'Reserved' ? reserved : null;
    if (target) for (const seat of booking.seats) target.add(seat);
  }
  return {booked: booked.size, reserved: reserved.size, total: new Set([...booked, ...reserved]).size};
}

export function fareQuantities(fares) {
  const quantities = new Map();
  for (const fare of fares) quantities.set(fare, (quantities.get(fare) || 0) + 1);
  return [...quantities].map(([fare, count]) => ({fare, count}));
}

export function paidVoucherBookings(bookings) {
  return bookings.filter(booking => booking.bookingStatus === 'Confirmed' &&
    booking.paid - (booking.refunds || []).reduce((sum, refund) => sum + refund.amount, 0) > 0)
    .sort((a, b) => a.seats[0] - b.seats[0]);
}
