-- release: additive
CREATE TABLE IF NOT EXISTS terminal_slots (
  slot TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT terminal_slots_range CHECK (slot BETWEEN 1 AND 99)
) ENGINE=InnoDB;
INSERT IGNORE INTO terminal_slots (slot) VALUES (1),(2),(3);
-- Widen the original checks without removing any enrolled devices or changing their keys.
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='terminal_devices' AND CONSTRAINT_NAME='terminal_devices_chk_1'), 'ALTER TABLE terminal_devices DROP CHECK terminal_devices_chk_1', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='terminal_enrollments' AND CONSTRAINT_NAME='terminal_enrollments_chk_1'), 'ALTER TABLE terminal_enrollments DROP CHECK terminal_enrollments_chk_1', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(NOT EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='terminal_devices' AND CONSTRAINT_NAME='terminal_devices_registered_slot'), 'ALTER TABLE terminal_devices ADD CONSTRAINT terminal_devices_registered_slot FOREIGN KEY (slot) REFERENCES terminal_slots(slot)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF(NOT EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='terminal_enrollments' AND CONSTRAINT_NAME='terminal_enrollments_registered_slot'), 'ALTER TABLE terminal_enrollments ADD CONSTRAINT terminal_enrollments_registered_slot FOREIGN KEY (slot) REFERENCES terminal_slots(slot)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
