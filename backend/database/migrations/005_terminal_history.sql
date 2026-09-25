-- Additive and repeatable: preserve all existing bookings and run history.
ALTER TABLE trip_runs MODIFY status ENUM('Scheduled','Boarding','Departed','Returned','Cancelled') NOT NULL DEFAULT 'Scheduled';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trip_runs' AND column_name = 'snapshot') = 0,
  'ALTER TABLE trip_runs ADD COLUMN snapshot JSON NULL', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trip_runs' AND column_name = 'returned_at') = 0,
  'ALTER TABLE trip_runs ADD COLUMN returned_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE trip_runs tr JOIN trips t ON t.id = tr.trip_id JOIN routes r ON r.id = t.route_id JOIN buses b ON b.id = tr.bus_id
SET tr.snapshot = JSON_OBJECT('routeId',t.route_id,'departure',TIME_FORMAT(t.departure,'%H:%i'),'arrival',TIME_FORMAT(t.arrival,'%H:%i'),
  'route',JSON_OBJECT('id',r.id,'from',r.origin,'to',r.destination,'distance',r.distance,'duration',r.duration,'fare',r.fare,'boarding',r.boarding_point,'status',r.status),
  'bus',JSON_OBJECT('id',b.id,'registration',b.registration,'service',b.service,'seats',b.seats,'model',b.model,'year',b.model_year,'status',b.status,'nextService',b.next_service))
WHERE tr.snapshot IS NULL;
-- Holds are now released only by an operator. Do not restore already cancelled records.
UPDATE bookings SET expires_at = NULL WHERE booking_status = 'Reserved' AND expires_at IS NOT NULL;
-- On-route is derived from recorded departures, never set independently on the fleet card.
UPDATE buses b SET status = 'Ready' WHERE status = 'On route'
  AND NOT EXISTS (SELECT 1 FROM trip_runs tr WHERE tr.bus_id = b.id AND tr.status = 'Departed');
