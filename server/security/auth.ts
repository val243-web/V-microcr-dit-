import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import type { UserRole } from '../db/database.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'vmicro_dev_secret_change_in_prod_32chars';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'vmicro_dev_refresh_secret_change_prod_32';

export type Permission =
  | 'ADMIN_VIEW_OVERVIEW'
  | 'ADMIN_MANAGE_USERS'
  | 'ADMIN_VERIFY_KYC'
  | 'ADMIN_REVIEW_LOANS'
  | 'ADMIN_MANAGE_ROLES'
  | 'ADMIN_SEND_NOTIFICATIONS'
  | 'ADMIN_VIEW_AUDIT'
  | 'ADMIN_MANAGE_PROVIDERS'
  | 'ADMIN_RECONCILE_TX';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  CLIENT: [],
  SUPER_ADMIN: [
    'ADMIN_VIEW_OVERVIEW',
    'ADMIN_MANAGE_USERS',
    'ADMIN_VERIFY_KYC',
    'ADMIN_REVIEW_LOANS',
    'ADMIN_MANAGE_ROLES',
    'ADMIN_SEND_NOTIFICATIONS',
    'ADMIN_VIEW_AUDIT',
    'ADMIN_MANAGE_PROVIDERS',
    'ADMIN_RECONCILE_TX',
  ],
  ADMIN: [
    'ADMIN_VIEW_OVERVIEW',
    'ADMIN_MANAGE_USERS',
    'ADMIN_VERIFY_KYC',
    'ADMIN_REVIEW_LOANS',
    'ADMIN_SEND_NOTIFICATIONS',
    'ADMIN_VIEW_AUDIT',
    'ADMIN_RECONCILE_TX',
  ],
  VERIFICATION_AGENT: ['ADMIN_VIEW_OVERVIEW', 'ADMIN_MANAGE_USERS', 'ADMIN_VERIFY_KYC'],
  CREDIT_AGENT: ['ADMIN_VIEW_OVERVIEW', 'ADMIN_REVIEW_LOANS', 'ADMIN_RECONCILE_TX'],
  CLIENT_SUPPORT: ['ADMIN_VIEW_OVERVIEW', 'ADMIN_MANAGE_USERS', 'ADMIN_SEND_NOTIFICATIONS'],
  AUDITOR: ['ADMIN_VIEW_OVERVIEW', 'ADMIN_VIEW_AUDIT'],
};

export interface AuthTokenPayload {
  sub: string;
  role: UserRole;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthTokenPayload;
}

export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return getPermissionsForRole(role).includes(permission);
}

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

export function signRefreshToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}

export function verifyRefreshToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as AuthTokenPayload;
}

export function hashSecret(value: string): string {
  return bcrypt.hashSync(value, 10);
}

export function compareSecret(value: string, hash: string): boolean {
  return bcrypt.compareSync(value, hash);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class LoginRateLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  private maxAttempts: number;
  private windowMs: number;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now > entry.resetAt) {
      return { allowed: true, retryAfterSec: 0 };
    }
    if (entry.count >= this.maxAttempts) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || now > entry.resetAt) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export function requireAuth(db: Database.Database) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyAccessToken(token);
      const session = db
        .prepare('SELECT id, revoked, expires_at FROM sessions WHERE id = ? AND user_id = ?')
        .get(payload.sessionId, payload.sub) as { id: string; revoked: number; expires_at: string } | undefined;

      if (!session || session.revoked === 1 || new Date(session.expires_at).getTime() < Date.now()) {
        res.status(401).json({ error: 'Session expirée ou révoquée.' });
        return;
      }

      const user = db.prepare('SELECT role, status FROM users WHERE id = ?').get(payload.sub) as
        | { role: UserRole; status: string }
        | undefined;
      if (!user || user.status !== 'ACTIVE') {
        res.status(403).json({ error: 'Compte suspendu ou introuvable.' });
        return;
      }

      req.auth = { ...payload, role: user.role };
      next();
    } catch {
      res.status(401).json({ error: 'Jeton d’accès invalide.' });
    }
  };
}

export function requirePermission(permission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    if (!hasPermission(req.auth.role, permission)) {
      res.status(403).json({
        error: `Accès refusé : permission requise (${permission}).`,
      });
      return;
    }
    next();
  };
}

export function logAudit(
  db: Database.Database,
  actorId: string | null,
  actorRole: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `aud_${crypto.randomUUID().slice(0, 12)}`,
    actorId,
    actorRole,
    action,
    targetType,
    targetId,
    JSON.stringify(metadata),
    new Date().toISOString()
  );
}
