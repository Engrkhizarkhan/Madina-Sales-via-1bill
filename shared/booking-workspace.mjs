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

// Keep class/destination price proportions and allocate the final cents exactly.
export function allocateFareTotal(fares, total) {
  if (total === undefined || !fares.length) return [...fares];
  if (!Number.isFinite(total) || total < 0 || !Number.isSafeInteger(Math.round(total * 100))) throw new RangeError('Invalid total fare.');
  let weights = fares.map(fare => {
    const cents = Math.round(fare * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Invalid seat fare.');
    return BigInt(cents);
  });
  if (weights.every(weight => weight === 0n)) weights = weights.map(() => 1n);
  const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
  const target = BigInt(Math.round(total * 100));
  const amounts = weights.map(weight => target * weight / denominator);
  const remainders = weights.map((weight, index) => ({index, value:target * weight % denominator}));
  remainders.sort((a,b) => a.value === b.value ? a.index - b.index : a.value > b.value ? -1 : 1);
  const remaining = Number(target - amounts.reduce((sum, amount) => sum + amount, 0n));
  for (let index = 0; index < remaining; index++) amounts[remainders[index].index]++;
  return amounts.map(amount => Number(amount) / 100);
}

export function paidVoucherBookings(bookings) {
  return bookings.filter(booking => booking.bookingStatus === 'Confirmed' &&
    booking.paid - (booking.refunds || []).reduce((sum, refund) => sum + refund.amount, 0) > 0)
    .sort((a, b) => a.seats[0] - b.seats[0]);
}
