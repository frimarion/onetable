import { doyleQueries, optionalDoyleResources, type DoyleResource, type DoyleRows } from '../shared/doyleQueries.ts';
import type { AuthContext } from './auth.ts';
import { DomainError } from './validation.ts';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const linkedUserId = process.env.DOYLE_ONETABLE_USER_ID;
const serviceKey = process.env.DOYLE_SERVICE_ROLE_KEY;
const doyleUserId = process.env.DOYLE_SUPABASE_USER_ID;
const workspaceDir = process.env.DOYLE_WORKSPACE_DIR;
const supabase = 'http://127.0.0.1:8000';
const pages = new Set(['tournaments.html', 'rooms.html', 'admin.html', 'crm.html']);
const clientInitializer = 'supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { global: { fetch: window.sbFetchFailover } })';

export function hasDoyleAccess(ctx: AuthContext): boolean {
  return Boolean(serviceKey && linkedUserId === ctx.user.id && ctx.club.id === 'doyle' && ctx.memberRole === 'owner');
}

export function hasDoyleWorkspace(ctx: AuthContext): boolean {
  return Boolean(workspaceDir && doyleUserId && hasDoyleAccess(ctx));
}

export async function doyleWorkspaceFile(file: string, scope: string) {
  const page = pages.has(file);
  const asset = /^(?:js|lib|assets|svg_playing_cards)\/(?:[\w-]+\/)*[\w.-]+\.(?:js|css|png|jpe?g|webp|ico|svg|woff2?|ogg|mp3|wav|m4a)$/i;
  if (!workspaceDir || (!page && !asset.test(file))) throw new DomainError('Страница не найдена', 404);
  let content: Buffer;
  try { content = await readFile(join(workspaceDir, file)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new DomainError(page ? 'Кабинет Doyle временно недоступен' : 'Файл не найден', page ? 503 : 404);
  }
  if (!page) return { content, extension: extname(file) };

  const html = content.toString('utf8');
  if (html.split(clientInitializer).length !== 2) {
    throw new DomainError('Эта версия кабинета Doyle требует обновления интеграции', 503);
  }
  const client = `window.openDoyleOffice(${JSON.stringify(scope)})`;
  const body = html
    .replace('</head>', '<script src="/doyle-office.js"></script></head>')
    .replace(clientInitializer, client)
    .replace('const base=location.origin+location.pathname.replace(/\\/[^\\/]*$/,"/");', 'const base="https://doylepoker.ru/";');
  return { content: body, extension: '.html' };
}

async function doyleRequest<T>(path: string, body?: object): Promise<T> {
  try {
    const headers = { apikey: serviceKey!, Authorization: 'Bearer ' + serviceKey!, 'Content-Type': 'application/json' };
    const response = await fetch(supabase + path, {
      headers, redirect: 'error', signal: AbortSignal.timeout(5000),
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json() as T;
  } catch {
    throw new DomainError('Не удалось войти в кабинет Doyle. Попробуйте ещё раз.', 502);
  }
}

type DoyleUser = {
  id: string;
  email: string;
  banned_until?: string | null;
};
type DoyleSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: DoyleUser;
};

let issuingSession: Promise<unknown> = Promise.resolve();

export async function issueDoyleSession(ctx: AuthContext): Promise<DoyleSession> {
  if (!hasDoyleWorkspace(ctx)) throw new DomainError('Нет доступа к кабинету Doyle', 403);

  // GoTrue keeps one outstanding magic link per account.
  const issue = issuingSession.then(async () => {
    const userPath = '/auth/v1/admin/users/' + encodeURIComponent(doyleUserId!);
    const [user, factors, profiles] = await Promise.all([
      doyleRequest<DoyleUser>(userPath),
      doyleRequest<{ status: string }[]>(userPath + '/factors'),
      doyleRequest<{ role: string; is_admin: boolean }[]>('/rest/v1/profiles?id=eq.' + encodeURIComponent(doyleUserId!) + '&select=role,is_admin'),
    ]);
    if (user.id !== doyleUserId || user.email?.toLowerCase() !== ctx.user.email.toLowerCase()
      || (user.banned_until && Date.parse(user.banned_until) > Date.now())
      || !Array.isArray(factors) || factors.some(factor => factor.status === 'verified')
      || !(profiles[0]?.is_admin || profiles[0]?.role === 'admin')) {
      throw new DomainError('Проверьте доступ связанной учётной записи в Doyle', 403);
    }
    const link = await doyleRequest<{ id: string; hashed_token: string }>('/auth/v1/admin/generate_link', { type: 'magiclink', email: user.email });
    if (link.id !== doyleUserId || !link.hashed_token) throw new DomainError('Не удалось подтвердить учётную запись Doyle', 502);
    const session = await doyleRequest<DoyleSession>('/auth/v1/verify', { type: 'magiclink', token_hash: link.hashed_token });
    if (session.user?.id !== doyleUserId || !session.access_token || !session.refresh_token) {
      throw new DomainError('Не удалось подтвердить сеанс Doyle', 502);
    }
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
      user: session.user,
    };
  });
  issuingSession = issue.catch(() => {});
  return issue;
}

export async function readDoyleRows(ctx: AuthContext): Promise<DoyleRows> {
  if (!hasDoyleAccess(ctx)) throw new DomainError('Нет доступа к данным Doyle', 403);

  const entries = await Promise.all((Object.keys(doyleQueries) as DoyleResource[]).map(async resource => {
    try {
      const response = await fetch(supabase + '/rest/v1/' + doyleQueries[resource], {
        headers: { apikey: serviceKey!, Authorization: 'Bearer ' + serviceKey! },
        redirect: 'error',
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid response');
      return [resource, rows] as const;
    } catch {
      if (optionalDoyleResources.has(resource)) return [resource, []] as const;
      throw new DomainError('Не удалось загрузить данные Doyle. Попробуйте ещё раз.', 502);
    }
  }));
  return Object.fromEntries(entries) as DoyleRows;
}
