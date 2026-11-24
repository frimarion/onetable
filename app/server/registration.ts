import { createHash, randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { Command, RegistrationStatus, Waitlist } from '../shared/model.ts';
import { registrationOpen } from '../shared/operations.ts';
import { assign, charge, seatsOf } from './operations.ts';
import { configOf, refreshClock, structureOf, type StateRow } from './runtime.ts';
import { planSeating } from './seating.ts';
import { DomainError, field } from './validation.ts';
import { tournamentRow } from './definitions.ts';

type QueueCommand = Extract<Command, { type: 'setWaitlistArrival' | 'admitWaitlist' | 'removeWaitlist' }>;

const openForRegistration = (row: StateRow) => row.state === 'scheduled' ||
  (row.state === 'live' && registrationOpen(configOf(row), structureOf(row), row.level));

async function availability(tx: Transaction, row: StateRow) {
  const config = configOf(row);
  const { rows: [counts] } = await tx.query<{ reserved: number; unseated: number; capacity: number }>(
    `SELECT count(*) FILTER (WHERE queued_at IS NULL AND status<>'out')::int AS reserved,
      count(*) FILTER (WHERE status='active' AND seat_no IS NULL)::int AS unseated,
      (SELECT count(*)::int FROM seats WHERE tournament_id=$1) AS capacity FROM entries WHERE tournament_id=$1`, [row.id]);
  const limit = Math.min(config.registrationLimit || Infinity, config.seating ? counts.capacity : Infinity);
  return { full: counts.reserved >= limit, unseated: counts.unseated };
}

export async function waitlist(tx: Transaction, row: StateRow): Promise<Waitlist> {
  const { rows: people } = await tx.query<Waitlist['people'][number]>(
    `SELECT e.player_id AS "playerId",p.name,p.nickname,e.queue_arrived AS arrived
      FROM entries e JOIN players p ON (p.club_id,p.id)=(e.club_id,e.player_id)
      WHERE e.tournament_id=$1 AND e.queued_at IS NOT NULL ORDER BY e.queued_at,e.player_id`, [row.id]);
  if (!people.length) return { people, canAdmit: false };
  if (!openForRegistration(row)) return { people, canAdmit: false, blocked: 'closed' };
  if (row.state === 'live' && !people.some(person => person.arrived)) return { people, canAdmit: false, blocked: 'arrival' };
  const { full, unseated } = await availability(tx, row);
  if (full) return { people, canAdmit: false, blocked: 'full' };
  if (row.state === 'live' && configOf(row).seating && unseated > 0) return { people, canAdmit: false, blocked: 'unseated' };
  return { people, canAdmit: true };
}

async function cancelRegistration(tx: Transaction, tournamentId: string, playerId: string) {
  const deleted = await tx.query(`DELETE FROM entries e WHERE tournament_id=$1 AND player_id=$2
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tournament_id=e.tournament_id AND p.player_id=e.player_id AND NOT p.voided)
    RETURNING player_id`, [tournamentId, playerId]);
  if (!deleted.rows.length) throw new DomainError('Сначала отмените оплату игрока');
}

export async function queueOperation(tx: Transaction, row: StateRow, action: QueueCommand, now: number) {
  const id = field(action.playerId, 80, true);
  const list = await waitlist(tx, row);
  const player = list.people.find(person => person.playerId === id);
  if (!player || (row.state !== 'scheduled' && row.state !== 'live')) throw new DomainError('Запись в листе ожидания недоступна');
  if (action.type === 'removeWaitlist') {
    await cancelRegistration(tx, row.id, id);
    return player.name + ' · снят с листа ожидания';
  }
  if (action.type === 'setWaitlistArrival') {
    if (typeof action.arrived !== 'boolean') throw new DomainError('Укажите, пришёл ли игрок', 400);
    await tx.query('UPDATE entries SET queue_arrived=$3 WHERE tournament_id=$1 AND player_id=$2', [row.id, id, action.arrived]);
    return player.name + (action.arrived ? ' · пришёл, лист ожидания' : ' · отметка прихода в листе ожидания снята');
  }
  if (!list.canAdmit || list.people.find(person => row.state === 'scheduled' || person.arrived)?.playerId !== id) {
    throw new DomainError('Очередь, доступные места или поздняя регистрация изменились');
  }
  if (row.state === 'scheduled' && !player.arrived) {
    await tx.query('UPDATE entries SET queued_at=NULL WHERE tournament_id=$1 AND player_id=$2', [row.id, id]);
    return player.name + ' · запись подтверждена из листа ожидания';
  }
  const config = configOf(row);
  const price = config.buyIn;
  await tx.query(`UPDATE entries SET status='active',visited_at=$3,queued_at=NULL,queue_arrived=false,original_buyin=$4
    WHERE tournament_id=$1 AND player_id=$2`, [row.id, id, now, price]);
  await charge(tx, row, id, price, 'buyin', now);
  if (!config.seating || row.state === 'scheduled') return player.name + ' · допущен к игре из листа ожидания';
  const { rows: occupied } = await tx.query<{ tableNo: number; seatNo: number }>(
    'SELECT table_no AS "tableNo",seat_no AS "seatNo" FROM entries WHERE tournament_id=$1 AND seat_no IS NOT NULL', [row.id]);
  let seat: { tableNo: number; seatNo: number } | undefined;
  if (action.tableNo !== undefined || action.seatNo !== undefined) {
    if (!Number.isInteger(action.tableNo) || !Number.isInteger(action.seatNo)) throw new DomainError('Выберите корректный бокс', 400);
    const exists = await tx.query('SELECT 1 FROM seats WHERE tournament_id=$1 AND table_no=$2 AND seat_no=$3', [row.id, action.tableNo, action.seatNo]);
    if (!exists.rows.length) throw new DomainError('Бокс не найден', 404);
    if (occupied.some(item => item.tableNo === action.tableNo && item.seatNo === action.seatNo)) {
      throw new DomainError('Этот бокс уже занят');
    }
    seat = { tableNo: action.tableNo!, seatNo: action.seatNo! };
  } else {
    [seat] = planSeating(await seatsOf(tx, row.id), occupied, [id]);
  }
  if (!seat) throw new DomainError('Свободных мест нет');
  await assign(tx, row.id, id, seat.tableNo, seat.seatNo);
  return player.name + ' · из листа ожидания за стол ' + seat.tableNo + ', место ' + seat.seatNo;
}

export async function onlineRegistration(db: PGlite, clubId: string, id: string, payload: unknown): Promise<RegistrationStatus> {
  const input = payload as { action?: unknown; key?: unknown; name?: unknown; nickname?: unknown } | null;
  const { action, key } = input ?? {};
  if (typeof key !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key) ||
      (action !== 'status' && action !== 'register' && action !== 'cancel')) {
    throw new DomainError('Обновите страницу и повторите действие', 400);
  }
  const hash = createHash('sha256').update(key).digest('hex');
  return db.transaction(async tx => {
    if (action !== 'status') await tx.query('SELECT id FROM clubs WHERE id=$1 FOR UPDATE', [clubId]);
    const row = await tournamentRow(tx, clubId, id, true);
    if (row.state === 'draft') throw new DomainError('Турнир не найден', 404);
    const now = Date.now();
    await refreshClock(tx, row, now);
    const open = openForRegistration(row);
    let { full } = await availability(tx, row);
    const { rows: people } = await tx.query<{ playerId: string }>(
      'SELECT player_id AS "playerId" FROM entries WHERE tournament_id=$1 AND queued_at IS NOT NULL ORDER BY queued_at,player_id', [id]);
    let { rows: [player] } = await tx.query<{ id: string; name: string }>(
      'SELECT id,name FROM players WHERE club_id=$1 AND online_key=$2', [clubId, hash]);
    const found = player && (await tx.query<{ status: string; queued: boolean }>(
      'SELECT status,queued_at IS NOT NULL AS queued FROM entries WHERE tournament_id=$1 AND player_id=$2', [id, player.id])).rows[0];
    let state: RegistrationStatus['state'] = found ? found.queued ? 'waiting' : found.status === 'registered' ? 'registered' : 'admitted' : null;
    let position = state === 'waiting' ? people.findIndex(person => person.playerId === player.id) + 1 : null;
    let label = '';
    if (action === 'register' && !found) {
      if (!open) throw new DomainError('Регистрация закрыта');
      const name = field(input?.name, 80, true);
      const nickname = input?.nickname === undefined ? '' : field(input.nickname, 40);
      if (!player) {
        player = { id: randomUUID(), name };
        await tx.query("INSERT INTO players (club_id,id,name,source,online_key,nickname) VALUES ($1,$2,$3,'Онлайн-запись',$4,$5)",
          [clubId, player.id, name, hash, nickname]);
      } else if (nickname) {
        await tx.query('UPDATE players SET nickname=$3 WHERE club_id=$1 AND id=$2', [clubId, player.id, nickname]);
      }
      const queue = full || people.length > 0;
      await tx.query(`INSERT INTO entries (club_id,tournament_id,player_id,queued_at)
        VALUES ($1,$2,$3,CASE WHEN $4::boolean THEN GREATEST($5::bigint,
          COALESCE((SELECT MAX(queued_at) FROM entries WHERE tournament_id=$2),0)+1) END)`, [clubId, id, player.id, queue, now]);
      state = queue ? 'waiting' : 'registered';
      position = queue ? people.length + 1 : null;
      label = player.name + (queue ? ' · в листе ожидания' : ' · онлайн-запись');
    } else if (action === 'cancel' && found) {
      if (found.status !== 'registered' || row.state === 'finished') throw new DomainError('Обратитесь к администратору для отмены');
      await cancelRegistration(tx, id, player.id);
      state = null;
      position = null;
      label = player.name + ' · отмена онлайн-записи';
    }
    if (label) {
      await tx.query('UPDATE tournaments SET revision=revision+1 WHERE id=$1', [id]);
      await tx.query("INSERT INTO journal (tournament_id,label,actor,time) VALUES ($1,$2,'Онлайн-запись',$3)", [id, label, now]);
      ({ full } = await availability(tx, row));
    }
    return { open, full: full || people.some(person => action !== 'cancel' || person.playerId !== player?.id), state, position };
  });
}
