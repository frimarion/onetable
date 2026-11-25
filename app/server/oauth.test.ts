import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { test } from 'node:test';
import { oauthProviderStatus, startOAuthFlow, verifyTelegramIdToken, verifyTelegramLogin } from './oauth.ts';
import { validateAvatarUrl } from './auth.ts';

test('OAuth Telegram Widget: проверяет HMAC-SHA256 подпись и отклоняет подделку/просрочку', () => {
  const token = '123456:TEST_BOT_TOKEN';
  const now = Date.UTC(2026, 10, 25, 12, 0, 0);
  const authDate = Math.floor(now / 1000) - 30;
  const payload = { id: 777123, first_name: 'Александр', username: 'alex_poker', auth_date: authDate };
  const check = Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHash('sha256').update(token, 'utf8').digest();
  const hash = createHmac('sha256', secret).update(check, 'utf8').digest('hex');

  const verified = verifyTelegramLogin({ ...payload, hash }, token, now);
  assert.equal(verified.provider, 'telegram');
  assert.equal(verified.providerUserId, '777123');
  assert.equal(verified.username, 'alex_poker');
  assert.equal(verified.displayName, 'Александр');

  assert.throws(() => verifyTelegramLogin({ ...payload, hash: '0'.repeat(64) }, token, now), /Недействительная подпись/);
  assert.throws(() => verifyTelegramLogin({ ...payload, hash }, token, now + 10 * 60 * 1000), /Срок подписи/);
});

test('OAuth Telegram OIDC: проверяет RS256 id_token по JWK и отклоняет подделку/чужой aud/просрочку', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'tg-key-1', alg: 'RS256', use: 'sig' };
  const now = Date.UTC(2026, 10, 25, 12, 0, 0);
  const exp = Math.floor(now / 1000) + 300;

  const makeJwt = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: 'tg-key-1' }) => {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${p}`, 'utf8'), privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  };

  const token = makeJwt({
    iss: 'https://oauth.telegram.org',
    aud: '99887766',
    sub: '777123',
    id: 777123,
    name: 'Александр Иванов',
    preferred_username: 'alex_poker',
    picture: 'https://t.me/i/userpic/320/alex.jpg',
    exp,
  });

  const verified = verifyTelegramIdToken(token, '99887766', [jwk], now);
  assert.equal(verified.provider, 'telegram');
  assert.equal(verified.providerUserId, '777123');
  assert.equal(verified.username, 'alex_poker');
  assert.equal(verified.displayName, 'Александр Иванов');
  assert.equal(verified.avatarUrl, 'https://t.me/i/userpic/320/alex.jpg');

  assert.throws(() => verifyTelegramIdToken(token, 'other_client', [jwk], now), /другого приложения/);
  assert.throws(() => verifyTelegramIdToken(token, '99887766', [jwk], now + 600_000), /истёк/);
  assert.throws(() => verifyTelegramIdToken(token + 'x', '99887766', [jwk], now), /Недействительная подпись/);
});

test('startOAuthFlow и oauthProviderStatus: формируют актуальные URL с PKCE для Telegram, VK ID и Яндекс ID', () => {
  const prev = {
    TELEGRAM_CLIENT_ID: process.env.TELEGRAM_CLIENT_ID,
    TELEGRAM_CLIENT_SECRET: process.env.TELEGRAM_CLIENT_SECRET,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    VK_CLIENT_ID: process.env.VK_CLIENT_ID,
    YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
    YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
  };
  try {
    process.env.TELEGRAM_CLIENT_ID = 'tg-client-1';
    process.env.TELEGRAM_CLIENT_SECRET = 'tg-secret-1';
    process.env.VK_CLIENT_ID = '51999999';
    process.env.YANDEX_CLIENT_ID = 'ya-client-1';
    process.env.YANDEX_CLIENT_SECRET = 'ya-secret-1';

    const status = oauthProviderStatus();
    assert.equal(status.telegram.enabled, true);
    assert.equal(status.telegram.mode, 'oidc');
    assert.equal(status.vk.enabled, true);
    assert.equal(status.yandex.enabled, true);

    const tg = startOAuthFlow('telegram', 'login', 'https://app.onetable.pro', '/clubs/doyle');
    const tgUrl = new URL(tg.authorizeUrl);
    assert.equal(tgUrl.origin + tgUrl.pathname, 'https://oauth.telegram.org/auth');
    assert.equal(tgUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(tgUrl.searchParams.get('scope'), 'openid profile');
    assert.equal(tgUrl.searchParams.get('redirect_uri'), 'https://app.onetable.pro/api/auth/oauth/telegram/callback');

    const vk = startOAuthFlow('vk', 'login', 'https://app.onetable.pro', '/');
    const vkUrl = new URL(vk.authorizeUrl);
    assert.equal(vkUrl.origin + vkUrl.pathname, 'https://id.vk.ru/authorize');
    assert.equal(vkUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok((vkUrl.searchParams.get('state') || '').length >= 32);
    assert.equal(vkUrl.searchParams.get('redirect_uri'), 'https://app.onetable.pro/api/auth/oauth/vk/callback');

    const ya = startOAuthFlow('yandex', 'link', 'https://app.onetable.pro', '/clubs/doyle');
    const yaUrl = new URL(ya.authorizeUrl);
    assert.equal(yaUrl.origin + yaUrl.pathname, 'https://oauth.yandex.ru/authorize');
    assert.equal(yaUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(yaUrl.searchParams.get('force_confirm'), 'yes');
    assert.equal(yaUrl.searchParams.get('redirect_uri'), 'https://app.onetable.pro/api/auth/oauth/yandex/callback');

    delete process.env.TELEGRAM_CLIENT_ID;
    delete process.env.TELEGRAM_CLIENT_SECRET;
    process.env.TELEGRAM_BOT_USERNAME = '@onetable_bot';
    process.env.TELEGRAM_BOT_TOKEN = '123:abc';
    const widgetStatus = oauthProviderStatus();
    assert.equal(widgetStatus.telegram.mode, 'widget');
    assert.equal(widgetStatus.telegram.botUsername, 'onetable_bot');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('Аватарка: пропускает лёгкий WebP/JPEG/PNG и отклоняет тяжёлые/невалидные строки', () => {
  const valid = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
  assert.equal(validateAvatarUrl(valid), valid);
  assert.equal(validateAvatarUrl(''), '');
  assert.throws(() => validateAvatarUrl('https://evil.example/x.png'), /Поддерживаются только изображения/);
  assert.throws(() => validateAvatarUrl('data:image/svg+xml;base64,PHN2Zz4='), /Поддерживаются только изображения/);
  assert.throws(() => validateAvatarUrl('data:image/png;base64,' + 'A'.repeat(160_000)), /слишком тяжёлая/);
});
