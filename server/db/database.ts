import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';

export type UserRole =
  | 'CLIENT'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'VERIFICATION_AGENT'
  | 'CREDIT_AGENT'
  | 'CLIENT_SUPPORT'
  | 'AUDITOR';

export function createDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath || process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'vmicro_credit.db');
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  seedDatabase(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CLIENT',
      phone_verified INTEGER NOT NULL DEFAULT 0,
      phone_otp TEXT,
      reset_token TEXT,
      reset_token_expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT 'Kinshasa',
      commune TEXT DEFAULT 'Gombe',
      country TEXT NOT NULL DEFAULT 'RDC',
      profession TEXT DEFAULT '',
      monthly_income_usd REAL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'fr',
      avatar_url TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identity_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_reference TEXT,
      liveness_passed INTEGER NOT NULL DEFAULT 0,
      document_matched INTEGER NOT NULL DEFAULT 0,
      device_biometric_verified INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      failure_reason TEXT,
      reviewed_by TEXT,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      consent_type TEXT NOT NULL,
      granted INTEGER NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      ip_address TEXT,
      granted_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT NOT NULL,
      device_label TEXT NOT NULL,
      ip_address TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'USD',
      available_balance REAL NOT NULL DEFAULT 0,
      locked_goals_balance REAL NOT NULL DEFAULT 0,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL NOT NULL DEFAULT 0,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_references (
      reference TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      phone_number TEXT,
      goal_id TEXT,
      loan_id TEXT,
      external_ref TEXT,
      status TEXT NOT NULL DEFAULT 'INITIATED',
      is_simulated INTEGER NOT NULL DEFAULT 1,
      reconciled INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_id TEXT,
      loan_id TEXT,
      payment_reference TEXT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT NOT NULL,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_activity TEXT NOT NULL,
      business_years INTEGER NOT NULL DEFAULT 1,
      monthly_income REAL NOT NULL,
      monthly_expenses REAL NOT NULL,
      existing_commitments REAL NOT NULL DEFAULT 0,
      requested_amount REAL NOT NULL,
      duration_months INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      estimated_monthly_payment REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      decision_note TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS solvency_assessments (
      id TEXT PRIMARY KEY,
      loan_application_id TEXT UNIQUE NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      risk_band TEXT NOT NULL,
      debt_to_income_ratio REAL NOT NULL,
      disposable_income REAL NOT NULL,
      eligible INTEGER NOT NULL,
      factors_json TEXT NOT NULL,
      halisi_reference TEXT,
      disclaimer TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_contracts (
      id TEXT PRIMARY KEY,
      loan_application_id TEXT UNIQUE NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      principal_amount REAL NOT NULL,
      annual_interest_rate REAL NOT NULL,
      duration_months INTEGER NOT NULL,
      monthly_installment REAL NOT NULL,
      total_repayable REAL NOT NULL,
      remaining_balance REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      disbursed_at TEXT NOT NULL,
      is_simulated INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS repayment_schedules (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES loan_contracts(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      principal_due REAL NOT NULL,
      interest_due REAL NOT NULL,
      total_due REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS repayments (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES loan_contracts(id) ON DELETE CASCADE,
      schedule_id TEXT REFERENCES repayment_schedules(id),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_reference TEXT NOT NULL,
      provider TEXT NOT NULL,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      push_enabled INTEGER NOT NULL DEFAULT 1,
      savings_alerts INTEGER NOT NULL DEFAULT 1,
      loan_updates INTEGER NOT NULL DEFAULT 1,
      repayment_reminders INTEGER NOT NULL DEFAULT 1,
      security_alerts INTEGER NOT NULL DEFAULT 1,
      financial_tips INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'SIMULATION',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_errors (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      error_code TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deletion_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      created_at TEXT NOT NULL
    );
  `);
}

function seedDatabase(db: Database.Database): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existingUsers.count > 0) return;

  const now = new Date().toISOString();
  const clientHash = bcrypt.hashSync('Password123!', 10);
  const adminHash = bcrypt.hashSync('Admin123!', 10);
  const agentHash = bcrypt.hashSync('Agent123!', 10);
  const auditHash = bcrypt.hashSync('Audit123!', 10);

  const clientId = 'usr_client_grace';
  const client2Id = 'usr_client_patrick';
  const superAdminId = 'usr_admin_super';
  const creditAgentId = 'usr_agent_credit';
  const kycAgentId = 'usr_agent_kyc';
  const auditorId = 'usr_auditor_01';

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, role, phone_verified, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?)
  `);

  insertUser.run(clientId, 'grace.kabongo@vmicro.cd', '+243812345678', clientHash, 'CLIENT', now, now);
  insertUser.run(client2Id, 'patrick.mutombo@vmicro.cd', '+243998765432', clientHash, 'CLIENT', now, now);
  insertUser.run(superAdminId, 'admin@vmicro.cd', '+243810000001', adminHash, 'SUPER_ADMIN', now, now);
  insertUser.run(creditAgentId, 'credit.agent@vmicro.cd', '+243810000002', agentHash, 'CREDIT_AGENT', now, now);
  insertUser.run(kycAgentId, 'kyc.agent@vmicro.cd', '+243810000003', agentHash, 'VERIFICATION_AGENT', now, now);
  insertUser.run(auditorId, 'auditor@vmicro.cd', '+243810000004', auditHash, 'AUDITOR', now, now);

  const insertProfile = db.prepare(`
    INSERT INTO profiles (user_id, first_name, last_name, date_of_birth, city, commune, country, profession, monthly_income_usd, language, avatar_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'RDC', ?, ?, 'fr', ?, ?)
  `);

  insertProfile.run(
    clientId,
    'Grâce',
    'Kabongo',
    '1994-05-14',
    'Kinshasa',
    'Gombe',
    'Commerçante — Boutique textile',
    780,
    '/src/assets/images/avatar_client_congo_1795184076161.jpg',
    now
  );
  insertProfile.run(client2Id, 'Patrick', 'Mutombo', '1991-09-22', 'Lubumbashi', 'Kampemba', 'Technicien solaire', 640, '', now);
  insertProfile.run(superAdminId, 'Nadège', 'Ilunga', '1986-02-11', 'Kinshasa', 'Ngaliema', 'Super Administrateur', 0, '', now);
  insertProfile.run(creditAgentId, 'Chadrack', 'Mbuyi', '1989-11-03', 'Kinshasa', 'Limete', 'Analyste Crédit', 0, '', now);
  insertProfile.run(kycAgentId, 'Bénédicte', 'Lumbu', '1993-07-19', 'Goma', 'Karisimbi', 'Agent Vérification KYC', 0, '', now);
  insertProfile.run(auditorId, 'Serge', 'Kasongo', '1984-04-30', 'Kinshasa', 'Gombe', 'Auditeur Interne', 0, '', now);

  // Notification preferences
  const insertPrefs = db.prepare(`
    INSERT INTO notification_preferences (user_id) VALUES (?)
  `);
  [clientId, client2Id, superAdminId, creditAgentId, kycAgentId, auditorId].forEach((id) => insertPrefs.run(id));

  // Identity Verifications
  db.prepare(`
    INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, reviewed_by, is_simulated, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('kyc_grace_01', clientId, 'HALISI_FACE_LIVENESS', 'HalisiMockIdentityProvider', 'HLS-ID-2026-8841', 1, 1, 1, 'VERIFIED', kycAgentId, now, now);

  db.prepare(`
    INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, reviewed_by, is_simulated, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('kyc_patrick_01', client2Id, 'ALTERNATIVE_AGENT_KYC', 'ManualVerificationQueue', 'ALT-KYC-2026-102', 0, 1, 0, 'PENDING_REVIEW', null, now, now);

  // Consents
  db.prepare(`
    INSERT INTO consents (id, user_id, consent_type, granted, version, ip_address, granted_at)
    VALUES (?, ?, 'BIOMETRIC_VERIFICATION', 1, '1.0', '127.0.0.1', ?)
  `).run('cns_grace_bio', clientId, now);
  db.prepare(`
    INSERT INTO consents (id, user_id, consent_type, granted, version, ip_address, granted_at)
    VALUES (?, ?, 'DATA_PROCESSING_RDC', 1, '1.0', '127.0.0.1', ?)
  `).run('cns_grace_data', clientId, now);

  // Savings Accounts
  const insertAccount = db.prepare(`
    INSERT INTO savings_accounts (id, user_id, currency, available_balance, locked_goals_balance, is_simulated, updated_at)
    VALUES (?, ?, 'USD', ?, ?, 1, ?)
  `);
  insertAccount.run('acc_grace', clientId, 245.50, 620.00, now);
  insertAccount.run('acc_patrick', client2Id, 110.00, 180.00, now);

  // Savings Goals
  const insertGoal = db.prepare(`
    INSERT INTO savings_goals (id, user_id, title, category, target_amount, current_amount, target_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `);
  insertGoal.run('goal_01', clientId, 'Stock Boutique Gombe', 'Commerce', 800, 460, '2027-03-01', now, now);
  insertGoal.run('goal_02', clientId, 'Fonds Scolaire Enfants', 'Éducation', 350, 160, '2027-01-15', now, now);
  insertGoal.run('goal_03', client2Id, 'Onduleur Solaire Atelier', 'Équipement', 500, 180, '2027-04-10', now, now);

  // Transactions
  const insertTx = db.prepare(`
    INSERT INTO transactions (id, user_id, goal_id, loan_id, payment_reference, type, amount, currency, provider, status, description, is_simulated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'CONFIRMED', ?, 1, ?)
  `);
  insertTx.run('tx_01', clientId, null, null, 'PAY-SIM-9001', 'DEPOSIT', 150.00, 'VODACOM_MPESA', 'Dépôt épargne libre via Vodacom M-Pesa (Simulation)', '2026-11-10T09:15:00Z');
  insertTx.run('tx_02', clientId, 'goal_01', null, 'PAY-SIM-9002', 'GOAL_ALLOCATION', 260.00, 'AIRTEL_MONEY', 'Dépôt objectif Stock Boutique Gombe (Simulation)', '2026-11-13T14:30:00Z');
  insertTx.run('tx_03', clientId, 'goal_02', null, 'PAY-SIM-9003', 'GOAL_ALLOCATION', 160.00, 'ORANGE_MONEY', 'Dépôt objectif Fonds Scolaire (Simulation)', '2026-11-16T11:05:00Z');
  insertTx.run('tx_04', clientId, null, 'loan_grace_active', 'PAY-SIM-9004', 'LOAN_REPAYMENT', 92.50, 'AIRTEL_MONEY', 'Remboursement échéance #1 microcrédit (Simulation)', '2026-11-18T16:40:00Z');

  // Payment references
  const insertPayRef = db.prepare(`
    INSERT INTO payment_references (reference, idempotency_key, user_id, provider, operation_type, amount, currency, phone_number, external_ref, status, is_simulated, reconciled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, 'CONFIRMED', 1, 1, ?, ?)
  `);
  insertPayRef.run('PAY-SIM-9001', 'idem_9001', clientId, 'VODACOM_MPESA', 'DEPOSIT', 150.00, '+243812345678', 'MPESA-SIM-7712', '2026-11-10T09:15:00Z', '2026-11-10T09:15:05Z');
  insertPayRef.run('PAY-SIM-9002', 'idem_9002', clientId, 'AIRTEL_MONEY', 'GOAL_DEPOSIT', 260.00, '+243812345678', 'AIRTEL-SIM-8821', '2026-11-13T14:30:00Z', '2026-11-13T14:30:04Z');

  // Active Loan + Pending Loan
  const insertLoanApp = db.prepare(`
    INSERT INTO loan_applications (id, user_id, business_activity, business_years, monthly_income, monthly_expenses, existing_commitments, requested_amount, duration_months, purpose, estimated_monthly_payment, status, decision_note, reviewed_by, reviewed_at, is_simulated, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  insertLoanApp.run(
    'loan_grace_active',
    clientId,
    'Vente en gros de pagnes et tissus',
    4,
    780,
    360,
    50,
    500,
    6,
    'Réapprovisionnement stock fin d’année',
    92.50,
    'APPROVED',
    'Dossier solide : épargne régulière et capacité nette positive de 370 USD/mois.',
    creditAgentId,
    '2026-10-18T10:00:00Z',
    '2026-10-15T08:00:00Z',
    '2026-10-18T10:00:00Z'
  );

  insertLoanApp.run(
    'loan_patrick_pending',
    client2Id,
    'Installation kits solaires résidentiels',
    2,
    640,
    340,
    40,
    400,
    6,
    'Achat outillage et batteries lithium',
    74.00,
    'PENDING_REVIEW',
    null,
    null,
    null,
    now,
    now
  );

  // Solvency Assessments
  const insertSolvency = db.prepare(`
    INSERT INTO solvency_assessments (id, loan_application_id, user_id, score, risk_band, debt_to_income_ratio, disposable_income, eligible, factors_json, halisi_reference, disclaimer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSolvency.run(
    'solv_01',
    'loan_grace_active',
    clientId,
    79,
    'LOW',
    0.18,
    370,
    1,
    JSON.stringify([
      { label: 'Ratio d’endettement (18%)', impact: '+24 pts', status: 'FAVORABLE' },
      { label: 'Épargne active (865.50 USD)', impact: '+22 pts', status: 'FAVORABLE' },
      { label: 'Vérification KYC Halisi confirmée', impact: '+18 pts', status: 'FAVORABLE' },
      { label: 'Ancienneté activité (4 ans)', impact: '+15 pts', status: 'FAVORABLE' }
    ]),
    'HLS-CREDIT-SIM-4401',
    'Score indicatif uniquement — ne constitue pas une garantie d’octroi. Décision finale soumise à validation humaine autorisée.',
    '2026-10-15T08:01:00Z'
  );

  insertSolvency.run(
    'solv_02',
    'loan_patrick_pending',
    client2Id,
    62,
    'MEDIUM',
    0.18,
    260,
    1,
    JSON.stringify([
      { label: 'Capacité nette mensuelle (260 USD)', impact: '+20 pts', status: 'FAVORABLE' },
      { label: 'Épargne active (290 USD)', impact: '+16 pts', status: 'FAVORABLE' },
      { label: 'Vérification KYC en attente d’examen', impact: '+8 pts', status: 'ATTENTION' },
      { label: 'Ancienneté activité (2 ans)', impact: '+18 pts', status: 'FAVORABLE' }
    ]),
    'HLS-CREDIT-SIM-4402',
    'Score indicatif uniquement — ne constitue pas une garantie d’octroi. Décision finale soumise à validation humaine autorisée.',
    now
  );

  // Active Loan Contract & Schedule for Grâce
  db.prepare(`
    INSERT INTO loan_contracts (id, loan_application_id, user_id, principal_amount, annual_interest_rate, duration_months, monthly_installment, total_repayable, remaining_balance, status, disbursed_at, is_simulated)
    VALUES (?, ?, ?, 500, 22, 6, 92.50, 555.00, 462.50, 'ACTIVE', '2026-10-18T10:05:00Z', 1)
  `).run('ctr_grace_01', 'loan_grace_active', clientId);

  const insertSched = db.prepare(`
    INSERT INTO repayment_schedules (id, contract_id, installment_number, due_date, principal_due, interest_due, total_due, paid_amount, status, paid_at)
    VALUES (?, 'ctr_grace_01', ?, ?, ?, ?, 92.50, ?, ?, ?)
  `);
  insertSched.run('sch_01', 1, '2026-11-18', 83.33, 9.17, 92.50, 'PAID', '2026-11-18T16:40:00Z');
  insertSched.run('sch_02', 2, '2026-12-18', 83.33, 9.17, 0, 'PENDING', null);
  insertSched.run('sch_03', 3, '2027-01-18', 83.33, 9.17, 0, 'PENDING', null);
  insertSched.run('sch_04', 4, '2027-02-18', 83.33, 9.17, 0, 'PENDING', null);
  insertSched.run('sch_05', 5, '2027-03-18', 83.34, 9.16, 0, 'PENDING', null);
  insertSched.run('sch_06', 6, '2027-04-18', 83.34, 9.16, 0, 'PENDING', null);

  // Notifications
  const insertNotif = db.prepare(`
    INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertNotif.run('ntf_01', clientId, 'REPAYMENT_REMINDER', 'Échéance à venir le 18 décembre', 'Votre 2e échéance simulée de 92,50 USD arrive à échéance le 18/12/2026.', 0, now);
  insertNotif.run('ntf_02', clientId, 'SAVINGS_CONFIRMED', 'Objectif Stock Boutique à 57 %', 'Bravo ! Vous avez déjà épargné 460,00 USD sur votre objectif de 800,00 USD.', 0, '2026-11-13T14:35:00Z');
  insertNotif.run('ntf_03', clientId, 'SECURITY_ALERT', 'Vérification d’identité confirmée', 'Votre vérification Halisi (mode simulation) a été validée avec succès.', 1, '2026-10-14T12:00:00Z');

  // Provider Configs
  const insertProvider = db.prepare(`
    INSERT INTO provider_configs (id, name, category, mode, enabled, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertProvider.run('AIRTEL_MONEY', 'Airtel Money RDC', 'MOBILE_MONEY', 'SIMULATION', 1, superAdminId, now);
  insertProvider.run('ORANGE_MONEY', 'Orange Money RDC', 'MOBILE_MONEY', 'SIMULATION', 1, superAdminId, now);
  insertProvider.run('VODACOM_MPESA', 'Vodacom M-Pesa RDC', 'MOBILE_MONEY', 'SIMULATION', 1, superAdminId, now);
  insertProvider.run('FLEXPAY_AGGREGATOR', 'Agrégateur FlexPay RDC', 'PAYMENT_AGGREGATOR', 'SIMULATION', 1, superAdminId, now);
  insertProvider.run('CARD_INTL', 'Cartes Bancaires (Visa/MC)', 'CARD', 'DISABLED_SANDBOX', 0, superAdminId, now);
  insertProvider.run('HALISI_CORE', 'API Halisi (Enrôlement, KYC & Crédit)', 'IDENTITY_CREDIT', 'MOCK_ADAPTER', 1, superAdminId, now);
  insertProvider.run('GEMINI_AI', 'Assistant V-Micro (Google Gemini)', 'AI_ASSISTANT', 'CLOUD_API', 1, superAdminId, now);

  // Sample integration error log for Admin visibility
  db.prepare(`
    INSERT INTO integration_errors (id, provider, endpoint, error_code, message, resolved, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(
    'err_init_01',
    'CARD_INTL',
    'POST /cards/authorize',
    'PROVIDER_CONTRACT_PENDING',
    'Connecteur cartes internationales désactivé par défaut en attente des autorisations acquéreur RDC.',
    '2026-11-01T08:00:00Z'
  );

  // Initial Audit Log
  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata_json, created_at)
    VALUES (?, ?, 'CREDIT_AGENT', 'LOAN_APPROVED', 'LOAN_APPLICATION', 'loan_grace_active', ?, ?)
  `).run(
    `aud_${crypto.randomUUID().slice(0, 8)}`,
    creditAgentId,
    JSON.stringify({ amount: 500, mode: 'SIMULATION', note: 'Dossier approuvé après contrôle solvabilité' }),
    '2026-10-18T10:00:00Z'
  );
}
