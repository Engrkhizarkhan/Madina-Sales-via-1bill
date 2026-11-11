CREATE TABLE IF NOT EXISTS terminal_devices (
  slot TINYINT UNSIGNED PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL UNIQUE,
  certificate TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (slot BETWEEN 1 AND 3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS terminal_enrollments (
  slot TINYINT UNSIGNED PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  CHECK (slot BETWEEN 1 AND 3),
  CONSTRAINT fk_terminal_enrollment_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
