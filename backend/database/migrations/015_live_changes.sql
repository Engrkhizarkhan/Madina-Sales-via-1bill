-- release: additive
-- Updated in the same transaction as the business change; the locked clock row
-- orders commits, unlike AUTO_INCREMENT ids allocated before a transaction commits.
CREATE TABLE IF NOT EXISTS live_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  epoch CHAR(32) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT IGNORE INTO live_state(id,epoch,revision) VALUES (1,REPLACE(UUID(),'-',''),0);
CREATE TABLE IF NOT EXISTS live_changes (
  entity_type VARCHAR(16) NOT NULL,
  entity_id VARCHAR(190) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(entity_type,entity_id),
  INDEX live_changes_revision(revision)
) ENGINE=InnoDB;
