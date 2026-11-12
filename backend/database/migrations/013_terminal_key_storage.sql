-- release: additive
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='terminal_enrollments' AND COLUMN_NAME='allow_software_key')=0, 'ALTER TABLE terminal_enrollments ADD COLUMN allow_software_key TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='terminal_devices' AND COLUMN_NAME='key_storage')=0, 'ALTER TABLE terminal_devices ADD COLUMN key_storage VARCHAR(16) NOT NULL DEFAULT ''tpm''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
