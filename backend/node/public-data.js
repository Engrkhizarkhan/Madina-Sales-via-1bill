// Public timetable responses contain pricing and seating, never commission or crew records.
export function publicBus(bus) {
  if (!bus) return bus;
  const {id,layoutId,registration,service,seats,model,year,status,isTemplate,seatClasses}=bus;
  return {id,layoutId,registration,service,seats,model,year,status,isTemplate,seatClasses};
}
export function publicRoute(route) {
  if (!route) return route;
  const {id,from,to,distance,duration,fare,boarding,status,destinations,services}=route;
  return {id,from,to,distance,duration,fare,boarding,status,destinations,
    services:services?.map(({busId,times,fares})=>({busId,times,fares}))};
}
export function publicTrip(trip) {
  const {id,routeId,busId,departure,arrival,status,days,active,runNumber}=trip;
  return {id,routeId,busId,departure,arrival,status,days,active,runNumber,driver:"",attendant:"",platform:""};
}
