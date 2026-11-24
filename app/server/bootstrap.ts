/**
 * CLI для инициализации продакшен-базы OneTable и выдачи инвайтов новым клубам.
 *
 * Примеры запуска на VPS (из папки app/):
 *   DATABASE_URL=postgres://... node server/bootstrap.ts init-schema
 *   DATABASE_URL=postgres://... node server/bootstrap.ts create-club doyle "Doyle Poker Club" "Москва" "#2BD98A"
 *   DATABASE_URL=postgres://... node server/bootstrap.ts create-owner doyle owner@club.ru "Александр" "StrongPass123"
 *   DATABASE_URL=postgres://... node server/bootstrap.ts invite doyle admin@club.ru admin
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PgAdapter } from './pgAdapter.ts';
import { hashPassword, randomToken, sha256 } from './auth.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Задайте DATABASE_URL');
  process.exit(1);
}

const pg = new PgAdapter(url);
const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'init-schema') {
    const baseSql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    const prodSql = await readFile(new URL('./schema_prod.sql', import.meta.url), 'utf8');
    await pg.exec(baseSql);
    await pg.exec(prodSql);
    console.log('Схема и RLS-политики успешно применены.');
  } else if (cmd === 'create-club') {
    const [id, name, venue = '', accent = '#2BD98A'] = args;
    if (!id || !name) throw new Error('Формат: create-club <id> <name> [venue] [accent]');
    await pg.systemTransaction(async tx => {
      await tx.query(
        'INSERT INTO clubs (id,name,venue,accent) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, venue=EXCLUDED.venue, accent=EXCLUDED.accent',
        [id, name, venue, accent],
      );
    });
    console.log(`Клуб «${name}» (${id}) создан.`);
  } else if (cmd === 'create-owner') {
    const [clubId, email, name, password] = args;
    if (!clubId || !email || !name || !password) {
      throw new Error('Формат: create-owner <clubId> <email> <name> <password>');
    }
    const normEmail = email.trim().toLowerCase();
    const now = Date.now();
    await pg.systemTransaction(async tx => {
      const existing = (await tx.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=$1', [normEmail])).rows[0];
      const userId = existing?.id ?? ('u_' + randomUUID());
      if (!existing) {
        await tx.query(
          'INSERT INTO users (id,email,name,password_hash,created_at) VALUES ($1,$2,$3,$4,$5)',
          [userId, normEmail, name, hashPassword(password), now],
        );
      }
      await tx.query(
        `INSERT INTO club_members (club_id,user_id,role,active,created_at)
         VALUES ($1,$2,'owner',true,$3)
         ON CONFLICT (club_id,user_id) DO UPDATE SET role='owner', active=true`,
        [clubId, userId, now],
      );
    });
    console.log(`Владелец ${normEmail} добавлен в клуб ${clubId}.`);
  } else if (cmd === 'invite') {
    const [clubId, email, role = 'owner', table] = args;
    if (!clubId || !email || !['owner', 'admin', 'floor', 'dealer'].includes(role)) {
      throw new Error('Формат: invite <clubId> <email> [owner|admin|floor|dealer] [номер стола дилера]');
    }
    const tableNo = role === 'dealer' ? Number(table) : null;
    if (tableNo !== null && (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 20)) throw new Error('Укажите номер стола дилера (1–20)');
    const token = randomToken(32);
    const now = Date.now();
    await pg.systemTransaction(async tx => {
      await tx.query(
        'INSERT INTO club_invites (token_hash,club_id,email,role,table_no,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [sha256(token), clubId, email.trim().toLowerCase(), role, tableNo, now, now + 24 * 60 * 60 * 1000],
      );
    });
    console.log(`Одноразовая ссылка-приглашение (действует 24 часа):\nhttps://app.onetable.pro/?invite=${token}`);
  } else {
    console.log('Команды: init-schema | create-club | create-owner | invite');
  }
} finally {
  await pg.close();
}
