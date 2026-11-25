import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyTelegramLogin } from './oauth.ts';
import { validateAvatarUrl } from './auth.ts';

test('OAuth Telegram: проверяет HMAC-SHA256 подпись и отклоняет подделку/просрочку', () => {
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

test('Аватарка: пропускает лёгкий WebP/JPEG/PNG и отклоняет тяжёлые/невалидные строки', () => {
  const valid = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
  assert.equal(validateAvatarUrl(valid), valid);
  assert.equal(validateAvatarUrl(''), '');
  assert.throws(() => validateAvatarUrl('https://evil.example/x.png'), /Поддерживаются только изображения/);
  assert.throws(() => validateAvatarUrl('data:image/svg+xml;base64,PHN2Zz4='), /Поддерживаются только изображения/);
  assert.throws(() => validateAvatarUrl('data:image/png;base64,' + 'A'.repeat(160_000)), /слишком тяжёлая/);
});
