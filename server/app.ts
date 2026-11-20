import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { createDatabase, type UserRole } from './db/database.ts';
import {
  AuthenticatedRequest,
  LoginRateLimiter,
  compareSecret,
  getPermissionsForRole,
  hashSecret,
  logAudit,
  requireAuth,
  requirePermission,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './security/auth.ts';
import {
  getPaymentProvider,
  listPaymentProviders,
  type PaymentProviderId,
} from './adapters/payment/PaymentProvider.ts';
import {
  MockHalisiCreditAssessmentProvider,
  MockHalisiEnrollmentProvider,
  MockHalisiIdentityVerificationProvider,
} from './adapters/halisi/HalisiProviders.ts';
import {
  calculateAgeFromDob,
  calculateLoanEstimate,
  evaluateSolvency,
} from './services/solvencyService.ts';
import { GeminiAssistantProvider } from './services/geminiAssistant.ts';
import { GeminiMultimodalService } from './services/geminiMultimodal.ts';
import { openApiSpec } from './openapi.ts';

export interface AppDependencies {
  db?: Database.Database;
  assistantProvider?: GeminiAssistantProvider;
  multimodalService?: GeminiMultimodalService;
}

const registerSchema = z.object({
  email: z.string().email('Adresse e-mail invalide'),
  phone: z.string().min(9, 'Numéro de téléphone RDC requis'),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères'),
  firstName: z.string().min(2, 'Prénom requis'),
  lastName: z.string().min(2, 'Nom requis'),
  dateOfBirth: z.string().min(8, 'Date de naissance requise'),
  city: z.string().min(2).default('Kinshasa'),
  commune: z.string().optional().default('Gombe'),
  profession: z.string().optional().default(''),
  monthlyIncomeUsd: z.number().nonnegative().optional().default(0),
  language: z.enum(['fr', 'sw', 'en']).optional().default('fr'),
  acceptDataConsent: z.boolean(),
});

const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
  deviceLabel: z.string().optional().default('Navigateur Web V-Micro'),
});

const goalSchema = z.object({
  title: z.string().min(2, 'Titre requis').max(80),
  category: z.string().min(2).max(40),
  targetAmount: z.number().positive('Le montant cible doit être positif'),
  targetDate: z.string().min(8),
});

const paymentInitSchema = z.object({
  idempotencyKey: z.string().min(6),
  provider: z.enum(['AIRTEL_MONEY', 'ORANGE_MONEY', 'VODACOM_MPESA', 'FLEXPAY_AGGREGATOR', 'CARD_INTL']),
  operationType: z.enum(['DEPOSIT', 'WITHDRAWAL', 'GOAL_DEPOSIT', 'LOAN_REPAYMENT']),
  amount: z.number().positive('Le montant doit être supérieur à 0'),
  currency: z.enum(['USD', 'CDF']).default('USD'),
  phoneNumber: z.string().optional(),
  goalId: z.string().optional(),
  loanId: z.string().optional(),
});

const loanApplySchema = z.object({
  businessActivity: z.string().min(3, 'Activité économique requise'),
  businessYears: z.number().int().min(0).max(60),
  monthlyIncome: z.number().positive('Revenu mensuel requis'),
  monthlyExpenses: z.number().nonnegative(),
  existingCommitments: z.number().nonnegative().default(0),
  requestedAmount: z.number().min(20, 'Montant minimum 20 USD').max(10000),
  durationMonths: z.number().int().min(1).max(24),
  purpose: z.string().min(5, 'Objet du crédit requis'),
});

export function createApp(deps: AppDependencies = {}) {
  const db = deps.db ?? createDatabase();
  const assistant = deps.assistantProvider ?? new GeminiAssistantProvider();
  const multimodal = deps.multimodalService ?? new GeminiMultimodalService();
  const halisiEnrollment = new MockHalisiEnrollmentProvider();
  const halisiIdentity = new MockHalisiIdentityVerificationProvider();
  const halisiCredit = new MockHalisiCreditAssessmentProvider();
  const rateLimiter = new LoginRateLimiter(5, 15 * 60 * 1000);

  const app = express();

  // Durcissement sécurité transport & en-têtes HTTP (HSTS, Anti-MIME sniffing, Frameguard)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');

    if (process.env.FORCE_HTTPS === 'true') {
      const proto = req.headers['x-forwarded-proto'];
      if (proto && proto !== 'https') {
        res.status(403).json({ error: 'Connexion HTTPS obligatoire.' });
        return;
      }
    }
    next();
  });

  app.use(express.json({
    limit: '6mb',
    verify: (req: Request & { rawBody?: string }, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));

  const api = express.Router();

  // OpenAPI & Health
  api.get('/health', (_req, res) => {
    res.json({ status: 'UP', service: 'v-micro-credit-api', mode: 'SIMULATION_DEMO', timestamp: new Date().toISOString() });
  });
  api.get('/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  // ============================================================================
  // A. AUTHENTIFICATION, INSCRIPTION & SESSIONS
  // ============================================================================

  api.post('/auth/register', (req, res, next) => {
    try {
      const parsed = registerSchema.parse(req.body);
      if (!parsed.acceptDataConsent) {
        res.status(400).json({ error: 'Le consentement au traitement des données est requis.' });
        return;
      }

      const minAge = Number(process.env.MIN_ELIGIBLE_AGE || 18);
      const age = calculateAgeFromDob(parsed.dateOfBirth);
      if (age < minAge) {
        res.status(422).json({
          error: `Inscription impossible : l’âge minimum réglementaire est de ${minAge} ans.`,
        });
        return;
      }

      const existing = db
        .prepare('SELECT id FROM users WHERE email = ? OR phone = ?')
        .get(parsed.email.toLowerCase(), parsed.phone) as { id: string } | undefined;
      if (existing) {
        res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail ou ce numéro.' });
        return;
      }

      const now = new Date().toISOString();
      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO users (id, email, phone, password_hash, role, phone_verified, phone_otp, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'CLIENT', 0, ?, 'ACTIVE', ?, ?)`
        ).run(userId, parsed.email.toLowerCase(), parsed.phone, hashSecret(parsed.password), otpCode, now, now);

        db.prepare(
          `INSERT INTO profiles (user_id, first_name, last_name, date_of_birth, city, commune, country, profession, monthly_income_usd, language, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'RDC', ?, ?, ?, ?)`
        ).run(
          userId,
          parsed.firstName,
          parsed.lastName,
          parsed.dateOfBirth,
          parsed.city,
          parsed.commune,
          parsed.profession,
          parsed.monthlyIncomeUsd,
          parsed.language,
          now
        );

        db.prepare(
          `INSERT INTO savings_accounts (id, user_id, currency, available_balance, locked_goals_balance, is_simulated, updated_at)
           VALUES (?, ?, 'USD', 0, 0, 1, ?)`
        ).run(`acc_${crypto.randomUUID().slice(0, 10)}`, userId, now);

        db.prepare(
          `INSERT INTO consents (id, user_id, consent_type, granted, version, ip_address, granted_at)
           VALUES (?, ?, 'DATA_PROCESSING_RDC', 1, '1.0', ?, ?)`
        ).run(`cns_${crypto.randomUUID().slice(0, 10)}`, userId, req.ip || '127.0.0.1', now);

        db.prepare('INSERT INTO notification_preferences (user_id) VALUES (?)').run(userId);

        db.prepare(
          `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
           VALUES (?, ?, 'REGISTRATION_CONFIRMED', 'Bienvenue sur V-Micro Crédit', 'Votre compte a été créé. Vérifiez votre numéro de téléphone pour activer toutes les opérations.', 0, ?)`
        ).run(`ntf_${crypto.randomUUID().slice(0, 10)}`, userId, now);
      });

      tx();
      logAudit(db, userId, 'CLIENT', 'USER_REGISTERED', 'USER', userId, { city: parsed.city });

      res.status(201).json({
        userId,
        email: parsed.email.toLowerCase(),
        phone: parsed.phone,
        phoneVerified: false,
        simulatedOtpPreview: otpCode,
        message: 'Compte créé. Entrez le code OTP simulé pour valider votre numéro.',
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/verify-phone', (req, res, next) => {
    try {
      const schema = z.object({ phone: z.string().min(6), otp: z.string().length(6) });
      const { phone, otp } = schema.parse(req.body);
      const user = db.prepare('SELECT id, phone_otp, phone_verified FROM users WHERE phone = ?').get(phone) as
        | { id: string; phone_otp: string | null; phone_verified: number }
        | undefined;

      if (!user) {
        res.status(404).json({ error: 'Numéro introuvable.' });
        return;
      }
      if (user.phone_verified === 1) {
        res.json({ verified: true, message: 'Numéro déjà vérifié.' });
        return;
      }
      if (user.phone_otp !== otp) {
        res.status(400).json({ error: 'Code OTP incorrect.' });
        return;
      }

      db.prepare('UPDATE users SET phone_verified = 1, phone_otp = NULL, updated_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        user.id
      );
      logAudit(db, user.id, 'CLIENT', 'PHONE_VERIFIED', 'USER', user.id, {});
      res.json({ verified: true, message: 'Numéro de téléphone vérifié avec succès.' });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/login', (req, res, next) => {
    try {
      const { identifier, password, deviceLabel } = loginSchema.parse(req.body);
      const key = `${req.ip || 'local'}:${identifier.toLowerCase()}`;
      const limit = rateLimiter.check(key);
      if (!limit.allowed) {
        res.status(429).json({
          error: `Trop de tentatives échouées. Réessayez dans ${limit.retryAfterSec} secondes.`,
        });
        return;
      }

      const user = db
        .prepare('SELECT id, email, phone, password_hash, role, phone_verified, status FROM users WHERE email = ? OR phone = ?')
        .get(identifier.toLowerCase(), identifier) as
        | {
            id: string;
            email: string;
            phone: string;
            password_hash: string;
            role: UserRole;
            phone_verified: number;
            status: string;
          }
        | undefined;

      if (!user || !compareSecret(password, user.password_hash)) {
        rateLimiter.recordFailure(key);
        res.status(401).json({ error: 'Identifiants invalides.' });
        return;
      }

      if (user.status !== 'ACTIVE') {
        res.status(403).json({ error: 'Ce compte est suspendu ou désactivé.' });
        return;
      }

      rateLimiter.reset(key);
      const sessionId = `ses_${crypto.randomUUID().slice(0, 12)}`;
      const payload = { sub: user.id, role: user.role, sessionId };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(
        `INSERT INTO sessions (id, user_id, refresh_token_hash, device_label, ip_address, revoked, expires_at, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(sessionId, user.id, sha256(refreshToken), deviceLabel, req.ip || '127.0.0.1', expiresAt, now, now);

      const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
      logAudit(db, user.id, user.role, 'USER_LOGIN', 'SESSION', sessionId, { deviceLabel });

      res.json({
        accessToken,
        refreshToken,
        sessionId,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          permissions: getPermissionsForRole(user.role),
          phoneVerified: user.phone_verified === 1,
          profile,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/refresh', (req, res, next) => {
    try {
      const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
      const decoded = verifyRefreshToken(refreshToken);
      const session = db
        .prepare('SELECT id, refresh_token_hash, revoked, expires_at FROM sessions WHERE id = ? AND user_id = ?')
        .get(decoded.sessionId, decoded.sub) as
        | { id: string; refresh_token_hash: string; revoked: number; expires_at: string }
        | undefined;

      if (
        !session ||
        session.revoked === 1 ||
        session.refresh_token_hash !== sha256(refreshToken) ||
        new Date(session.expires_at).getTime() < Date.now()
      ) {
        res.status(401).json({ error: 'Refresh token invalide ou révoqué.' });
        return;
      }

      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(decoded.sub) as { role: UserRole };
      const newPayload = { sub: decoded.sub, role: user.role, sessionId: decoded.sessionId };
      const newAccess = signAccessToken(newPayload);
      const newRefresh = signRefreshToken(newPayload);

      db.prepare('UPDATE sessions SET refresh_token_hash = ?, last_used_at = ? WHERE id = ?').run(
        sha256(newRefresh),
        new Date().toISOString(),
        decoded.sessionId
      );

      res.json({ accessToken: newAccess, refreshToken: newRefresh });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/forgot-password', (req, res, next) => {
    try {
      const { email } = z.object({ email: z.string().email() }).parse(req.body);
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase()) as
        | { id: string }
        | undefined;
      if (!user) {
        res.json({ message: 'Si ce compte existe, un code de réinitialisation a été généré.' });
        return;
      }
      const token = crypto.randomBytes(4).toString('hex').toUpperCase();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?').run(
        token,
        expiresAt,
        user.id
      );
      res.json({
        message: 'Code de réinitialisation généré (environnement simulation).',
        simulatedResetCodePreview: token,
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/reset-password', (req, res, next) => {
    try {
      const { email, code, newPassword } = z
        .object({
          email: z.string().email(),
          code: z.string().min(4),
          newPassword: z.string().min(8),
        })
        .parse(req.body);

      const user = db
        .prepare('SELECT id, role, reset_token, reset_token_expires_at FROM users WHERE email = ?')
        .get(email.toLowerCase()) as
        | { id: string; role: UserRole; reset_token: string | null; reset_token_expires_at: string | null }
        | undefined;

      if (
        !user ||
        !user.reset_token ||
        user.reset_token !== code ||
        !user.reset_token_expires_at ||
        new Date(user.reset_token_expires_at).getTime() < Date.now()
      ) {
        res.status(400).json({ error: 'Code de réinitialisation invalide ou expiré.' });
        return;
      }

      db.prepare(
        'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?'
      ).run(hashSecret(newPassword), new Date().toISOString(), user.id);

      // Révoquer toutes les anciennes sessions par sécurité
      db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(user.id);
      logAudit(db, user.id, user.role, 'PASSWORD_RESET', 'USER', user.id, {});

      res.json({ message: 'Mot de passe réinitialisé. Veuillez vous reconnecter.' });
    } catch (err) {
      next(err);
    }
  });

  api.post('/auth/logout', requireAuth(db), (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.auth!.sessionId);
    res.json({ message: 'Session déconnectée.' });
  });

  api.get('/auth/sessions', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const sessions = db
      .prepare(
        `SELECT id, device_label, ip_address, revoked, created_at, last_used_at, expires_at
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
      )
      .all(req.auth!.sub);
    res.json({ currentSessionId: req.auth!.sessionId, sessions });
  });

  api.delete('/auth/sessions/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const result = db
      .prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.auth!.sub);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Session introuvable.' });
      return;
    }
    logAudit(db, req.auth!.sub, req.auth!.role, 'SESSION_REVOKED', 'SESSION', String(req.params.id), {});
    res.json({ message: 'Session révoquée.' });
  });

  // ============================================================================
  // J. PROFIL, PRÉFÉRENCES, CONSENTEMENTS & SUPPRESSION
  // ============================================================================

  api.get('/me', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const user = db
      .prepare('SELECT id, email, phone, role, phone_verified, status, created_at FROM users WHERE id = ?')
      .get(req.auth!.sub) as Record<string, unknown>;
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.auth!.sub);
    const consents = db
      .prepare('SELECT id, consent_type, granted, version, granted_at, revoked_at FROM consents WHERE user_id = ? ORDER BY granted_at DESC')
      .all(req.auth!.sub);
    const kyc = db
      .prepare('SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.auth!.sub);

    res.json({
      user: {
        ...user,
        permissions: getPermissionsForRole(req.auth!.role),
      },
      profile,
      consents,
      kyc,
    });
  });

  api.put('/me/profile', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        firstName: z.string().min(2),
        lastName: z.string().min(2),
        city: z.string().min(2),
        commune: z.string().optional().default(''),
        profession: z.string().optional().default(''),
        monthlyIncomeUsd: z.number().nonnegative().optional().default(0),
        language: z.enum(['fr', 'sw', 'en']).optional(),
      });
      const data = schema.parse(req.body);
      db.prepare(
        `UPDATE profiles
         SET first_name = ?, last_name = ?, city = ?, commune = ?, profession = ?, monthly_income_usd = ?, language = COALESCE(?, language), updated_at = ?
         WHERE user_id = ?`
      ).run(
        data.firstName,
        data.lastName,
        data.city,
        data.commune,
        data.profession,
        data.monthlyIncomeUsd,
        data.language ?? null,
        new Date().toISOString(),
        req.auth!.sub
      );
      const updated = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.auth!.sub);
      res.json({ profile: updated });
    } catch (err) {
      next(err);
    }
  });

  api.put('/me/preferences', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const { language } = z.object({ language: z.enum(['fr', 'sw', 'en']) }).parse(req.body);
      db.prepare('UPDATE profiles SET language = ?, updated_at = ? WHERE user_id = ?').run(
        language,
        new Date().toISOString(),
        req.auth!.sub
      );
      res.json({ language });
    } catch (err) {
      next(err);
    }
  });

  api.post('/me/deletion-request', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const { reason } = z.object({ reason: z.string().min(5) }).parse(req.body);
      const id = `del_${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO deletion_requests (id, user_id, reason, status, created_at)
         VALUES (?, ?, ?, 'PENDING_REVIEW', ?)`
      ).run(id, req.auth!.sub, reason, new Date().toISOString());
      logAudit(db, req.auth!.sub, req.auth!.role, 'ACCOUNT_DELETION_REQUESTED', 'USER', req.auth!.sub, { reason });
      res.status(201).json({
        id,
        status: 'PENDING_REVIEW',
        message: 'Demande enregistrée. Conformément aux obligations réglementaires financières, un délai de conservation légal peut s’appliquer aux contrats clos.',
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // B. VÉRIFICATION D'IDENTITÉ (HALISI MOCK + BIOMÉTRIE APPAREIL + ALTERNATIF)
  // ============================================================================

  api.get('/kyc/status', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const latest = db
      .prepare('SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.auth!.sub);
    const bioConsent = db
      .prepare(
        `SELECT * FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1`
      )
      .get(req.auth!.sub);
    res.json({ verification: latest ?? null, biometricConsent: bioConsent ?? null });
  });

  api.post('/kyc/consent', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const { granted } = z.object({ granted: z.boolean() }).parse(req.body);
      const now = new Date().toISOString();
      const id = `cns_${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO consents (id, user_id, consent_type, granted, version, ip_address, granted_at, revoked_at)
         VALUES (?, ?, 'BIOMETRIC_VERIFICATION', ?, '1.0', ?, ?, ?)`
      ).run(id, req.auth!.sub, granted ? 1 : 0, req.ip || '127.0.0.1', now, granted ? null : now);

      logAudit(db, req.auth!.sub, req.auth!.role, granted ? 'BIOMETRIC_CONSENT_GRANTED' : 'BIOMETRIC_CONSENT_REVOKED', 'CONSENT', id, {});
      res.json({ id, granted, timestamp: now });
    } catch (err) {
      next(err);
    }
  });

  api.post('/kyc/verify-biometric', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        livenessCompleted: z.boolean(),
        documentProvided: z.boolean(),
        deviceBiometricUsed: z.boolean().default(false),
        simulateFailure: z.boolean().optional().default(false),
      });
      const input = schema.parse(req.body);

      const bioConsent = db
        .prepare(
          `SELECT granted FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1`
        )
        .get(req.auth!.sub) as { granted: number } | undefined;

      if (!bioConsent || bioConsent.granted !== 1) {
        res.status(403).json({
          error: 'Le consentement biométrique explicite est requis avant toute vérification.',
        });
        return;
      }

      const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.auth!.sub) as {
        first_name: string;
        last_name: string;
        city: string;
        country: string;
      };
      const user = db.prepare('SELECT phone FROM users WHERE id = ?').get(req.auth!.sub) as { phone: string };

      await halisiEnrollment.enrollClient({
        userId: req.auth!.sub,
        firstName: profile.first_name,
        lastName: profile.last_name,
        phoneNumber: user.phone,
        city: profile.city,
        country: profile.country,
        consentReferenceId: 'BIOMETRIC_VERIFICATION',
      });

      const halisiRes = await halisiIdentity.verifyIdentity({
        userId: req.auth!.sub,
        consentGranted: true,
        livenessCheckCompleted: input.livenessCompleted,
        documentReferenceProvided: input.documentProvided,
        simulateFailure: input.simulateFailure,
      });

      const now = new Date().toISOString();
      const id = `kyc_${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated, created_at, updated_at)
         VALUES (?, ?, 'HALISI_FACE_LIVENESS', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        id,
        req.auth!.sub,
        halisiRes.providerName,
        halisiRes.verificationRef,
        halisiRes.livenessPassed ? 1 : 0,
        halisiRes.documentMatched ? 1 : 0,
        input.deviceBiometricUsed ? 1 : 0,
        halisiRes.status,
        halisiRes.failureReason ?? null,
        now,
        now
      );

      db.prepare(
        `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
         VALUES (?, ?, 'KYC_UPDATE', ?, ?, 0, ?)`
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        req.auth!.sub,
        halisiRes.status === 'VERIFIED' ? 'Identité vérifiée (Simulation)' : 'Vérification d’identité à reprendre',
        halisiRes.status === 'VERIFIED'
          ? `Référence Halisi Mock ${halisiRes.verificationRef} confirmée.`
          : halisiRes.failureReason || 'Veuillez réessayer ou utiliser le parcours alternatif.',
        now
      );

      logAudit(db, req.auth!.sub, req.auth!.role, 'KYC_BIOMETRIC_ATTEMPT', 'IDENTITY_VERIFICATION', id, {
        status: halisiRes.status,
        providerRef: halisiRes.verificationRef,
      });

      res.json({ id, ...halisiRes });
    } catch (err) {
      next(err);
    }
  });

  api.post('/kyc/alternative', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        documentType: z.enum(['CARTE_ELECTEUR_RDC', 'PASSEPORT', 'PERMIS_CONDUIRE']),
        documentLast4: z.string().min(4).max(6),
        reason: z.string().min(5),
      });
      const input = schema.parse(req.body);
      const now = new Date().toISOString();
      const id = `kyc_${crypto.randomUUID().slice(0, 10)}`;
      const ref = `ALT-KYC-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

      db.prepare(
        `INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated, created_at, updated_at)
         VALUES (?, ?, 'ALTERNATIVE_AGENT_KYC', 'ManualVerificationQueue', ?, 0, 0, 0, 'PENDING_REVIEW', ?, 1, ?, ?)`
      ).run(id, req.auth!.sub, ref, `${input.documentType} (***${input.documentLast4}) — ${input.reason}`, now, now);

      logAudit(db, req.auth!.sub, req.auth!.role, 'KYC_ALTERNATIVE_SUBMITTED', 'IDENTITY_VERIFICATION', id, {
        documentType: input.documentType,
      });

      res.status(201).json({
        id,
        status: 'PENDING_REVIEW',
        providerReference: ref,
        message: 'Demande de vérification manuelle envoyée à un agent autorisé.',
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/kyc/gemini-verify-face-doc', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        selfieBase64: z.string().min(50),
        selfieMimeType: z.string().default('image/jpeg'),
        documentBase64: z.string().optional(),
        documentMimeType: z.string().optional(),
      });
      const input = schema.parse(req.body);

      const bioConsent = db
        .prepare(
          `SELECT granted FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1`
        )
        .get(req.auth!.sub) as { granted: number } | undefined;

      if (!bioConsent || bioConsent.granted !== 1) {
        res.status(403).json({
          error: 'Le consentement biométrique explicite est requis avant l’analyse faciale Gemini.',
        });
        return;
      }

      const result = await multimodal.verifyFaceAndDocument({
        selfieBase64: input.selfieBase64,
        selfieMimeType: input.selfieMimeType,
        documentBase64: input.documentBase64,
        documentMimeType: input.documentMimeType,
      });

      const now = new Date().toISOString();
      const id = `kyc_${crypto.randomUUID().slice(0, 10)}`;
      const status = result.passed ? 'VERIFIED' : 'FAILED';

      // Les images ne sont JAMAIS enregistrées en base ; seules la référence et les observations sont stockées.
      db.prepare(
        `INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated, created_at, updated_at)
         VALUES (?, ?, 'GEMINI_MULTIMODAL_FACE_TEST', 'GeminiVisionTest', ?, ?, ?, 0, ?, ?, 1, ?, ?)`
      ).run(
        id,
        req.auth!.sub,
        result.verificationRef,
        result.livenessLikely ? 1 : 0,
        result.documentReadable ? 1 : 0,
        status,
        result.passed ? null : result.observations,
        now,
        now
      );

      logAudit(db, req.auth!.sub, req.auth!.role, 'KYC_GEMINI_FACE_TEST', 'IDENTITY_VERIFICATION', id, {
        status,
        ref: result.verificationRef,
      });

      res.json({ id, status, ...result });
    } catch (err) {
      next(err);
    }
  });

  api.post('/kyc/gemini-verify-voice', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        audioBase64: z.string().min(50),
        audioMimeType: z.string().default('audio/webm'),
        expectedPhrase: z.string().min(5),
      });
      const input = schema.parse(req.body);

      const bioConsent = db
        .prepare(
          `SELECT granted FROM consents WHERE user_id = ? AND consent_type = 'BIOMETRIC_VERIFICATION' ORDER BY granted_at DESC LIMIT 1`
        )
        .get(req.auth!.sub) as { granted: number } | undefined;

      if (!bioConsent || bioConsent.granted !== 1) {
        res.status(403).json({
          error: 'Le consentement biométrique explicite est requis avant la vérification vocale.',
        });
        return;
      }

      const result = await multimodal.verifyVoiceChallenge({
        audioBase64: input.audioBase64,
        audioMimeType: input.audioMimeType,
        expectedPhrase: input.expectedPhrase,
      });

      const now = new Date().toISOString();
      const id = `kyc_${crypto.randomUUID().slice(0, 10)}`;
      const status = result.passed ? 'VERIFIED' : 'FAILED';

      db.prepare(
        `INSERT INTO identity_verifications (id, user_id, method, provider, provider_reference, liveness_passed, document_matched, device_biometric_verified, status, failure_reason, is_simulated, created_at, updated_at)
         VALUES (?, ?, 'GEMINI_VOICE_CHALLENGE_TEST', 'GeminiAudioTranscribeTest', ?, ?, 0, 0, ?, ?, 1, ?, ?)`
      ).run(
        id,
        req.auth!.sub,
        result.verificationRef,
        result.passed ? 1 : 0,
        status,
        result.passed ? null : `Correspondance vocale insuffisante (${Math.round(result.similarityScore * 100)}%).`,
        now,
        now
      );

      logAudit(db, req.auth!.sub, req.auth!.role, 'KYC_GEMINI_VOICE_TEST', 'IDENTITY_VERIFICATION', id, {
        status,
        similarityScore: result.similarityScore,
      });

      res.json({ id, status, ...result });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // C. TABLEAU DE BORD CLIENT
  // ============================================================================

  api.get('/dashboard', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.sub;
    const account = db.prepare('SELECT * FROM savings_accounts WHERE user_id = ?').get(userId) as {
      available_balance: number;
      locked_goals_balance: number;
      currency: string;
      is_simulated: number;
    };
    const goals = db
      .prepare(`SELECT * FROM savings_goals WHERE user_id = ? AND status != 'DELETED' ORDER BY created_at DESC`)
      .all(userId);
    const loans = db
      .prepare('SELECT * FROM loan_applications WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId);
    const activeContracts = db
      .prepare(`SELECT * FROM loan_contracts WHERE user_id = ? AND status = 'ACTIVE'`)
      .all(userId) as Array<{ id: string }>;

    let nextInstallments: unknown[] = [];
    if (activeContracts.length > 0) {
      nextInstallments = db
        .prepare(
          `SELECT * FROM repayment_schedules WHERE contract_id = ? AND status = 'PENDING' ORDER BY installment_number ASC LIMIT 3`
        )
        .all(activeContracts[0].id);
    }

    const recentTransactions = db
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 8')
      .all(userId);
    const recentNotifications = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
      .all(userId);
    const kyc = db
      .prepare('SELECT status, method, provider_reference FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(userId);

    const totalSavings = Number(((account?.available_balance || 0) + (account?.locked_goals_balance || 0)).toFixed(2));

    res.json({
      simulationNotice: 'Environnement de démonstration : soldes et transactions simulés.',
      account: {
        ...account,
        total_savings: totalSavings,
      },
      goals,
      loans,
      activeContracts,
      nextInstallments,
      recentTransactions,
      recentNotifications,
      kyc: kyc ?? { status: 'NOT_STARTED' },
    });
  });

  // ============================================================================
  // D. MODULE ÉPARGNE (Libre + Objectifs, sans épargne programmée en v1)
  // ============================================================================

  api.get('/savings/goals', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const goals = db
      .prepare(`SELECT * FROM savings_goals WHERE user_id = ? AND status != 'DELETED' ORDER BY created_at DESC`)
      .all(req.auth!.sub);
    res.json({ goals });
  });

  api.post('/savings/goals', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const data = goalSchema.parse(req.body);
      const now = new Date().toISOString();
      const id = `goal_${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO savings_goals (id, user_id, title, category, target_amount, current_amount, target_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 'ACTIVE', ?, ?)`
      ).run(id, req.auth!.sub, data.title, data.category, data.targetAmount, data.targetDate, now, now);

      db.prepare(
        `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
         VALUES (?, ?, 'SAVINGS_GOAL', 'Nouvel objectif créé', ?, 0, ?)`
      ).run(`ntf_${crypto.randomUUID().slice(0, 10)}`, req.auth!.sub, `Objectif « ${data.title} » (${data.targetAmount} USD) créé.`, now);

      const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(id);
      res.status(201).json({ goal });
    } catch (err) {
      next(err);
    }
  });

  api.put('/savings/goals/:id', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const data = goalSchema.partial().parse(req.body);
      const existing = db
        .prepare(`SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND status != 'DELETED'`)
        .get(req.params.id, req.auth!.sub) as { id: string; title: string; category: string; target_amount: number; target_date: string } | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Objectif introuvable.' });
        return;
      }

      db.prepare(
        `UPDATE savings_goals SET title = ?, category = ?, target_amount = ?, target_date = ?, updated_at = ? WHERE id = ?`
      ).run(
        data.title ?? existing.title,
        data.category ?? existing.category,
        data.targetAmount ?? existing.target_amount,
        data.targetDate ?? existing.target_date,
        new Date().toISOString(),
        existing.id
      );

      const goal = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(existing.id);
      res.json({ goal });
    } catch (err) {
      next(err);
    }
  });

  api.delete('/savings/goals/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const goal = db
      .prepare(`SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND status != 'DELETED'`)
      .get(req.params.id, req.auth!.sub) as { id: string; current_amount: number; title: string } | undefined;

    if (!goal) {
      res.status(404).json({ error: 'Objectif introuvable.' });
      return;
    }

    if (goal.current_amount > 0) {
      res.status(409).json({
        error: `Suppression contrôlée : cet objectif contient encore ${goal.current_amount.toFixed(2)} USD. Retirez d’abord les fonds vers votre épargne libre ou Mobile Money.`,
      });
      return;
    }

    db.prepare(`UPDATE savings_goals SET status = 'DELETED', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      goal.id
    );
    logAudit(db, req.auth!.sub, req.auth!.role, 'SAVINGS_GOAL_DELETED', 'SAVINGS_GOAL', goal.id, { title: goal.title });
    res.json({ message: 'Objectif supprimé.' });
  });

  // Transfert interne d'un objectif vers l'épargne libre (pour permettre la suppression contrôlée)
  api.post('/savings/goals/:id/release', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const goal = db
      .prepare(`SELECT * FROM savings_goals WHERE id = ? AND user_id = ? AND status = 'ACTIVE'`)
      .get(req.params.id, req.auth!.sub) as { id: string; current_amount: number; title: string } | undefined;

    if (!goal) {
      res.status(404).json({ error: 'Objectif introuvable.' });
      return;
    }
    if (goal.current_amount <= 0) {
      res.status(400).json({ error: 'Aucun solde à transférer.' });
      return;
    }

    const now = new Date().toISOString();
    const amount = goal.current_amount;
    const tx = db.transaction(() => {
      db.prepare('UPDATE savings_goals SET current_amount = 0, updated_at = ? WHERE id = ?').run(now, goal.id);
      db.prepare(
        `UPDATE savings_accounts
         SET available_balance = available_balance + ?,
             locked_goals_balance = MAX(0, locked_goals_balance - ?),
             updated_at = ?
         WHERE user_id = ?`
      ).run(amount, amount, now, req.auth!.sub);

      db.prepare(
        `INSERT INTO transactions (id, user_id, goal_id, type, amount, currency, provider, status, description, is_simulated, created_at)
         VALUES (?, ?, ?, 'GOAL_RELEASE', ?, 'USD', 'INTERNAL_LEDGER', 'CONFIRMED', ?, 1, ?)`
      ).run(`tx_${crypto.randomUUID().slice(0, 10)}`, req.auth!.sub, goal.id, amount, `Libération objectif « ${goal.title} » vers épargne libre`, now);
    });
    tx();
    res.json({ message: `${amount.toFixed(2)} USD transférés vers votre épargne libre.` });
  });

  // ============================================================================
  // F. PAIEMENTS MOBILE MONEY (Idempotence, Statut, Confirmation, Webhooks HMAC)
  // ============================================================================

  api.get('/payments/providers', requireAuth(db), (_req, res) => {
    res.json({ providers: listPaymentProviders() });
  });

  api.get('/transactions', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const transactions = db
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.auth!.sub);
    res.json({ transactions });
  });

  api.post('/payments/initialize', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const input = paymentInitSchema.parse(req.body);

      // Contrôle idempotence : retourner la référence existante si déjà créée
      const existing = db
        .prepare('SELECT * FROM payment_references WHERE idempotency_key = ? AND user_id = ?')
        .get(input.idempotencyKey, req.auth!.sub) as Record<string, unknown> | undefined;

      if (existing) {
        res.status(200).json({ idempotentReplay: true, payment: existing });
        return;
      }

      // Vérifier le solde disponible si retrait
      if (input.operationType === 'WITHDRAWAL') {
        const account = db
          .prepare('SELECT available_balance FROM savings_accounts WHERE user_id = ?')
          .get(req.auth!.sub) as { available_balance: number };
        if (!account || account.available_balance < input.amount) {
          res.status(400).json({ error: 'Solde disponible insuffisant pour ce retrait.' });
          return;
        }
      }

      if (input.operationType === 'GOAL_DEPOSIT' && !input.goalId) {
        res.status(400).json({ error: 'Identifiant d’objectif requis pour un dépôt sur objectif.' });
        return;
      }

      const provider = getPaymentProvider(input.provider);
      const reference = `PAY-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const initRes = provider.initializePayment({
        reference,
        idempotencyKey: input.idempotencyKey,
        amount: input.amount,
        currency: input.currency,
        phoneNumber: input.phoneNumber,
        description: `Opération ${input.operationType}`,
      });

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO payment_references (reference, idempotency_key, user_id, provider, operation_type, amount, currency, phone_number, goal_id, loan_id, external_ref, status, is_simulated, reconciled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).run(
        reference,
        input.idempotencyKey,
        req.auth!.sub,
        input.provider,
        input.operationType,
        input.amount,
        input.currency,
        input.phoneNumber ?? null,
        input.goalId ?? null,
        input.loanId ?? null,
        initRes.externalRef,
        initRes.status,
        now,
        now
      );

      res.status(201).json({
        idempotentReplay: false,
        payment: {
          reference,
          externalRef: initRes.externalRef,
          provider: input.provider,
          status: initRes.status,
          amount: input.amount,
          currency: input.currency,
          isSimulated: true,
          instructions: initRes.instructions,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  function applyConfirmedPayment(db: Database.Database, payRef: {
    reference: string;
    user_id: string;
    provider: PaymentProviderId;
    operation_type: string;
    amount: number;
    currency: string;
    goal_id: string | null;
    loan_id: string | null;
    status: string;
  }) {
    if (payRef.status === 'CONFIRMED') return; // Idempotence stricte contre double crédit/débit
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`UPDATE payment_references SET status = 'CONFIRMED', reconciled = 1, updated_at = ? WHERE reference = ?`).run(
        now,
        payRef.reference
      );

      let txType = 'DEPOSIT';
      let description = `Dépôt Mobile Money ${payRef.provider} (Simulation)`;

      if (payRef.operation_type === 'DEPOSIT') {
        db.prepare('UPDATE savings_accounts SET available_balance = available_balance + ?, updated_at = ? WHERE user_id = ?').run(
          payRef.amount,
          now,
          payRef.user_id
        );
      } else if (payRef.operation_type === 'GOAL_DEPOSIT' && payRef.goal_id) {
        txType = 'GOAL_ALLOCATION';
        description = `Dépôt sur objectif d’épargne via ${payRef.provider} (Simulation)`;
        db.prepare('UPDATE savings_goals SET current_amount = current_amount + ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
          payRef.amount,
          now,
          payRef.goal_id,
          payRef.user_id
        );
        db.prepare('UPDATE savings_accounts SET locked_goals_balance = locked_goals_balance + ?, updated_at = ? WHERE user_id = ?').run(
          payRef.amount,
          now,
          payRef.user_id
        );
      } else if (payRef.operation_type === 'WITHDRAWAL') {
        txType = 'WITHDRAWAL';
        description = `Retrait vers ${payRef.provider} (Simulation)`;
        const acc = db.prepare('SELECT available_balance FROM savings_accounts WHERE user_id = ?').get(payRef.user_id) as {
          available_balance: number;
        };
        if (acc.available_balance < payRef.amount) {
          throw new Error('Solde insuffisant au moment de la confirmation.');
        }
        db.prepare('UPDATE savings_accounts SET available_balance = available_balance - ?, updated_at = ? WHERE user_id = ?').run(
          payRef.amount,
          now,
          payRef.user_id
        );
      } else if (payRef.operation_type === 'LOAN_REPAYMENT') {
        txType = 'LOAN_REPAYMENT';
        description = `Remboursement microcrédit via ${payRef.provider} (Simulation)`;
      }

      db.prepare(
        `INSERT INTO transactions (id, user_id, goal_id, loan_id, payment_reference, type, amount, currency, provider, status, description, is_simulated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, 1, ?)`
      ).run(
        `tx_${crypto.randomUUID().slice(0, 10)}`,
        payRef.user_id,
        payRef.goal_id,
        payRef.loan_id,
        payRef.reference,
        txType,
        payRef.amount,
        payRef.currency,
        payRef.provider,
        description,
        now
      );

      db.prepare(
        `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        payRef.user_id,
        payRef.operation_type === 'WITHDRAWAL' ? 'WITHDRAWAL_CONFIRMED' : 'DEPOSIT_CONFIRMED',
        payRef.operation_type === 'WITHDRAWAL' ? 'Retrait confirmé (Simulation)' : 'Dépôt confirmé (Simulation)',
        `${description} — ${payRef.amount.toFixed(2)} ${payRef.currency} (Réf: ${payRef.reference}).`,
        now
      );
    });

    tx();
  }

  api.post('/payments/confirm', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const { reference, simulateFailure } = z
        .object({ reference: z.string(), simulateFailure: z.boolean().optional().default(false) })
        .parse(req.body);

      const payRef = db
        .prepare('SELECT * FROM payment_references WHERE reference = ? AND user_id = ?')
        .get(reference, req.auth!.sub) as
        | {
            reference: string;
            user_id: string;
            provider: PaymentProviderId;
            operation_type: string;
            amount: number;
            currency: string;
            goal_id: string | null;
            loan_id: string | null;
            external_ref: string;
            status: string;
          }
        | undefined;

      if (!payRef) {
        res.status(404).json({ error: 'Référence de paiement introuvable.' });
        return;
      }

      if (payRef.status === 'CONFIRMED') {
        res.json({ reference, status: 'CONFIRMED', idempotent: true, isSimulated: true });
        return;
      }

      const provider = getPaymentProvider(payRef.provider);
      const result = provider.confirmSimulated(payRef.reference, payRef.external_ref, simulateFailure);

      if (result.status === 'FAILED') {
        db.prepare(`UPDATE payment_references SET status = 'FAILED', failure_reason = ?, updated_at = ? WHERE reference = ?`).run(
          result.failureReason ?? 'Échec simulé',
          new Date().toISOString(),
          payRef.reference
        );
        res.status(402).json({ error: result.failureReason, reference, status: 'FAILED', isSimulated: true });
        return;
      }

      applyConfirmedPayment(db, payRef);
      res.json({ reference, status: 'CONFIRMED', isSimulated: true });
    } catch (err) {
      next(err);
    }
  });

  api.post('/payments/cancel/:reference', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const payRef = db
      .prepare('SELECT * FROM payment_references WHERE reference = ? AND user_id = ?')
      .get(req.params.reference, req.auth!.sub) as { reference: string; provider: PaymentProviderId; external_ref: string; status: string } | undefined;

    if (!payRef) {
      res.status(404).json({ error: 'Paiement introuvable.' });
      return;
    }
    if (payRef.status === 'CONFIRMED') {
      res.status(409).json({ error: 'Impossible d’annuler un paiement déjà confirmé.' });
      return;
    }

    const provider = getPaymentProvider(payRef.provider);
    if (!provider.supportsCancellation) {
      res.status(400).json({ error: 'Ce fournisseur ne permet pas l’annulation.' });
      return;
    }

    const cancelled = provider.cancelPayment(payRef.reference, payRef.external_ref);
    db.prepare(`UPDATE payment_references SET status = 'CANCELLED', updated_at = ? WHERE reference = ?`).run(
      new Date().toISOString(),
      payRef.reference
    );
    res.json(cancelled);
  });

  api.get('/payments/status/:reference', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const payRef = db
      .prepare('SELECT * FROM payment_references WHERE reference = ? AND user_id = ?')
      .get(req.params.reference, req.auth!.sub);
    if (!payRef) {
      res.status(404).json({ error: 'Référence introuvable.' });
      return;
    }
    res.json({ payment: payRef });
  });

  // Webhook sécurisé par HMAC + Idempotence
  api.post('/payments/webhook/:provider', (req: Request & { rawBody?: string }, res, next) => {
    try {
      const providerId = String(req.params.provider).toUpperCase() as PaymentProviderId;
      const provider = getPaymentProvider(providerId);
      const signature = req.headers['x-vmicro-signature'] as string | undefined;
      const rawBody = req.rawBody ?? JSON.stringify(req.body);

      if (!provider.verifyWebhookSignature(rawBody, signature)) {
        db.prepare(
          `INSERT INTO integration_errors (id, provider, endpoint, error_code, message, resolved, created_at)
           VALUES (?, ?, ?, 'INVALID_WEBHOOK_SIGNATURE', 'Signature HMAC invalide reçue sur webhook.', 0, ?)`
        ).run(`err_${crypto.randomUUID().slice(0, 10)}`, providerId, req.originalUrl, new Date().toISOString());
        res.status(401).json({ error: 'Signature webhook invalide.' });
        return;
      }

      const payload = z
        .object({
          reference: z.string(),
          status: z.enum(['CONFIRMED', 'FAILED']),
          failureReason: z.string().optional(),
        })
        .parse(req.body);

      const payRef = db.prepare('SELECT * FROM payment_references WHERE reference = ?').get(payload.reference) as
        | {
            reference: string;
            user_id: string;
            provider: PaymentProviderId;
            operation_type: string;
            amount: number;
            currency: string;
            goal_id: string | null;
            loan_id: string | null;
            status: string;
          }
        | undefined;

      if (!payRef) {
        res.status(404).json({ error: 'Référence de paiement inconnue.' });
        return;
      }

      if (payRef.status === 'CONFIRMED') {
        res.json({ received: true, duplicateIgnored: true, status: 'CONFIRMED' });
        return;
      }

      if (payload.status === 'CONFIRMED') {
        applyConfirmedPayment(db, payRef);
      } else {
        db.prepare(`UPDATE payment_references SET status = 'FAILED', failure_reason = ?, updated_at = ? WHERE reference = ?`).run(
          payload.failureReason ?? 'Échec signalé par webhook',
          new Date().toISOString(),
          payRef.reference
        );
      }

      res.json({ received: true, duplicateIgnored: false, status: payload.status });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // E. MODULE CRÉDIT (Estimation, Solvabilité explicable, Demandes, Échéancier)
  // ============================================================================

  api.post('/loans/estimate', requireAuth(db), (req, res, next) => {
    try {
      const schema = z.object({
        requestedAmount: z.number().min(20).max(10000),
        durationMonths: z.number().int().min(1).max(24),
      });
      const input = schema.parse(req.body);
      res.json(calculateLoanEstimate(input));
    } catch (err) {
      next(err);
    }
  });

  api.get('/loans', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const applications = db
      .prepare(
        `SELECT la.*, sa.score, sa.risk_band, sa.eligible, sa.debt_to_income_ratio, sa.disposable_income, sa.factors_json, sa.disclaimer
         FROM loan_applications la
         LEFT JOIN solvency_assessments sa ON sa.loan_application_id = la.id
         WHERE la.user_id = ?
         ORDER BY la.created_at DESC`
      )
      .all(req.auth!.sub);

    const contracts = db.prepare('SELECT * FROM loan_contracts WHERE user_id = ? ORDER BY disbursed_at DESC').all(req.auth!.sub);
    res.json({ applications, contracts });
  });

  api.get('/loans/:id', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const appRow = db
      .prepare(
        `SELECT la.*, sa.score, sa.risk_band, sa.eligible, sa.debt_to_income_ratio, sa.disposable_income, sa.factors_json, sa.disclaimer, sa.halisi_reference
         FROM loan_applications la
         LEFT JOIN solvency_assessments sa ON sa.loan_application_id = la.id
         WHERE la.id = ? AND la.user_id = ?`
      )
      .get(req.params.id, req.auth!.sub);

    if (!appRow) {
      res.status(404).json({ error: 'Demande de crédit introuvable.' });
      return;
    }

    const contract = db.prepare('SELECT * FROM loan_contracts WHERE loan_application_id = ?').get(req.params.id) as
      | { id: string }
      | undefined;
    const schedule = contract
      ? db.prepare('SELECT * FROM repayment_schedules WHERE contract_id = ? ORDER BY installment_number ASC').all(contract.id)
      : [];
    const repayments = contract
      ? db.prepare('SELECT * FROM repayments WHERE contract_id = ? ORDER BY created_at DESC').all(contract.id)
      : [];

    res.json({ application: appRow, contract: contract ?? null, schedule, repayments });
  });

  api.post('/loans/apply', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = loanApplySchema.parse(req.body);
      const userId = req.auth!.sub;

      const profile = db.prepare('SELECT date_of_birth FROM profiles WHERE user_id = ?').get(userId) as {
        date_of_birth: string;
      };
      const account = db
        .prepare('SELECT available_balance, locked_goals_balance FROM savings_accounts WHERE user_id = ?')
        .get(userId) as { available_balance: number; locked_goals_balance: number };
      const kyc = db
        .prepare(`SELECT status FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(userId) as { status: string } | undefined;

      const totalSavings = (account?.available_balance || 0) + (account?.locked_goals_balance || 0);
      const kycVerified = kyc?.status === 'VERIFIED';
      const ageYears = calculateAgeFromDob(profile.date_of_birth);

      const solvency = evaluateSolvency({
        ageYears,
        monthlyIncome: input.monthlyIncome,
        monthlyExpenses: input.monthlyExpenses,
        existingCommitments: input.existingCommitments,
        requestedAmount: input.requestedAmount,
        durationMonths: input.durationMonths,
        businessYears: input.businessYears,
        totalSavings,
        kycVerified,
      });

      if (solvency.riskBand === 'INELIGIBLE') {
        res.status(422).json({
          error: 'Conditions réglementaires d’éligibilité non remplies.',
          solvency,
        });
        return;
      }

      const halisiRes = await halisiCredit.assessCreditProfile({
        userId,
        requestedAmount: input.requestedAmount,
        durationMonths: input.durationMonths,
        monthlyIncome: input.monthlyIncome,
        monthlyExpenses: input.monthlyExpenses,
        existingCommitments: input.existingCommitments,
        savingsTotal: totalSavings,
        kycVerified,
      });

      const now = new Date().toISOString();
      const loanId = `loan_${crypto.randomUUID().slice(0, 10)}`;
      const solvId = `solv_${crypto.randomUUID().slice(0, 10)}`;

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO loan_applications (id, user_id, business_activity, business_years, monthly_income, monthly_expenses, existing_commitments, requested_amount, duration_months, purpose, estimated_monthly_payment, status, is_simulated, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', 1, ?, ?)`
        ).run(
          loanId,
          userId,
          input.businessActivity,
          input.businessYears,
          input.monthlyIncome,
          input.monthlyExpenses,
          input.existingCommitments,
          input.requestedAmount,
          input.durationMonths,
          input.purpose,
          solvency.monthlyInstallment,
          now,
          now
        );

        db.prepare(
          `INSERT INTO solvency_assessments (id, loan_application_id, user_id, score, risk_band, debt_to_income_ratio, disposable_income, eligible, factors_json, halisi_reference, disclaimer, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          solvId,
          loanId,
          userId,
          solvency.score,
          solvency.riskBand,
          solvency.debtToIncomeRatio,
          solvency.disposableIncome,
          solvency.eligible ? 1 : 0,
          JSON.stringify(solvency.factors),
          halisiRes.assessmentRef,
          solvency.disclaimer,
          now
        );

        db.prepare(
          `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
           VALUES (?, ?, 'LOAN_RECEIVED', 'Demande de crédit reçue', ?, 0, ?)`
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          userId,
          `Votre demande de ${input.requestedAmount.toFixed(2)} USD sur ${input.durationMonths} mois est en cours d’examen par un agent de crédit.`,
          now
        );
      });

      tx();
      logAudit(db, userId, req.auth!.role, 'LOAN_APPLICATION_SUBMITTED', 'LOAN_APPLICATION', loanId, {
        amount: input.requestedAmount,
        indicativeScore: solvency.score,
      });

      res.status(201).json({
        loanId,
        status: 'PENDING_REVIEW',
        solvency,
        halisiAssessment: halisiRes,
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/loans/:id/repay', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        scheduleId: z.string(),
        provider: z.enum(['AIRTEL_MONEY', 'ORANGE_MONEY', 'VODACOM_MPESA', 'FLEXPAY_AGGREGATOR']),
        idempotencyKey: z.string().min(6),
      });
      const input = schema.parse(req.body);
      const userId = req.auth!.sub;

      const contract = db
        .prepare('SELECT * FROM loan_contracts WHERE loan_application_id = ? AND user_id = ?')
        .get(req.params.id, userId) as { id: string; remaining_balance: number; status: string } | undefined;

      if (!contract) {
        res.status(404).json({ error: 'Contrat de crédit introuvable.' });
        return;
      }

      const sched = db
        .prepare('SELECT * FROM repayment_schedules WHERE id = ? AND contract_id = ?')
        .get(input.scheduleId, contract.id) as
        | { id: string; total_due: number; status: string; installment_number: number }
        | undefined;

      if (!sched) {
        res.status(404).json({ error: 'Échéance introuvable.' });
        return;
      }
      if (sched.status === 'PAID') {
        res.status(409).json({ error: 'Cette échéance est déjà réglée.' });
        return;
      }

      const ref = `REP-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const now = new Date().toISOString();

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO payment_references (reference, idempotency_key, user_id, provider, operation_type, amount, currency, loan_id, external_ref, status, is_simulated, reconciled, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'LOAN_REPAYMENT', ?, 'USD', ?, ?, 'CONFIRMED', 1, 1, ?, ?)`
        ).run(ref, input.idempotencyKey, userId, input.provider, sched.total_due, req.params.id, `EXT-${ref}`, now, now);

        db.prepare(`UPDATE repayment_schedules SET paid_amount = ?, status = 'PAID', paid_at = ? WHERE id = ?`).run(
          sched.total_due,
          now,
          sched.id
        );

        const newRemaining = Math.max(0, Number((contract.remaining_balance - sched.total_due).toFixed(2)));
        const newContractStatus = newRemaining <= 0.01 ? 'COMPLETED' : 'ACTIVE';
        db.prepare('UPDATE loan_contracts SET remaining_balance = ?, status = ? WHERE id = ?').run(
          newRemaining,
          newContractStatus,
          contract.id
        );

        db.prepare(
          `INSERT INTO repayments (id, contract_id, schedule_id, user_id, amount, payment_reference, provider, is_simulated, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(`rep_${crypto.randomUUID().slice(0, 10)}`, contract.id, sched.id, userId, sched.total_due, ref, input.provider, now);

        db.prepare(
          `INSERT INTO transactions (id, user_id, loan_id, payment_reference, type, amount, currency, provider, status, description, is_simulated, created_at)
           VALUES (?, ?, ?, ?, 'LOAN_REPAYMENT', ?, 'USD', ?, 'CONFIRMED', ?, 1, ?)`
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          userId,
          req.params.id,
          ref,
          sched.total_due,
          input.provider,
          `Remboursement échéance #${sched.installment_number} via ${input.provider} (Simulation)`,
          now
        );

        db.prepare(
          `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
           VALUES (?, ?, 'REPAYMENT_CONFIRMED', 'Remboursement confirmé (Simulation)', ?, 0, ?)`
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          userId,
          `Échéance #${sched.installment_number} (${sched.total_due.toFixed(2)} USD) enregistrée. Solde restant : ${newRemaining.toFixed(2)} USD.`,
          now
        );
      });

      tx();
      res.json({ reference: ref, amountPaid: sched.total_due, status: 'PAID', isSimulated: true });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // I. NOTIFICATIONS
  // ============================================================================

  api.get('/notifications', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const notifications = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(req.auth!.sub);
    const preferences = db
      .prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
      .get(req.auth!.sub);
    res.json({ notifications, preferences });
  });

  api.put('/notifications/:id/read', requireAuth(db), (req: AuthenticatedRequest, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.auth!.sub);
    res.json({ read: true });
  });

  api.put('/notifications/preferences', requireAuth(db), (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        push_enabled: z.boolean().optional(),
        savings_alerts: z.boolean().optional(),
        loan_updates: z.boolean().optional(),
        repayment_reminders: z.boolean().optional(),
        security_alerts: z.boolean().optional(),
        financial_tips: z.boolean().optional(),
      });
      const input = schema.parse(req.body);
      const current = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(req.auth!.sub) as Record<
        string,
        number
      >;

      db.prepare(
        `UPDATE notification_preferences
         SET push_enabled = ?, savings_alerts = ?, loan_updates = ?, repayment_reminders = ?, security_alerts = ?, financial_tips = ?
         WHERE user_id = ?`
      ).run(
        input.push_enabled !== undefined ? (input.push_enabled ? 1 : 0) : current.push_enabled,
        input.savings_alerts !== undefined ? (input.savings_alerts ? 1 : 0) : current.savings_alerts,
        input.loan_updates !== undefined ? (input.loan_updates ? 1 : 0) : current.loan_updates,
        input.repayment_reminders !== undefined ? (input.repayment_reminders ? 1 : 0) : current.repayment_reminders,
        input.security_alerts !== undefined ? (input.security_alerts ? 1 : 0) : current.security_alerts,
        input.financial_tips !== undefined ? (input.financial_tips ? 1 : 0) : current.financial_tips,
        req.auth!.sub
      );

      const updated = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(req.auth!.sub);
      res.json({ preferences: updated });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // H. ASSISTANT V-MICRO (Gemini API + RAG + Garde-fous stricts)
  // ============================================================================

  api.get('/assistant/conversations', requireAuth(db), (req: AuthenticatedRequest, res) => {
    const conv = db
      .prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(req.auth!.sub) as { id: string } | undefined;

    if (!conv) {
      res.json({ conversationId: null, messages: [] });
      return;
    }

    const messages = db
      .prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conv.id);
    res.json({ conversationId: conv.id, messages });
  });

  api.post('/assistant/chat', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const { message, conversationId } = z
        .object({
          message: z.string().min(1).max(1500),
          conversationId: z.string().nullable().optional(),
        })
        .parse(req.body);

      const userId = req.auth!.sub;
      const now = new Date().toISOString();
      let convId = conversationId ?? null;

      if (!convId) {
        const existing = db
          .prepare('SELECT id FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
          .get(userId) as { id: string } | undefined;
        if (existing) {
          convId = existing.id;
        } else {
          convId = `conv_${crypto.randomUUID().slice(0, 10)}`;
          db.prepare(
            `INSERT INTO ai_conversations (id, user_id, title, created_at, updated_at)
             VALUES (?, ?, 'Assistant V-Micro', ?, ?)`
          ).run(convId, userId, now, now);
        }
      }

      const history = db
        .prepare('SELECT sender, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 12')
        .all(convId) as Array<{ sender: 'USER' | 'ASSISTANT'; content: string }>;

      // Contexte strictement NON IDENTIFIANT (aucun mot de passe, PII, biométrie ou numéro de pièce)
      const profile = db.prepare('SELECT language FROM profiles WHERE user_id = ?').get(userId) as {
        language: 'fr' | 'sw' | 'en';
      };
      const kyc = db
        .prepare('SELECT status FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(userId) as { status: string } | undefined;
      const goalsCount = db
        .prepare(`SELECT COUNT(*) as c FROM savings_goals WHERE user_id = ? AND status = 'ACTIVE'`)
        .get(userId) as { c: number };
      const loansCount = db
        .prepare(`SELECT COUNT(*) as c FROM loan_contracts WHERE user_id = ? AND status = 'ACTIVE'`)
        .get(userId) as { c: number };

      const reply = await assistant.generateReply(message, history, {
        preferredLanguage: profile?.language || 'fr',
        kycStatus: kyc?.status || 'NOT_STARTED',
        activeGoalsCount: goalsCount.c,
        activeLoansCount: loansCount.c,
      });

      const userMsgId = `msg_${crypto.randomUUID().slice(0, 10)}`;
      const aiMsgId = `msg_${crypto.randomUUID().slice(0, 10)}`;

      db.prepare(
        `INSERT INTO ai_messages (id, conversation_id, sender, content, created_at) VALUES (?, ?, 'USER', ?, ?)`
      ).run(userMsgId, convId, message, now);
      db.prepare(
        `INSERT INTO ai_messages (id, conversation_id, sender, content, citations_json, created_at) VALUES (?, ?, 'ASSISTANT', ?, ?, ?)`
      ).run(aiMsgId, convId, reply.answer, JSON.stringify(reply.citations), new Date().toISOString());
      db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), convId);

      res.json({
        conversationId: convId,
        reply: reply.answer,
        citations: reply.citations,
        modelUsed: reply.modelUsed,
      });
    } catch (err) {
      next(err);
    }
  });

  api.post('/assistant/transcribe', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const { audioBase64, mimeType } = z
        .object({
          audioBase64: z.string().min(50),
          mimeType: z.string().default('audio/webm'),
        })
        .parse(req.body);
      const transcript = await multimodal.transcribeAudio(audioBase64, mimeType);
      res.json({ transcript });
    } catch (err) {
      next(err);
    }
  });

  api.post('/assistant/tts', requireAuth(db), async (req: AuthenticatedRequest, res, next) => {
    try {
      const { text } = z.object({ text: z.string().min(2).max(1200) }).parse(req.body);
      const speech = await multimodal.synthesizeSpeech(text);
      res.json(speech);
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // 5. ESPACE ADMINISTRATEUR (RBAC STRICT & JOURNALISATION)
  // ============================================================================

  api.get('/admin/overview', requireAuth(db), requirePermission('ADMIN_VIEW_OVERVIEW'), (_req, res) => {
    const totalUsers = (db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'CLIENT'`).get() as { c: number }).c;
    const verifiedUsers = (
      db.prepare(`SELECT COUNT(DISTINCT user_id) as c FROM identity_verifications WHERE status = 'VERIFIED'`).get() as { c: number }
    ).c;
    const totalLoanApps = (db.prepare('SELECT COUNT(*) as c FROM loan_applications').get() as { c: number }).c;
    const pendingLoans = (
      db.prepare(`SELECT COUNT(*) as c FROM loan_applications WHERE status = 'PENDING_REVIEW'`).get() as { c: number }
    ).c;
    const approvedLoans = (
      db.prepare(`SELECT COUNT(*) as c FROM loan_applications WHERE status = 'APPROVED'`).get() as { c: number }
    ).c;
    const totalSavings = (
      db.prepare('SELECT COALESCE(SUM(available_balance + locked_goals_balance), 0) as s FROM savings_accounts').get() as {
        s: number;
      }
    ).s;
    const totalDisbursed = (
      db.prepare('SELECT COALESCE(SUM(principal_amount), 0) as s FROM loan_contracts').get() as { s: number }
    ).s;
    const totalRepaid = (
      db.prepare('SELECT COALESCE(SUM(amount), 0) as s FROM repayments').get() as { s: number }
    ).s;
    const simulatedTxCount = (
      db.prepare('SELECT COUNT(*) as c FROM transactions WHERE is_simulated = 1').get() as { c: number }
    ).c;
    const realTxCount = (
      db.prepare('SELECT COUNT(*) as c FROM transactions WHERE is_simulated = 0').get() as { c: number }
    ).c;

    res.json({
      kpis: {
        totalUsers,
        verifiedUsers,
        totalLoanApps,
        pendingLoans,
        approvedLoans,
        totalSavings: Number(totalSavings.toFixed(2)),
        totalDisbursed: Number(totalDisbursed.toFixed(2)),
        totalRepaid: Number(totalRepaid.toFixed(2)),
        simulatedTxCount,
        realTxCount,
      },
    });
  });

  api.get('/admin/users', requireAuth(db), requirePermission('ADMIN_MANAGE_USERS'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.phone, u.role, u.phone_verified, u.status, u.created_at,
                p.first_name, p.last_name, p.city, p.commune, p.profession,
                COALESCE((SELECT status FROM identity_verifications iv WHERE iv.user_id = u.id ORDER BY iv.created_at DESC LIMIT 1), 'NOT_STARTED') as kyc_status,
                (SELECT id FROM identity_verifications iv WHERE iv.user_id = u.id ORDER BY iv.created_at DESC LIMIT 1) as latest_kyc_id
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         ORDER BY u.created_at DESC`
      )
      .all();
    res.json({ users });
  });

  api.put('/admin/users/:id/kyc', requireAuth(db), requirePermission('ADMIN_VERIFY_KYC'), (req: AuthenticatedRequest, res, next) => {
    try {
      const { status, note } = z.object({ status: z.enum(['VERIFIED', 'FAILED']), note: z.string().min(3) }).parse(req.body);
      const latest = db
        .prepare('SELECT id FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(req.params.id) as { id: string } | undefined;

      if (!latest) {
        res.status(404).json({ error: 'Aucun dossier KYC trouvé pour cet utilisateur.' });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE identity_verifications SET status = ?, failure_reason = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`
      ).run(status, status === 'FAILED' ? note : null, req.auth!.sub, now, latest.id);

      db.prepare(
        `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
         VALUES (?, ?, 'KYC_UPDATE', ?, ?, 0, ?)`
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        req.params.id,
        status === 'VERIFIED' ? 'Identité validée par un agent' : 'Dossier KYC refusé',
        note,
        now
      );

      logAudit(db, req.auth!.sub, req.auth!.role, `KYC_ADMIN_${status}`, 'USER', String(req.params.id), { note });
      res.json({ status, reviewedBy: req.auth!.sub });
    } catch (err) {
      next(err);
    }
  });

  api.put('/admin/users/:id/role', requireAuth(db), requirePermission('ADMIN_MANAGE_ROLES'), (req: AuthenticatedRequest, res, next) => {
    try {
      const { role } = z
        .object({
          role: z.enum(['CLIENT', 'SUPER_ADMIN', 'ADMIN', 'VERIFICATION_AGENT', 'CREDIT_AGENT', 'CLIENT_SUPPORT', 'AUDITOR']),
        })
        .parse(req.body);

      if (req.params.id === req.auth!.sub) {
        res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle.' });
        return;
      }

      db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, new Date().toISOString(), req.params.id);
      logAudit(db, req.auth!.sub, req.auth!.role, 'ROLE_UPDATED', 'USER', String(req.params.id), { newRole: role });
      res.json({ userId: req.params.id, role });
    } catch (err) {
      next(err);
    }
  });

  api.get('/admin/loans', requireAuth(db), requirePermission('ADMIN_REVIEW_LOANS'), (_req, res) => {
    const loans = db
      .prepare(
        `SELECT la.*, p.first_name, p.last_name, p.city, u.phone,
                sa.score, sa.risk_band, sa.debt_to_income_ratio, sa.disposable_income, sa.factors_json, sa.disclaimer
         FROM loan_applications la
         JOIN users u ON u.id = la.user_id
         LEFT JOIN profiles p ON p.user_id = la.user_id
         LEFT JOIN solvency_assessments sa ON sa.loan_application_id = la.id
         ORDER BY la.created_at DESC`
      )
      .all();
    res.json({ loans });
  });

  api.post('/admin/loans/:id/decision', requireAuth(db), requirePermission('ADMIN_REVIEW_LOANS'), (req: AuthenticatedRequest, res, next) => {
    try {
      const { decision, note } = z
        .object({
          decision: z.enum(['APPROVED', 'REJECTED', 'COMPLEMENT_REQUIRED']),
          note: z.string().min(5, 'Justification obligatoire pour la piste d’audit'),
        })
        .parse(req.body);

      const appRow = db.prepare('SELECT * FROM loan_applications WHERE id = ?').get(req.params.id) as
        | {
            id: string;
            user_id: string;
            requested_amount: number;
            duration_months: number;
            status: string;
          }
        | undefined;

      if (!appRow) {
        res.status(404).json({ error: 'Demande de crédit introuvable.' });
        return;
      }

      if (appRow.status === 'APPROVED' || appRow.status === 'REJECTED') {
        res.status(409).json({ error: 'Une décision finale a déjà été rendue sur ce dossier.' });
        return;
      }

      const now = new Date().toISOString();
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE loan_applications SET status = ?, decision_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
        ).run(decision, note, req.auth!.sub, now, now, appRow.id);

        if (decision === 'APPROVED') {
          const est = calculateLoanEstimate({
            requestedAmount: appRow.requested_amount,
            durationMonths: appRow.duration_months,
          });
          const contractId = `ctr_${crypto.randomUUID().slice(0, 10)}`;
          db.prepare(
            `INSERT INTO loan_contracts (id, loan_application_id, user_id, principal_amount, annual_interest_rate, duration_months, monthly_installment, total_repayable, remaining_balance, status, disbursed_at, is_simulated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 1)`
          ).run(
            contractId,
            appRow.id,
            appRow.user_id,
            est.requestedAmount,
            est.annualInterestRate,
            est.durationMonths,
            est.monthlyInstallment,
            est.totalRepayable,
            est.totalRepayable,
            now
          );

          const insertSched = db.prepare(
            `INSERT INTO repayment_schedules (id, contract_id, installment_number, due_date, principal_due, interest_due, total_due, paid_amount, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'PENDING')`
          );

          est.schedulePreview.forEach((item) => {
            const dueDate = new Date();
            dueDate.setMonth(dueDate.getMonth() + item.installmentNumber);
            insertSched.run(
              `sch_${crypto.randomUUID().slice(0, 10)}`,
              contractId,
              item.installmentNumber,
              dueDate.toISOString().slice(0, 10),
              item.principalDue,
              item.interestDue,
              item.totalDue
            );
          });
        }

        db.prepare(
          `INSERT INTO notifications (id, user_id, category, title, message, read, created_at)
           VALUES (?, ?, 'LOAN_DECISION', ?, ?, 0, ?)`
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          appRow.user_id,
          decision === 'APPROVED'
            ? 'Demande de crédit approuvée (Simulation)'
            : decision === 'REJECTED'
              ? 'Demande de crédit refusée'
              : 'Complément d’information demandé',
          note,
          now
        );
      });

      tx();
      logAudit(db, req.auth!.sub, req.auth!.role, `LOAN_DECISION_${decision}`, 'LOAN_APPLICATION', appRow.id, { note });
      res.json({ loanId: appRow.id, decision, note, reviewedBy: req.auth!.sub });
    } catch (err) {
      next(err);
    }
  });

  api.get('/admin/transactions', requireAuth(db), requirePermission('ADMIN_VIEW_OVERVIEW'), (_req, res) => {
    const transactions = db
      .prepare(
        `SELECT t.*, p.first_name, p.last_name, pr.reconciled
         FROM transactions t
         LEFT JOIN profiles p ON p.user_id = t.user_id
         LEFT JOIN payment_references pr ON pr.reference = t.payment_reference
         ORDER BY t.created_at DESC LIMIT 100`
      )
      .all();
    res.json({ transactions });
  });

  api.get('/admin/audit-logs', requireAuth(db), requirePermission('ADMIN_VIEW_AUDIT'), (_req, res) => {
    const logs = db
      .prepare(
        `SELECT al.*, u.email as actor_email
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
         ORDER BY al.created_at DESC LIMIT 120`
      )
      .all();
    res.json({ logs });
  });

  api.get('/admin/providers', requireAuth(db), requirePermission('ADMIN_VIEW_OVERVIEW'), (_req, res) => {
    const providers = db.prepare('SELECT * FROM provider_configs ORDER BY category, name').all();
    const errors = db.prepare('SELECT * FROM integration_errors ORDER BY created_at DESC LIMIT 30').all();
    res.json({ providers, errors });
  });

  api.put('/admin/providers/:id', requireAuth(db), requirePermission('ADMIN_MANAGE_PROVIDERS'), (req: AuthenticatedRequest, res, next) => {
    try {
      const { enabled, mode } = z
        .object({
          enabled: z.boolean(),
          mode: z.enum(['SIMULATION', 'MOCK_ADAPTER', 'CLOUD_API', 'DISABLED_SANDBOX']).optional(),
        })
        .parse(req.body);

      db.prepare(
        `UPDATE provider_configs SET enabled = ?, mode = COALESCE(?, mode), updated_by = ?, updated_at = ? WHERE id = ?`
      ).run(enabled ? 1 : 0, mode ?? null, req.auth!.sub, new Date().toISOString(), req.params.id);

      logAudit(db, req.auth!.sub, req.auth!.role, 'PROVIDER_CONFIG_UPDATED', 'PROVIDER', String(req.params.id), {
        enabled,
        mode,
      });
      const updated = db.prepare('SELECT * FROM provider_configs WHERE id = ?').get(req.params.id);
      res.json({ provider: updated });
    } catch (err) {
      next(err);
    }
  });

  api.post('/admin/notifications/broadcast', requireAuth(db), requirePermission('ADMIN_SEND_NOTIFICATIONS'), (req: AuthenticatedRequest, res, next) => {
    try {
      const { title, message, category } = z
        .object({
          title: z.string().min(3),
          message: z.string().min(5),
          category: z.enum(['FINANCIAL_TIP', 'SECURITY_ALERT', 'GENERAL']).default('FINANCIAL_TIP'),
        })
        .parse(req.body);

      const clients = db.prepare(`SELECT id FROM users WHERE role = 'CLIENT' AND status = 'ACTIVE'`).all() as Array<{
        id: string;
      }>;
      const now = new Date().toISOString();
      const insert = db.prepare(
        `INSERT INTO notifications (id, user_id, category, title, message, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
      );

      const tx = db.transaction(() => {
        for (const c of clients) {
          insert.run(`ntf_${crypto.randomUUID().slice(0, 10)}`, c.id, category, title, message, now);
        }
      });
      tx();

      logAudit(db, req.auth!.sub, req.auth!.role, 'BROADCAST_NOTIFICATION_SENT', 'NOTIFICATION', null, {
        recipients: clients.length,
        title,
      });

      res.status(201).json({ sentCount: clients.length });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1', api);

  // Gestionnaire centralisé des exceptions
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: err.issues[0]?.message || 'Données invalides.',
        details: err.issues,
      });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur interne du serveur.';
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    res.status(status).json({ error: message });
  });

  return { app, db };
}
