CREATE TABLE IF NOT EXISTS api_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  csrf_token CHAR(64) NOT NULL,
  finance_unlocked_until DATETIME NULL,
  last_activity DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  user_agent VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_api_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_api_session_expiry (expires_at),
  INDEX idx_api_session_user (user_id)
) ENGINE=InnoDB;
