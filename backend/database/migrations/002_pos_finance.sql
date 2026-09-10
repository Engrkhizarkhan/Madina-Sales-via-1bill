CREATE TABLE IF NOT EXISTS counter_shifts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_date DATE NOT NULL,
  counter_name VARCHAR(80) NOT NULL,
  opening_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_transaction_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('Open','Closed') NOT NULL DEFAULT 'Open',
  opened_by BIGINT UNSIGNED NOT NULL,
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME NULL,
  CONSTRAINT fk_counter_shift_opened_by FOREIGN KEY (opened_by) REFERENCES users(id),
  CONSTRAINT fk_counter_shift_closed_by FOREIGN KEY (closed_by) REFERENCES users(id),
  INDEX idx_counter_shift_user_status (opened_by, status),
  INDEX idx_counter_shift_date (business_date)
) ENGINE=InnoDB;

ALTER TABLE counter_shifts
  ADD COLUMN IF NOT EXISTS opening_transaction_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER opening_cash;

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_date DATE NOT NULL,
  category ENUM('Terminal','Fuel','Maintenance','Driver advance','Refreshment','Utilities','Salary','Other') NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_method ENUM('Cash','Card','Bank transfer') NOT NULL DEFAULT 'Cash',
  reference VARCHAR(190) NOT NULL DEFAULT '',
  notes TEXT NOT NULL,
  shift_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_shift FOREIGN KEY (shift_id) REFERENCES counter_shifts(id),
  CONSTRAINT fk_expense_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_expense_date_category (expense_date, category)
) ENGINE=InnoDB;

ALTER TABLE shift_closures
  ADD COLUMN IF NOT EXISTS shift_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN IF NOT EXISTS opening_cash DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER counter_name;

SET @has_fk = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'shift_closures'
    AND CONSTRAINT_NAME = 'fk_shift_closure_shift'
);
SET @add_fk = IF(
  @has_fk = 0,
  'ALTER TABLE shift_closures ADD CONSTRAINT fk_shift_closure_shift FOREIGN KEY (shift_id) REFERENCES counter_shifts(id), ADD UNIQUE KEY uq_shift_closure_shift (shift_id)',
  'SELECT 1'
);
PREPARE migration_stmt FROM @add_fk;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
