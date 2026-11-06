-- Route destinations, per-layout fares / time choices, seat classes and short ticket references.
SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='routes' AND COLUMN_NAME='destinations');
SET @ddl = IF(@present=0, 'ALTER TABLE routes ADD COLUMN destinations JSON NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='routes' AND COLUMN_NAME='services');
SET @ddl = IF(@present=0, 'ALTER TABLE routes ADD COLUMN services JSON NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='buses' AND COLUMN_NAME='seat_classes');
SET @ddl = IF(@present=0, 'ALTER TABLE buses ADD COLUMN seat_classes JSON NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='buses' AND COLUMN_NAME='commission_rate');
SET @ddl = IF(@present=0, 'ALTER TABLE buses ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

ALTER TABLE bookings MODIFY gender ENUM('Male','Female','Unspecified') NOT NULL;
CREATE TABLE IF NOT EXISTS ticket_numbers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
