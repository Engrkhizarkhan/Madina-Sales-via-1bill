export const isSleeper = (service: string) => /sleeper/i.test(service);

// Keep the persisted seat numbers stable: A = 1–15, B = 16–30,
// and the five rear berths retain their printed numbers 31–35.
export function seatLabel(seat: number, service: string): string {
  if (!isSleeper(service) || seat > 30) return String(seat);
  return seat <= 15 ? `A-${seat}` : `B-${seat - 15}`;
}

export const seatList = (seats: number[], service: string, separator = ", ") =>
  seats.map((seat) => seatLabel(seat, service)).join(separator);

export type CoachRow = {
  left: (number | null)[];
  center: number | null;
  right: (number | null)[];
};

export function coachRows(capacity: number): CoachRow[] {
  if (!Number.isInteger(capacity) || capacity < 1) return [];
  // The 41-seat reference has four 1+2 rows, then seven 2+2 rows.
  if (capacity === 41) {
    return [
      ...Array.from({ length: 4 }, (_, row) => ({
        left: [row * 3 + 3, null], center: null, right: [row * 3 + 2, row * 3 + 1],
      })),
      ...Array.from({ length: 7 }, (_, row) => ({
        left: [row * 4 + 16, row * 4 + 15], center: null, right: [row * 4 + 14, row * 4 + 13],
      })),
      { left: [41, null], center: null, right: [null, null] },
    ];
  }
  // The supplied 49-seat plan has eleven paired rows and a five-seat rear bench.
  const pairedSeats = capacity === 49 ? 44 : capacity;
  const rows: CoachRow[] = [];
  for (let first = 1; first <= pairedSeats; first += 4) {
    const seat = (offset: number) => first + offset <= pairedSeats ? first + offset : null;
    rows.push({ left: [seat(3), seat(2)], center: null, right: [seat(1), seat(0)] });
  }
  if (capacity === 49) rows.push({ left: [49, 48], center: 47, right: [46, 45] });
  return rows;
}

export type SleeperRoom = { label: string; seats: number[] };

export function sleeperRows(capacity: number): SleeperRoom[][] {
  if (!Number.isInteger(capacity) || capacity < 1) return [];
  return Array.from({ length: 5 }, (_, index) => {
    const first = index * 3 + 1;
    return [
      { label: `A-${first}`, seats: [first] },
      { label: `A-${first + 1}-${first + 2}`, seats: [first + 1, first + 2] },
      { label: `B-${first}`, seats: [first + 15] },
      { label: `B-${first + 1}-${first + 2}`, seats: [first + 16, first + 17] },
    ].map((room) => {
      const seats = room.seats.filter((seat) => seat <= capacity);
      return { seats, label: seats.length === room.seats.length ? room.label : seatList(seats, "Sleeper Bus") };
    });
  }).filter((row) => row.some((room) => room.seats.length));
}
