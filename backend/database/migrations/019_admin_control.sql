-- release: additive
-- Each DDL step can resume safely after an interrupted installation.
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bookings' AND COLUMN_NAME='tariff_total_at_sale')=0,'ALTER TABLE bookings ADD COLUMN tariff_total_at_sale DECIMAL(12,2) NULL','SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='financial_transactions' AND COLUMN_NAME='terminal_slot')=0,'ALTER TABLE financial_transactions ADD COLUMN terminal_slot TINYINT UNSIGNED NULL','SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='financial_transactions' AND COLUMN_NAME='actor_name')=0,'ALTER TABLE financial_transactions ADD COLUMN actor_name VARCHAR(160) NULL','SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_logs' AND COLUMN_NAME='terminal_slot')=0,'ALTER TABLE audit_logs ADD COLUMN terminal_slot TINYINT UNSIGNED NULL','SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_logs' AND COLUMN_NAME='actor_name')=0,'ALTER TABLE audit_logs ADD COLUMN actor_name VARCHAR(160) NULL','SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='financial_transactions' AND INDEX_NAME='idx_financial_actor_date')=0,'ALTER TABLE financial_transactions ADD INDEX idx_financial_actor_date(created_by,terminal_slot,created_at)','SELECT 1');
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

-- Historical selling terminals are known only when the ledger actor matches the recorded seller.
UPDATE financial_transactions t JOIN bookings b ON b.id=t.booking_id
SET t.terminal_slot=b.sold_terminal_slot,t.actor_name=b.issued_by
WHERE t.transaction_type='sale' AND t.created_by=b.sold_by_user_id AND b.sold_terminal_slot IS NOT NULL AND t.terminal_slot IS NULL;

CREATE TABLE IF NOT EXISTS catalog_removals (
  id VARCHAR(96) PRIMARY KEY,
  entity_type ENUM('route','bus','trip','crew') NOT NULL,
  entity_id VARCHAR(190) NOT NULL,
  label VARCHAR(255) NOT NULL,
  parent_id VARCHAR(96) NULL,
  snapshot JSON NOT NULL,
  status ENUM('Pending','Approved','Restored','Purged') NOT NULL DEFAULT 'Pending',
  removed_by BIGINT UNSIGNED NULL,
  removed_name VARCHAR(160) NULL,
  terminal_slot TINYINT UNSIGNED NULL,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  removed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_name VARCHAR(160) NULL,
  reviewed_at DATETIME NULL,
  INDEX idx_removal_status(status,removed_at,id),
  INDEX idx_removal_entity(entity_type,entity_id,removed_at),
  INDEX idx_removal_parent(parent_id)
) ENGINE=InnoDB;

-- Earlier soft deletions remain recoverable. Do not infer cascade membership from old timestamps.
INSERT IGNORE INTO catalog_removals(id,entity_type,entity_id,label,snapshot,status,removed_at,reason)
SELECT CONCAT('legacy-route-',id),'route',id,CONCAT(origin,' → ',destination),JSON_OBJECT('status','Paused'),'Approved',deleted_at,'Archived before admin review was introduced'
FROM routes WHERE deleted_at IS NOT NULL;
INSERT IGNORE INTO catalog_removals(id,entity_type,entity_id,label,snapshot,status,removed_at,reason)
SELECT CONCAT('legacy-bus-',id),'bus',id,CONCAT(model,' · ',registration),JSON_OBJECT('status',status),'Approved',deleted_at,'Archived before admin review was introduced'
FROM buses WHERE deleted_at IS NOT NULL;
INSERT IGNORE INTO catalog_removals(id,entity_type,entity_id,label,snapshot,status,removed_at,reason)
SELECT CONCAT('legacy-trip-',t.id),'trip',t.id,CONCAT(r.origin,' → ',r.destination,' · ',LEFT(t.departure,5)),JSON_OBJECT('active',1),'Approved',t.deleted_at,'Archived before admin review was introduced'
FROM trips t JOIN routes r ON r.id=t.route_id WHERE t.deleted_at IS NOT NULL;
INSERT IGNORE INTO catalog_removals(id,entity_type,entity_id,label,snapshot,status,removed_at,reason)
SELECT CONCAT('legacy-crew-',id),'crew',CAST(id AS CHAR),name,JSON_OBJECT('id',id),'Approved',deleted_at,'Archived before admin review was introduced'
FROM crew WHERE deleted_at IS NOT NULL;

UPDATE catalog_removals r JOIN audit_logs a ON a.id=(SELECT MAX(a2.id) FROM audit_logs a2 WHERE a2.entity_type=r.entity_type AND a2.entity_id=r.entity_id AND a2.action=CONCAT(r.entity_type,'.deleted'))
LEFT JOIN users u ON u.id=a.user_id
SET r.snapshot=COALESCE(a.before_json,r.snapshot),r.removed_by=a.user_id,r.removed_name=COALESCE(a.actor_name,u.name),r.terminal_slot=a.terminal_slot
WHERE r.id LIKE 'legacy-%' AND r.status='Approved';

CREATE TABLE IF NOT EXISTS counter_cash_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_date DATE NOT NULL,
  terminal_slot TINYINT UNSIGNED NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  staff_name VARCHAR(160) NOT NULL,
  kind ENUM('Handover','Payout') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  request_key VARCHAR(64) NOT NULL UNIQUE,
  notes VARCHAR(500) NOT NULL,
  reverses_id BIGINT UNSIGNED NULL UNIQUE,
  recorded_by BIGINT UNSIGNED NOT NULL,
  recorded_name VARCHAR(160) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_counter_cash_date(business_date,staff_id,terminal_slot)
) ENGINE=InnoDB;
