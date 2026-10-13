-- Initial schema. Applied automatically on the first request (see app/Migrator.php).
-- Times are stored in UTC. JSON values are stored as TEXT for MySQL 5.7+/MariaDB portability.

CREATE TABLE users (
  id CHAR(24) NOT NULL,
  email VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  phone VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('SUPER_ADMIN','ADMIN','CUSTOMER') NOT NULL DEFAULT 'CUSTOMER',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  token_version INT NOT NULL DEFAULT 0,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE offices (
  id CHAR(24) NOT NULL,
  unit VARCHAR(40) NOT NULL,
  floor VARCHAR(40) NULL,
  block VARCHAR(40) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY offices_unit (unit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id CHAR(24) NOT NULL,
  seq INT NOT NULL AUTO_INCREMENT,
  user_id CHAR(24) NOT NULL,
  company_name VARCHAR(191) NOT NULL,
  contact_name VARCHAR(191) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  whatsapp VARCHAR(40) NULL,
  office_id CHAR(24) NULL,
  status ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY customers_seq (seq),
  UNIQUE KEY customers_user (user_id),
  KEY customers_office (office_id),
  CONSTRAINT customers_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT customers_office_fk FOREIGN KEY (office_id) REFERENCES offices (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE plans (
  id CHAR(24) NOT NULL,
  name VARCHAR(60) NOT NULL,
  description TEXT NULL,
  speed VARCHAR(60) NOT NULL,
  duration_days INT NOT NULL,
  price_kobo INT NOT NULL,
  features TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoices (
  id CHAR(24) NOT NULL,
  seq INT NOT NULL AUTO_INCREMENT,
  customer_id CHAR(24) NOT NULL,
  plan_id CHAR(24) NOT NULL,
  amount_kobo INT NOT NULL,
  status ENUM('UNPAID','PENDING_VERIFICATION','PAID','CANCELLED') NOT NULL DEFAULT 'UNPAID',
  paid_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY invoices_seq (seq),
  KEY invoices_customer_created (customer_id, created_at),
  KEY invoices_status_paid (status, paid_at),
  CONSTRAINT invoices_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT invoices_plan_fk FOREIGN KEY (plan_id) REFERENCES plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subscriptions (
  id CHAR(24) NOT NULL,
  customer_id CHAR(24) NOT NULL,
  plan_id CHAR(24) NOT NULL,
  invoice_id CHAR(24) NULL,
  status ENUM('ACTIVE','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  starts_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY subscriptions_invoice (invoice_id),
  KEY subscriptions_customer_expires (customer_id, expires_at),
  KEY subscriptions_status_expires (status, expires_at),
  CONSTRAINT subscriptions_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT subscriptions_plan_fk FOREIGN KEY (plan_id) REFERENCES plans (id),
  CONSTRAINT subscriptions_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id CHAR(24) NOT NULL,
  invoice_id CHAR(24) NOT NULL,
  customer_id CHAR(24) NOT NULL,
  amount_kobo INT NOT NULL,
  method ENUM('BANK_TRANSFER','CASH','POS','OTHER') NOT NULL DEFAULT 'BANK_TRANSFER',
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  sender_name VARCHAR(191) NULL,
  sender_bank VARCHAR(100) NULL,
  transfer_ref VARCHAR(191) NULL,
  proof_mime VARCHAR(100) NULL,
  note TEXT NULL,
  reject_reason TEXT NULL,
  recorded_by_id CHAR(24) NULL,
  reviewed_by_id CHAR(24) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY payments_status_created (status, created_at),
  KEY payments_invoice (invoice_id),
  KEY payments_customer (customer_id),
  CONSTRAINT payments_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
  CONSTRAINT payments_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded transfer receipts live in the database so they're backed up with everything else.
-- Separate table so listing payments never loads file bytes.
CREATE TABLE payment_proofs (
  payment_id CHAR(24) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  data MEDIUMBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (payment_id),
  CONSTRAINT payment_proofs_payment_fk FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One access account per customer. `desired_enabled` is what the subscription says; `enabled` is
-- what the admin confirmed on the router. A mismatch shows up as a to-do in the admin portal.
CREATE TABLE network_accounts (
  id CHAR(24) NOT NULL,
  customer_id CHAR(24) NOT NULL,
  username VARCHAR(60) NOT NULL,
  password VARCHAR(60) NOT NULL,
  mac_addresses TEXT NOT NULL,
  desired_enabled TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  last_synced_at DATETIME(3) NULL,
  notes TEXT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY network_accounts_customer (customer_id),
  UNIQUE KEY network_accounts_username (username),
  CONSTRAINT network_accounts_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE support_tickets (
  id CHAR(24) NOT NULL,
  seq INT NOT NULL AUTO_INCREMENT,
  customer_id CHAR(24) NOT NULL,
  subject VARCHAR(191) NOT NULL,
  status ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY support_tickets_seq (seq),
  KEY support_tickets_customer (customer_id),
  CONSTRAINT support_tickets_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ticket_messages (
  id CHAR(24) NOT NULL,
  ticket_id CHAR(24) NOT NULL,
  author_id CHAR(24) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ticket_messages_ticket (ticket_id, created_at),
  CONSTRAINT ticket_messages_ticket_fk FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE,
  CONSTRAINT ticket_messages_author_fk FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  dedupe_key VARCHAR(191) NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY notifications_dedupe (dedupe_key),
  KEY notifications_user_created (user_id, created_at),
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settings (
  setting_key VARCHAR(100) NOT NULL,
  value LONGTEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id CHAR(24) NOT NULL,
  actor_id CHAR(24) NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(64) NULL,
  meta TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY audit_logs_created (created_at),
  CONSTRAINT audit_logs_actor_fk FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
