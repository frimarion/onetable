import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Club, Session } from '../shared/model.ts';
import type { PgAdapter } from './pgAdapter.ts';
import { DomainError } from './validation.ts';

export type MemberRole = 'owner' | 'admin' | 'floor' | 'dealer';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
};

export type Membership = {
  club: Club;
  role: MemberRole;
  tableNo: number | null;
};

export type AuthContext = {
  user: AuthUser;
  club: Club;
  memberRole: MemberRole;
  tableNo: number | null;
  memberships: Membership[];
  session: Session;
};

export const SESSION_COOKIE = 'onetable_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;       // 24 часа
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;         // 15 минут

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function validatePasswordStrength(password: string) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new DomainError('Пароль должен содержать минимум 10 символов', 400);
  }
  if (password.length > 128) {
    throw new DomainError('Пароль слишком длинный', 400);
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) {
    throw new DomainError('Пароль должен содержать хотя бы одну букву и одну цифру', 400);
  }
}

export function hashPassword(password: string): string {
  validatePasswordStrength(password);
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const actual = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  }
  return out;
}

export function sessionCookieHeader(token: string, secure: boolean, clear = false): string {
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function toSessionRole(role: MemberRole): Session['role'] {
  return role === 'dealer' ? 'dealer' : 'admin';
}

export async function loginWithPassword(
  pg: PgAdapter,
  email: string,
  password: string,
  meta: { ip: string; userAgent: string },
): Promise<{ token: string; context: AuthContext }> {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail || !password) throw new DomainError('Укажите email и пароль', 400);
  const now = Date.now();

  return pg.systemTransaction(async tx => {
    const userRow = (await tx.query<{
      id: string; email: string; name: string; password_hash: string;
      is_superadmin: boolean; disabled: boolean; failed_logins: number; locked_until: string | null;
    }>(
      'SELECT id,email,name,password_hash,is_superadmin,disabled,failed_logins,locked_until FROM users WHERE lower(email)=$1 FOR UPDATE',
      [normEmail],
    )).rows[0];

    if (!userRow || userRow.disabled) {
      await tx.query(
        'INSERT INTO auth_audit_log (event,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5)',
        ['login_failed', normEmail, meta.ip, 'unknown_or_disabled', now],
      );
      throw new DomainError('Неверный email или пароль', 401);
    }

    const lockedUntil = userRow.locked_until ? Number(userRow.locked_until) : 0;
    if (lockedUntil > now) {
      const mins = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
      throw new DomainError(`Слишком много неудачных попыток. Повторите через ${mins} мин.`, 429);
    }

    if (!verifyPassword(password, userRow.password_hash)) {
      const fails = userRow.failed_logins + 1;
      const lock = fails >= MAX_FAILED_LOGINS ? now + LOCK_DURATION_MS : null;
      await tx.query(
        'UPDATE users SET failed_logins=$2, locked_until=$3 WHERE id=$1',
        [userRow.id, fails >= MAX_FAILED_LOGINS ? 0 : fails, lock],
      );
      await tx.query(
        'INSERT INTO auth_audit_log (event,user_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        ['login_failed', userRow.id, normEmail, meta.ip, lock ? 'locked' : 'bad_password', now],
      );
      throw new DomainError('Неверный email или пароль', 401);
    }

    const memberships = (await tx.query<{
      club_id: string; name: string; venue: string; accent: string; role: MemberRole; table_no: number | null;
    }>(
      `SELECT m.club_id, c.name, c.venue, c.accent, m.role, m.table_no
         FROM club_members m JOIN clubs c ON c.id = m.club_id
        WHERE m.user_id = $1 AND m.active
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'floor' THEN 2 ELSE 3 END, c.name`,
      [userRow.id],
    )).rows.map(r => ({
      club: { id: r.club_id, name: r.name, venue: r.venue, accent: r.accent },
      role: r.role,
      tableNo: r.table_no,
    }));

    if (!memberships.length) {
      throw new DomainError('У вашей учётной записи нет активного доступа ни к одному клубу', 403);
    }

    const primary = memberships[0];
    const token = randomToken(32);
    const tokenHash = sha256(token);

    await tx.query('UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=$2 WHERE id=$1', [userRow.id, now]);
    await tx.query('DELETE FROM auth_sessions WHERE expires_at < $1', [now]);
    await tx.query(
      'INSERT INTO auth_sessions (token_hash,user_id,club_id,created_at,expires_at,ip,user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tokenHash, userRow.id, primary.club.id, now, now + SESSION_TTL_MS, meta.ip, meta.userAgent.slice(0, 240)],
    );
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      ['login_ok', userRow.id, primary.club.id, normEmail, meta.ip, now],
    );

    const user: AuthUser = { id: userRow.id, email: userRow.email, name: userRow.name, isSuperadmin: userRow.is_superadmin };
    return {
      token,
      context: {
        user,
        club: primary.club,
        memberRole: primary.role,
        tableNo: primary.tableNo,
        memberships,
        session: {
          token: 'session',
          club: primary.club,
          role: toSessionRole(primary.role),
          table: primary.tableNo,
        },
      },
    };
  });
}

export async function resolveSession(pg: PgAdapter, rawToken: string | undefined): Promise<AuthContext | null> {
  if (!rawToken || rawToken.length < 20) return null;
  const tokenHash = sha256(rawToken);
  const now = Date.now();

  return pg.systemTransaction(async tx => {
    const row = (await tx.query<{
      user_id: string; email: string; name: string; is_superadmin: boolean; disabled: boolean;
      club_id: string; expires_at: string;
    }>(
      `SELECT s.user_id, u.email, u.name, u.is_superadmin, u.disabled, s.club_id, s.expires_at
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [tokenHash],
    )).rows[0];

    if (!row || row.disabled || Number(row.expires_at) < now) {
      if (row) await tx.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
      return null;
    }

    const memberships = (await tx.query<{
      club_id: string; name: string; venue: string; accent: string; role: MemberRole; table_no: number | null;
    }>(
      `SELECT m.club_id, c.name, c.venue, c.accent, m.role, m.table_no
         FROM club_members m JOIN clubs c ON c.id = m.club_id
        WHERE m.user_id = $1 AND m.active
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'floor' THEN 2 ELSE 3 END, c.name`,
      [row.user_id],
    )).rows.map(r => ({
      club: { id: r.club_id, name: r.name, venue: r.venue, accent: r.accent },
      role: r.role,
      tableNo: r.table_no,
    }));

    const current = memberships.find(m => m.club.id === row.club_id) ?? memberships[0];
    if (!current) return null;

    return {
      user: { id: row.user_id, email: row.email, name: row.name, isSuperadmin: row.is_superadmin },
      club: current.club,
      memberRole: current.role,
      tableNo: current.tableNo,
      memberships,
      session: {
        token: 'session',
        club: current.club,
        role: toSessionRole(current.role),
        table: current.tableNo,
      },
    };
  });
}

export async function switchSessionClub(pg: PgAdapter, rawToken: string, clubId: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await pg.systemTransaction(async tx => {
    const sess = (await tx.query<{ user_id: string }>('SELECT user_id FROM auth_sessions WHERE token_hash=$1', [tokenHash])).rows[0];
    if (!sess) throw new DomainError('Сессия не найдена', 401);
    const member = (await tx.query<{ club_id: string }>(
      'SELECT club_id FROM club_members WHERE user_id=$1 AND club_id=$2 AND active',
      [sess.user_id, clubId],
    )).rows[0];
    if (!member) throw new DomainError('Клуб не найден', 404);
    await tx.query('UPDATE auth_sessions SET club_id=$2 WHERE token_hash=$1', [tokenHash, clubId]);
  });
}

export async function logoutSession(pg: PgAdapter, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await pg.systemTransaction(async tx => {
    await tx.query('DELETE FROM auth_sessions WHERE token_hash=$1', [sha256(rawToken)]);
  });
}

export async function createInvite(
  pg: PgAdapter,
  actor: AuthContext,
  email: string,
  role: MemberRole,
  ip: string,
): Promise<{ token: string; expiresAt: number }> {
  if (actor.memberRole !== 'owner' && !actor.user.isSuperadmin) {
    throw new DomainError('Приглашать сотрудников может только владелец клуба', 403);
  }
  const normEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) throw new DomainError('Укажите корректный email', 400);
  if (!['owner', 'admin', 'floor', 'dealer'].includes(role)) throw new DomainError('Некорректная роль', 400);

  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;

  await pg.systemTransaction(async tx => {
    await tx.query(
      'INSERT INTO club_invites (token_hash,club_id,email,role,invited_by,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [sha256(token), actor.club.id, normEmail, role, actor.user.id, now, expiresAt],
    );
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['invite_created', actor.user.id, actor.club.id, normEmail, ip, role, now],
    );
  });
  return { token, expiresAt };
}

export async function acceptInvite(
  pg: PgAdapter,
  rawToken: string,
  name: string,
  password: string,
  meta: { ip: string; userAgent: string },
): Promise<{ token: string; context: AuthContext }> {
  const tokenHash = sha256(String(rawToken || ''));
  const cleanName = String(name || '').trim().slice(0, 80);
  if (cleanName.length < 2) throw new DomainError('Укажите имя (минимум 2 символа)', 400);
  const passwordHash = hashPassword(password);
  const now = Date.now();

  const email = await pg.systemTransaction(async tx => {
    const invite = (await tx.query<{
      club_id: string; email: string; role: MemberRole; expires_at: string; accepted_at: string | null;
    }>('SELECT club_id,email,role,expires_at,accepted_at FROM club_invites WHERE token_hash=$1 FOR UPDATE', [tokenHash])).rows[0];

    if (!invite || invite.accepted_at !== null || Number(invite.expires_at) < now) {
      throw new DomainError('Ссылка приглашения недействительна или истекла', 400);
    }

    let user = (await tx.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=$1', [invite.email.toLowerCase()])).rows[0];
    if (!user) {
      const id = 'u_' + randomUUID();
      await tx.query(
        'INSERT INTO users (id,email,name,password_hash,created_at) VALUES ($1,$2,$3,$4,$5)',
        [id, invite.email.toLowerCase(), cleanName, passwordHash, now],
      );
      user = { id };
    } else {
      await tx.query('UPDATE users SET name=$2, password_hash=$3, disabled=false WHERE id=$1', [user.id, cleanName, passwordHash]);
    }

    await tx.query(
      `INSERT INTO club_members (club_id,user_id,role,active,created_at)
       VALUES ($1,$2,$3,true,$4)
       ON CONFLICT (club_id,user_id) DO UPDATE SET role=EXCLUDED.role, active=true`,
      [invite.club_id, user.id, invite.role, now],
    );
    await tx.query('UPDATE club_invites SET accepted_at=$2 WHERE token_hash=$1', [tokenHash, now]);
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['invite_accepted', user.id, invite.club_id, invite.email, meta.ip, invite.role, now],
    );
    return invite.email;
  });

  return loginWithPassword(pg, email, password, meta);
}

export async function issueTvToken(pg: PgAdapter, actor: AuthContext, tournamentId: string): Promise<string> {
  if (actor.memberRole === 'dealer') throw new DomainError('Нет прав на выпуск ссылки ТВ', 403);
  const token = randomToken(32);
  const now = Date.now();
  await pg.systemTransaction(async tx => {
    const t = (await tx.query<{ id: string }>('SELECT id FROM tournaments WHERE id=$1 AND club_id=$2', [tournamentId, actor.club.id])).rows[0];
    if (!t) throw new DomainError('Турнир не найден', 404);
    await tx.query('UPDATE tv_tokens SET revoked_at=$2 WHERE tournament_id=$1 AND revoked_at IS NULL', [tournamentId, now]);
    await tx.query(
      'INSERT INTO tv_tokens (token_hash,club_id,tournament_id,created_by,created_at) VALUES ($1,$2,$3,$4,$5)',
      [sha256(token), actor.club.id, tournamentId, actor.user.id, now],
    );
  });
  return token;
}

export async function resolveTvToken(pg: PgAdapter, rawToken: string): Promise<{ club: Club; tournamentId: string; session: Session } | null> {
  if (!rawToken || rawToken.length < 20) return null;
  return pg.systemTransaction(async tx => {
    const row = (await tx.query<{
      club_id: string; name: string; venue: string; accent: string; tournament_id: string;
    }>(
      `SELECT t.club_id, c.name, c.venue, c.accent, t.tournament_id
         FROM tv_tokens t JOIN clubs c ON c.id = t.club_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [sha256(rawToken)],
    )).rows[0];
    if (!row) return null;
    const club: Club = { id: row.club_id, name: row.name, venue: row.venue, accent: row.accent };
    return {
      club,
      tournamentId: row.tournament_id,
      session: { token: 'tv', club, role: 'display', table: null },
    };
  });
}
