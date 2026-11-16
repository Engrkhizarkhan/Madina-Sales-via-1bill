type Customer = {tripRunId?: string; passenger: string; phone: string};
type SeatBooking = {bookingStatus: string; seats: number[]};
export function sameBookingCustomer(a: Customer, b: Customer): boolean;
export function departureSeatCounts(bookings: SeatBooking[]): {booked: number; reserved: number; total: number};
export function fareQuantities(fares: number[]): {fare: number; count: number}[];
export function paidVoucherBookings<T extends SeatBooking & {paid: number; refunds?: {amount: number}[]}>(bookings: T[]): T[];
