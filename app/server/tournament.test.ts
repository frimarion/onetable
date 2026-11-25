import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { seed, sessions } from './seed.ts';
import { command, snapshot } from './tournament.ts';
import { publicSchedule } from './definitions.ts';
import { onlineRegistration } from './registration.ts';
import { planSeating } from './seating.ts';
import { defaultConfig, formats } from '../shared/operations.ts';
import { matchesQuery } from '../shared/search.ts';
import { buildGuestSummaries, computeCrmAnalytics, computeRetention, periodBounds, selectBroadcastRecipients } from '../shared/crm.ts';

test('поиск игроков поддерживает транслит в обе стороны (кириллица и латиница)', () => {
  assert.equal(matchesQuery('alex volk', ['Александр Волков', '']), true);
  assert.equal(matchesQuery('maxim krylov', ['Максим Крылов', '']), true);
  assert.equal(matchesQuery('zaitsev', ['Роман Зайцев', '']), true);
  assert.equal(matchesQuery('shcherbakov', ['Щербаков', '']), true);
  assert.equal(matchesQuery('джокер', ['Иван Морозов', 'Joker']), true);
  assert.equal(matchesQuery('шарк', ['Иван Морозов', '@Shark']), true);
  assert.equal(matchesQuery('@shark', ['Иван Морозов', 'Shark']), true);
  assert.equal(matchesQuery('алекс', ['Иван', 'Alex_Pro']), true);
  assert.equal(matchesQuery('дойл', ['Клуб', 'Doyle']), true);
  assert.equal(matchesQuery('михаил', ['Mikhail', '']), true);
  assert.equal(matchesQuery('федоров', ['Артём Фёдоров', '']), true);
  assert.equal(matchesQuery('неизвестный', ['Александр Волков', 'Joker']), false);
});

test('авторассадка заполняет менее занятые столы и не назначает занятые места', () => {
  const seats = [1, 2].flatMap(tableNo => [1, 2].map(seatNo => ({ tableNo, seatNo })));
  assert.deepEqual(planSeating(seats, [seats[0]], ['a', 'b', 'c', 'd']), [
    { playerId: 'a', tableNo: 2, seatNo: 1 },
    { playerId: 'b', tableNo: 1, seatNo: 2 },
    { playerId: 'c', tableNo: 2, seatNo: 2 },
  ]);
});

test('архивный турнир открывается, если сохранённый уровень за пределами структуры', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);

  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const data = await snapshot(db, admin, 'doyle-past-1');
  assert.equal(data.tournament.state, 'finished');
  assert.equal(data.clock.level, data.structure.length - 1);
  assert.equal(data.clock.duration, data.structure.at(-1)?.duration);
});

test('прямая публикация и копирование недели создают новые турниры с чистым состоянием', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const other = sessions.find(item => item.token === 'vyatka-admin')!;
  const create = { type: 'createTournament', name: 'Воскресный турнир', publish: true } as const;
  await assert.rejects(command(db, admin, null, 'missing-date', create), { status: 400 });
  const action = { ...create, layout: 'club:Daily Tournament', startsAt: '2026-11-22T20:30:00.000Z', description: 'Вечерняя серия' };
  const source = await command(db, admin, null, 'direct-publish', action);
  assert.ok(source.tournamentId);
  assert.deepEqual(await command(db, admin, null, 'direct-publish', action), source);
  const id = source.tournamentId;
  assert.ok((await publicSchedule(db, 'doyle')).tournaments.some(item => item.id === id));
  await command(db, admin, id, 'source-register', { type: 'register', playerId: 'p1' });
  await command(db, admin, id, 'source-checkin', { type: 'checkIn', playerId: 'p1' });
  await command(db, admin, id, 'source-start', { type: 'start' });
  await command(db, admin, id, 'source-next', { type: 'nextLevel' });
  const before = await snapshot(db, admin, id);
  const copy = {
    type: 'copyTournamentWeek', sourceWeek: '2026-11-16', targetWeek: '2026-11-30', publish: false,
    tournaments: [{ sourceId: id, name: 'Копия', startsAt: '2026-12-06T20:30:00.000Z' }],
  } as const;
  const batch = { ...copy, tournaments: [...copy.tournaments] };
  await assert.rejects(command(db, other, null, 'outside-week', batch), { status: 404 });
  await assert.rejects(command(db, admin, null, 'bad-week-copy', { ...batch, tournaments: [batch.tournaments[0], { ...batch.tournaments[0], sourceId: 'missing-id' }] }), { status: 404 });
  assert.ok(!(await snapshot(db, admin, id)).schedule.some(item => item.name === 'Копия'));
  const result = await command(db, admin, null, 'copy-0001', batch);
  assert.deepEqual(await command(db, admin, null, 'copy-0001', batch), result);
  await assert.rejects(command(db, admin, null, 'copy-again', batch), { status: 409 });
  const saved = (await snapshot(db, admin, id)).schedule.find(item => item.name === 'Копия')!;
  const draft = await snapshot(db, admin, saved.id);
  assert.equal(draft.tournament.state, 'draft');
  assert.equal(draft.tournament.description, action.description);
  assert.deepEqual(draft.structure, before.structure);
  assert.deepEqual(draft.config, before.config);
  assert.equal(draft.clock.level, 0);
  assert.equal(draft.clock.remaining, before.structure[0].duration);
  assert.equal(draft.entries.length, 0);
  assert.ok(!draft.payments.some(item => item.tournamentId === saved.id));
  await command(db, admin, null, 'copy-publish', { ...batch, publish: true, tournaments: [{ ...batch.tournaments[0], name: 'Копия опубликована' }] });
  assert.ok((await publicSchedule(db, 'doyle')).tournaments.some(item => item.name === 'Копия опубликована'));
});

test('режим анте сохраняется в турнире и макете, а отключение не меняет таймер и суммы уровней', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const display = sessions.find(item => item.token === 'doyle-display')!;
  const id = 'doyle-main';
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const original = await snapshot(db, admin, id);
  assert.equal(original.config.anteEnabled, true);
  await send({ type: 'saveStructure', structure: original.structure, anteEnabled: false });
  await send({ type: 'saveConfig', name: original.tournament.name, config: original.config });
  const changed = await snapshot(db, admin, id);
  const tv = await snapshot(db, display, id);
  assert.equal(changed.config.anteEnabled, false);
  assert.deepEqual(changed.structure, original.structure);
  assert.deepEqual(changed.clock, original.clock);
  assert.equal(tv.config.anteEnabled, false);
  assert.ok(tv.structure.every(level => level.ante === 0));

  await send({ type: 'savePreset', name: 'Без анте', structure: original.structure, anteEnabled: false });
  const created = await command(db, admin, null, randomUUID(), { type: 'createTournament', name: 'Без анте', layout: 'club:Без анте' });
  assert.ok(created.tournamentId);
  const draft = await snapshot(db, admin, created.tournamentId);
  assert.equal(draft.config.anteEnabled, false);
  assert.deepEqual(draft.structure, original.structure);

  await send({ type: 'saveStructure', structure: original.structure, anteEnabled: true });
  const restored = await snapshot(db, display, id);
  assert.equal(restored.config.anteEnabled, true);
  assert.deepEqual(restored.structure, original.structure);
});

test('двойной и тройной аддоны заменяют начисление и дают фактический стек на ТВ', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const display = sessions.find(item => item.token === 'doyle-display')!;
  const id = 'doyle-main';
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const first = await snapshot(db, admin, id);
  const config = { ...first.config, addon: true, addon2Chips: 55_000, addon2Cost: 2500, addon3Chips: 90_000, addon3Cost: 3200 };
  await send({ type: 'saveConfig', name: first.tournament.name, config });
  await send({ type: 'addon', playerId: 'p1', tier: 2, expectedTier: 0 });
  await assert.rejects(send({ type: 'addon', playerId: 'p1', tier: 3, expectedTier: 0 }), { status: 409 });
  await send({ type: 'addon', playerId: 'p1', tier: 3, expectedTier: 2 });
  await send({ type: 'saveConfig', name: first.tournament.name, config: { ...config, addon3Cost: 5000, addon3Chips: 120_000 } });
  const next = await snapshot(db, admin, id);
  assert.equal(next.entries.find(item => item.playerId === 'p1')?.addonTier, 3);
  assert.deepEqual(next.payments.filter(item => item.playerId === 'p1' && item.kind === 'addon').map(item => item.amount), [3200]);
  assert.equal((await snapshot(db, display, id)).stats.addonChips, 90_000);
  await send({ type: 'addon', playerId: 'p1', tier: 0, expectedTier: 3 });
  const cleared = await snapshot(db, admin, id);
  assert.equal(cleared.stats.addonChips, 0);
  assert.ok(!cleared.payments.some(item => item.kind === 'addon'));
});

test('онлайн-запись соблюдает лимит и очередь, а освобождённое место назначается один раз', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const display = sessions.find(item => item.token === 'doyle-display')!;
  const { tournamentId: id } = await command(db, admin, null, randomUUID(), {
    type: 'createTournament', name: 'Лист ожидания', startsAt: '2026-12-12T16:05:00.000Z',
    config: { ...defaultConfig, registrationLimit: 2, lateRegistration: 1 },
  });
  assert.ok(id);
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const keys = Array.from({ length: 5 }, () => randomUUID());
  const online = (index: number, action = 'register') => onlineRegistration(db, 'doyle', id, { action, key: keys[index], name: 'Игрок ' + index });
  await assert.rejects(online(0), { status: 404 });
  await send({ type: 'publishTournament' });
  await send({ type: 'configureTables', count: 1, capacity: 2 });
  const direct = await Promise.all([online(0), online(1)]);
  assert.deepEqual(direct.map(item => item.state), ['registered', 'registered']);
  assert.deepEqual(await online(1), { open: true, full: true, state: 'registered', position: null });
  assert.equal((await online(2)).state, 'waiting');
  assert.equal((await online(3)).position, 2);
  assert.equal((await online(4)).position, 3);
  await online(4, 'cancel');
  const before = await snapshot(db, admin, id);
  assert.equal(before.entries.length, 2);
  assert.equal(before.waitlist.people.length, 2);
  assert.equal((await snapshot(db, display, id)).waitlist.people.length, 0);
  await send({ type: 'start' });
  for (const entry of before.entries) await send({ type: 'checkIn', playerId: entry.playerId });
  await send({ type: 'autoSeat' });
  const [absent, ready] = before.waitlist.people;
  await send({ type: 'setWaitlistArrival', playerId: ready.playerId, arrived: true });
  await assert.rejects(send({ type: 'admitWaitlist', playerId: ready.playerId }), { status: 409 });
  const seated = await snapshot(db, admin, id);
  const first = seated.entries[0];
  await send({ type: 'bust', playerId: first.playerId });
  await assert.rejects(send({ type: 'admitWaitlist', playerId: absent.playerId }), { status: 409 });
  const attempts = await Promise.allSettled([send({ type: 'admitWaitlist', playerId: ready.playerId }), send({ type: 'admitWaitlist', playerId: ready.playerId })]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  const current = await snapshot(db, admin, id);
  const joined = current.entries.find(item => item.playerId === ready.playerId);
  assert.equal(joined?.status, 'active');
  assert.equal(joined?.seatNo, first.seatNo);
  assert.equal(current.payments.filter(item => item.kind === 'buyin' && item.playerId === ready.playerId).length, 1);
  assert.equal((await online(3, 'status')).state, 'admitted');
  await assert.rejects(online(3, 'cancel'), { status: 409 });
  await send({ type: 'bust', playerId: joined!.playerId });
  await send({ type: 'nextLevel' });
  await send({ type: 'setWaitlistArrival', playerId: absent.playerId, arrived: true });
  assert.equal((await snapshot(db, admin, id)).waitlist.blocked, 'closed');
  await assert.rejects(send({ type: 'admitWaitlist', playerId: absent.playerId }), { status: 409 });
});

test('до старта отмена освобождает бронь для первого в очереди, а импорт сохраняет онлайн-записи', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const id = 'doyle-next';
  const get = () => snapshot(db, admin, id);
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const current = await get();
  await send({ type: 'saveConfig', name: current.tournament.name, config: { ...current.config, registrationLimit: 1 } });
  const join = (name: string, key = randomUUID()) => onlineRegistration(db, 'doyle', id, { action: 'register', key, name });
  const firstKey = randomUUID();
  const queuedKey = randomUUID();
  await join('Первая запись', firstKey);
  await join('Первая в очереди', queuedKey);
  await onlineRegistration(db, 'doyle', id, { action: 'cancel', key: firstKey });
  assert.equal((await join('Новая запись')).position, 2);
  const pending = await get();
  assert.equal(pending.waitlist.canAdmit, true);
  const [next, last] = pending.waitlist.people;
  await assert.rejects(send({ type: 'admitWaitlist', playerId: last.playerId }), { status: 409 });
  await send({ type: 'admitWaitlist', playerId: next.playerId });
  const after = await get();
  assert.equal(after.entries[0].status, 'registered');
  assert.equal(after.stats.entered, 0);
  assert.equal(after.payments.filter(item => item.tournamentId === id).length, 0);
  await send({ type: 'importNames', names: ['Запись администратора'], replace: true });
  assert.equal((await get()).entries.length, 2);
  assert.equal((await onlineRegistration(db, 'doyle', id, { action: 'status', key: queuedKey })).state, 'registered');
});

test('клубный макет копируется в черновик, а публикация открывает тот же турнир для регистрации и ТВ', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  await seed(db);
  await db.exec("ALTER TABLE tournaments DROP CONSTRAINT tournaments_state_check; ALTER TABLE tournaments ADD CONSTRAINT tournaments_state_check CHECK (state IN ('scheduled','live','finished'))");
  await db.exec(schema);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const other = sessions.find(item => item.token === 'vyatka-admin')!;
  const display = sessions.find(item => item.token === 'doyle-display')!;
  const config = { ...defaultConfig, seating: false, buyIn: 2300 };
  await command(db, admin, 'doyle-main', 'save-layout', { type: 'savePreset', name: 'Субботний', structure: formats.Turbo, config });

  const create = { type: 'createTournament', name: 'Субботний турнир', layout: 'club:Субботний' } as const;
  await assert.rejects(command(db, other, null, 'create-0001', create), { status: 404 });
  await assert.rejects(command(db, display, null, 'create-0001', create), { status: 403 });
  const first = await command(db, admin, null, 'create-0001', create);
  assert.deepEqual(await command(db, admin, null, 'create-0001', create), first);
  assert.ok(first.tournamentId);
  const id = first.tournamentId;
  const get = () => snapshot(db, admin, id);
  const draft = await get();
  assert.equal(draft.tournament.state, 'draft');
  assert.equal(draft.schedule.filter(item => item.name === create.name).length, 1);
  assert.equal(draft.config.buyIn, 2300);
  assert.equal(draft.clock.remaining, 600);
  assert.deepEqual(draft.structure, formats.Turbo);
  assert.equal(draft.journal.length, 1);
  await command(db, admin, 'doyle-main', 'delete-layout', { type: 'deletePreset', name: 'Субботний' });
  assert.equal((await get()).clock.remaining, 600);
  const published = await publicSchedule(db, 'doyle');
  assert.equal(published.tournaments.some(item => item.id === id), false);
  assert.equal(published.tournaments.find(item => item.id === 'doyle-next')?.state, 'scheduled');
  await assert.rejects(snapshot(db, other, id), { status: 404 });
  await assert.rejects(snapshot(db, display, id), { status: 404 });
  await assert.rejects(command(db, admin, id, 'publish-0001', { type: 'publishTournament' }), { status: 400 });
  await assert.rejects(command(db, admin, id, 'register-0001', { type: 'register', playerId: 'p1' }), { status: 409 });
  await assert.rejects(command(db, admin, id, 'start-0001', { type: 'start' }), { status: 409 });

  const update = {
    type: 'updateTournament', name: 'Субботний турнир · финал', startsAt: '2026-12-12T16:05:00.000Z',
    description: 'Турнир выходного дня', layout: draft.tournament.layout, config: draft.config,
    structure: draft.structure.map((level, index) => index === 0 ? { ...level, duration: 900 } : level),
  } as const;
  await assert.rejects(command(db, admin, id, 'invalid-edit', { ...update, startsAt: '2026-02-30T16:05:00.000Z' }), { status: 400 });
  assert.equal((await get()).tournament.name, create.name);
  await command(db, admin, id, 'edit-0001', update);
  assert.equal((await get()).clock.remaining, 900);
  await command(db, admin, id, 'publish-0001', { type: 'publishTournament' });
  assert.equal((await publicSchedule(db, 'doyle')).tournaments.find(item => item.id === id)?.description, update.description);
  assert.equal((await publicSchedule(db, 'vyatka')).tournaments.some(item => item.id === id), false);
  await command(db, admin, id, 'register-0001', { type: 'register', playerId: 'p1' });
  await command(db, admin, id, 'edit-0002', { ...update, name: 'Клубный финал' });
  await command(db, admin, id, 'start-0001', { type: 'start' });
  await command(db, admin, id, 'timer-0001', { type: 'toggleClock' });
  const play = await get();
  const tv = await snapshot(db, display, id);
  assert.equal(play.entries[0].playerId, 'p1');
  assert.equal(tv.stats.registered, 1);
  assert.equal(tv.tournament.id, id);
  assert.equal(tv.tournament.name, 'Клубный финал');
  assert.equal(tv.clock.startedAt, play.clock.startedAt);
  assert.equal(tv.clock.duration, 900);
  assert.equal((await snapshot(db, admin, 'doyle-main')).tournament.name, 'Doyle Deepstack');
});

test('дилер работает со своим столом, реэнтри и начисление атомарны, клубы изолированы', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const profile = (token: string) => sessions.find(session => session.token === token)!;
  const id = 'doyle-main';
  const admin = profile('doyle-admin');
  const dealer = profile('doyle-dealer-1');
  const tv = profile('doyle-display');
  await assert.rejects(snapshot(db, profile('vyatka-admin'), id), { status: 404 });
  await assert.rejects(command(db, profile('vyatka-admin'), id, 'outside-club', { type: 'autoSeat' }), { status: 404 });
  await assert.rejects(command(db, dealer, id, 'outside-table', { type: 'bust', playerId: 'p6' }), { status: 403 });
  await assert.rejects(command(db, tv, id, 'display-write', { type: 'autoSeat' }), { status: 403 });
  assert.equal((await snapshot(db, tv, id)).entries.length, 0);
  assert.equal((await snapshot(db, dealer, id)).roster.length, 0);
  assert.equal((await snapshot(db, dealer, id)).payments.length, 0);

  await command(db, dealer, id, 'confirm-seat', { type: 'confirmSeat', playerId: 'p1' });
  assert.equal((await snapshot(db, admin, id)).entries.find(p => p.playerId === 'p1')!.confirmed, true);
  await command(db, dealer, id, 'bust-player', { type: 'bust', playerId: 'p1' });
  assert.equal((await snapshot(db, dealer, id)).entries.find(p => p.playerId === 'p1')!.tableNo, null);
  const reentry = { type: 'reenter', playerId: 'p1' } as const;
  const [first, second] = await Promise.all([
    command(db, dealer, id, 'reentry-0001', reentry),
    command(db, dealer, id, 'reentry-0001', reentry),
  ]);
  assert.deepEqual(first, second);
  const next = await snapshot(db, admin, id);
  assert.equal(next.entries.find(p => p.playerId === 'p1')!.reentries, 2);
  assert.equal(next.payments.filter(p => p.playerId === 'p1' && p.kind === 'reentry').length, 2);
  await assert.rejects(command(db, dealer, id, 'reentry-0001', { type: 'bust', playerId: 'p1' }), { status: 409 });
  const contenders = await Promise.allSettled([
    command(db, admin, id, 'seat-player-1', { type: 'assign', playerId: 'p1', tableNo: 1, seatNo: 1 }),
    command(db, admin, id, 'seat-player-2', { type: 'assign', playerId: 'p16', tableNo: 1, seatNo: 1 }),
  ]);
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  await command(db, admin, id, 'auto-seating', { type: 'autoSeat' });
  const filled = await snapshot(db, admin, id);
  assert.equal(filled.stats.seated, filled.stats.active);
  await command(db, admin, id, 'payment-cash', { type: 'payment', playerId: 'p1', amount: 1500 });
  assert.equal((await snapshot(db, admin, id)).payments.filter(p => p.playerId === 'p1' && p.kind === 'payment').length, 2);
});


test('турнирный пульт управляет уровнями, рассадкой, тарифами, кассой и ТВ', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(session => session.token === 'doyle-admin')!;
  const tv = sessions.find(session => session.token === 'doyle-display')!;
  const id = 'doyle-main';
  let expectedSequence = 0;
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, 'operation-' + ++expectedSequence, action);
  const get = () => snapshot(db, admin, id);
  await assert.rejects(send({ type: 'configureTables', count: 2, capacity: 8 }), { status: 409 });
  await send({ type: 'configureTables', count: 20, capacity: 10 });
  assert.equal((await get()).tables.length, 20);
  await assert.rejects(send({ type: 'configureTables', count: 21, capacity: 8 }), { status: 400 });
  await send({ type: 'configureTables', count: 4, capacity: 8 });
  await send({ type: 'swapSeats', playerId: 'p1', withPlayerId: 'p6' });
  assert.equal((await get()).entries.find(p => p.playerId === 'p1')!.tableNo, 2);
  await send({ type: 'shuffleSeating' });
  const seated = await get();
  assert.equal(seated.stats.seated, 17);
  assert.equal(new Set(seated.entries.filter(p => p.tableNo).map(p => p.tableNo + '/' + p.seatNo)).size, 17);
  await send({ type: 'displayMode', mode: 'seating' });
  const tvSeating = await snapshot(db, tv, id);
  assert.equal(tvSeating.entries.length, 17);
  assert.equal(tvSeating.roster.length, 0);
  assert.equal(tvSeating.payments.length, 0);
  await send({ type: 'clearSeating' });
  assert.equal((await get()).stats.seated, 0);
  await send({ type: 'autoSeat' });
  const original = await get();
  await send({ type: 'clockControl', operation: 'plus', revision: original.revision });
  assert.equal((await get()).clock.remaining, original.clock.remaining + 60);
  await assert.rejects(send({ type: 'clockControl', operation: 'minus', revision: original.revision }), { status: 409 });
  await send({ type: 'clockControl', operation: 'break', revision: (await get()).revision });
  assert.equal((await snapshot(db, tv, id)).clock.manualBreak, true);
  const initialBreak = (await get()).clock.duration;
  await send({ type: 'clockControl', operation: 'plus', revision: (await get()).revision });
  assert.equal((await get()).clock.duration, initialBreak + 60);
  await send({ type: 'clockControl', operation: 'break', revision: (await get()).revision });
  assert.equal((await get()).clock.remaining, original.clock.remaining + 60);
  const structure = original.structure.map((level, index) => index === 4 ? { ...level, duration: 600 } : level);
  await send({ type: 'saveStructure', structure });
  await send({ type: 'savePreset', name: 'Пилот', structure });
  assert.ok((await get()).presets.some(preset => preset.name === 'Пилот'));
  await assert.rejects(send({ type: 'saveStructure', structure: structure.slice(0, 2) }), { status: 409 });

  await send({ type: 'setTariff', playerId: 'p18', rate: 50 });
  await send({ type: 'checkIn', playerId: 'p18' });
  let account = (await get()).payments.filter(item => item.playerId === 'p18');
  assert.equal(account.find(item => item.kind === 'buyin')!.amount, 750);
  await send({ type: 'payment', playerId: 'p18', amount: 750, method: 'card' });
  account = (await get()).payments.filter(item => item.playerId === 'p18');
  const payment = account.find(item => item.kind === 'payment')!;
  assert.equal(payment.method, 'card');
  await send({ type: 'voidPayment', paymentId: payment.id });
  assert.equal((await get()).payments.some(item => item.id === payment.id), false);
  await send({ type: 'bust', playerId: 'p18' });
  await send({ type: 'setFinishPlace', playerId: 'p18', place: 19 });
  assert.equal((await get()).results.find(item => item.playerId === 'p18')!.place, 19);
  await send({ type: 'undoBust', playerId: 'p18' });
  assert.equal((await get()).entries.find(item => item.playerId === 'p18')!.status, 'active');
});

test('автопереход восстанавливает истёкший таймер по серверным часам', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(session => session.token === 'doyle-admin')!;
  const id = 'doyle-main';
  await db.query('UPDATE tournaments SET level=0,remaining=5,started_at=$2 WHERE id=$1', [id, Date.now() - 10000]);
  const first = await snapshot(db, admin, id);
  assert.equal(first.clock.level, 1);
  const next = await snapshot(db, admin, id);
  assert.equal(next.clock.level, 1);
  assert.equal(next.revision, first.revision);
});

test('касса учитывает способ, остаток, отмену, льготы и погашение прошлых долгов', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(session => session.token === 'doyle-admin')!;
  const model = await import('../shared/payments.ts');
  const id = 'doyle-main';
  let sequence = 0;
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, 'cash-flow-' + ++sequence, action);
  const get = () => snapshot(db, admin, id);
  const playerId = 'p18';
  const ledger = async (tournamentId = id) => (await get()).payments.filter(item => item.playerId === playerId && item.tournamentId === tournamentId);
  const currentBalance = async () => model.amountDue(await ledger());
  await send({ type: 'checkIn', playerId });
  assert.equal(await currentBalance(), 1500);
  const parallel = await Promise.allSettled([
    send({ type: 'settleBalance', playerId, method: 'card', expectedDue: 1500 }),
    send({ type: 'settleBalance', playerId, method: 'cash', expectedDue: 1500 }),
  ]);
  assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await currentBalance(), 0);
  const receipt = (await ledger()).find(item => item.kind === 'payment')!;
  await send({ type: 'changePaymentMethod', paymentId: receipt.id, method: 'transfer' });
  assert.equal((await ledger()).find(item => item.id === receipt.id)!.method, 'transfer');
  await send({ type: 'voidPayment', paymentId: receipt.id });
  assert.equal(await currentBalance(), 1500);
  await send({ type: 'settleBalance', playerId, method: 'cash', expectedDue: 1500, amount: 500 });
  assert.equal(await currentBalance(), 1000);
  await assert.rejects(send({ type: 'clearPayments', playerId, paymentIds: [receipt.id] }), { status: 409 });
  await send({ type: 'compEntry', playerId, enabled: true });
  assert.equal(await currentBalance(), -500);
  await send({ type: 'setTariff', playerId, rate: 50 });
  assert.equal((await ledger()).find(item => item.kind === 'buyin')!.waived, true);
  await send({ type: 'compEntry', playerId, enabled: false });
  assert.equal(await currentBalance(), 250);
  const before = await get();
  await send({ type: 'saveConfig', name: before.tournament.name, config: { ...before.config, addon: true } });
  await send({ type: 'compAddon', playerId, enabled: true });
  assert.equal(await currentBalance(), 250);
  assert.equal((await get()).entries.find(item => item.playerId === playerId)!.addon, true);
  await send({ type: 'clearPayments', playerId, resetTerms: true, paymentIds: (await ledger()).filter(item => item.kind === 'payment').map(item => item.id) });
  assert.equal(await currentBalance(), 1500);
  assert.equal((await get()).entries.find(item => item.playerId === playerId)!.addon, false);

  await db.query("UPDATE tournaments SET state='finished' WHERE id='doyle-next'");
  await db.query("INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time) VALUES ('doyle','doyle-next',$1,700,'buyin',$2)", [playerId, Date.now()]);
  await send({ type: 'settleOldDebts', playerId, method: 'prior', debts: [{ id: 'doyle-next', amount: 700 }] });
  const historic = await ledger('doyle-next');
  assert.equal(model.amountDue(historic), 0);
  assert.equal(historic.find(item => item.kind === 'payment')!.collectedAtTournament, id);
  assert.equal(historic.find(item => item.kind === 'payment')!.method, 'prior');
  await send({ type: 'voidPayment', paymentId: historic.find(item => item.kind === 'payment')!.id });
  assert.equal(model.amountDue(await ledger('doyle-next')), 700);
});

test('режим без рассадки сохраняет места и даёт обратимые отметки игроков', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(session => session.token === 'doyle-admin')!;
  const dealer = sessions.find(session => session.token === 'doyle-dealer-1')!;
  const tv = sessions.find(session => session.token === 'doyle-display')!;
  const id = 'doyle-main';
  let sequence = 0;
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, 'attendance-' + ++sequence, action);
  const get = () => snapshot(db, admin, id);
  await send({ type: 'displayMode', mode: 'seating' });
  await send({ type: 'setSeatingEnabled', enabled: false });
  assert.equal((await get()).tables.length, 0);
  assert.equal((await get()).stats.seated, 0);
  assert.equal((await get()).entries.find(item => item.playerId === 'p1')!.tableNo, null);
  assert.equal((await snapshot(db, tv, id)).display.mode, 'clock');
  assert.equal((await snapshot(db, dealer, id)).entries.length, 0);
  await assert.rejects(send({ type: 'autoSeat' }), { status: 409 });
  await assert.rejects(command(db, dealer, id, 'dealer-disabled-1', { type: 'bust', playerId: 'p1' }), { status: 403 });

  const playerId = 'p18';
  await send({ type: 'checkIn', playerId });
  const first = await get();
  await send({ type: 'saveConfig', name: first.tournament.name, config: { ...first.config, addon: true, seating: true } });
  assert.equal((await get()).config.seating, false);
  await send({ type: 'addon', playerId, enabled: true });
  await send({ type: 'adjustReentry', playerId, delta: 1, expectedReentries: 0 });
  await assert.rejects(send({ type: 'adjustReentry', playerId, delta: 1, expectedReentries: 0 }), { status: 409 });
  await send({ type: 'adjustReentry', playerId, delta: -1, expectedReentries: 1 });
  await send({ type: 'payment', playerId, amount: 500, method: 'cash' });
  await send({ type: 'checkOut', playerId });
  const absent = await get();
  assert.equal(absent.entries.find(item => item.playerId === playerId)!.status, 'registered');
  assert.equal(absent.visits.some(item => item.playerId === playerId), false);
  assert.deepEqual(absent.payments.filter(item => item.playerId === playerId).map(item => item.kind), ['payment']);
  await send({ type: 'checkIn', playerId });
  const returned = await get();
  const ledger = returned.payments.filter(item => item.playerId === playerId);
  assert.equal(ledger.filter(item => item.kind === 'buyin').length, 1);
  assert.equal(ledger.filter(item => item.kind === 'addon').length, 1);
  assert.equal(ledger.filter(item => item.kind === 'payment').length, 1);
  assert.equal(returned.visits.filter(item => item.playerId === playerId).length, 1);
  assert.equal(returned.journal.some(item => item.label.includes('отметка прихода снята')), true);
  assert.equal(returned.journal.some(item => item.label.includes('реэнтри отменено')), true);

  await send({ type: 'setSeatingEnabled', enabled: true });
  assert.equal((await get()).entries.find(item => item.playerId === 'p1')!.tableNo, 1);
  await send({ type: 'createTournament', name: 'Без рассадки' });
  const created = (await get()).schedule.find(item => item.name === 'Без рассадки')!;
  assert.equal((await snapshot(db, admin, created.id)).config.seating, false);
});

test('очередь защищает от повторной записи, compAddon сохраняет купленный аддон, а Excel совпадает с кассой', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const id = 'doyle-main';
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const get = () => snapshot(db, admin, id);

  // 1. Запись из CRM игрока, стоящего в листе ожидания, даёт 409, а не 500
  const queued = await get();
  await send({ type: 'saveConfig', name: queued.tournament.name, config: { ...queued.config, registrationLimit: 1, addon: true, addon2Chips: 55_000, addon2Cost: 2500 } });
  await onlineRegistration(db, 'doyle', id, { action: 'register', key: randomUUID(), name: 'Игрок из очереди' });
  const queuedPlayer = (await get()).waitlist.people[0];
  await assert.rejects(send({ type: 'register', playerId: queuedPlayer.playerId }), { status: 409 });

  // 2. Отмена compAddon на купленном двойном аддоне возвращает его в платный, а выданный с нуля — удаляет
  await send({ type: 'addon', playerId: 'p1', tier: 2, expectedTier: 0 });
  await send({ type: 'compAddon', playerId: 'p1', enabled: true });
  assert.equal((await get()).payments.find(item => item.playerId === 'p1' && item.kind === 'addon')?.waived, true);
  await send({ type: 'compAddon', playerId: 'p1', enabled: false });
  const afterPaidComp = await get();
  const p1 = afterPaidComp.entries.find(item => item.playerId === 'p1')!;
  assert.equal(p1.addon, true);
  assert.equal(p1.addonTier, 2);
  assert.equal(p1.addonChips, 55_000);
  const p1Addon = afterPaidComp.payments.find(item => item.playerId === 'p1' && item.kind === 'addon')!;
  assert.equal(p1Addon.waived, false);
  assert.equal(p1Addon.amount, 2500);

  await send({ type: 'compAddon', playerId: 'p2', enabled: true });
  assert.equal((await get()).entries.find(item => item.playerId === 'p2')!.addon, true);
  await send({ type: 'compAddon', playerId: 'p2', enabled: false });
  const afterFreeComp = await get();
  assert.equal(afterFreeComp.entries.find(item => item.playerId === 'p2')!.addon, false);
  assert.equal(afterFreeComp.payments.some(item => item.playerId === 'p2' && item.kind === 'addon'), false);

  // 3. Касса в Excel совпадает с UI при погашении прошлых долгов и prior-зачётах
  await db.query("UPDATE tournaments SET state='finished' WHERE id='doyle-next'");
  await db.query("INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time) VALUES ('doyle','doyle-next','p18',700,'buyin',$1),('doyle','doyle-next','p19',900,'buyin',$1)", [Date.now()]);
  await send({ type: 'checkIn', playerId: 'p18' });
  await send({ type: 'settleBalance', playerId: 'p18', method: 'card', expectedDue: 1500 });
  await send({ type: 'settleOldDebts', playerId: 'p18', method: 'cash', debts: [{ id: 'doyle-next', amount: 700 }] });
  await send({ type: 'settleOldDebts', playerId: 'p19', method: 'prior', debts: [{ id: 'doyle-next', amount: 900 }] });

  const snap = await get();
  const { isCashReceiptFor } = await import('../shared/payments.ts');
  const { paymentWorkbook } = await import('./paymentWorkbook.ts');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await paymentWorkbook(snap) as never);
  const sheet = wb.getWorksheet('Оплаты')!;
  const num = (col: number) => {
    const val = sheet.getRow(4).getCell(col).value;
    return typeof val === 'object' && val && 'formula' in val ? Number(val.result ?? 0) : Number(val ?? 0);
  };
  const receipts = snap.payments.filter(item => isCashReceiptFor(item, id));
  const expectedReceived = receipts.reduce((sum, item) => sum + item.amount, 0);
  const expectedCard = receipts.filter(item => item.method === 'card').reduce((sum, item) => sum + item.amount, 0);
  const expectedCash = receipts.filter(item => item.method === 'cash').reduce((sum, item) => sum + item.amount, 0);
  const expectedTransfer = receipts.filter(item => item.method === 'transfer').reduce((sum, item) => sum + item.amount, 0);
  assert.equal(num(9), expectedReceived);
  assert.equal(num(11), expectedCard);
  assert.equal(num(12), expectedCash);
  assert.equal(num(13), expectedTransfer);
  assert.equal(num(15), 700);
});

test('вылет в нокаут-турнире сохраняет нокауты, а swapOutcome исправляет порядок и перепутанных игроков', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const id = 'doyle-main';
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const get = () => snapshot(db, admin, id);

  const initial = await get();
  await send({ type: 'saveConfig', name: initial.tournament.name, config: { ...initial.config, knockout: true } });
  const p2Seat = initial.entries.find(item => item.playerId === 'p2')!;
  const p3Seat = initial.entries.find(item => item.playerId === 'p3')!;

  await send({ type: 'bust', playerId: 'p1', knockouts: 3 });
  await send({ type: 'bust', playerId: 'p2', knockouts: 1 });
  const afterBusts = await get();
  assert.equal(afterBusts.entries.find(item => item.playerId === 'p1')!.knockouts, 3);
  assert.equal(afterBusts.entries.find(item => item.playerId === 'p2')!.knockouts, 1);
  const placeBefore = (pid: string) => afterBusts.results.find(item => item.playerId === pid)!.place;
  const p1Place = placeBefore('p1');
  const p2Place = placeBefore('p2');
  assert.ok(p1Place! > p2Place!);

  // Обмен местами двух вылетевших
  await send({ type: 'swapOutcome', playerId: 'p1', withPlayerId: 'p2' });
  const afterSwapOut = await get();
  assert.equal(afterSwapOut.results.find(item => item.playerId === 'p1')!.place, p2Place);
  assert.equal(afterSwapOut.results.find(item => item.playerId === 'p2')!.place, p1Place);

  // Обмен вылетевшего p2 с играющим p3 (перепутали игроков)
  await send({ type: 'swapOutcome', playerId: 'p2', withPlayerId: 'p3' });
  const afterSwapActive = await get();
  const p2Now = afterSwapActive.entries.find(item => item.playerId === 'p2')!;
  const p3Now = afterSwapActive.entries.find(item => item.playerId === 'p3')!;
  assert.equal(p2Now.status, 'active');
  assert.equal(p2Now.tableNo, p3Seat.tableNo);
  assert.equal(p2Now.seatNo, p3Seat.seatNo);
  assert.equal(p3Now.status, 'out');
  assert.equal(p3Now.tableNo, null);
  assert.equal(afterSwapActive.results.find(item => item.playerId === 'p3')!.place, p1Place);
  assert.ok(p2Seat.tableNo !== null);

  // Редактирование нокаутов после завершения турнира
  await send({ type: 'finish' });
  await send({ type: 'knockouts', playerId: 'p1', value: 4 });
  assert.equal((await get()).entries.find(item => item.playerId === 'p1')!.knockouts, 4);
});

test('макеты рейтинга изолированы по клубам, сохраняются в турнире и рассчитывают все режимы', async t => {
  const { baseRatingPresets, calculateRating } = await import('../shared/rating.ts');
  const classic = baseRatingPresets.find(item => item.name === 'Классический (проценты)')!.scheme;
  const resClassic = calculateRating({ ...classic, guarantee: 1000, itmMode: 'fixed', itmFixedPlaces: 3, roundStep: 10 }, 20, 5);
  assert.equal(resClassic.total, 1000);
  assert.equal(resClassic.knockoutPool, 0);
  assert.deepEqual(resClassic.payouts, [500, 300, 200]);

  const league = baseRatingPresets.find(item => item.name === 'Клубная лига (фикс за места)')!.scheme;
  const resLeague = calculateRating({ ...league, multiplier: 2, fixedPlaces: [100, 80, 60] }, 2, 0);
  assert.deepEqual(resLeague.payouts, [200, 160]);
  assert.equal(resLeague.participationPoints, 5);

  const none = baseRatingPresets.find(item => item.name === 'Без рейтинга')!.scheme;
  assert.deepEqual(calculateRating(none, 20, 5).payouts, []);

  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const other = sessions.find(item => item.token === 'vyatka-admin')!;
  const tv = sessions.find(item => item.token === 'doyle-display')!;
  const id = 'doyle-main';
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);

  const customScheme = { ...classic, guarantee: 1500, knockoutMode: 'per_ko' as const, knockoutPoints: 10 };
  await send({ type: 'saveRatingPreset', name: 'Вечерняя лига', scheme: customScheme });
  assert.equal((await snapshot(db, admin, id)).ratingPresets.some(item => item.name === 'Вечерняя лига'), true);
  assert.equal((await snapshot(db, other, 'vyatka-main')).ratingPresets.some(item => item.name === 'Вечерняя лига'), false);

  const current = await snapshot(db, admin, id);
  await send({ type: 'saveConfig', name: current.tournament.name, config: { ...current.config, ratingPreset: 'club:Вечерняя лига', rating: customScheme } });
  const tvSnap = await snapshot(db, tv, id);
  assert.equal(tvSnap.config.rating?.guarantee, 1500);
  assert.equal(tvSnap.config.rating?.knockoutMode, 'per_ko');
  assert.equal(tvSnap.config.rating?.knockoutPoints, 10);

  await send({ type: 'deleteRatingPreset', name: 'Вечерняя лига' });
  assert.equal((await snapshot(db, admin, id)).ratingPresets.some(item => item.name === 'Вечерняя лига'), false);

  // Аддон доступен до старта турнира (scheduled), если игрок уже отмечен пришедшим
  const nextId = 'doyle-next';
  const sendNext = (action: Parameters<typeof command>[4]) => command(db, admin, nextId, randomUUID(), action);
  const nextSnap = await snapshot(db, admin, nextId);
  await sendNext({ type: 'saveConfig', name: nextSnap.tournament.name, config: { ...nextSnap.config, addon: true } });
  await sendNext({ type: 'register', playerId: 'p1' });
  await sendNext({ type: 'checkIn', playerId: 'p1' });
  await sendNext({ type: 'addon', playerId: 'p1', tier: 1, expectedTier: 0 });
  const withAddon = await snapshot(db, admin, nextId);
  assert.equal(withAddon.entries.find(item => item.playerId === 'p1')!.addon, true);
  assert.equal(withAddon.payments.some(item => item.tournamentId === nextId && item.playerId === 'p1' && item.kind === 'addon'), true);
});

test('посадка из листа ожидания позволяет выбрать конкретный свободный бокс и отклоняет занятый', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const id = 'doyle-next';
  const send = (action: Parameters<typeof command>[4]) => command(db, admin, id, randomUUID(), action);
  const initial = await snapshot(db, admin, id);
  await send({ type: 'configureTables', count: 2, capacity: 4 });
  await send({ type: 'saveConfig', name: initial.tournament.name, config: { ...initial.config, registrationLimit: 2 } });
  const join = (name: string) => onlineRegistration(db, 'doyle', id, { action: 'register', key: randomUUID(), name });
  await join('Первый');
  await join('Второй');
  await join('Из очереди');
  await send({ type: 'start' });
  const liveSnap = await snapshot(db, admin, id);
  for (const entry of liveSnap.entries) await send({ type: 'checkIn', playerId: entry.playerId });
  await send({ type: 'assign', playerId: liveSnap.entries[0].playerId, tableNo: 1, seatNo: 1 });
  await send({ type: 'assign', playerId: liveSnap.entries[1].playerId, tableNo: 2, seatNo: 3 });
  const queued = liveSnap.waitlist.people[0];
  await send({ type: 'setWaitlistArrival', playerId: queued.playerId, arrived: true });
  await send({ type: 'bust', playerId: liveSnap.entries[0].playerId });

  // Занятый бокс должен отклоняться
  await assert.rejects(send({ type: 'admitWaitlist', playerId: queued.playerId, tableNo: 2, seatNo: 3 }), { status: 409 });

  // Свободный выбранный бокс на столе 2, бокс 4 — игрок садится именно туда
  await send({ type: 'admitWaitlist', playerId: queued.playerId, tableNo: 2, seatNo: 4 });
  const after = await snapshot(db, admin, id);
  const seated = after.entries.find(item => item.playerId === queued.playerId);
  assert.equal(seated?.status, 'active');
  assert.equal(seated?.tableNo, 2);
  assert.equal(seated?.seatNo, 4);
});


test('CRM: аналитика, удержание, карточка гостя (контакты, заметки, переписки) и Telegram-рассылки с воронкой', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const id = 'doyle-main';

  const initial = await snapshot(db, admin, id);
  const bounds = periodBounds('month', initial.serverTime);
  const analytics = computeCrmAnalytics(
    initial.roster,
    initial.crm.registrations,
    initial.visits,
    initial.payments,
    initial.schedule,
    bounds.start,
    bounds.end,
  );
  assert.ok(analytics.attendedGuests > 0);
  assert.ok(analytics.revenue > 0);
  assert.ok(analytics.avgCheck > 0);
  assert.ok(analytics.sources.length > 0);
  assert.ok(analytics.registrationConversion > 0 && analytics.registrationConversion <= 100);

  const guests = buildGuestSummaries(
    initial.roster,
    initial.crm.registrations,
    initial.visits,
    initial.payments,
    initial.serverTime,
  );
  const retention = computeRetention(guests, initial.visits, initial.serverTime);
  assert.ok(retention.twoPlusVisitsCount > 0);
  assert.ok(retention.segments.inactive14.length > 0);
  assert.ok(retention.segments.inactive30.length > 0);
  assert.ok(retention.avgVisitsPerGuest >= 1);

  // Редактирование контактов, добавление заметки и переписки
  await command(db, admin, id, 'crm-update-p1', {
    type: 'updatePlayer',
    playerId: 'p1',
    name: 'Александр Волков',
    nickname: 'Volk',
    phone: '+7 999 123-45-67',
    telegram: '@volk_poker',
    instagram: '@volk.ig',
    telegramConsent: true,
    source: 'Telegram',
    tags: 'VIP, Регуляр',
    note: 'Обновлённая заметка',
  });
  await command(db, admin, id, 'crm-add-note', { type: 'addPlayerNote', playerId: 'p1', body: 'Просил место у дилера' });
  await command(db, admin, id, 'crm-add-msg', {
    type: 'addPlayerMessage',
    playerId: 'p1',
    direction: 'in',
    channel: 'telegram',
    body: 'Запишите на пятницу!',
  });

  // Проверка фильтрации получателей по согласию и отправки рассылки
  const afterEdit = await snapshot(db, admin, id);
  const updatedP1 = afterEdit.roster.find(p => p.id === 'p1')!;
  assert.equal(updatedP1.phone, '+7 999 123-45-67');
  assert.equal(updatedP1.telegram, '@volk_poker');
  assert.equal(updatedP1.instagram, '@volk.ig');
  assert.ok(afterEdit.crm.notes.some(n => n.playerId === 'p1' && n.body === 'Просил место у дилера'));
  assert.ok(afterEdit.crm.messages.some(m => m.playerId === 'p1' && m.body === 'Запишите на пятницу!'));

  const updatedGuests = buildGuestSummaries(
    afterEdit.roster,
    afterEdit.crm.registrations,
    afterEdit.visits,
    afterEdit.payments,
    afterEdit.serverTime,
  );
  const sel = selectBroadcastRecipients(updatedGuests, 'inactive_14', afterEdit.serverTime);
  assert.ok(sel.eligible.length > 0);
  assert.ok(sel.eligible.every(g => g.player.telegramConsent && g.player.telegram.trim() !== ''));

  // Попытка отправить гостю без согласия (p25) отклоняется
  await assert.rejects(
    command(db, admin, id, 'crm-bc-no-consent', {
      type: 'sendBroadcast',
      title: 'Тест без согласия',
      segment: 'all',
      message: 'Привет',
      recipientIds: ['p25'],
    }),
    { status: 400 },
  );

  // Отправка валидной рассылки по сегменту + фиксация перехода
  await command(db, admin, id, 'crm-bc-send', {
    type: 'sendBroadcast',
    title: 'Реактивация',
    segment: 'inactive_14',
    tournamentId: 'doyle-next',
    message: 'Ждём вас на Вечернем турнире!',
    linkUrl: 'https://t.me/doyle_poker_bot?start=next',
    recipientIds: sel.eligible.map(g => g.player.id),
  });
  const afterBc = await snapshot(db, admin, id);
  const sentBc = afterBc.crm.broadcasts.find(b => b.title === 'Реактивация');
  assert.ok(sentBc);
  assert.equal(sentBc.sentCount, sel.eligible.length);

  await command(db, admin, id, 'crm-bc-click', {
    type: 'trackBroadcastClick',
    broadcastId: sentBc.id,
    playerId: sel.eligible[0].player.id,
  });
  const afterClick = await snapshot(db, admin, id);
  assert.equal(afterClick.crm.broadcasts.find(b => b.id === sentBc.id)?.clicksCount, 1);
  // В переписке получателя появилось исходящее сообщение от рассылки
  assert.ok(afterClick.crm.messages.some(m => m.playerId === sel.eligible[0].player.id && m.body.includes('Ждём вас на Вечернем турнире!')));
  // В демо-рассылке bc-friday корректно считается воронка и выручка по пришедшим получателям
  const demoBc = afterClick.crm.broadcasts.find(b => b.id === 'bc-friday');
  assert.ok(demoBc && demoBc.attendedCount === 9 && demoBc.revenue === 18000);
});


test('CRM amoCRM: смена этапов воронки, события таймлайна, задачи и автопереходы при записи/приходе', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const admin = sessions.find(item => item.token === 'doyle-admin')!;
  const id = 'doyle-main';

  // Ручная смена этапа воронки создаёт событие в таймлайне
  await command(db, admin, id, 'stage-move-1', { type: 'setPlayerStage', playerId: 'p24', stage: 'registered' });
  let snap = await snapshot(db, admin, id);
  assert.equal(snap.roster.find(p => p.id === 'p24')?.stage, 'registered');
  assert.ok(snap.crm.events.some(ev => ev.playerId === 'p24' && ev.summary.includes('Записался на турнир')));

  // Создание, выполнение и удаление задачи
  const dueAt = snap.serverTime + 3_600_000;
  await command(db, admin, id, 'task-add-1', {
    type: 'addCrmTask',
    playerId: 'p24',
    kind: 'call',
    title: 'Уточнить участие в субботу',
    assignee: 'Менеджер Анна',
    dueAt,
  });
  snap = await snapshot(db, admin, id);
  const task = snap.crm.tasks.find(item => item.playerId === 'p24' && item.title === 'Уточнить участие в субботу');
  assert.ok(task && task.completedAt === null);

  await command(db, admin, id, 'task-done-1', {
    type: 'completeCrmTask',
    taskId: task.id,
    result: 'Придёт с другом',
  });
  snap = await snapshot(db, admin, id);
  const doneTask = snap.crm.tasks.find(item => item.id === task.id);
  assert.ok(doneTask && doneTask.completedAt !== null && doneTask.result === 'Придёт с другом');
  assert.ok(snap.crm.events.some(ev => ev.playerId === 'p24' && ev.summary.includes('Придёт с другом')));

  // Автопереход: новый лид (p25) записывается на турнир -> registered, приходит -> first_visit
  assert.equal(snap.roster.find(p => p.id === 'p25')?.stage, 'lead');
  await command(db, admin, id, 'auto-reg-p25', { type: 'register', playerId: 'p25' });
  snap = await snapshot(db, admin, id);
  assert.equal(snap.roster.find(p => p.id === 'p25')?.stage, 'registered');
  await command(db, admin, id, 'auto-checkin-p25', { type: 'checkIn', playerId: 'p25' });
  snap = await snapshot(db, admin, id);
  assert.equal(snap.roster.find(p => p.id === 'p25')?.stage, 'first_visit');
});

test('роли клуба ограничивают турнирные действия и данные на сервере', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await seed(db);
  const id = 'doyle-main';
  const demo = sessions.find(session => session.token === 'doyle-admin')!;
  const owner = { ...demo, token: 'owner', memberRole: 'owner' } as const;
  const manager = { ...demo, token: 'manager', memberRole: 'admin' } as const;
  const floor = { ...demo, token: 'floor', role: 'floor', memberRole: 'floor' } as const;
  const dealer = { ...demo, token: 'dealer', role: 'dealer', memberRole: 'dealer', table: 1 } as const;
  const send = (session: typeof owner | typeof manager | typeof floor | typeof dealer, action: Parameters<typeof command>[4]) =>
    command(db, session, id, randomUUID(), action);

  const current = await snapshot(db, owner, id);
  assert.ok(current.payments.length);
  assert.deepEqual((await snapshot(db, manager, id)).payments, []);
  assert.deepEqual((await snapshot(db, floor, id)).roster, []);
  assert.deepEqual((await snapshot(db, dealer, id)).tables.map(table => table.number), [1]);
  await assert.rejects(send(manager, { type: 'payment', playerId: 'p1', amount: 500 }), { status: 403 });
  await assert.rejects(send(floor, { type: 'finish' }), { status: 403 });
  await assert.rejects(send(dealer, { type: 'toggleClock' }), { status: 403 });
  await assert.rejects(send(dealer, { type: 'swapSeats', playerId: 'p1', withPlayerId: 'p6' }), { status: 403 });
  await assert.rejects(send(dealer, { type: 'addon', playerId: 'p6', tier: 1 }), { status: 403 });

  await send(manager, { type: 'assign', playerId: 'p1', tableNo: 1, seatNo: 7 });
  await send(dealer, { type: 'dealerSeat', playerId: 'p1', seatNo: 8 });
  await send(floor, { type: 'adjustReentry', playerId: 'p1', delta: 1 });
  const next = await snapshot(db, owner, id);
  const player = next.entries.find(entry => entry.playerId === 'p1')!;
  assert.equal(player.seatNo, 8);
  assert.equal(player.reentries, current.entries.find(entry => entry.playerId === 'p1')!.reentries + 1);
});
