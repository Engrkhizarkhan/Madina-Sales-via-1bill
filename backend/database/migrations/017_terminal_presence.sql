-- release: additive
-- Latest browser contacts only; no passenger data or growing event history.
CREATE TABLE IF NOT EXISTS terminal_presence (
  slot TINYINT UNSIGNED NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  instance_id CHAR(32) NOT NULL,
  last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  phase VARCHAR(12) NOT NULL,
  transport VARCHAR(12) NOT NULL,
  rtt_ms DOUBLE NULL,
  download_mbps DOUBLE NULL,
  loss_pct DOUBLE NULL,
  probe_ok TINYINT NULL,
  version VARCHAR(24) NOT NULL DEFAULT '',
  PRIMARY KEY (slot, instance_id),
  INDEX idx_presence_seen (last_seen)
) ENGINE=InnoDB;
