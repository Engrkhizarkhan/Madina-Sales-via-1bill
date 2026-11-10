SET @present = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'idx_bookings_expiry');
SET @ddl = IF(@present = 0, 'ALTER TABLE bookings ADD INDEX idx_bookings_expiry (booking_status, expires_at)', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
