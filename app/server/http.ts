import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Command } from '../shared/model.ts';
import { PgAdapter } from './pgAdapter.ts';
import {
  acceptInvite, clubAccounts, createInvite, issueTvToken, loginWithPassword, logoutSession, removeClubAccess,
  parseCookies, resolveSession, resolveTvToken, SESSION_COOKIE, sessionCookieHeader,
  sha256, switchSessionClub,
} from './auth.ts';
import { command, DomainError, snapshot } from './tournament.ts';
import { publicSchedule } from './definitions.ts';
import { onlineRegistration } from './registration.ts';
import { paymentWorkbook } from './paymentWorkbook.ts';
import { doyleWorkspaceFile, hasDoyleAccess, hasDoyleWorkspace, issueDoyleSession, readDoyleRows } from './doyle.ts';
import { notifyOfficeUpdate, subscribeToOfficeUpdates } from './officeUpdates.ts';

const PORT = Number(process.env.PORT || 4181);
const HOST = process.env.HOST || '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL || '';
const SECURE_COOKIES = process.env.COOKIE_SECURE !== '0' && process.env.NODE_ENV === 'production';
const DIST_DIR = resolve(new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (!DATABASE_URL) {
  console.error('Ошибка: переменная окружения DATABASE_URL не задана.');
  process.exit(1);
}

const pg = new PgAdapter(DATABASE_URL);

// Простой in-memory rate-limit (второй рубеж поверх Nginx limit_req)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count++;
  if (bucket.count > max) {
    throw new DomainError('Слишком много запросов. Повторите через минуту.', 429);
  }
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 128_000) throw new DomainError('Запрос слишком большой', 413);
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { throw new DomainError('Неверный формат запроса', 400); }
}

function sendJson(res: ServerResponse, code: number, data: unknown, extraHeaders: Record<string, string | string[]> = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.json': 'application/json; charset=utf-8',
};

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function serveDoyle(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const ctx = await resolveSession(pg, token);
  if (!ctx) return redirect(res, '/');
  if (!hasDoyleWorkspace(ctx)) throw new DomainError('Нет доступа к кабинету Doyle', 403);
  if (pathname === '/doyle' || pathname === '/doyle/') return redirect(res, '/doyle/tournaments.html');
  const { content, extension } = pathname === '/doyle-office.js'
    ? { content: await readFile(new URL('../deploy/doyle-office.js', import.meta.url)), extension: '.js' }
    : await doyleWorkspaceFile(pathname.slice('/doyle/'.length), sha256('doyle-office:' + token));
  res.writeHead(200, {
    'Content-Type': MIME[extension.toLowerCase()] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-store' : 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  res.end(content);
}

async function serveStatic(res: ServerResponse, pathname: string) {
  const clean = pathname === '/' ? '/index.html' : pathname;
  const rel = normalize(clean).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  let target = join(DIST_DIR, rel);
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    target = join(DIST_DIR, 'index.html');
  }
  if (!target.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const content = await readFile(target);
  const ext = extname(target);
  const immutable = target.includes('assets');
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  res.end(content);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method = req.method || 'GET';
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '');
  const cookies = parseCookies(req.headers.cookie);
  const rawSessionToken = cookies[SESSION_COOKIE];

  // /api/demo отключён в продакшене намеренно
  if (url.pathname === '/api/demo') {
    return sendJson(res, 404, { error: 'Демо-режим отключён на сервере' });
  }

  // ── Авторизация ────────────────────────────────────────────────────────────
  if (method === 'GET' && url.pathname === '/api/auth/me') {
    const ctx = await resolveSession(pg, rawSessionToken);
    if (!ctx) return sendJson(res, 401, { error: 'Требуется вход' });
    const defaultTournament = (await pg.forClub(ctx.club.id).query<{ id: string }>(
      `SELECT id FROM tournaments WHERE club_id=$1 AND ($2::boolean OR state<>'draft')
       ORDER BY CASE state WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, starts_at NULLS LAST, id LIMIT 1`,
      [ctx.club.id, ctx.session.role === 'admin'],
    )).rows[0]?.id ?? null;
    return sendJson(res, 200, {
      user: ctx.user,
      club: ctx.club,
      role: ctx.memberRole,
      session: ctx.session,
      memberships: ctx.memberships,
      defaultTournamentId: defaultTournament,
      doyleAccess: hasDoyleAccess(ctx),
      doyleWorkspace: hasDoyleWorkspace(ctx),
    });
  }

  if (method === 'POST' && url.pathname === '/api/auth/login') {
    checkRateLimit('login:' + ip, 10, 60_000);
    const body = await readJson(req);
    const { token, context } = await loginWithPassword(
      pg,
      String(body.email || ''),
      String(body.password || ''),
      { ip, userAgent: ua },
    );
    return sendJson(res, 200, {
      user: context.user,
      club: context.club,
      role: context.memberRole,
      session: context.session,
      memberships: context.memberships,
    }, { 'Set-Cookie': sessionCookieHeader(token, SECURE_COOKIES) });
  }

  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    await logoutSession(pg, rawSessionToken);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookieHeader('', SECURE_COOKIES, true) });
  }

  if (method === 'POST' && url.pathname === '/api/auth/accept-invite') {
    checkRateLimit('invite:' + ip, 10, 60_000);
    const body = await readJson(req);
    const { token, context } = await acceptInvite(
      pg,
      String(body.token || ''),
      String(body.name || ''),
      String(body.password || ''),
      { ip, userAgent: ua },
    );
    return sendJson(res, 200, {
      user: context.user,
      club: context.club,
      role: context.memberRole,
      session: context.session,
      memberships: context.memberships,
    }, { 'Set-Cookie': sessionCookieHeader(token, SECURE_COOKIES) });
  }

  // ── Публичное расписание и запись игроков ──────────────────────────────────
  const pubSchedule = /^\/api\/public\/clubs\/([a-zA-Z0-9_-]+)\/schedule$/.exec(url.pathname);
  if (method === 'GET' && pubSchedule) {
    const clubId = pubSchedule[1];
    return sendJson(res, 200, await publicSchedule(pg.forClub(clubId), clubId));
  }
  const pubReg = /^\/api\/public\/clubs\/([a-zA-Z0-9_-]+)\/tournaments\/([a-zA-Z0-9_-]+)\/registration$/.exec(url.pathname);
  if (method === 'POST' && pubReg) {
    checkRateLimit('reg:' + ip, 30, 60_000);
    const [, clubId, tournamentId] = pubReg;
    const input = await readJson(req);
    const result = await onlineRegistration(pg.forClub(clubId), clubId, tournamentId, input);
    if (input.action !== 'status') notifyOfficeUpdate(clubId);
    return sendJson(res, 200, result);
  }

  // ── ТВ-дисплей по 256-битному токену (только чтение одного турнира) ────────
  const tvMatch = /^\/api\/tv\/([a-zA-Z0-9_-]{20,120})$/.exec(url.pathname);
  if (method === 'GET' && tvMatch) {
    const tv = await resolveTvToken(pg, tvMatch[1]);
    if (!tv) return sendJson(res, 404, { error: 'Экран не найден' });
    return sendJson(res, 200, await snapshot(pg.forClub(tv.club.id), tv.session, tv.tournamentId));
  }

  // ── Защищённые эндпоинты кабинета клуба ────────────────────────────────────
  const ctx = await resolveSession(pg, rawSessionToken);
  if (!ctx) return sendJson(res, 401, { error: 'Требуется вход в кабинет' });

  if (method === 'GET' && url.pathname === '/api/office/updates') {
    return subscribeToOfficeUpdates(ctx.club.id, res);
  }

  if (method === 'GET' && url.pathname === '/api/doyle/snapshot') {
    return sendJson(res, 200, await readDoyleRows(ctx));
  }

  if (method === 'POST' && url.pathname === '/api/doyle/session') {
    const origin = (SECURE_COOKIES ? 'https://' : 'http://') + req.headers.host;
    if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
      throw new DomainError('Недопустимый источник запроса', 403);
    }
    if (!hasDoyleWorkspace(ctx)) throw new DomainError('Нет доступа к кабинету Doyle', 403);
    checkRateLimit('doyle-session:' + ctx.user.id, 12, 60_000);
    return sendJson(res, 200, await issueDoyleSession(ctx));
  }

  if (method === 'POST' && url.pathname === '/api/auth/switch-club') {
    const body = await readJson(req);
    await switchSessionClub(pg, rawSessionToken!, String(body.clubId || ''));
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && url.pathname === '/api/auth/accounts') {
    return sendJson(res, 200, await clubAccounts(pg, ctx));
  }
  if (method === 'DELETE' && url.pathname === '/api/auth/accounts') {
    const body = await readJson(req);
    const target = typeof body.id === 'string' && body.id ? { id: body.id }
      : typeof body.email === 'string' && body.email.trim() ? { email: body.email } : null;
    if (!target) throw new DomainError('Выберите учётную запись или приглашение', 400);
    await removeClubAccess(pg, ctx, target, ip);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && url.pathname === '/api/auth/invites') {
    const body = await readJson(req);
    const invite = await createInvite(pg, ctx, String(body.email || ''), body.role, body.tableNo, ip);
    return sendJson(res, 200, invite);
  }

  // Изолированный RLS-контекст: ВСЕ дальнейшие запросы физически видят ТОЛЬКО ctx.club.id
  const clubDb = pg.forClub(ctx.club.id);

  const tvIssue = /^\/api\/tournaments\/([a-zA-Z0-9_-]+)\/tv-token$/.exec(url.pathname);
  if (method === 'POST' && tvIssue) {
    const token = await issueTvToken(pg, ctx, tvIssue[1]);
    return sendJson(res, 200, { token });
  }

  const createMatch = url.pathname === '/api/clubs/' + ctx.club.id + '/tournaments';
  const tMatch = /^\/api\/tournaments\/([a-zA-Z0-9_-]+)(\/(?:commands|payments\.xlsx))?$/.exec(url.pathname);
  if (!tMatch && !createMatch) return sendJson(res, 404, { error: 'Страница не найдена' });

  const tournamentId = tMatch?.[1] ?? null;

  if (method === 'GET' && tournamentId && tMatch?.[2] === '/payments.xlsx') {
    if (ctx.memberRole !== 'owner') {
      throw new DomainError('Нет доступа к финансовому отчёту', 403);
    }
    const data = await snapshot(clubDb, ctx.session, tournamentId);
    const file = await paymentWorkbook(data);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('Оплаты — ' + data.tournament.name + '.xlsx').replaceAll("'", '%27'),
      'Cache-Control': 'no-store',
    });
    return res.end(file);
  }

  if (method === 'GET' && tournamentId && !tMatch?.[2]) {
    return sendJson(res, 200, await snapshot(clubDb, ctx.session, tournamentId));
  }

  if (method === 'POST' && (createMatch || tMatch?.[2] === '/commands')) {
    const body = await readJson(req);
    const action = body.action as Command | undefined;
    const cmdId = body.id;
    if (!action || typeof cmdId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(cmdId)) {
      throw new DomainError('Укажите идентификатор и действие', 400);
    }
    const result = await command(clubDb, ctx.session, tournamentId, cmdId, action);
    notifyOfficeUpdate(ctx.club.id);
    return sendJson(res, 200, result);
  }

  return sendJson(res, 405, { error: 'Метод не поддерживается' });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (url.pathname === '/doyle' || url.pathname.startsWith('/doyle/') || url.pathname === '/doyle-office.js') {
      await serveDoyle(req, res, url.pathname);
    } else {
      await serveStatic(res, url.pathname);
    }
  } catch (error) {
    if (!(error instanceof DomainError)) console.error(error);
    sendJson(res, error instanceof DomainError ? error.status : 500, {
      error: error instanceof DomainError ? error.message : 'Операция не выполнена. Попробуйте ещё раз',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OneTable server listening on http://${HOST}:${PORT}`);
});
