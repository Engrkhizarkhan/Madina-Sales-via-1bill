-- Nullable additions keep older applications compatible during an update/rollback.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bookings' AND COLUMN_NAME='sold_by_user_id')=0,
  'ALTER TABLE bookings ADD COLUMN sold_by_user_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bookings' AND COLUMN_NAME='sold_terminal_slot')=0,
  'ALTER TABLE bookings ADD COLUMN sold_terminal_slot TINYINT UNSIGNED NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bookings' AND COLUMN_NAME='sold_from')=0,
  'ALTER TABLE bookings ADD COLUMN sold_from VARCHAR(32) NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bookings' AND INDEX_NAME='idx_bookings_seller')=0,
  'ALTER TABLE bookings ADD INDEX idx_bookings_seller (sold_by_user_id, seat_printed_at)', 'SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

-- Recover only an unambiguous payment actor from the immutable sales ledger.
-- Keep the original issued_by name snapshot and leave historical PCs unknown.
UPDATE bookings b JOIN (
  SELECT booking_id,MIN(created_by) seller
  FROM financial_transactions
  WHERE transaction_type='sale' AND booking_id IS NOT NULL AND created_by IS NOT NULL
  GROUP BY booking_id HAVING COUNT(DISTINCT created_by)=1
) sales ON sales.booking_id=b.id
SET b.sold_by_user_id=sales.seller
WHERE b.sold_by_user_id IS NULL;
