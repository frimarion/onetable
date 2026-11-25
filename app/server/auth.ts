import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Transaction } from '@electric-sql/pglite';
import type { ClubAccounts, MemberRole } from '../shared/access.ts';
import type { Club, Session } from '../shared/model.ts';
import type { PgAdapter } from './pgAdapter.ts';
import { DomainError } from './validation.ts';

export type { MemberRole } from '../shared/access.ts';

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
  return role === 'dealer' || role === 'floor' ? role : 'admin';
}

export async function loginWithPassword(
  pg: PgAdapter,
  email: string,
  password: string,
  meta: { ip: string; userAgent: string },
  preferredClubId?: string,
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

    const primary = memberships.find(item => item.club.id === preferredClubId) ?? memberships[0];
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
          token: userRow.id + ':' + primary.club.id,
          club: primary.club,
          memberRole: primary.role,
          role: toSessionRole(primary.role),
          table: primary.tableNo,
        },
      },
    };
  });
}

export async function resolveSession(pg: PgAdapter, rawToken: string | undefined, requestedClubId?: string): Promise<AuthContext | null> {
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

    const current = requestedClubId === undefined
      ? memberships.find(m => m.club.id === row.club_id) ?? memberships[0]
      : memberships.find(m => m.club.id === requestedClubId);
    if (requestedClubId !== undefined && !current) throw new DomainError('У вас нет доступа к этому клубу', 403);
    if (!current) return null;

    return {
      user: { id: row.user_id, email: row.email, name: row.name, isSuperadmin: row.is_superadmin },
      club: current.club,
      memberRole: current.role,
      tableNo: current.tableNo,
      memberships,
      session: {
        token: row.user_id + ':' + current.club.id,
        club: current.club,
        memberRole: current.role,
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

function requireOwner(actor: AuthContext) {
  if (actor.memberRole !== 'owner') throw new DomainError('Управлять учётными записями может только владелец клуба', 403);
}

async function lockClub(tx: Transaction, clubId: string) {
  await tx.query('SELECT id FROM clubs WHERE id=$1 FOR UPDATE', [clubId]);
}

export async function clubAccounts(pg: PgAdapter, actor: AuthContext): Promise<ClubAccounts> {
  requireOwner(actor);
  return pg.systemTransaction(async tx => {
    const members = await tx.query<ClubAccounts['members'][number]>(
      `SELECT u.id,u.email,u.name,m.role,m.table_no AS "tableNo" FROM club_members m JOIN users u ON u.id=m.user_id
       WHERE m.club_id=$1 AND m.active ORDER BY (m.role='owner') DESC,u.name,u.email`, [actor.club.id]);
    const invitations = await tx.query<Omit<ClubAccounts['invitations'][number], 'expiresAt'> & { expiresAt: string }>(
      `SELECT email,role,table_no AS "tableNo",expires_at AS "expiresAt" FROM club_invites
       WHERE club_id=$1 AND accepted_at IS NULL AND expires_at>$2 ORDER BY created_at DESC`, [actor.club.id, Date.now()]);
    return { members: members.rows, invitations: invitations.rows.map(row => ({ ...row, expiresAt: Number(row.expiresAt) })) };
  });
}

export async function createInvite(
  pg: PgAdapter, actor: AuthContext, email: string, role: unknown, table: unknown, ip: string,
): Promise<{ token: string; expiresAt: number }> {
  requireOwner(actor);
  const normEmail = email.trim().toLowerCase();
  if (normEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) throw new DomainError('Укажите корректный email', 400);
  if (role !== 'admin' && role !== 'floor' && role !== 'dealer') throw new DomainError('Выберите роль сотрудника', 400);
  if (role === 'dealer' && (typeof table !== 'number' || !Number.isInteger(table) || table < 1 || table > 20)) {
    throw new DomainError('Укажите номер стола дилера', 400);
  }
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;
  const clubId = actor.club.id;

  await pg.systemTransaction(async tx => {
    await lockClub(tx, clubId);
    const active = await tx.query(
      'SELECT 1 FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=$1 AND m.active AND lower(u.email)=$2', [clubId, normEmail]);
    if (active.rows.length) throw new DomainError('У сотрудника уже есть доступ к этому клубу', 409);
    await tx.query('DELETE FROM club_invites WHERE club_id=$1 AND email=$2 AND accepted_at IS NULL', [clubId, normEmail]);
    await tx.query(
      'INSERT INTO club_invites (token_hash,club_id,email,role,table_no,invited_by,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [sha256(token), clubId, normEmail, role, role === 'dealer' ? table : null, actor.user.id, now, expiresAt]);
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['invite_created', actor.user.id, clubId, normEmail, ip, role, now]);
  });
  return { token, expiresAt };
}

export async function removeClubAccess(pg: PgAdapter, actor: AuthContext, target: { id: string } | { email: string }, ip: string) {
  requireOwner(actor);
  const clubId = actor.club.id;
  await pg.systemTransaction(async tx => {
    await lockClub(tx, clubId);
    let email: string;
    if ('id' in target) {
      const member = (await tx.query<{ email: string; role: MemberRole }>(
        'SELECT u.email,m.role FROM club_members m JOIN users u ON u.id=m.user_id WHERE m.club_id=$1 AND m.user_id=$2 AND m.active',
        [clubId, target.id])).rows[0];
      if (!member) throw new DomainError('Сотрудник не найден', 404);
      if (member.role === 'owner') throw new DomainError('Доступ владельца нельзя удалить', 403);
      email = member.email;
      await tx.query('UPDATE club_members SET active=false WHERE club_id=$1 AND user_id=$2', [clubId, target.id]);
      await tx.query('DELETE FROM auth_sessions WHERE club_id=$1 AND user_id=$2', [clubId, target.id]);
    } else {
      email = target.email.trim().toLowerCase();
    }
    await tx.query('DELETE FROM club_invites WHERE club_id=$1 AND lower(email)=$2 AND accepted_at IS NULL', [clubId, email.toLowerCase()]);
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      ['id' in target ? 'member_removed' : 'invite_revoked', actor.user.id, clubId, email, ip, Date.now()]);
  });
}

export async function acceptInvite(
  pg: PgAdapter, rawToken: string, name: string, password: string, meta: { ip: string; userAgent: string },
): Promise<{ token: string; context: AuthContext }> {
  const tokenHash = sha256(rawToken);
  const now = Date.now();
  const { email, clubId } = await pg.systemTransaction(async tx => {
    const candidate = (await tx.query<{ club_id: string }>('SELECT club_id FROM club_invites WHERE token_hash=$1', [tokenHash])).rows[0];
    if (candidate) await lockClub(tx, candidate.club_id);
    const invite = (await tx.query<{
      club_id: string; email: string; role: MemberRole; table_no: number | null; expires_at: string; accepted_at: string | null;
    }>('SELECT club_id,email,role,table_no,expires_at,accepted_at FROM club_invites WHERE token_hash=$1 FOR UPDATE', [tokenHash])).rows[0];
    if (!invite || invite.accepted_at !== null || Number(invite.expires_at) <= now) {
      throw new DomainError('Приглашение уже использовано или срок его действия истёк', 400);
    }
    const email = invite.email.toLowerCase();
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
    const existing = (await tx.query<{ id: string; password_hash: string; disabled: boolean; locked_until: string | null }>(
      'SELECT id,password_hash,disabled,locked_until FROM users WHERE lower(email)=$1 FOR UPDATE', [email])).rows[0];
    const userId = existing?.id ?? 'u_' + randomUUID();
    if (existing) {
      if (existing.disabled || Number(existing.locked_until) > now || !password || password.length > 128 || !verifyPassword(password, existing.password_hash)) {
        throw new DomainError('Укажите действующий пароль вашей учётной записи OneTable', 401);
      }
    } else {
      const cleanName = name.trim().slice(0, 80);
      if (cleanName.length < 2) throw new DomainError('Для новой учётной записи укажите имя', 400);
      await tx.query('INSERT INTO users (id,email,name,password_hash,created_at) VALUES ($1,$2,$3,$4,$5)',
        [userId, email, cleanName, hashPassword(password), now]);
    }

    await tx.query(
      `INSERT INTO club_members (club_id,user_id,role,table_no,active,created_at)
       VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT (club_id,user_id) DO UPDATE
       SET role=EXCLUDED.role,table_no=EXCLUDED.table_no,active=true WHERE NOT club_members.active`,
      [invite.club_id, userId, invite.role, invite.table_no, now]);
    await tx.query('UPDATE club_invites SET accepted_at=$2 WHERE token_hash=$1', [tokenHash, now]);
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['invite_accepted', userId, invite.club_id, email, meta.ip, invite.role, now]);
    return { email, clubId: invite.club_id };
  });
  return loginWithPassword(pg, email, password, meta, clubId);
}

export async function issueTvToken(pg: PgAdapter, actor: AuthContext, tournamentId: string): Promise<string> {
  if (actor.memberRole !== 'owner' && actor.memberRole !== 'admin') throw new DomainError('Нет прав на выпуск ссылки ТВ', 403);
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

export type ActiveSessionInfo = {
  id: string;
  current: boolean;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
};

export async function updateUserProfile(pg: PgAdapter, actor: AuthContext, name: string, ip: string): Promise<AuthUser> {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (cleanName.length < 2) throw new DomainError('Имя должно содержать минимум 2 символа', 400);
  const now = Date.now();
  await pg.systemTransaction(async tx => {
    await tx.query('UPDATE users SET name=$2 WHERE id=$1', [actor.user.id, cleanName]);
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['profile_updated', actor.user.id, actor.club.id, actor.user.email, ip, cleanName, now],
    );
  });
  return { ...actor.user, name: cleanName };
}

export async function changeUserPassword(
  pg: PgAdapter,
  actor: AuthContext,
  currentPassword: string,
  newPassword: string,
  rawSessionToken: string | undefined,
  ip: string,
): Promise<void> {
  if (!currentPassword || !newPassword) throw new DomainError('Укажите текущий и новый пароль', 400);
  if (currentPassword === newPassword) throw new DomainError('Новый пароль должен отличаться от текущего', 400);
  const nextHash = hashPassword(newPassword);
  const now = Date.now();
  const currentHash = rawSessionToken ? sha256(rawSessionToken) : '';
  await pg.systemTransaction(async tx => {
    const row = (await tx.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',
      [actor.user.id],
    )).rows[0];
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      throw new DomainError('Текущий пароль указан неверно', 401);
    }
    await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1', [actor.user.id, nextHash]);
    if (currentHash) {
      await tx.query('DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash<>$2', [actor.user.id, currentHash]);
    }
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      ['password_changed', actor.user.id, actor.club.id, actor.user.email, ip, now],
    );
  });
}

export async function listUserSessions(pg: PgAdapter, actor: AuthContext, rawSessionToken: string | undefined): Promise<ActiveSessionInfo[]> {
  const currentHash = rawSessionToken ? sha256(rawSessionToken) : '';
  const now = Date.now();
  return pg.systemTransaction(async tx => {
    const rows = (await tx.query<{
      token_hash: string; created_at: string; expires_at: string; ip: string | null; user_agent: string | null;
    }>(
      `SELECT token_hash, created_at, expires_at, ip, user_agent
         FROM auth_sessions
        WHERE user_id=$1 AND expires_at > $2
        ORDER BY created_at DESC`,
      [actor.user.id, now],
    )).rows;
    return rows.map(row => ({
      id: row.token_hash.slice(0, 12),
      current: row.token_hash === currentHash,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      ip: row.ip || '',
      userAgent: row.user_agent || '',
    }));
  });
}

export async function revokeOtherSessions(pg: PgAdapter, actor: AuthContext, rawSessionToken: string | undefined, ip: string): Promise<number> {
  const currentHash = rawSessionToken ? sha256(rawSessionToken) : '';
  if (!currentHash) return 0;
  const now = Date.now();
  return pg.systemTransaction(async tx => {
    const res = await tx.query<{ token_hash: string }>(
      'DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash<>$2 RETURNING token_hash',
      [actor.user.id, currentHash],
    );
    await tx.query(
      'INSERT INTO auth_audit_log (event,user_id,club_id,email,ip,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['sessions_revoked', actor.user.id, actor.club.id, actor.user.email, ip, String(res.rows.length), now],
    );
    return res.rows.length;
  });
}
