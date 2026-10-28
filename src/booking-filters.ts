export type DateRange = {from: string; to: string};

/** ISO travel dates are inclusive; blank bounds mean all dates. Invalid ranges show no records. */
export function inDateRange(date: string, range: DateRange): boolean {
  if (range.from && range.to && range.from > range.to) return false;
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
