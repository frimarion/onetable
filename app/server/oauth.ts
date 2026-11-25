import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from './validation.ts';

export type OAuthProvider = 'telegram' | 'vk' | 'yandex';

export type VerifiedIdentity = {
  provider: OAuthProvider;
  providerUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
};

export type OAuthProvidersStatus = {
  telegram: { enabled: boolean; botUsername: string };
  vk: { enabled: boolean };
  yandex: { enabled: boolean };
};

export const OAUTH_STATE_COOKIE = 'onetable_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

type PendingOAuth = {
  provider: 'vk' | 'yandex';
  mode: 'login' | 'link';
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
};

const pendingFlows = new Map<string, PendingOAuth>();

function prunePending(now: number) {
  for (const [key, item] of pendingFlows.entries()) {
    if (now - item.createdAt > STATE_TTL_MS) pendingFlows.delete(key);
  }
}

export function oauthProviderStatus(): OAuthProvidersStatus {
  const tgUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
  const tgToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const vkClientId = String(process.env.VK_CLIENT_ID || '').trim();
  const yaClientId = String(process.env.YANDEX_CLIENT_ID || '').trim();
  const yaSecret = String(process.env.YANDEX_CLIENT_SECRET || '').trim();
  return {
    telegram: { enabled: Boolean(tgUsername && tgToken), botUsername: tgUsername },
    vk: { enabled: Boolean(vkClientId) },
    yandex: { enabled: Boolean(yaClientId && yaSecret) },
  };
}

export function oauthStateCookieHeader(state: string, secure: boolean, clear = false): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=${clear ? '' : encodeURIComponent(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : 'Max-Age=600',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function verifyTelegramLogin(
  payload: Record<string, unknown>,
  botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  now = Date.now(),
): VerifiedIdentity {
  if (!botToken) throw new DomainError('Вход через Telegram не настроен на сервере', 503);
  const hash = String(payload.hash || '').trim();
  const id = String(payload.id ?? '').trim();
  const authDate = Number(payload.auth_date);
  if (!hash || !/^\d{1,20}$/.test(id) || !Number.isFinite(authDate)) {
    throw new DomainError('Некорректные данные авторизации Telegram', 400);
  }
  const ageMs = now - authDate * 1000;
  if (ageMs > 5 * 60 * 1000 || ageMs < -60_000) {
    throw new DomainError('Срок подписи Telegram истёк. Повторите вход.', 401);
  }

  const pairs: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'hash' || value === undefined || value === null || value === '') continue;
    pairs.push(`${key}=${String(value)}`);
  }
  pairs.sort();
  const checkString = pairs.join('\n');
  const secretKey = createHash('sha256').update(botToken, 'utf8').digest();
  const expected = createHmac('sha256', secretKey).update(checkString, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = /^[0-9a-f]{64}$/i.test(hash) ? Buffer.from(hash, 'hex') : Buffer.alloc(0);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new DomainError('Недействительная подпись Telegram', 401);
  }

  const firstName = String(payload.first_name || '').trim();
  const lastName = String(payload.last_name || '').trim();
  const username = String(payload.username || '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || (username ? '@' + username : 'Telegram #' + id);
  const avatarUrl = typeof payload.photo_url === 'string' && payload.photo_url.startsWith('https://')
    ? payload.photo_url.slice(0, 500) : '';

  return { provider: 'telegram', providerUserId: id, username, displayName, avatarUrl };
}

export function startOAuthFlow(
  provider: 'vk' | 'yandex',
  mode: 'login' | 'link',
  origin: string,
  returnTo = '/',
): { authorizeUrl: string; state: string } {
  const now = Date.now();
  prunePending(now);
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';

  if (provider === 'vk') {
    const clientId = String(process.env.VK_CLIENT_ID || '').trim();
    if (!clientId) throw new DomainError('Вход через VK ID не настроен на сервере', 503);
    const redirectUri = String(process.env.VK_REDIRECT_URI || '').trim() || `${origin}/api/auth/oauth/vk/callback`;
    pendingFlows.set(state, { provider, mode, codeVerifier, redirectUri, returnTo: safeReturn, createdAt: now });
    const url = new URL('https://id.vk.com/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('scope', 'vkid.personal_info');
    return { authorizeUrl: url.toString(), state };
  }

  const clientId = String(process.env.YANDEX_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YANDEX_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new DomainError('Вход через Яндекс ID не настроен на сервере', 503);
  const redirectUri = String(process.env.YANDEX_REDIRECT_URI || '').trim() || `${origin}/api/auth/oauth/yandex/callback`;
  pendingFlows.set(state, { provider, mode, codeVerifier, redirectUri, returnTo: safeReturn, createdAt: now });
  const url = new URL('https://oauth.yandex.ru/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (mode === 'link') url.searchParams.set('force_confirm', 'yes');
  return { authorizeUrl: url.toString(), state };
}

export async function completeOAuthFlow(
  provider: 'vk' | 'yandex',
  params: URLSearchParams,
  cookieState: string | undefined,
): Promise<{ mode: 'login' | 'link'; returnTo: string; identity: VerifiedIdentity }> {
  const errCode = params.get('error');
  if (errCode) {
    throw new DomainError(params.get('error_description') || 'Авторизация отменена', 400);
  }
  const state = params.get('state') || '';
  const code = params.get('code') || '';
  if (!state || !code || !cookieState || state !== cookieState) {
    throw new DomainError('Сессия входа устарела. Попробуйте ещё раз.', 400);
  }
  const pending = pendingFlows.get(state);
  pendingFlows.delete(state);
  if (!pending || pending.provider !== provider || Date.now() - pending.createdAt > STATE_TTL_MS) {
    throw new DomainError('Сессия входа истёкла. Попробуйте ещё раз.', 400);
  }

  if (provider === 'vk') {
    const clientId = String(process.env.VK_CLIENT_ID || '').trim();
    const deviceId = params.get('device_id') || '';
    if (!deviceId) throw new DomainError('VK ID не передал device_id', 400);
    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.codeVerifier,
      client_id: clientId,
      device_id: deviceId,
      redirect_uri: pending.redirectUri,
      state,
    });
    const tokenResp = await fetch('https://id.vk.com/oauth2/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenBody = (await tokenResp.json().catch(() => ({}))) as Record<string, unknown>;
    const accessToken = String(tokenBody.access_token || '');
    if (!tokenResp.ok || !accessToken) {
      throw new DomainError('Не удалось получить токен VK ID', 502);
    }

    const infoForm = new URLSearchParams({ client_id: clientId, access_token: accessToken });
    const infoResp = await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: infoForm.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const infoBody = (await infoResp.json().catch(() => ({}))) as { user?: Record<string, unknown> };
    const u = infoBody.user;
    const providerUserId = String(u?.user_id ?? tokenBody.user_id ?? '').trim();
    if (!infoResp.ok || !providerUserId) {
      throw new DomainError('Не удалось загрузить профиль VK ID', 502);
    }
    const first = String(u?.first_name || '').trim();
    const last = String(u?.last_name || '').trim();
    const displayName = [first, last].filter(Boolean).join(' ') || `VK #${providerUserId}`;
    const avatarUrl = typeof u?.avatar === 'string' && u.avatar.startsWith('https://') ? u.avatar.slice(0, 500) : '';
    return {
      mode: pending.mode,
      returnTo: pending.returnTo,
      identity: { provider: 'vk', providerUserId, username: `id${providerUserId}`, displayName, avatarUrl },
    };
  }

  // Яндекс ID
  const clientId = String(process.env.YANDEX_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YANDEX_CLIENT_SECRET || '').trim();
  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: pending.redirectUri,
  });
  const tokenResp = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenForm.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const tokenBody = (await tokenResp.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = String(tokenBody.access_token || '');
  if (!tokenResp.ok || !accessToken) {
    throw new DomainError('Не удалось получить токен Яндекс ID', 502);
  }
  const infoResp = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: 'OAuth ' + accessToken },
    signal: AbortSignal.timeout(10_000),
  });
  const info = (await infoResp.json().catch(() => ({}))) as Record<string, unknown>;
  const providerUserId = String(info.id ?? '').trim();
  if (!infoResp.ok || !providerUserId) {
    throw new DomainError('Не удалось загрузить профиль Яндекс ID', 502);
  }
  const username = String(info.login || '').trim();
  const displayName = String(info.display_name || info.real_name || username || `Яндекс #${providerUserId}`).trim();
  const avatarId = String(info.default_avatar_id || '').trim();
  const avatarUrl = avatarId && !info.is_avatar_empty
    ? `https://avatars.yandex.net/get-yapic/${encodeURIComponent(avatarId)}/islands-200`
    : '';
  return {
    mode: pending.mode,
    returnTo: pending.returnTo,
    identity: { provider: 'yandex', providerUserId, username, displayName, avatarUrl },
  };
}
