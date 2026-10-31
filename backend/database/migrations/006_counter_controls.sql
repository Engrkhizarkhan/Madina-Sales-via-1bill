-- Re-runnable migration for schedule removal, bus layouts and ticket-page sales controls.
SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='deleted_at');
SET @ddl = IF(@present=0, 'ALTER TABLE trips ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='buses' AND COLUMN_NAME='deleted_at');
SET @ddl = IF(@present=0, 'ALTER TABLE buses ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='routes' AND COLUMN_NAME='deleted_at');
SET @ddl = IF(@present=0, 'ALTER TABLE routes ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crew' AND COLUMN_NAME='deleted_at');
SET @ddl = IF(@present=0, 'ALTER TABLE crew ADD COLUMN deleted_at DATETIME NULL', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='buses' AND COLUMN_NAME='is_template');
SET @ddl = IF(@present=0, 'ALTER TABLE buses ADD COLUMN is_template TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trip_runs' AND COLUMN_NAME='sales_paused');
SET @ddl = IF(@present=0, 'ALTER TABLE trip_runs ADD COLUMN sales_paused TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trip_runs' AND COLUMN_NAME='sales_override');
SET @ddl = IF(@present=0, 'ALTER TABLE trip_runs ADD COLUMN sales_override TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

