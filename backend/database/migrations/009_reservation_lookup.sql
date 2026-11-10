SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reservation_no');
SET @ddl = IF(@present = 0,
  'ALTER TABLE bookings ADD COLUMN reservation_no VARCHAR(40) NULL, ADD UNIQUE INDEX uq_bookings_reservation_no (reservation_no)',
  'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

UPDATE bookings b JOIN (
  SELECT entity_id, MAX(JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.ticketNo'))) AS reference
  FROM audit_logs
  WHERE action = 'reservation.confirmed' AND entity_type = 'booking'
  GROUP BY entity_id
) original ON original.entity_id = b.id
SET b.reservation_no = original.reference
WHERE b.reservation_no IS NULL AND CHAR_LENGTH(original.reference) <= 40
  AND original.reference REGEXP '^RS-[0-9A-Z]+(-[0-9A-Z]+)*$';
