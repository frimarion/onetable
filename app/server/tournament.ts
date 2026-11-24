import { randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { remaining, type Command, type CommandResult, type Entry, type JournalItem, type Payment, type Player, type Session, type Snapshot, type Status, type Table, type Tournament, type Visit } from '../shared/model.ts';
import type { RatingPreset } from '../shared/rating.ts';
import { planSeating } from './seating.ts';
import { defaultConfig, methods, registrationOpen, type CashCommand, type OperationsCommand, type Preset } from '../shared/operations.ts';
import { assign, charge, operate, operationTypes, seatsOf } from './operations.ts';
import { clock, configOf, displayOf, refreshClock, structureOf, type StateRow } from './runtime.ts';
import { cashOperation, cashTypes, postPayment } from './cash.ts';
import { DomainError, field, integer } from './validation.ts';
import { copyTournamentWeek, createTournament, tournamentColumns, tournamentRow, updateDefinition } from './definitions.ts';
import { queueOperation, registrationAvailability, waitlist } from './registration.ts';
import { crmOperation, crmTypes, emptyCrmData, isPipelineStage, loadCrmData } from './crm.ts';
import { pipelineStageMap, type CrmCommand, type PipelineStage } from '../shared/crm.ts';
export { DomainError } from './validation.ts';

type EntryRow = Entry & { lastTable: number | null };
type Timed<T> = Omit<T, 'time'> & { time: string };

async function tournament(tx: Transaction, session: Session, id: string, lock = false) {
  const row = await tournamentRow(tx, session.club.id, id, lock);
  if (row.state === 'draft' && session.role !== 'admin') throw new DomainError('Турнир не найден', 404);
  return row;
}

async function entries(tx: Transaction, id: string) {
  return (await tx.query<EntryRow>(
    `SELECT e.player_id AS "playerId",p.name,p.nickname,e.status,e.table_no AS "tableNo",e.seat_no AS "seatNo",e.last_table AS "lastTable",e.reentries,e.confirmed,e.addon,
      e.addon_tier AS "addonTier", CASE WHEN NOT e.addon THEN 0 ELSE COALESCE(e.addon_chips,(t.config->>'addonChips')::int,$2) END AS "addonChips",
      e.knockouts,e.rate,e.busted_at AS "bustedAt" FROM entries e JOIN players p ON (p.club_id,p.id)=(e.club_id,e.player_id)
      JOIN tournaments t ON t.id=e.tournament_id WHERE e.tournament_id=$1 AND e.queued_at IS NULL ORDER BY p.name,p.id`,
    [id, defaultConfig.addonChips])).rows.map(entry => ({ ...entry, bustedAt: entry.bustedAt === null ? null : Number(entry.bustedAt) }));
}

function timed<T extends { time: number }>(rows: Timed<T>[]): T[] {
  return rows.map(row => ({ ...row, time: Number(row.time) }) as T);
}

export async function snapshot(db: PGlite, session: Session, id: string): Promise<Snapshot> {
  return db.transaction(async tx => {
    const row = await tournament(tx, session, id, true);
    const now = Date.now();
    await refreshClock(tx, row, now);
    const all = await entries(tx, id);
    const admin = session.role === 'admin';
    const dealer = session.role === 'dealer';
    const floor = session.role === 'floor';
    const staff = session.memberRole !== undefined;
    const finances = admin && session.memberRole !== 'admin';
    const dealerDesk = dealer && staff && session.table !== null;
    const display = displayOf(row);
    const config = configOf(row);
    if (!config.seating && display.mode === 'seating') display.mode = 'clock';
    const publicSeating = session.role === 'display' && display.mode === 'seating';
    const attended = all.filter(entry => entry.status !== 'registered');
    const activeCount = all.length ? all.filter(entry => entry.status === 'active').length : row.manualStats.entered + row.manualStats.reentries - row.manualStats.out;
    const out = all.filter(entry => entry.status === 'out')
      .sort((a, b) => (b.bustedAt ?? 0) - (a.bustedAt ?? 0) || a.playerId.localeCompare(b.playerId));
    const results = [...all.filter(entry => entry.status === 'active').map(entry => ({ ...entry, place: activeCount === 1 && (out.length > 0 || row.state === 'finished') ? 1 : null })),
      ...out.map((entry, index) => ({ ...entry, place: activeCount + index + 1 }))]
      .map(({ playerId, name, nickname, place, knockouts }) => ({ playerId, name: nickname || name, place, knockouts }));
    const schedule = admin || floor || dealerDesk ? (await tx.query<Tournament>(`SELECT ${tournamentColumns} FROM tournaments WHERE club_id=$1 AND ($2::boolean OR state<>'draft')
      ORDER BY CASE state WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,starts_at NULLS LAST,name,id`, [session.club.id, admin])).rows : [];
    const tables = !config.seating || (dealer && session.table === null) || (session.role === 'display' && !publicSeating) ? [] : (await tx.query<Table>(
      'SELECT table_no AS number,count(*)::int AS capacity FROM seats WHERE tournament_id=$1 AND ($2::int IS NULL OR table_no=$2) GROUP BY table_no ORDER BY table_no',
      [id, session.table])).rows;
    const crm = admin ? await loadCrmData(tx, session.club.id) : emptyCrmData;
    const dealerQueue = dealerDesk && config.seating && tables.length ? all
      .filter(entry => entry.tableNo === null && (entry.status === 'registered' || (entry.status === 'active' && (entry.lastTable === null || entry.lastTable === session.table))))
      .map(({ playerId, name, nickname }) => ({ playerId, name, nickname })) : undefined;
    return {
      tournament: { id, name: row.name, clubId: row.clubId, state: row.state, startsAt: row.startsAt, description: row.description, layout: admin ? row.layout : null },
      schedule, club: session.club, role: session.role, revision: row.revision, serverTime: now, clock: clock(row, now),
      structure: admin || config.anteEnabled ? structureOf(row) : structureOf(row).map(level => ({ ...level, ante: 0 })),
      display, manualStats: admin ? row.manualStats : { entered: 0, reentries: 0, out: 0 },
      presets: admin ? (await tx.query<Preset>('SELECT name,structure,config FROM blind_presets WHERE club_id=$1 ORDER BY name', [row.clubId])).rows : [],
      ratingPresets: admin ? (await tx.query<RatingPreset>('SELECT name,scheme FROM rating_presets WHERE club_id=$1 ORDER BY name', [row.clubId])).rows : [],
      config: admin ? config : { ...defaultConfig, seating: config.seating, anteEnabled: config.anteEnabled, reentryFee: dealer && !staff ? config.reentryFee : 0,
        ...(dealerDesk ? { addon: config.addon, addon2Chips: config.addon2Chips, addon3Chips: config.addon3Chips, addonCost: 0, addon2Cost: 0, addon3Cost: 0 } : {}),
        manualBreakMinutes: config.manualBreakMinutes, startStack: config.startStack, addonChips: config.addonChips,
        knockout: config.knockout, ratingGuarantee: config.ratingGuarantee, rating: config.rating, ratingPreset: config.ratingPreset, lateRegistration: config.lateRegistration, comment: config.comment, bonusHand: config.bonusHand },
      results: admin || (session.role === 'display' && display.mode === 'results') ? results
        : session.role === 'display' && display.finalTable
          ? results.filter(item => item.place === null || item.place === 1).slice(0, 9).map((item, index) => ({ ...item, playerId: String(index + 1) }))
          : [],
      stats: {
        registered: all.length || row.manualStats.entered, active: activeCount,
        entered: all.length ? attended.length : row.manualStats.entered, addons: attended.filter(p => p.addon).length,
        addonChips: attended.reduce((total, player) => total + player.addonChips, 0),
        seated: config.seating ? attended.filter(p => p.tableNo !== null).length : 0, reentries: all.length ? attended.reduce((total, p) => total + p.reentries, 0) : row.manualStats.reentries,
      },
      tables,
      waitlist: admin ? await waitlist(tx, row) : { people: [], canAdmit: false },
      dealerQueue,
      entries: all.filter(p => admin || floor || (dealer && session.table !== null && config.seating && (p.tableNo === session.table || (p.status === 'out' && p.lastTable === session.table))) || (publicSeating && p.tableNo !== null))
        .map(({ lastTable: _lastTable, ...entry }) => publicSeating ? { ...entry, name: entry.nickname || entry.name, nickname: '',
          playerId: String(entry.tableNo) + '/' + entry.seatNo, reentries: 0, rate: 0, knockouts: 0, addon: false, addonTier: 0, addonChips: 0 } : { ...entry, rate: finances || !staff ? entry.rate : 100, ...(!config.seating ? { tableNo: null, seatNo: null, confirmed: false } : {}) }),
      roster: admin ? (await tx.query<Omit<Player, 'registeredAt'> & { registeredAt: string }>(
        'SELECT id,name,nickname,source,note,tags,phone,telegram,instagram,registered_at AS "registeredAt",telegram_consent AS "telegramConsent",stage,owner FROM players WHERE club_id=$1 ORDER BY name,id',
        [session.club.id])).rows.map(player => ({ ...player, registeredAt: Number(player.registeredAt), stage: isPipelineStage(player.stage) ? player.stage : 'lead' })) : [],
      visits: admin ? timed<Visit>((await tx.query<Timed<Visit>>(
        'SELECT e.player_id AS "playerId",t.id AS "tournamentId",t.name AS "tournamentName",e.visited_at AS time FROM entries e JOIN tournaments t ON t.id=e.tournament_id WHERE e.club_id=$1 AND e.visited_at IS NOT NULL ORDER BY e.visited_at DESC', [session.club.id])).rows) : [],
      payments: finances ? timed<Payment>((await tx.query<Timed<Payment>>(
        "SELECT p.player_id AS \"playerId\",t.id AS \"tournamentId\",t.name AS \"tournamentName\",p.time,p.amount,p.kind,p.id::int,p.method,p.waived,p.collected_at_tournament AS \"collectedAtTournament\" FROM payments p JOIN tournaments t ON t.id=p.tournament_id LEFT JOIN entries e ON e.tournament_id=p.tournament_id AND e.player_id=p.player_id WHERE p.club_id=$1 AND NOT p.voided AND (p.kind='payment' OR e.status IS DISTINCT FROM 'registered') ORDER BY p.time DESC,p.id DESC", [session.club.id])).rows) : [],
      journal: admin ? timed<JournalItem>((await tx.query<Timed<JournalItem>>(
        'SELECT id::int,label,actor,time FROM journal WHERE tournament_id=$1 ORDER BY id DESC LIMIT 40', [id])).rows) : [],
      crm: finances ? crm : { ...crm, broadcasts: crm.broadcasts.map(item => ({ ...item, revenue: 0 })) },
    };
  });
}

async function checkIn(tx: Transaction, row: StateRow, entry: Pick<Entry, 'playerId' | 'rate'>, time: number) {
  const { id, clubId } = row;
  const { playerId } = entry;
  const params = [id, playerId];
  const config = configOf(row);
  const { rows: [attendance] } = await tx.query<{ price: number }>("UPDATE entries SET status='active',visited_at=$3,original_buyin=COALESCE(original_buyin,$4) WHERE tournament_id=$1 AND player_id=$2 RETURNING original_buyin AS price", [...params, time, config.buyIn]);
  const existing = await tx.query("SELECT id FROM payments WHERE tournament_id=$1 AND player_id=$2 AND kind='buyin' AND NOT voided LIMIT 1", params);
  if (!existing.rows.length) await charge(tx, row, playerId, attendance.price, 'buyin', time, false, entry.rate);
  const visitCount = Number((await tx.query<{ count: string }>('SELECT COUNT(*) AS count FROM entries WHERE club_id=$1 AND player_id=$2 AND visited_at IS NOT NULL', [clubId, playerId])).rows[0]?.count ?? 0);
  const autoStage: PipelineStage = visitCount >= 3 ? 'regular' : 'first_visit';
  await tx.query(
    "UPDATE players SET stage=$3 WHERE club_id=$1 AND id=$2 AND stage IN ('lead','registered','first_visit','reactivation') AND stage <> $3",
    [clubId, playerId, autoStage],
  );
}

async function seatDealerPlayer(tx: Transaction, row: StateRow, table: number, action: Extract<Command, { type: 'dealerSeat' }>, time: number) {
  if (row.state !== 'live') throw new DomainError('Рассадка доступна во время турнира', 409);
  const { id, clubId } = row;
  const seat = integer(action.seatNo, 1, 10, 'Выберите место');
  const exists = await tx.query('SELECT 1 FROM seats WHERE tournament_id=$1 AND table_no=$2 AND seat_no=$3', [id, table, seat]);
  if (!exists.rows.length) throw new DomainError('Место не найдено', 404);
  const all = await entries(tx, id);
  if (all.some(entry => entry.tableNo === table && entry.seatNo === seat)) throw new DomainError('Это место уже занято', 409);

  let player: Pick<Entry, 'playerId' | 'name' | 'rate' | 'status'>;
  if ('playerId' in action) {
    const targetId = field(action.playerId, 80, true);
    const target = all.find(entry => entry.playerId === targetId);
    if (!target || target.status === 'out' || (target.tableNo ?? target.lastTable ?? table) !== table) {
      throw new DomainError('Игрок недоступен для рассадки за этим столом', 403);
    }
    player = target;
  } else {
    const config = configOf(row);
    if (!registrationOpen(config, structureOf(row), row.level)) throw new DomainError('Поздняя регистрация закрыта');
    if ((await registrationAvailability(tx, row)).full) throw new DomainError('Лимит записи на турнир исчерпан');
    if ((await waitlist(tx, row)).people.some(person => person.arrived)) throw new DomainError('Передайте запись менеджеру: есть пришедшие в листе ожидания');
    const name = field(action.name, 80, true);
    const duplicate = await tx.query(
      'SELECT 1 FROM players WHERE club_id=$1 AND (lower(name)=lower($2) OR lower(nickname)=lower($2))', [clubId, name]);
    if (duplicate.rows.length) throw new DomainError('Игрок уже есть в клубе. Выберите его из записанных или обратитесь к менеджеру', 409);
    const playerId = randomUUID();
    await tx.query("INSERT INTO players (club_id,id,name,stage) VALUES ($1,$2,$3,'registered')", [clubId, playerId, name]);
    await tx.query('INSERT INTO entries (club_id,tournament_id,player_id,registered_at) VALUES ($1,$2,$3,$4)', [clubId, id, playerId, time]);
    player = { playerId, name, rate: 100, status: 'registered' };
  }
  if (player.status === 'registered') await checkIn(tx, row, player, time);
  await assign(tx, id, player.playerId, table, seat);
  return player.name + ' · стол ' + table + ', место ' + seat;
}

const entryActions = ['register', 'checkIn', 'checkOut', 'confirmSeat', 'bust', 'reenter', 'assign'];
const floorActions = ['start', 'toggleClock', 'nextLevel', 'clockControl', 'reenter', 'adjustReentry'];
const dealerActions = ['dealerSeat', 'swapSeats', 'reenter', 'adjustReentry', 'addon'];
const financialActions = ['payment', 'voidPayment', 'setTariff', ...cashTypes];

const knownActions = ['dealerSeat', ...cashTypes, ...operationTypes, ...crmTypes, ...entryActions, 'addPlayer', 'updatePlayer', 'payment', 'createTournament', 'copyTournamentWeek', 'updateTournament', 'publishTournament', 'setWaitlistArrival', 'admitWaitlist', 'removeWaitlist', 'start', 'finish', 'autoSeat', 'toggleClock', 'nextLevel'];

export async function command(db: PGlite, session: Session, id: string | null, requestId: string, action: Command): Promise<CommandResult> {
  if (!action || !knownActions.includes(action.type) ||
      (id === null && action.type !== 'createTournament' && action.type !== 'copyTournamentWeek')) throw new DomainError('Неизвестное действие', 400);
  const allowed = session.role === 'admin' ? session.memberRole !== 'admin' || !financialActions.includes(action.type)
    : session.role === 'floor' ? floorActions.includes(action.type)
      : session.role === 'dealer' && (session.memberRole
        ? session.table !== null && dealerActions.includes(action.type)
        : ['bust', 'reenter', 'confirmSeat'].includes(action.type));
  if (!allowed) {
    throw new DomainError('Нет доступа к действию', 403);
  }
  return db.transaction(async tx => {
    await tx.query('SELECT id FROM clubs WHERE id=$1 FOR UPDATE', [session.club.id]);
    const fingerprint = JSON.stringify([id, action]);
    const prior = (await tx.query<{ fingerprint: string; result: string; tournamentId: string | null }>(
      'SELECT fingerprint,result,tournament_id AS "tournamentId" FROM processed_commands WHERE token=$1 AND id=$2', [session.token, requestId])).rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new DomainError('Идентификатор команды уже использован');
      return { message: prior.result, ...(prior.tournamentId ? { tournamentId: prior.tournamentId } : {}) };
    }

    const time = Date.now();
    if (action.type === 'createTournament') {
      if (id !== null) await tournament(tx, session, id);
      const result = await createTournament(tx, session, action);
      await tx.query("INSERT INTO journal (tournament_id,label,actor,time) VALUES ($1,$2,'Администратор',$3)", [result.tournamentId, result.message, time]);
      await tx.query('INSERT INTO processed_commands (token,id,fingerprint,result,tournament_id) VALUES ($1,$2,$3,$4,$5)',
        [session.token, requestId, fingerprint, result.message, result.tournamentId]);
      return result;
    }
    if (action.type === 'copyTournamentWeek') {
      const message = await copyTournamentWeek(tx, session.club.id, action, time);
      await tx.query('INSERT INTO processed_commands (token,id,fingerprint,result) VALUES ($1,$2,$3,$4)', [session.token, requestId, fingerprint, message]);
      return { message };
    }
    if (id === null) throw new DomainError('Выберите турнир', 400);
    const row = await tournament(tx, session, id, true);
    const tournamentParams = [id];
    const clubId = session.club.id;
    let message = '';
    const type = action.type;
    if (row.state === 'draft' && !['updateTournament', 'publishTournament', 'savePreset', 'deletePreset', 'saveRatingPreset', 'deleteRatingPreset', 'updatePlayer', ...crmTypes].includes(type)
        && !(type === 'addPlayer' && !action.enroll)) {
      throw new DomainError('Сначала опубликуйте турнир');
    }
    await refreshClock(tx, row, time);
    const config = configOf(row);
    const structure = structureOf(row);
    if (session.role === 'dealer' && (!config.seating || session.table === null)) throw new DomainError('Стол дилера недоступен', 403);
    if (session.role === 'dealer' && session.memberRole && type !== 'dealerSeat') {
      const all = await entries(tx, id);
      const atDesk = (playerId: string) => all.some(entry => entry.playerId === playerId &&
        (entry.tableNo === session.table || (type === 'reenter' && entry.status === 'out' && entry.lastTable === session.table)));
      if (!('playerId' in action) || !atDesk(action.playerId) || (type === 'swapSeats' && !atDesk(action.withPlayerId))) {
        throw new DomainError('Дилеру доступны только игроки своего стола', 403);
      }
    }
    if (!config.seating && (type === 'autoSeat' || type === 'assign' || type === 'confirmSeat')) {
      throw new DomainError('Включите столы и рассадку в настройках');
    }
    if (entryActions.includes(type) || type === 'autoSeat' || type === 'toggleClock' || type === 'nextLevel') {
      if (row.state === 'finished' || (row.state === 'scheduled' && !['register', 'checkIn', 'checkOut'].includes(type))) {
        throw new DomainError('Действие доступно во время турнира');
      }
    }

    if (type === 'dealerSeat') {
      if (session.role !== 'dealer' || session.table === null) throw new DomainError('Действие доступно дилеру', 403);
      message = await seatDealerPlayer(tx, row, session.table, action, time);
    } else if (type === 'updateTournament') {
      message = await updateDefinition(tx, row, action);
    } else if (type === 'publishTournament') {
      if (row.state !== 'draft') throw new DomainError('Турнир уже опубликован');
      if (row.startsAt === null) throw new DomainError('Укажите дату и время перед публикацией', 400);
      await tx.query("UPDATE tournaments SET state='scheduled' WHERE id=$1", [id]);
      message = 'Турнир опубликован';
    } else if (type === 'setWaitlistArrival' || type === 'admitWaitlist' || type === 'removeWaitlist') {
      message = await queueOperation(tx, row, action, time);
    } else if ((cashTypes as readonly string[]).includes(type)) {
      message = await cashOperation(tx, row, action as CashCommand, time);
    } else if ((operationTypes as readonly string[]).includes(type)) {
      if (row.state === 'finished' && (type === 'saveStructure' || type === 'configureTables')) throw new DomainError('Турнир завершён');
      message = await operate(tx, row, action as OperationsCommand, () => entries(tx, id), time);
    } else if ((crmTypes as readonly string[]).includes(type)) {
      message = await crmOperation(tx, clubId, action as CrmCommand, time);
    } else if (type === 'addPlayer' || type === 'updatePlayer') {
      const source = field(action.source, 100);
      const note = field(action.note, 500);
      const tags = field(action.tags, 120);
      const nickname = action.nickname === undefined ? null : field(action.nickname, 40);
      const phone = action.phone === undefined ? null : field(action.phone, 40);
      const telegram = action.telegram === undefined ? null : field(action.telegram, 60);
      const instagram = action.instagram === undefined ? null : field(action.instagram, 60);
      const telegramConsent = action.telegramConsent === undefined ? null : Boolean(action.telegramConsent);
      const owner = action.owner === undefined ? null : field(action.owner, 80);
      const stage: PipelineStage | null = action.stage === undefined ? null : (isPipelineStage(action.stage) ? action.stage : null);
      if (action.stage !== undefined && stage === null) throw new DomainError('Неизвестный этап воронки', 400);
      if (type === 'addPlayer') {
        const name = field(action.name, 80, true);
        if (action.enroll && (row.state === 'finished' || (row.state === 'live' && !registrationOpen(config, structure, row.level)))) throw new DomainError('Регистрация закрыта');
        const newPlayerId = randomUUID();
        const initialStage: PipelineStage = stage ?? (action.enroll ? 'registered' : 'lead');
        await tx.query(
          'INSERT INTO players (club_id,id,name,source,note,tags,nickname,phone,telegram,instagram,registered_at,telegram_consent,stage,owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          [clubId, newPlayerId, name, source, note, tags, nickname ?? '', phone ?? '', telegram ?? '', instagram ?? '', time, telegramConsent ?? false, initialStage, owner || 'Администратор']);
        await tx.query(
          "INSERT INTO crm_events (club_id,player_id,kind,actor,summary,created_at) VALUES ($1,$2,'created','Администратор',$3,$4)",
          [clubId, newPlayerId, `Создана карточка гостя · этап «${pipelineStageMap[initialStage].label}»`, time]);
        if (action.enroll) await tx.query('INSERT INTO entries (club_id,tournament_id,player_id,registered_at) VALUES ($1,$2,$3,$4)', [clubId, id, newPlayerId, time]);
        message = name + (action.enroll ? ' · записан на турнир' : ' · карточка создана');
      } else {
        const name = action.name === undefined ? null : field(action.name, 80, true);
        const targetId = field(action.playerId, 80, true);
        const before = (await tx.query<{ stage: string }>('SELECT stage FROM players WHERE club_id=$1 AND id=$2', [clubId, targetId])).rows[0];
        if (!before) throw new DomainError('Игрок не найден', 404);
        const { rows } = await tx.query<{ name: string }>(
          'UPDATE players SET source=$3,note=$4,tags=$5,name=COALESCE($6,name),nickname=COALESCE($7,nickname),phone=COALESCE($8,phone),telegram=COALESCE($9,telegram),instagram=COALESCE($10,instagram),telegram_consent=COALESCE($11,telegram_consent),stage=COALESCE($12,stage),owner=COALESCE($13,owner) WHERE club_id=$1 AND id=$2 RETURNING name',
          [clubId, targetId, source, note, tags, name, nickname, phone, telegram, instagram, telegramConsent, stage, owner]);
        if (stage && before.stage !== stage) {
          const prevLabel = isPipelineStage(before.stage) ? pipelineStageMap[before.stage].label : before.stage;
          await tx.query(
            "INSERT INTO crm_events (club_id,player_id,kind,actor,summary,created_at) VALUES ($1,$2,'stage','Администратор',$3,$4)",
            [clubId, targetId, `Этап изменён: «${prevLabel}» → «${pipelineStageMap[stage].label}»`, time]);
        }
        message = rows[0].name + ' · карточка обновлена';
      }
    } else if (type === 'start' || type === 'finish') {
      if ((type === 'start' && row.state !== 'scheduled') || (type === 'finish' && row.state !== 'live')) {
        throw new DomainError('Статус турнира уже изменился');
      }
      await tx.query('UPDATE tournaments SET state=$2,started_at=NULL,remaining=$3,manual_break=NULL WHERE id=$1',
        [id, type === 'start' ? 'live' : 'finished', row.manualBreak ? row.remaining : remaining(clock(row, time), time)]);
      message = type === 'start' ? 'Турнир открыт' : 'Турнир завершён';
    } else if (type === 'toggleClock' || type === 'nextLevel') {
      if (row.manualBreak) throw new DomainError('Сначала завершите перерыв');
      if (action.revision !== undefined && action.revision !== row.revision) throw new DomainError('Таймер уже изменился. Повторите действие');
      const left = remaining(clock(row, time), time);
      if (type === 'toggleClock') {
        if (!left) throw new DomainError('Время вышло. Перейдите к следующему уровню');
        await tx.query('UPDATE tournaments SET started_at=$2,remaining=$3 WHERE id=$1', [id, row.startedAt === null ? time : null, left]);
        message = row.startedAt === null ? 'Таймер запущен' : 'Таймер на паузе';
      } else {
        const next = structure[row.level + 1];
        if (!next) throw new DomainError('Это последний уровень');
        await tx.query('UPDATE tournaments SET level=level+1,remaining=$2,started_at=$3 WHERE id=$1',
          [id, next.duration, row.startedAt === null ? null : time]);
        message = next.kind === 'break' ? 'Начался перерыв по структуре' : 'Начат уровень ' + structure.slice(0, row.level + 2).filter(level => level.kind === 'play').length;
      }
    } else if (type === 'autoSeat') {
      const all = await entries(tx, id);
      const seats = await seatsOf(tx, id);
      const occupied = all.flatMap(p => p.tableNo !== null && p.seatNo !== null ? [{ tableNo: p.tableNo, seatNo: p.seatNo }] : []);
      const waiting = all.filter(p => p.status === 'active' && p.tableNo === null);
      const assignments = planSeating(seats, occupied, waiting.map(p => p.playerId));
      if (!assignments.length) throw new DomainError(waiting.length ? 'Свободных мест нет' : 'Все пришедшие уже рассажены');
      for (const seat of assignments) {
        await tx.query('UPDATE entries SET table_no=$3,seat_no=$4,last_table=$3,confirmed=false WHERE tournament_id=$1 AND player_id=$2', [id, seat.playerId, seat.tableNo, seat.seatNo]);
      }
      message = 'Авторассадка · назначено мест: ' + assignments.length;
    } else if ('playerId' in action) {
      const playerId = field(action.playerId, 80, true);
      const player = (await tx.query<Player>('SELECT name FROM players WHERE club_id=$1 AND id=$2', [clubId, playerId])).rows[0];
      if (!player) throw new DomainError('Игрок не найден', 404);
      const entry = (await entries(tx, id)).find(item => item.playerId === playerId);
      if (type === 'register') {
        if (row.state === 'live' && !registrationOpen(config, structure, row.level)) throw new DomainError('Поздняя регистрация закрыта');
        if (entry) throw new DomainError('Игрок уже записан');
        const queued = await tx.query('SELECT 1 FROM entries WHERE tournament_id=$1 AND player_id=$2', [id, playerId]);
        if (queued.rows.length) throw new DomainError('Игрок уже в листе ожидания');
        await tx.query('INSERT INTO entries (club_id,tournament_id,player_id,registered_at) VALUES ($1,$2,$3,$4)', [clubId, id, playerId, time]);
        await tx.query("UPDATE players SET stage='registered' WHERE club_id=$1 AND id=$2 AND stage='lead'", [clubId, playerId]);
        message = player.name + ' · запись на турнир';
      } else if (type === 'payment') {
        if (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > 1_000_000) throw new DomainError('Укажите сумму в рублях', 400);
        const method = action.method ?? null;
        if (method !== null && !Object.hasOwn(methods, method)) throw new DomainError('Выберите способ оплаты', 400);
        await postPayment(tx, row, playerId, action.amount, method, time);
        message = player.name + ' · оплата ' + action.amount + ' ₽';
      } else {
        if (!entry) throw new DomainError('Игрок не записан на турнир', 404);
        const visibleAtTable = entry.status === 'out' ? entry.lastTable : entry.tableNo;
        if (session.role === 'dealer' && visibleAtTable !== session.table) throw new DomainError('Игрок закреплён за другим столом', 403);
        const params = [id, playerId];
        if (type === 'checkIn' && entry.status === 'registered') {
          await checkIn(tx, row, entry, time);
          message = player.name + ' · пришёл';
        } else if (type === 'checkOut' && entry.status !== 'registered') {
          await tx.query("UPDATE entries SET status='registered',visited_at=NULL,table_no=NULL,seat_no=NULL,last_table=NULL,confirmed=false,busted_at=NULL WHERE tournament_id=$1 AND player_id=$2", params);
          message = player.name + ' · отметка прихода снята';
        } else if (type === 'confirmSeat' && entry.status === 'active' && entry.tableNo !== null && !entry.confirmed) {
          await tx.query('UPDATE entries SET confirmed=true WHERE tournament_id=$1 AND player_id=$2', params);
          message = player.name + ' · место подтверждено';
        } else if (type === 'bust' && entry.status === 'active') {
          const knockouts = config.knockout && action.knockouts !== undefined
            ? integer(action.knockouts, 0, 500, 'Укажите количество нокаутов') : null;
          await tx.query("UPDATE entries SET status='out',last_table=table_no,table_no=NULL,seat_no=NULL,confirmed=false,knockouts=COALESCE($4,knockouts),busted_at=GREATEST($3::bigint, COALESCE((SELECT MAX(busted_at) FROM entries WHERE tournament_id=$1), 0)+1) WHERE tournament_id=$1 AND player_id=$2", [...params, time, knockouts]);
          message = player.name + ' · вылет' + (knockouts !== null ? ' · нокауты: ' + knockouts : '');
        } else if (type === 'reenter' && entry.status === 'out') {
          await tx.query("UPDATE entries SET status='active',reentries=reentries+1,busted_at=NULL WHERE tournament_id=$1 AND player_id=$2", params);
          await charge(tx, row, playerId, config.reentryFee, 'reentry', time, false, entry.rate);
          message = player.name + (config.seating ? ' · реэнтри, ожидает место' : ' · реэнтри, вернулся в игру');
        } else if (type === 'assign' && entry.status === 'active') {
          const { tableNo, seatNo } = action;
          if (!Number.isInteger(tableNo) || !Number.isInteger(seatNo)) throw new DomainError('Выберите место', 400);
          const seat = await tx.query('SELECT 1 FROM seats WHERE tournament_id=$1 AND table_no=$2 AND seat_no=$3', [id, tableNo, seatNo]);
          if (!seat.rows.length) throw new DomainError('Место не найдено', 404);
          const taken = (await entries(tx, id)).some(p => p.playerId !== playerId && p.tableNo === tableNo && p.seatNo === seatNo);
          if (taken) throw new DomainError('Это место уже занято');
          await assign(tx, id, playerId, tableNo, seatNo);
          message = player.name + ' · стол ' + tableNo + ', место ' + seatNo;
        }
      }
    }

    if (!message) throw new DomainError('Статус игрока уже изменился. Обновите список');
    const actor = session.role === 'floor' ? 'Флор' : session.role === 'dealer' ? 'Дилер · стол ' + session.table
      : session.memberRole === 'owner' ? 'Владелец' : session.memberRole === 'admin' ? 'Менеджер' : 'Администратор';
    await tx.query('UPDATE tournaments SET revision=revision+1 WHERE id=$1', tournamentParams);
    await tx.query('INSERT INTO journal (tournament_id,label,actor,time) VALUES ($1,$2,$3,$4)', [id, message, actor, time]);
    await tx.query('INSERT INTO processed_commands (token,id,fingerprint,result) VALUES ($1,$2,$3,$4)', [session.token, requestId, fingerprint, message]);
    return { message };
  });
}

