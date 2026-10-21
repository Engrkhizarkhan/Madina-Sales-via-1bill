type TicketState = {
  bookingStatus: string;
  paymentStatus: string;
  balance: number;
};

export function ticketPresentation(booking: TicketState) {
  if (booking.bookingStatus === "Cancelled") return {
    canBoard: false, title: "Cancelled ticket", status: "CANCELLED",
    message: "Not valid for boarding. Keep this record for reference.",
  };
  if (booking.bookingStatus === "Refunded" || booking.paymentStatus === "Refunded") return {
    canBoard: false, title: "Refunded ticket", status: "REFUNDED",
    message: "Not valid for boarding. Keep this refund record.",
  };
  if (booking.bookingStatus === "Confirmed" && booking.balance <= 0 && ["Paid", "Partially refunded"].includes(booking.paymentStatus)) return {
    canBoard: true, title: "Ticket & boarding token",
    status: booking.paymentStatus === "Partially refunded" ? "PARTIALLY REFUNDED" : "PAID & CONFIRMED",
    message: "Valid for boarding. Keep this receipt and give the token to the conductor.",
  };
  return { canBoard: false, title: "Reservation slip", status: "UNPAID · NOT VALID FOR BOARDING",
    message: "Pay at the terminal to receive your boarding token.",
  };
}

export const ticketDate = (date: string) => new Date(`${date}T12:00:00+05:00`)
  .toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "2-digit" }).replaceAll(" ", "-");

export const ticketTime = (date: Date) => date.toLocaleTimeString("en-GB", {
  timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false,
});
