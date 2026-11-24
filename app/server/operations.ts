import { randomInt, randomUUID } from 'node:crypto';
import type { Transaction } from '@electric-sql/pglite';
import { remaining, type Entry } from '../shared/model.ts';
import { addonOptions, registrationOpen, type OperationsCommand } from '../shared/operations.ts';
import { assertStructureEditable, clock, configOf, displayOf, structureOf, type StateRow } from './runtime.ts';
import { planSeating } from './seating.ts';
import { DomainError, field, integer, validateAnteEnabled, validateConfig, validateRatingScheme, validateStructure } from './validation.ts';

export const operationTypes = [
  'setSeatingEnabled', 'saveConfig', 'saveStructure', 'savePreset', 'deletePreset', 'saveRatingPreset', 'deleteRatingPreset', 'setManualStats', 'setFinishPlace', 'swapOutcome', 'clockControl', 'configureTables', 'clearSeating', 'shuffleSeating',
  'balanceSeating', 'swapSeats', 'vacate', 'unregister', 'undoBust', 'addon', 'adjustReentry', 'knockouts',
  'setTariff', 'voidPayment', 'displayMode', 'toggleFinalTable', 'importNames',
] as const;

type Seat = { tableNo: number; seatNo: number };
export async function seatsOf(tx: Transaction, id: string) {
  return (await tx.query<Seat>('SELECT table_no AS "tableNo",seat_no AS "seatNo" FROM seats WHERE tournament_id=$1 ORDER BY table_no,seat_no', [id])).rows;
}
export async function assign(tx: Transaction, id: string, playerId: string, tableNo: number | null, seatNo: number | null) {
  await tx.query('UPDATE entries SET table_no=$3,seat_no=$4,last_table=COALESCE($3,last_table),confirmed=false WHERE tournament_id=$1 AND player_id=$2', [id, playerId, tableNo, seatNo]);
}
export async function charge(tx: Transaction, row: StateRow, playerId: string, amount: number, kind: 'buyin' | 'addon' | 'reentry', time: number, waived = false, rate = 100) {
  await tx.query('INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,waived,original_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [row.clubId, row.id, playerId, Math.round(amount * rate / 100), kind, time, waived, amount]);
}

function requireLive(row: StateRow) {
  if (row.state !== 'live') throw new DomainError('Действие доступно во время турнира');
}

export async function operate(tx: Transaction, row: StateRow, action: OperationsCommand, all: () => Promise<Entry[]>, now: number) {
  const { id, clubId } = row;
  const config = configOf(row);
  const structure = structureOf(row);
  if (action.type === 'setSeatingEnabled') {
    if (row.state === 'finished') throw new DomainError('Турнир завершён');
    if (typeof action.enabled !== 'boolean') throw new DomainError('Выберите режим турнира', 400);
    if (action.enabled === config.seating) throw new DomainError('Режим уже установлен');
    const display = displayOf(row);
    if (!action.enabled && display.mode === 'seating') display.mode = 'clock';
    await tx.query('UPDATE tournaments SET config=$2,display=$3 WHERE id=$1', [id, JSON.stringify({ ...config, seating: action.enabled }), JSON.stringify(display)]);
    return action.enabled ? 'Столы и рассадка включены' : 'Столы и рассадка отключены';
  }
  if (!config.seating && ['configureTables','clearSeating','shuffleSeating','balanceSeating','swapSeats','vacate'].includes(action.type)) {
    throw new DomainError('Включите столы и рассадку в настройках');
  }
  if (action.type === 'saveConfig') {
    const name = field(action.name, 80, true);
    const next = validateConfig(action.config, structure, config.seating, config.anteEnabled);
    next.anteEnabled = config.anteEnabled;
    await tx.query('UPDATE tournaments SET name=$2,config=$3 WHERE id=$1', [id, name, JSON.stringify(next)]);
    return 'Настройки турнира сохранены';
  }

  if (action.type === 'saveStructure' || action.type === 'savePreset') {
    const next = validateStructure(action.structure);
    if (action.type === 'savePreset') {
      const name = field(action.name, 40, true);
      const presetConfig = action.config !== undefined ? validateConfig(action.config, next)
        : action.anteEnabled === undefined ? null : { anteEnabled: validateAnteEnabled(action.anteEnabled, config.anteEnabled) };
      await tx.query(`INSERT INTO blind_presets (club_id,name,structure,config) VALUES ($1,$2,$3,$4)
        ON CONFLICT (club_id,name) DO UPDATE SET structure=EXCLUDED.structure,
        config=CASE WHEN EXCLUDED.config IS NULL THEN blind_presets.config ELSE COALESCE(blind_presets.config,'{}') || EXCLUDED.config END`,
        [clubId, name, JSON.stringify(next), presetConfig && JSON.stringify(presetConfig)]);
      return 'Шаблон структуры сохранён';
    }
    if (row.manualBreak) throw new DomainError('Во время игры можно менять только предстоящие уровни');
    assertStructureEditable(row, next);
    const anteEnabled = validateAnteEnabled(action.anteEnabled, config.anteEnabled);
    await tx.query('UPDATE tournaments SET structure=$2,remaining=$3,config=$4 WHERE id=$1', [id, JSON.stringify(next),
      row.state === 'live' ? row.remaining : next[0].duration,
      JSON.stringify({ ...config, anteEnabled, lateRegistration: Math.min(config.lateRegistration, next.filter(level => level.kind === 'play').length) })]);
    return 'Структура уровней сохранена';
  }

  if (action.type === 'deletePreset') {
    const result = await tx.query('DELETE FROM blind_presets WHERE club_id=$1 AND name=$2 RETURNING name', [clubId, field(action.name, 40, true)]);
    if (!result.rows.length) throw new DomainError('Шаблон не найден', 404);
    return 'Шаблон структуры удалён';
  }

  if (action.type === 'saveRatingPreset') {
    const name = field(action.name, 40, true);
    const scheme = validateRatingScheme(action.scheme);
    await tx.query(`INSERT INTO rating_presets (club_id,name,scheme) VALUES ($1,$2,$3)
      ON CONFLICT (club_id,name) DO UPDATE SET scheme=EXCLUDED.scheme`, [clubId, name, JSON.stringify(scheme)]);
    return 'Макет рейтинга «' + name + '» сохранён';
  }

  if (action.type === 'deleteRatingPreset') {
    const name = field(action.name, 40, true);
    const result = await tx.query('DELETE FROM rating_presets WHERE club_id=$1 AND name=$2 RETURNING name', [clubId, name]);
    if (!result.rows.length) throw new DomainError('Макет рейтинга не найден', 404);
    return 'Макет рейтинга удалён';
  }

  if (action.type === 'setManualStats') {
    if (row.state === 'finished' || (await all()).length) throw new DomainError('Счётчики доступны для турнира без списка игроков');
    const entered = integer(action.stats?.entered, 0, 500);
    const reentries = integer(action.stats?.reentries, 0, 1000);
    const out = integer(action.stats?.out, 0, entered + reentries);
    await tx.query('UPDATE tournaments SET manual_stats=$2 WHERE id=$1', [id, JSON.stringify({ entered, reentries, out })]);
    return 'Счётчики сохранены';
  }

  if (action.type === 'clockControl') {
    requireLive(row);
    if (action.revision !== row.revision) throw new DomainError('Таймер уже изменился. Повторите действие');
    const left = remaining(clock(row, now), now);
    if (action.operation === 'break') {
      if (row.manualBreak) {
        await tx.query('UPDATE tournaments SET manual_break=NULL,started_at=$2 WHERE id=$1', [id, row.manualBreak.wasRunning ? now : null]);
        return 'Перерыв завершён';
      }
      if (structure[row.level].kind === 'break') throw new DomainError('Перерыв уже идёт по структуре турнира');
      const state = { startedAt: now, endsAt: now + config.manualBreakMinutes * 60_000, wasRunning: row.startedAt !== null && left > 0 };
      await tx.query('UPDATE tournaments SET manual_break=$2,started_at=NULL,remaining=$3 WHERE id=$1', [id, JSON.stringify(state), left]);
      return 'Включён перерыв';
    }
    if (action.operation === 'reset') {
      await tx.query('UPDATE tournaments SET level=0,remaining=$2,started_at=NULL,manual_break=NULL WHERE id=$1', [id, structure[0].duration]);
      return 'Таймер сброшен на первый уровень';
    }
    if (row.manualBreak) {
      if (action.operation !== 'plus' && action.operation !== 'minus') throw new DomainError('Сначала завершите перерыв');
      const startedAt = row.manualBreak.startedAt ?? row.manualBreak.endsAt - config.manualBreakMinutes * 60000;
      const endsAt = Math.max(now, row.manualBreak.endsAt + (action.operation === 'plus' ? 60000 : -60000));
      await tx.query('UPDATE tournaments SET manual_break=$2 WHERE id=$1', [id, JSON.stringify({ ...row.manualBreak, startedAt, endsAt })]);
      return action.operation === 'plus' ? 'На перерыв добавлена минута' : 'С перерыва снята минута';
    }
    const level = action.operation === 'previous' ? row.level - 1 : row.level;
    if (level < 0) throw new DomainError('Это первый уровень');
    let seconds: number;
    if (action.operation === 'restart' || action.operation === 'previous') seconds = structure[level].duration;
    else if (action.operation === 'minus' || action.operation === 'plus') seconds = Math.max(0, Math.min(10_800, left + (action.operation === 'minus' ? -60 : 60)));
    else throw new DomainError('Неизвестная команда таймера', 400);
    const running = row.startedAt !== null;
    await tx.query('UPDATE tournaments SET level=$2,remaining=$3,started_at=$4 WHERE id=$1', [id, level, seconds, running ? now : null]);
    return action.operation === 'restart' ? 'Текущий уровень сброшен' : action.operation === 'previous' ? 'Возврат к предыдущему уровню' : action.operation === 'minus' ? 'С таймера снята минута' : 'На таймер добавлена минута';
  }

  if (action.type === 'configureTables') {
    const count = integer(action.count, 1, 20, 'Укажите от 1 до 20 столов');
    const capacity = integer(action.capacity, 2, 10, 'Укажите от 2 до 10 мест');
    if ((await all()).some(entry => entry.tableNo !== null && (entry.tableNo > count || entry.seatNo! > capacity))) {
      throw new DomainError('Пересадите игроков с мест, которые нужно убрать');
    }
    await tx.query('DELETE FROM seats WHERE tournament_id=$1 AND (table_no>$2 OR seat_no>$3)', [id, count, capacity]);
    await tx.query('INSERT INTO seats SELECT $1,t,s FROM generate_series(1,$2::int) t CROSS JOIN generate_series(1,$3::int) s ON CONFLICT DO NOTHING', [id, count, capacity]);
    return 'Столы и вместимость обновлены';
  }

  if (action.type === 'clearSeating' || action.type === 'shuffleSeating' || action.type === 'balanceSeating') {
    requireLive(row);
    const players = (await all()).filter(entry => entry.status === 'active');
    const seats = await seatsOf(tx, id);
    if (action.type !== 'clearSeating' && (!players.length || players.length > seats.length)) throw new DomainError('Для рассадки нужно достаточно мест и хотя бы один пришедший игрок');
    if (action.type === 'clearSeating' || action.type === 'shuffleSeating') {
      await tx.query('UPDATE entries SET table_no=NULL,seat_no=NULL,confirmed=false WHERE tournament_id=$1 AND table_no IS NOT NULL', [id]);
    }
    if (action.type === 'clearSeating') return 'Рассадка очищена';
    if (action.type === 'shuffleSeating') {
      for (let i = players.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [players[i], players[j]] = [players[j], players[i]];
      }
      const plan = planSeating(seats, [], players.map(player => player.playerId));
      for (const item of plan) await assign(tx, id, item.playerId, item.tableNo, item.seatNo);
      return 'Выполнена случайная рассадка · игроков: ' + plan.length;
    }
    const target = new Map<number, number>();
    for (const item of planSeating(seats, [], players.map(player => player.playerId))) target.set(item.tableNo, (target.get(item.tableNo) ?? 0) + 1);
    const kept: Seat[] = [];
    const moving: Entry[] = [];
    for (const player of players.sort((a, b) => (a.seatNo ?? 99) - (b.seatNo ?? 99))) {
      if (player.tableNo !== null && (target.get(player.tableNo) ?? 0) > 0) {
        kept.push({ tableNo: player.tableNo, seatNo: player.seatNo! });
        target.set(player.tableNo, target.get(player.tableNo)! - 1);
      } else moving.push(player);
    }
    if (!moving.length) throw new DomainError('Столы уже сбалансированы');
    for (const player of moving) if (player.tableNo !== null) await assign(tx, id, player.playerId, null, null);
    for (const item of planSeating(seats, kept, moving.map(player => player.playerId))) await assign(tx, id, item.playerId, item.tableNo, item.seatNo);
    return 'Балансировка столов · новых назначений: ' + moving.length;
  }

  if (action.type === 'displayMode' || action.type === 'toggleFinalTable') {
    const display = displayOf(row);
    if (action.type === 'displayMode') {
      if (!['seating', 'clock', 'results', 'payouts'].includes(action.mode)) throw new DomainError('Неизвестный режим ТВ', 400);
      if (action.mode === 'seating' && !config.seating) throw new DomainError('Включите столы и рассадку в настройках');
      display.mode = action.mode;
    } else display.finalTable = !display.finalTable;
    await tx.query('UPDATE tournaments SET display=$2 WHERE id=$1', [id, JSON.stringify(display)]);
    return 'Режим ТВ обновлён';
  }

  if (action.type === 'voidPayment') {
    const paymentId = integer(action.paymentId, 1, Number.MAX_SAFE_INTEGER);
    const result = await tx.query("UPDATE payments SET voided=true WHERE (tournament_id=$1 OR collected_at_tournament=$1) AND id=$2 AND kind='payment' AND NOT voided RETURNING id", [id, paymentId]);
    if (!result.rows.length) throw new DomainError('Оплата уже отменена или не найдена');
    return 'Оплата отменена · операция ' + paymentId;
  }

  if (action.type === 'importNames') {
    if (row.state === 'finished' || (row.state === 'live' && !registrationOpen(config, structure, row.level))) throw new DomainError('Регистрация закрыта');
    if (!Array.isArray(action.names) || action.names.length > 150) throw new DomainError('Вставьте до 150 имён', 400);
    const names = [...new Map(action.names.map(value => {
      const name = field(value, 80, true);
      return [name.toLocaleLowerCase('ru'), name];
    })).values()];
    if (!names.length) throw new DomainError('Добавьте хотя бы одно имя', 400);
    if (action.replace) await tx.query(`DELETE FROM entries e USING players r
      WHERE e.tournament_id=$1 AND e.status='registered' AND (r.club_id,r.id)=(e.club_id,e.player_id)
      AND r.online_key IS NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tournament_id=e.tournament_id AND p.player_id=e.player_id AND NOT p.voided)`, [id]);
    const roster = (await tx.query<{ id: string; name: string }>('SELECT id,name FROM players WHERE club_id=$1', [clubId])).rows;
    let added = 0;
    for (const name of names) {
      const matches = roster.filter(player => player.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
      if (matches.length > 1) throw new DomainError('В CRM несколько игроков с именем «' + name + '». Запишите нужного вручную');
      const playerId = matches[0]?.id ?? randomUUID();
      if (!matches.length) await tx.query("INSERT INTO players (club_id,id,name,source) VALUES ($1,$2,$3,'Импорт списка')", [clubId, playerId, name]);
      const result = await tx.query('INSERT INTO entries (club_id,tournament_id,player_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING player_id', [clubId, id, playerId]);
      added += result.rows.length;
    }
    return (action.replace ? 'Список записей обновлён' : 'Список импортирован') + ' · добавлено ' + added + ' из ' + names.length;
  }

  if (!('playerId' in action)) throw new DomainError('Неизвестное действие', 400);
  const playerId = field(action.playerId, 80, true);
  const player = (await all()).find(item => item.playerId === playerId);
  if (!player) throw new DomainError('Игрок не записан на турнир', 404);
  const params = [id, playerId];
  if (action.type === 'unregister') {
    if (row.state === 'finished' || player.status !== 'registered') throw new DomainError('Удалить можно только запись игрока, который ещё не пришёл');
    const result = await tx.query('DELETE FROM entries WHERE tournament_id=$1 AND player_id=$2 AND NOT EXISTS (SELECT 1 FROM payments WHERE tournament_id=$1 AND player_id=$2 AND NOT voided) RETURNING player_id', params);
    if (!result.rows.length) throw new DomainError('Сначала отмените оплату игрока');
    return player.name + ' · запись отменена';
  }
  if (action.type === 'setTariff') {
    if (![0, 50, 100].includes(action.rate)) throw new DomainError('Выберите тариф 0%, 50% или 100%', 400);
    if (row.state === 'finished') throw new DomainError('Турнир завершён');
    const { rows: [entry] } = await tx.query<{ price: number | null }>('UPDATE entries SET rate=$3,original_buyin=COALESCE(original_buyin, CASE WHEN status<>\'registered\' THEN $4::int END) WHERE tournament_id=$1 AND player_id=$2 RETURNING original_buyin AS price', [...params, action.rate, config.buyIn]);
    const changed = await tx.query<{ kind: string }>("UPDATE payments SET original_amount=COALESCE(original_amount, CASE WHEN kind='buyin' THEN $4::int END,amount),amount=ROUND(COALESCE(original_amount,CASE WHEN kind='buyin' THEN $4::int END,amount)::numeric*$3/100) WHERE tournament_id=$1 AND player_id=$2 AND kind IN ('buyin','reentry') AND NOT voided RETURNING kind", [...params, action.rate, entry.price]);
    if (player.status !== 'registered' && entry.price !== null && !changed.rows.some(item => item.kind === 'buyin')) {
      await charge(tx, row, playerId, entry.price, 'buyin', now, false, action.rate);
    }
    return player.name + ' · тариф ' + action.rate + '%';
  }

  if (action.type === 'setFinishPlace' && player.status === 'out') {
    const list = await all();
    const active = list.filter(item => item.status === 'active').length;
    const out = list.filter(item => item.status === 'out').sort((a, b) =>
      (b.bustedAt ?? 0) - (a.bustedAt ?? 0) || a.playerId.localeCompare(b.playerId));
    const place = integer(action.place, active + 1, active + out.length, 'Укажите место среди выбывших игроков');
    const next = out.filter(item => item.playerId !== playerId);
    next.splice(place - active - 1, 0, player);
    for (const [index, item] of next.entries()) {
      await tx.query('UPDATE entries SET busted_at=$3 WHERE tournament_id=$1 AND player_id=$2', [id, item.playerId, now - index]);
    }
    return player.name + ' · место исправлено на ' + place;
  }
  if (action.type === 'swapOutcome' && (row.state === 'live' || row.state === 'finished')) {
    const otherId = field(action.withPlayerId, 80, true);
    const other = (await all()).find(item => item.playerId === otherId);
    if (!other || otherId === playerId || player.status === 'registered' || other.status === 'registered') {
      throw new DomainError('Выберите другого пришедшего игрока');
    }
    if (player.status === 'active' && other.status === 'active') {
      throw new DomainError('Хотя бы один из игроков должен быть вылетевшим');
    }
    if (player.status === 'out' && other.status === 'out') {
      let firstBusted = player.bustedAt ?? now;
      let secondBusted = other.bustedAt ?? now;
      if (firstBusted === secondBusted) {
        if (player.playerId.localeCompare(other.playerId) < 0) firstBusted++;
        else secondBusted++;
      }
      await tx.query('UPDATE entries SET busted_at=$3 WHERE tournament_id=$1 AND player_id=$2', [id, playerId, secondBusted]);
      await tx.query('UPDATE entries SET busted_at=$3 WHERE tournament_id=$1 AND player_id=$2', [id, otherId, firstBusted]);
      return player.name + ' и ' + other.name + ' · итоговые места поменяны';
    }
    const activePlayer = player.status === 'active' ? player : other;
    const outPlayer = player.status === 'out' ? player : other;
    const bustedAt = outPlayer.bustedAt ?? now;
    await tx.query(
      "UPDATE entries SET status='out',last_table=COALESCE(table_no,last_table),table_no=NULL,seat_no=NULL,confirmed=false,busted_at=$3 WHERE tournament_id=$1 AND player_id=$2",
      [id, activePlayer.playerId, bustedAt]);
    await tx.query(
      "UPDATE entries SET status='active',table_no=$3,seat_no=$4,last_table=COALESCE($3,last_table),confirmed=$5,busted_at=NULL WHERE tournament_id=$1 AND player_id=$2",
      [id, outPlayer.playerId, activePlayer.tableNo, activePlayer.seatNo, activePlayer.confirmed]);
    return outPlayer.name + ' возвращён в игру вместо ' + activePlayer.name;
  }
  if (action.type === 'knockouts' && config.knockout && player.status !== 'registered' && (row.state === 'live' || row.state === 'finished')) {
    await tx.query('UPDATE entries SET knockouts=$3 WHERE tournament_id=$1 AND player_id=$2', [...params, integer(action.value, 0, 500)]);
    return player.name + ' · нокауты обновлены';
  }
  if (action.type === 'addon' && (row.state === 'scheduled' || row.state === 'live') && (player.status === 'active' || (player.status === 'out' && player.addon))) {
    if (action.enabled !== undefined && typeof action.enabled !== 'boolean') throw new DomainError('Укажите состояние аддона', 400);
    if (action.expectedTier !== undefined && action.expectedTier !== player.addonTier) throw new DomainError('Отметка аддона уже изменилась');
    const enabled = action.enabled ?? !player.addon;
    const tier = action.tier === undefined ? Number(enabled) : integer(action.tier, 0, 3);
    if (tier === player.addonTier || (action.tier === undefined && action.enabled === player.addon)) throw new DomainError('Отметка аддона уже изменилась');
    const option = addonOptions(config).find(item => item.tier === tier);
    if (tier && (!option || player.status !== 'active')) throw new DomainError('Этот аддон недоступен');
    const { rows } = await tx.query<{ waived: boolean }>("UPDATE payments SET voided=true WHERE tournament_id=$1 AND player_id=$2 AND kind='addon' AND NOT voided RETURNING waived", params);
    await tx.query('UPDATE entries SET addon=$3,addon_tier=$4,addon_chips=$5,addon_granted_free=false WHERE tournament_id=$1 AND player_id=$2', [...params, tier > 0, tier, option?.chips ?? null]);
    if (option) await charge(tx, row, playerId, option.cost, 'addon', now, rows.some(item => item.waived));
    return player.name + (option ? ' · ' + option.label.toLocaleLowerCase('ru') : ' · аддон отменён');
  }
  requireLive(row);
  if (action.type === 'swapSeats') {
    const otherId = field(action.withPlayerId, 80, true);
    const other = (await all()).find(item => item.playerId === otherId);
    if (!other || otherId === playerId || other.tableNo === null || player.tableNo === null) throw new DomainError('Оба игрока должны занимать места');
    await assign(tx, id, playerId, null, null);
    await assign(tx, id, otherId, player.tableNo, player.seatNo);
    await assign(tx, id, playerId, other.tableNo, other.seatNo);
    return player.name + ' и ' + other.name + ' поменялись местами';
  }
  if (action.type === 'vacate' && player.tableNo !== null) {
    await assign(tx, id, playerId, null, null);
    return player.name + ' · место освобождено';
  }
  if (action.type === 'undoBust' && player.status === 'out') {
    await tx.query("UPDATE entries SET status='active',busted_at=NULL WHERE tournament_id=$1 AND player_id=$2", params);
    return player.name + (config.seating ? ' · вылет отменён, ожидает место' : ' · вылет отменён');
  }
  if (action.type === 'adjustReentry' && player.status !== 'registered') {
    if (action.expectedReentries !== undefined && action.expectedReentries !== player.reentries) {
      throw new DomainError('Число реэнтри изменилось. Проверьте счётчик');
    }
    if (action.delta === 1) await charge(tx, row, playerId, config.reentryFee, 'reentry', now, false, player.rate);
    else if (action.delta === -1 && player.reentries > 0) {
      await tx.query("UPDATE payments SET voided=true WHERE id=(SELECT id FROM payments WHERE tournament_id=$1 AND player_id=$2 AND kind='reentry' AND NOT voided ORDER BY id DESC LIMIT 1)", params);
    } else throw new DomainError('Нельзя изменить число реэнтри');
    await tx.query('UPDATE entries SET reentries=reentries+$3 WHERE tournament_id=$1 AND player_id=$2', [...params, action.delta]);
    return player.name + (action.delta === 1 ? ' · реэнтри добавлено' : ' · реэнтри отменено') + ' · ' + (player.reentries + action.delta);
  }
  throw new DomainError('Действие недоступно для текущего статуса игрока');
}

