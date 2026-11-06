// Shared by the counter, public checkout and API. Saved ticket amounts never change.
export const routeDestinations = route => route.destinations?.length ? route.destinations : [{name:route.to,fare:route.fare}];
export const serviceSettings = (route,bus) => route.services?.find(item=>item.busId===(bus.layoutId||bus.id));
export const seatClass = (bus,seat) => bus.seatClasses?.find(group=>group.seats.includes(seat))?.name || 'Standard';
export function seatFare(route,bus,destination,seat) {
  const stop=routeDestinations(route).find(item=>item.name===destination);
  if(!stop) return NaN;
  return Number(serviceSettings(route,bus)?.fares?.[destination]?.[seatClass(bus,seat)] ?? stop.fare);
}
export const departureTimes = (route,bus) => serviceSettings(route,bus)?.times || [];
export function commissionPolicy(route,bus) {
  const rate=serviceSettings(route,bus)?.commissionRate ?? bus.commissionRate ?? 0;
  return {rate, fixed:rate>0};
}
