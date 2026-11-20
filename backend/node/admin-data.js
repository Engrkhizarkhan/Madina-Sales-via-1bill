import {pool} from './db.js';
import {isOwner} from './account-access.js';
import {getPolicies} from './policies.js';
import {fail,pakistanDate} from './helpers.js';
import {fetchBookings,fetchBuses,fetchCrew,fetchRoutes,fetchTripRuns,fetchTrips,fetchUsers} from './repository.js';

async function snapshot(read) {
  const connection=await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [[state]]=await connection.query('SELECT epoch,CAST(revision AS CHAR) revision FROM live_state WHERE id=1');
    if (!state) throw new Error('The live change index has not been initialized.');
    const result=await read(connection,state);
    await connection.commit();
    return result;
  } catch(error) {await connection.rollback();throw error;}
  finally {connection.release();}
}

async function catalog(connection,user,runs) {
  const trips=await fetchTrips(false,connection);
  const todayRuns=runs||await fetchTripRuns(pakistanDate(),connection);
  return {
    trips:trips.map(trip=>{
      const run=todayRuns.find(item=>item.tripId===trip.id&&item.date===pakistanDate());
      return run?{...trip,status:run.status,runNumber:run.runNumber}:{...trip,status:'Scheduled',runNumber:1};
    }),
    fleet:await fetchBuses(false,connection),routes:await fetchRoutes(false,connection),crew:await fetchCrew(connection),
    users:isOwner(user)?await fetchUsers(connection):[],policies:await getPolicies(connection),
    ...(isOwner(user)?{pendingRemovals:Number((await connection.query("SELECT COUNT(*) count FROM catalog_removals WHERE status='Pending'"))[0][0].count)}:{}),
  };
}

const cursorFor=state=>`${state.epoch}:${state.revision}`;
export async function adminSnapshot(user,serviceDate=null) {
  return snapshot(async(connection,state)=>{
    const runs=await fetchTripRuns(serviceDate,connection);
    return {liveCursor:cursorFor(state),scopeDate:serviceDate,bookings:await fetchBookings(connection,null,serviceDate),runs,...await catalog(connection,user,runs)};
  });
}

export async function adminChanges(cursor,user,serviceDate=null) {
  if (typeof cursor!=='string'||!/^([a-f0-9]{32}):([0-9]{1,18})$/.test(cursor)) fail('Reload the page to reconnect live data.',422,'invalid_cursor');
  const [epoch,revision]=cursor.split(':');
  return snapshot(async(connection,state)=>{
    const liveCursor=cursorFor(state);
    if (epoch!==state.epoch||BigInt(revision)>BigInt(state.revision)) return {reset:true,liveCursor};
    if (revision===state.revision) return {changed:false,liveCursor};
    const [changes]=await connection.execute(`SELECT entity_type,entity_id FROM live_changes WHERE revision>? AND revision<=?
      ORDER BY revision,entity_type,entity_id LIMIT 501`,[revision,state.revision]);
    // A bulk cleanup/long offline interval gets one consistent full resync.
    // Never advance past a partially delivered revision or silently lose events.
    if(changes.length>500||changes.some(change=>change.entity_type==='reset'))return {reset:true,liveCursor};
    const bookingIds=changes.filter(change=>change.entity_type==='booking').map(change=>change.entity_id);
    const runIds=changes.filter(change=>change.entity_type==='run').map(change=>change.entity_id);
    const bookings=(await fetchBookings(connection,bookingIds)).filter(row=>!serviceDate||row.date===serviceDate),runs=(await fetchTripRuns(null,connection,runIds)).filter(row=>!serviceDate||row.date===serviceDate);
    return {changed:true,liveCursor,bookings,runs,
      removedBookingIds:bookingIds.filter(id=>!bookings.some(booking=>booking.id===id)),
      removedRunIds:runIds.filter(id=>!runs.some(run=>run.id===id)),
      ...(changes.some(change=>change.entity_type==='catalog')?{catalog:await catalog(connection,user)}:{}),
    };
  });
}
