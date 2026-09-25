SET NAMES utf8mb4;
SET time_zone = '+05:00';

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','manager','counter','dispatcher','finance') NOT NULL DEFAULT 'counter',
  active TINYINT(1) NOT NULL DEFAULT 1,
  failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  force_password_change TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS routes (
  id VARCHAR(64) PRIMARY KEY,
  origin VARCHAR(120) NOT NULL,
  destination VARCHAR(120) NOT NULL,
  distance VARCHAR(40) NOT NULL,
  duration VARCHAR(40) NOT NULL,
  fare DECIMAL(12,2) NOT NULL,
  boarding_point VARCHAR(255) NOT NULL,
  status ENUM('Active','Paused') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_routes_status_origin (status, origin)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS buses (
  id VARCHAR(64) PRIMARY KEY,
  registration VARCHAR(40) NOT NULL UNIQUE,
  service VARCHAR(80) NOT NULL,
  seats SMALLINT UNSIGNED NOT NULL,
  model VARCHAR(120) NOT NULL,
  model_year SMALLINT UNSIGNED NOT NULL,
  status ENUM('On route','Ready','Maintenance','Retired') NOT NULL DEFAULT 'Ready',
  next_service VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHECK (seats BETWEEN 1 AND 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crew (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  role ENUM('Driver','Female attendant','Manager','Counter agent') NOT NULL,
  phone VARCHAR(30) NOT NULL,
  cnic VARCHAR(40) NOT NULL UNIQUE,
  license VARCHAR(80) NOT NULL,
  duty VARCHAR(255) NOT NULL,
  status ENUM('On duty','Available','Scheduled','Off duty') NOT NULL DEFAULT 'Available',
  initials VARCHAR(8) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_crew_role_status (role, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trips (
  id VARCHAR(64) PRIMARY KEY,
  route_id VARCHAR(64) NOT NULL,
  bus_id VARCHAR(64) NOT NULL,
  departure TIME NOT NULL,
  arrival TIME NOT NULL,
  driver VARCHAR(120) NOT NULL,
  attendant VARCHAR(120) NOT NULL,
  platform VARCHAR(30) NOT NULL,
  status ENUM('Boarding','Scheduled','Departed') NOT NULL DEFAULT 'Scheduled',
  service_days JSON NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  run_number INT UNSIGNED NOT NULL DEFAULT 1,
  last_departed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_trips_route FOREIGN KEY (route_id) REFERENCES routes(id),
  CONSTRAINT fk_trips_bus FOREIGN KEY (bus_id) REFERENCES buses(id),
  INDEX idx_trips_route_active (route_id, active),
  INDEX idx_trips_departure (departure)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(64) PRIMARY KEY,
  ticket_no VARCHAR(40) NOT NULL UNIQUE,
  source ENUM('Public web','Counter') NOT NULL,
  passenger VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  cnic VARCHAR(50) NOT NULL,
  gender ENUM('Male','Female') NOT NULL,
  route_label VARCHAR(255) NOT NULL,
  destination VARCHAR(120) NOT NULL,
  boarding_point VARCHAR(255) NOT NULL,
  bus_registration VARCHAR(40) NOT NULL,
  service VARCHAR(80) NOT NULL,
  fare DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL,
  paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method ENUM('Cash','Card','Bank transfer','1Bill') NOT NULL,
  payment_reference VARCHAR(190) NOT NULL DEFAULT '',
  payment_status ENUM('Paid','Unpaid','Partially refunded','Refunded') NOT NULL,
  booking_status ENUM('Confirmed','Reserved','Cancelled','Refunded') NOT NULL,
  travel_date DATE NOT NULL,
  travel_time TIME NOT NULL,
  driver VARCHAR(120) NOT NULL,
  attendant VARCHAR(120) NOT NULL,
  trip_id VARCHAR(64) NOT NULL,
  trip_run_id VARCHAR(120) NOT NULL,
  expires_at DATETIME NULL,
  seat_printed_at DATETIME NULL,
  issued_by VARCHAR(120) NULL,
  terminal VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_bookings_trip FOREIGN KEY (trip_id) REFERENCES trips(id),
  INDEX idx_bookings_trip_run (trip_run_id),
  INDEX idx_bookings_status_date (booking_status, travel_date),
  INDEX idx_bookings_phone (phone),
  INDEX idx_bookings_cnic (cnic)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trip_runs (
  id VARCHAR(190) PRIMARY KEY,
  trip_id VARCHAR(64) NOT NULL,
  service_date DATE NOT NULL,
  run_number INT UNSIGNED NOT NULL DEFAULT 1,
  bus_id VARCHAR(64) NOT NULL,
  driver VARCHAR(120) NOT NULL,
  attendant VARCHAR(120) NOT NULL,
  platform VARCHAR(30) NOT NULL,
  status ENUM('Scheduled','Boarding','Departed','Returned','Cancelled') NOT NULL DEFAULT 'Scheduled',
  notes TEXT NOT NULL,
  boarding_started_at DATETIME NULL,
  departed_at DATETIME NULL,
  returned_at DATETIME NULL,
  snapshot JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_trip_runs_trip FOREIGN KEY (trip_id) REFERENCES trips(id),
  CONSTRAINT fk_trip_runs_bus FOREIGN KEY (bus_id) REFERENCES buses(id),
  UNIQUE KEY uq_trip_service_run (trip_id, service_date, run_number),
  INDEX idx_trip_runs_service_status (service_date, status),
  INDEX idx_trip_runs_bus_date (bus_id, service_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_seats (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(64) NOT NULL,
  trip_run_id VARCHAR(120) NOT NULL,
  seat_number SMALLINT UNSIGNED NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  active_trip_run_id VARCHAR(120) AS (CASE WHEN active = 1 THEN trip_run_id ELSE NULL END) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_seats_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  UNIQUE KEY uq_active_trip_seat (active_trip_run_id, seat_number),
  INDEX idx_booking_seats_booking (booking_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refunds (
  id VARCHAR(64) PRIMARY KEY,
  booking_id VARCHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('Cash','Card','Bank transfer','1Bill') NOT NULL,
  reason ENUM('Passenger request','Trip cancelled','Duplicate payment','Service disruption','Other') NOT NULL,
  reference VARCHAR(190) NOT NULL,
  notes TEXT NOT NULL,
  processed_by BIGINT UNSIGNED NOT NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refunds_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_refunds_user FOREIGN KEY (processed_by) REFERENCES users(id),
  INDEX idx_refunds_booking (booking_id),
  INDEX idx_refunds_processed_at (processed_at),
  CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS financial_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(64) NULL,
  refund_id VARCHAR(64) NULL,
  transaction_type ENUM('sale','refund','expense','shift_close') NOT NULL,
  payment_method ENUM('Cash','Card','Bank transfer','1Bill') NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference VARCHAR(190) NOT NULL DEFAULT '',
  description VARCHAR(255) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_financial_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_financial_refund FOREIGN KEY (refund_id) REFERENCES refunds(id),
  CONSTRAINT fk_financial_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_financial_date_type (created_at, transaction_type)
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS shift_closures (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shift_id BIGINT UNSIGNED NULL UNIQUE,
  business_date DATE NOT NULL,
  counter_name VARCHAR(80) NOT NULL,
  opening_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
  expected_cash DECIMAL(12,2) NOT NULL,
  cash_counted DECIMAL(12,2) NOT NULL,
  digital_collections DECIMAL(12,2) NOT NULL,
  terminal_expense DECIMAL(12,2) NOT NULL DEFAULT 0,
  driver_advance DECIMAL(12,2) NOT NULL DEFAULT 0,
  refreshment DECIMAL(12,2) NOT NULL DEFAULT 0,
  handover DECIMAL(12,2) NOT NULL,
  variance DECIMAL(12,2) NOT NULL,
  remarks TEXT NOT NULL,
  closed_by BIGINT UNSIGNED NOT NULL,
  closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_shift_closure_shift FOREIGN KEY (shift_id) REFERENCES counter_shifts(id),
  CONSTRAINT fk_shift_user FOREIGN KEY (closed_by) REFERENCES users(id),
  INDEX idx_shift_date_counter (business_date, counter_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(40) NOT NULL,
  provider_event_id VARCHAR(190) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provider_event (provider, provider_event_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(190) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  ip_address VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_created_at (created_at)
) ENGINE=InnoDB;

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
