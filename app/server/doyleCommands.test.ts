import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { planDoyleCommand, type DoyleGame, type DoyleRoom } from './doyleCommands.ts';

const now = Date.UTC(2026, 10, 25, 19);
const fixture: DoyleGame = {
  id: 12, name: 'Тест', date: null, status: 'open', room_id: null, slots: 45,
  stack: 30_000, entry_fee: 1000, format: 'Deepstack', level_duration: null, late_reg: null,
  registrations: [{ player_id: 50, attendance: 'registered', doyle_players: { name: 'Игрок' } }],
};

test('Doyle: приход, R+, вылет и реэнтри обновляют совместимое состояние без потери данных', () => {
  const run = (room: DoyleRoom | undefined, action: Parameters<typeof planDoyleCommand>[2]) =>
    planDoyleCommand(fixture, room, action, 'test@example.com', now);
  const checkedIn = run(undefined, { type: 'checkIn', playerId: '50' });
  assert.deepEqual(checkedIn.attendance, { id: '50', status: 'present' });
  assert.ok(checkedIn.state);
  assert.equal(checkedIn.state.players?.[0].present, true);
  const room = { version: 4, state: { ...checkedIn.state, legacyField: 'keep' } };
  const plus = run(room, { type: 'adjustReentry', playerId: '50', delta: 1, expectedReentries: 0 });
  assert.ok(plus.state);
  assert.equal(plus.state.players?.[0].reentries, 1);
  assert.throws(() => run({ version: 5, state: plus.state }, { type: 'adjustReentry', playerId: '50', delta: 1, expectedReentries: 0 }));
  const bust = run({ version: 5, state: plus.state }, { type: 'bust', playerId: '50', knockouts: 2 });
  assert.ok(bust.state);
  assert.equal(bust.state.players?.[0].status, 'busted');
  const reentry = run({ version: 6, state: bust.state }, { type: 'reenter', playerId: '50' });
  assert.ok(reentry.state);
  assert.equal(reentry.state.players?.[0].status, 'playing');
  assert.equal(reentry.state.players?.[0].reentries, 2);
  assert.equal(reentry.state.players?.[0].ko, 2);
  assert.equal(reentry.state.legacyField, 'keep');
  assert.equal(reentry.state.stats?.alive, 1);
});

test('Doyle: SQL защищает версию комнаты, идемпотентность и доступ', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE rooms (room_id text PRIMARY KEY, state jsonb, branch text, display_token text, version bigint DEFAULT 0);
      CREATE TABLE doyle_tournaments (id bigint PRIMARY KEY, name text, status text, room_id text REFERENCES rooms,
        city text, date timestamptz, slots int, entry_fee int, stack int, format text);
      CREATE TABLE doyle_players (id bigint PRIMARY KEY);
      CREATE TABLE doyle_registrations (tournament_id bigint, player_id bigint, attendance text, source text,
        UNIQUE(tournament_id,player_id));
      INSERT INTO doyle_tournaments VALUES (12,'Тест','open',NULL,'MSK',NULL,45,1000,30000,'Deepstack');
      INSERT INTO doyle_players VALUES (50), (51);
      INSERT INTO doyle_registrations VALUES (12,50,'registered','manual');
    `);
    await db.exec(await readFile(new URL('../deploy/doyle-commands.sql', import.meta.url), 'utf8'));
    const sql = 'SELECT onetable_save_doyle_command(12,$1,$2,$3,$4,$5,$6,$7,$8,$9) AS status';
    const execute = async (...params: unknown[]) => (await db.query<{ status: string }>(sql, params)).rows[0].status;
    const save = [{ room_id: null, status: 'open' }, null, { players: [] }, {}, { id: '50', status: 'present' }, 'request1', 'checkIn', 'AB1234', 'screen-key'];
    await db.exec('SET ROLE anon');
    await assert.rejects(execute(...save), /permission denied/);
    await db.exec('SET ROLE service_role');
    assert.equal(await execute(...save), 'saved');
    assert.equal(await execute(...save), 'saved');
    const conflict = [{ room_id: 'AB1234', status: 'open' }, 1, {}, {}, null, 'request2', 'config', null, null];
    assert.equal(await execute(...conflict), 'conflict');
    assert.equal(await execute(...conflict.map((part, index) => index === 1 ? 0 : part)), 'saved');
    const registration = [{ room_id: 'AB1234' }, 0, null, {}, { id: '51', status: 'register' }, 'request3', 'register', null, null];
    assert.equal(await execute(...registration), 'saved');
    const cancellation = [{ room_id: 'AB1234' }, 0, null, {}, { id: '51', status: 'unregister' }, 'request4', 'unregister', null, null];
    assert.equal(await execute(...cancellation), 'saved');
    await db.exec('RESET ROLE');
    assert.equal((await db.query<{ attendance: string }>('SELECT attendance FROM doyle_registrations')).rows[0].attendance, 'present');
    assert.equal((await db.query('SELECT * FROM doyle_registrations')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM rooms')).rows.length, 1);
  } finally {
    await db.close();
  }
});
