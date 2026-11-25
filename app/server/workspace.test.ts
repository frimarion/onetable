import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { resolveSession, sha256, switchSessionClub } from './auth.ts';
import { issueDoyleReadTicket, redeemDoyleReadTicket } from './doyleGateway.ts';
import type { PgAdapter } from './pgAdapter.ts';
import { workspaceClubId, workspacePath } from '../shared/workspace.ts';

test('Адрес кабинета однозначно задаёт клуб', () => {
  assert.equal(workspaceClubId(workspacePath('doyle')), 'doyle');
  assert.equal(workspaceClubId('/clubs/white-felt/'), 'white-felt');
  assert.equal(workspaceClubId('/'), undefined);
  assert.equal(workspaceClubId('/doyle/tournaments.html'), undefined);
});

test('Пропуск для чтения Doyle одноразовый и действует 30 секунд', () => {
  const session = 'fixture-session';
  const ticket = issueDoyleReadTicket(session, 1000);
  assert.notEqual(ticket, session);
  assert.equal(redeemDoyleReadTicket(ticket, 1000), undefined);
  assert.equal(redeemDoyleReadTicket(`Bearer ${ticket}`, 30_999), session);
  assert.equal(redeemDoyleReadTicket(`Bearer ${ticket}`, 30_999), undefined);
  const expired = issueDoyleReadTicket(session, 1000);
  assert.equal(redeemDoyleReadTicket(`Bearer ${expired}`, 31_000), undefined);
});

test('Клуб из адреса сохраняет роли и изоляцию вкладок при смене клуба по умолчанию', async () => {
  const db = new PGlite();
  const pg = { systemTransaction: db.transaction.bind(db) } as PgAdapter;
  const token = 'workspace-fixture-token';
  try {
    await db.exec(`
      CREATE TABLE clubs(id text, name text, venue text, accent text);
      CREATE TABLE users(id text, email text, name text, avatar_url text DEFAULT '', is_superadmin boolean, disabled boolean);
      CREATE TABLE club_members(club_id text, user_id text, role text, active boolean, table_no int);
      CREATE TABLE auth_sessions(token_hash text, user_id text, club_id text, expires_at bigint);
      INSERT INTO clubs VALUES ('doyle','Doyle Poker Club','Москва','#2bd98a'),
        ('royal','Royal Poker Club','Казань','#2bd98a'), ('other','Другой клуб','Казань','#2bd98a');
      INSERT INTO users VALUES ('user','owner@example.com','Владелец','',true,false);
      INSERT INTO club_members VALUES ('doyle','user','owner',true,NULL), ('royal','user','dealer',true,3),
        ('other','user','admin',false,NULL);
    `);
    await db.query('INSERT INTO auth_sessions VALUES ($1,$2,$3,$4)', [sha256(token), 'user', 'doyle', Date.now() + 60_000]);

    assert.equal((await resolveSession(pg, token))?.club.id, 'doyle');
    const dealer = await resolveSession(pg, token, 'royal');
    assert.equal(dealer?.session.table, 3);
    assert.equal(dealer?.session.role, 'dealer');
    assert.equal((await resolveSession(pg, token))?.club.id, 'doyle');

    await switchSessionClub(pg, token, 'royal');
    assert.equal((await resolveSession(pg, token))?.club.id, 'royal');
    assert.equal((await resolveSession(pg, token, 'doyle'))?.memberRole, 'owner');
    assert.notEqual((await resolveSession(pg, token, 'doyle'))?.session.token, dealer?.session.token);
    await assert.rejects(resolveSession(pg, token, 'other'), { status: 403 });
    await assert.rejects(resolveSession(pg, token, 'missing'), { status: 403 });
    assert.equal(await resolveSession(pg, undefined, 'royal'), null);
  } finally {
    await db.close();
  }
});
