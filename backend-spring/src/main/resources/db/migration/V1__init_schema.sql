-- Flyway V1 : Schéma relationnel PostgreSQL complet V-Micro Crédit
-- Marché cible initial : République démocratique du Congo (extensible)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'CLIENT',
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_otp VARCHAR(12),
    reset_token VARCHAR(64),
    reset_token_expires_at TIMESTAMPTZ,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profiles (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    city VARCHAR(100) NOT NULL DEFAULT 'Kinshasa',
    commune VARCHAR(100),
    country VARCHAR(64) NOT NULL DEFAULT 'RDC',
    profession VARCHAR(160),
    monthly_income_usd NUMERIC(14,2) DEFAULT 0,
    language VARCHAR(8) NOT NULL DEFAULT 'fr',
    avatar_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE identity_verifications (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method VARCHAR(64) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    provider_reference VARCHAR(128),
    liveness_passed BOOLEAN NOT NULL DEFAULT FALSE,
    document_matched BOOLEAN NOT NULL DEFAULT FALSE,
    device_biometric_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    failure_reason TEXT,
    reviewed_by VARCHAR(64) REFERENCES users(id),
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE consents (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type VARCHAR(64) NOT NULL,
    granted BOOLEAN NOT NULL,
    version VARCHAR(16) NOT NULL DEFAULT '1.0',
    ip_address VARCHAR(64),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(128) NOT NULL,
    device_label VARCHAR(160) NOT NULL,
    ip_address VARCHAR(64),
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE savings_accounts (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    available_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
    locked_goals_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (locked_goals_balance >= 0),
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE savings_goals (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    category VARCHAR(64) NOT NULL,
    target_amount NUMERIC(14,2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
    target_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payment_references (
    reference VARCHAR(64) PRIMARY KEY,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    operation_type VARCHAR(32) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    phone_number VARCHAR(32),
    goal_id VARCHAR(64) REFERENCES savings_goals(id),
    loan_id VARCHAR(64),
    external_ref VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'INITIATED',
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    reconciled BOOLEAN NOT NULL DEFAULT FALSE,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id VARCHAR(64) REFERENCES savings_goals(id),
    loan_id VARCHAR(64),
    payment_reference VARCHAR(64) REFERENCES payment_references(reference),
    type VARCHAR(32) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    provider VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL,
    description TEXT NOT NULL,
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE loan_applications (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_activity VARCHAR(200) NOT NULL,
    business_years INTEGER NOT NULL DEFAULT 1,
    monthly_income NUMERIC(14,2) NOT NULL,
    monthly_expenses NUMERIC(14,2) NOT NULL,
    existing_commitments NUMERIC(14,2) NOT NULL DEFAULT 0,
    requested_amount NUMERIC(14,2) NOT NULL,
    duration_months INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    estimated_monthly_payment NUMERIC(14,2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW',
    decision_note TEXT,
    reviewed_by VARCHAR(64) REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE solvency_assessments (
    id VARCHAR(64) PRIMARY KEY,
    loan_application_id VARCHAR(64) UNIQUE NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    risk_band VARCHAR(24) NOT NULL,
    debt_to_income_ratio NUMERIC(6,2) NOT NULL,
    disposable_income NUMERIC(14,2) NOT NULL,
    eligible BOOLEAN NOT NULL,
    factors_json JSONB NOT NULL,
    halisi_reference VARCHAR(128),
    disclaimer TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE loan_contracts (
    id VARCHAR(64) PRIMARY KEY,
    loan_application_id VARCHAR(64) UNIQUE NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    principal_amount NUMERIC(14,2) NOT NULL,
    annual_interest_rate NUMERIC(5,2) NOT NULL,
    duration_months INTEGER NOT NULL,
    monthly_installment NUMERIC(14,2) NOT NULL,
    total_repayable NUMERIC(14,2) NOT NULL,
    remaining_balance NUMERIC(14,2) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    disbursed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE repayment_schedules (
    id VARCHAR(64) PRIMARY KEY,
    contract_id VARCHAR(64) NOT NULL REFERENCES loan_contracts(id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL,
    due_date DATE NOT NULL,
    principal_due NUMERIC(14,2) NOT NULL,
    interest_due NUMERIC(14,2) NOT NULL,
    total_due NUMERIC(14,2) NOT NULL,
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    paid_at TIMESTAMPTZ
);

CREATE TABLE repayments (
    id VARCHAR(64) PRIMARY KEY,
    contract_id VARCHAR(64) NOT NULL REFERENCES loan_contracts(id) ON DELETE CASCADE,
    schedule_id VARCHAR(64) REFERENCES repayment_schedules(id),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL,
    payment_reference VARCHAR(64) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(64) NOT NULL,
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_preferences (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    savings_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    loan_updates BOOLEAN NOT NULL DEFAULT TRUE,
    repayment_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    security_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    financial_tips BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ai_conversations (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_messages (
    id VARCHAR(64) PRIMARY KEY,
    conversation_id VARCHAR(64) NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    sender VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    citations_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) REFERENCES users(id),
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(64),
    metadata_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE provider_configs (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(64) NOT NULL,
    mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATION',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by VARCHAR(64) REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integration_errors (
    id VARCHAR(64) PRIMARY KEY,
    provider VARCHAR(64) NOT NULL,
    endpoint VARCHAR(160) NOT NULL,
    error_code VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_user ON transactions(user_id, created_at DESC);
CREATE INDEX idx_loans_user ON loan_applications(user_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
