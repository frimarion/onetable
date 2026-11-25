import { randomInt } from 'node:crypto';
import type { Command } from '../shared/model.ts';
import { formats, playingLevel, type Config, type Level } from '../shared/operations.ts';
import { planSeating } from './seating.ts';
import { DomainError, field, integer, scheduledDate, validateConfig, validateStructure } from './validation.ts';

type Json = Record<string, unknown>;
type DoyleSeat = { name: string; playerId: string | number | null };
type DoyleTable = Json & { name?: string; seats: DoyleSeat[]; dealer?: DoyleSeat };
type Player = Json & { player_id?: number; name?: string; present?: boolean; status?: string; reentries?: number; bustOrder?: number | null; place?: number | null; seatConfirmed?: boolean; payments?: Json[] };
type DoyleState = Json & {
  tournament?: Json; timer?: Json; structure?: Json; stats?: Json; seating?: Json;
  info?: Json; players?: Player[];
};
export type DoyleRoom = { state: DoyleState | null; version: number };
export type DoyleGame = {
  id: number; name: string; status: string; room_id: string | null; date: string | null;
  slots: number | null; entry_fee: number | null; stack: number | null; format: string | null;
  level_duration: string | null; late_reg: string | null;
  registrations: { player_id: number; attendance: string; doyle_players: { name: string } | null }[];
};

function encodeLevels(levels: Level[], ante = true) {
  return levels.map(level => ({ min: level.duration / 60, sb: level.small, bb: level.big,
    anteMode: ante && level.kind === 'play' && level.ante > 0 ? 'BB' : 'NONE', ante: ante ? level.ante : 0, isBreak: level.kind === 'break' }));
}

function decodeLevels(value: unknown): Level[] {
  if (!Array.isArray(value) || !value.length) return formats.Deepstack;
  return value.map((level: Json) => {
    const big = Number(level.bb ?? level.big) || 0;
    return { kind: level.isBreak || level.kind === 'break' ? 'break' : 'play', big,
      small: Number(level.sb ?? level.small) || 0, ante: level.anteMode === 'NONE' ? 0 : Number(level.ante ?? big),
      duration: Math.round((Number(level.min ?? level.minutes) || 15) * 60) };
  });
}

function registrationPlayer(reg: DoyleGame['registrations'][number]): Player {
  const present = reg.attendance === 'present';
  return { player_id: reg.player_id, name: reg.doyle_players?.name || 'Игрок #' + reg.player_id,
    status: present ? 'playing' : 'registered', present, reentries: 0, ko: 0 };
}

function updateStats(state: DoyleState, players: Player[]) {
  const present = players.filter(player => player.present);
  const out = present.filter(player => player.status === 'busted').sort((a, b) => (a.bustOrder ?? 0) - (b.bustOrder ?? 0));
  out.forEach((player, index) => { player.bustOrder = index + 1; player.place = present.length - index; });
  state.stats = { ...state.stats, registered: present.length, alive: present.length - out.length,
    busted: out.length, reentries: present.reduce((sum, player) => sum + (Number(player.reentries) || 0), 0) };
}

function emptySeat(): DoyleSeat {
  return { name: '', playerId: null };
}

function defaultTableConfig(slots: number | null) {
  const limit = Math.max(0, Number(slots) || 0);
  const count = Math.min(20, Math.max(3, Math.ceil(limit / 10)));
  const capacity = Math.min(10, Math.max(8, Math.ceil((limit || count * 9) / count)));
  return { count, capacity };
}

function makeTable(index: number, capacity: number, existing?: Json): DoyleTable {
  const prevSeats = Array.isArray(existing?.seats) ? existing.seats as Json[] : [];
  const seats: DoyleSeat[] = Array.from({ length: capacity }, (_, si) => {
    const cur = prevSeats[si];
    if (cur && typeof cur === 'object' && cur.playerId != null) {
      return { name: String(cur.name || ''), playerId: cur.playerId as string | number };
    }
    return emptySeat();
  });
  const dealer = existing?.dealer && typeof existing.dealer === 'object'
    ? existing.dealer as DoyleSeat
    : emptySeat();
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    name: typeof existing?.name === 'string' && existing.name ? existing.name : `Стол ${index + 1}`,
    seats,
    dealer,
  };
}

function ensureSeatingTables(state: DoyleState): DoyleTable[] {
  const seating = (state.seating ??= {}) as Json;
  if (!Array.isArray(seating.tables)) seating.tables = [];
  return seating.tables as DoyleTable[];
}

function findPlayerSeat(tables: DoyleTable[], id: string, name?: string): { tableNo: number; seatNo: number } | null {
  for (let ti = 0; ti < tables.length; ti++) {
    const seats = Array.isArray(tables[ti]?.seats) ? tables[ti].seats : [];
    for (let si = 0; si < seats.length; si++) {
      const seat = seats[si];
      if (!seat || typeof seat !== 'object') continue;
      if (seat.playerId != null ? String(seat.playerId) === id : Boolean(name && seat.name === name)) {
        return { tableNo: ti + 1, seatNo: si + 1 };
      }
    }
  }
  return null;
}

function allSeatsOf(tables: DoyleTable[]) {
  const seats: { tableNo: number; seatNo: number }[] = [];
  const occupied: { tableNo: number; seatNo: number; playerId: string }[] = [];
  tables.forEach((table, ti) => {
    const list = Array.isArray(table?.seats) ? table.seats : [];
    list.forEach((seat, si) => {
      seats.push({ tableNo: ti + 1, seatNo: si + 1 });
      if (seat && typeof seat === 'object' && seat.playerId != null) {
        occupied.push({ tableNo: ti + 1, seatNo: si + 1, playerId: String(seat.playerId) });
      }
    });
  });
  return { seats, occupied };
}

function releaseSeat(state: DoyleState, id: string, name?: string) {
  if (!Array.isArray(state.seating?.tables)) return;
  for (const table of state.seating.tables as Json[]) {
    const matches = (seat: unknown) => seat && typeof seat === 'object' &&
      ((seat as Json).playerId != null ? String((seat as Json).playerId) === id : Boolean(name && (seat as Json).name === name));
    if (Array.isArray(table.seats)) table.seats = table.seats.map(seat => matches(seat) ? emptySeat() : seat);
    if (matches(table.dealer)) table.dealer = emptySeat();
  }
}

function editClock(timer: Json, structure: Level[], action: Command, now: number, breakMinutes: number) {
  const index = Math.max(0, Math.min(structure.length - 1, Number(timer.levelIndex) || 0));
  const duration = structure[index].duration;
  const running = timer.isRunning === true && !timer.isPaused && Number(timer.levelEndAt) > 0;
  const onBreak = Number(timer.breakUntil) > now;
  const remaining = running ? Math.max(0, Math.ceil((Number(timer.levelEndAt) - now) / 1000))
    : Number(timer.pauseRemainingSec ?? duration);
  const setTime = (seconds: number, run: boolean) => {
    timer.isRunning = run || timer.isRunning === true;
    timer.isPaused = !run && timer.isRunning === true;
    timer.levelEndAt = run ? now + seconds * 1000 : null;
    timer.pauseRemainingSec = run ? null : seconds;
  };
  if (action.type === 'start') {
    timer.onetableStarted = true;
    setTime(remaining, false);
  } else if (action.type === 'toggleClock') {
    if (onBreak) throw new DomainError('Сначала завершите перерыв');
    setTime(remaining, !running);
  } else if (action.type === 'nextLevel') {
    if (onBreak || index + 1 >= structure.length) throw new DomainError('Следующий уровень недоступен');
    timer.levelIndex = index + 1;
    setTime(structure[index + 1].duration, running);
  } else if (action.type === 'clockControl') {
    if (action.operation === 'break') {
      timer.breakUntil = onBreak ? null : now + breakMinutes * 60_000;
      if (!onBreak) timer.savedRemainingSec = remaining;
      setTime(Number(timer.savedRemainingSec ?? remaining), onBreak);
    } else if (action.operation === 'plus' || action.operation === 'minus') {
      const delta = action.operation === 'plus' ? 60 : -60;
      if (onBreak) timer.breakUntil = Math.max(now, Number(timer.breakUntil) + delta * 1000);
      else setTime(Math.max(0, remaining + delta), running);
    } else {
      if (!['reset', 'restart', 'previous'].includes(action.operation) || (onBreak && action.operation !== 'reset')) throw new DomainError('Действие с таймером недоступно');
      const to = action.operation === 'reset' ? 0 : action.operation === 'previous' ? Math.max(0, index - 1) : index;
      timer.breakUntil = null;
      timer.levelIndex = to;
      setTime(structure[to].duration, action.operation !== 'reset' && running);
    }
  }
}

const journalLabels: Partial<Record<Command['type'], string>> = {
  checkIn: 'Приход игрока', checkOut: 'Отмена отметки прихода', reenter: 'Возврат по реэнтри',
  adjustReentry: 'Изменено число реэнтри', bust: 'Вылет игрока', undoBust: 'Отмена вылета',
  knockouts: 'Изменено число нокаутов', addon: 'Отметка аддона', saveConfig: 'Настройки турнира',
  updateTournament: 'Изменены параметры турнира', saveStructure: 'Изменена структура',
  publishTournament: 'Турнир опубликован', start: 'Турнир открыт', finish: 'Турнир завершён',
  nextLevel: 'Следующий уровень', toggleClock: 'Изменено состояние таймера', clockControl: 'Настроен таймер',
  setSeatingEnabled: 'Настроена рассадка', configureTables: 'Настроены столы',
  assign: 'Назначено место за столом', vacate: 'Место освобождено', swapSeats: 'Игроки поменялись местами',
  confirmSeat: 'Подтверждена посадка', autoSeat: 'Выполнена авторассадка',
  clearSeating: 'Рассадка очищена', shuffleSeating: 'Случайная рассадка', balanceSeating: 'Балансировка столов',
  setFinishPlace: 'Исправлено итоговое место', swapOutcome: 'Обмен итоговых мест',
  setManualStats: 'Обновлены ручные счётчики',
  settleBalance: 'Принята оплата', payment: 'Принята оплата', clearPayments: 'Оплаты игрока очищены',
  displayMode: 'Изменён режим дисплея', toggleFinalTable: 'Режим финального стола',
  unregister: 'Запись игрока отменена', importNames: 'Добавлены игроки из списка',
  setTariff: 'Изменён тариф игрока', compEntry: 'Изменена льгота на вход', compAddon: 'Изменена льгота на аддон',
};

export function planDoyleCommand(game: DoyleGame, room: DoyleRoom | undefined, action: Command, actor: string, now = Date.now()) {
  if (game.status === 'past' && !['setFinishPlace', 'swapOutcome', 'knockouts'].includes(action.type)) {
    throw new DomainError('Турнир завершён');
  }
  if (game.status === 'draft' && !['saveConfig', 'updateTournament', 'saveStructure', 'publishTournament', 'configureTables', 'setSeatingEnabled'].includes(action.type)) {
    throw new DomainError('Сначала опубликуйте турнир');
  }
  const date = new Date(now).toISOString();
  const state = structuredClone(room?.state ?? {}) as DoyleState;
  const patch: Json = {};
  let attendance: { id: string; status: string } | null = null;
  const tournament = state.tournament ??= { name: game.name, createdAt: date, createdBy: actor, startStack: game.stack ?? 30_000, defaultBuyIn: game.entry_fee ?? 0 };
  const timer = state.timer ??= { levelIndex: 0, isRunning: false, isPaused: false, levelEndAt: null };
  const structure = state.structure ??= {};
  const levels = decodeLevels(structure.levels);
  structure.levels ??= encodeLevels(levels);
  const players = state.players ??= (room ? [] : game.registrations.map(registrationPlayer));
  const playerKey = (player: Player, index: number) => player.player_id == null
    ? `manual-${index}-${player.name || 'player'}` : String(player.player_id);
  const setConfig = (config: Config) => {
    Object.assign(tournament, { defaultBuyIn: config.buyIn, reentryFee: config.reentryFee,
      startStack: config.startStack, lateRegUntilLevel: config.lateRegistration, addonEnabled: config.addon,
      addonCost: config.addonCost, addonChips: config.addonChips, pko: config.knockout });
    state.info = { ...state.info, comment: config.comment, bonusHand: config.bonusHand };
    state.onetableConfig = { addon2Cost: config.addon2Cost, addon2Chips: config.addon2Chips,
      addon3Cost: config.addon3Cost, addon3Chips: config.addon3Chips, ratingGuarantee: config.ratingGuarantee,
      manualBreakMinutes: config.manualBreakMinutes, autoAdvance: config.autoAdvance, rating: config.rating };
    const existingTables = ensureSeatingTables(state);
    if (config.seating && !existingTables.length) {
      const defaults = defaultTableConfig(config.registrationLimit || game.slots);
      state.seating = {
        ...state.seating,
        isActive: true,
        tables: Array.from({ length: defaults.count }, (_, idx) => makeTable(idx, defaults.capacity)),
      };
    } else {
      state.seating = { ...state.seating, isActive: config.seating };
    }
    Object.assign(patch, { slots: config.registrationLimit, entry_fee: config.buyIn, stack: config.startStack, format: config.format });
  };
  const setLevels = (next: Level[], ante?: boolean) => {
    if (timer.isRunning || timer.isPaused || timer.onetableStarted) {
      const fixed = (Number(timer.levelIndex) || 0) + 1;
      if (next.length < fixed || JSON.stringify(next.slice(0, fixed)) !== JSON.stringify(levels.slice(0, fixed))) {
        throw new DomainError('Во время игры можно менять только предстоящие уровни');
      }
    }
    structure.levels = encodeLevels(next, ante);
  };

  switch (action.type) {
    case 'updateTournament':
    case 'saveConfig': {
      const next = action.type === 'updateTournament' ? validateStructure(action.structure) : levels;
      const config = validateConfig(action.config, next);
      patch.name = tournament.name = field(action.name, 80, true);
      setConfig(config);
      if (action.type === 'updateTournament') {
        patch.date = scheduledDate(action.startsAt);
        state.onetableDescription = field(action.description, 1000);
        state.onetableLayout = action.layout === null ? null : field(action.layout, 80);
        setLevels(next, config.anteEnabled);
      }
      break;
    }
    case 'saveStructure':
      setLevels(validateStructure(action.structure), action.anteEnabled);
      break;
    case 'setSeatingEnabled': {
      if (typeof action.enabled !== 'boolean') throw new DomainError('Проверьте настройку рассадки', 400);
      const currentTables = ensureSeatingTables(state);
      if (action.enabled && !currentTables.length) {
        const defaults = defaultTableConfig(game.slots);
        state.seating = {
          ...state.seating,
          isActive: true,
          tables: Array.from({ length: defaults.count }, (_, idx) => makeTable(idx, defaults.capacity)),
        };
      } else {
        state.seating = { ...state.seating, isActive: action.enabled };
      }
      break;
    }
    case 'configureTables': {
      const count = integer(action.count, 1, 20, 'Укажите от 1 до 20 столов');
      const capacity = integer(action.capacity, 2, 10, 'Укажите от 2 до 10 мест');
      const existing = ensureSeatingTables(state);
      const { occupied } = allSeatsOf(existing);
      if (occupied.some(seat => seat.tableNo > count || seat.seatNo > capacity)) {
        throw new DomainError('Пересадите игроков с мест, которые нужно убрать');
      }
      state.seating = {
        ...state.seating,
        isActive: true,
        tables: Array.from({ length: count }, (_, idx) => makeTable(idx, capacity, existing[idx])),
      };
      break;
    }
    case 'assign': {
      const id = field(action.playerId, 160, true);
      const playerIdx = players.findIndex((item, index) => playerKey(item, index) === id);
      const player = playerIdx >= 0 ? players[playerIdx] : undefined;
      if (!player || !player.present || player.status === 'busted') {
        throw new DomainError('Посадить можно только активного пришедшего игрока');
      }
      const tables = ensureSeatingTables(state);
      if (!tables.length) throw new DomainError('Сначала настройте столы');
      const tableNo = integer(action.tableNo, 1, tables.length, 'Стол не найден');
      const table = tables[tableNo - 1];
      const seats = Array.isArray(table.seats) ? table.seats : [];
      const seatNo = integer(action.seatNo, 1, seats.length, 'Место не найдено');
      const target = seats[seatNo - 1];
      if (target && target.playerId != null && String(target.playerId) !== id) {
        throw new DomainError('Это место уже занято');
      }
      releaseSeat(state, id, player.name);
      table.seats[seatNo - 1] = { name: String(player.name || 'Игрок'), playerId: player.player_id ?? id };
      break;
    }
    case 'vacate': {
      const id = field(action.playerId, 160, true);
      const player = players.find((item, index) => playerKey(item, index) === id);
      if (!player) throw new DomainError('Игрок не найден', 404);
      releaseSeat(state, id, player.name);
      player.seatConfirmed = false;
      break;
    }
    case 'confirmSeat': {
      const id = field(action.playerId, 160, true);
      const player = players.find((item, index) => playerKey(item, index) === id);
      if (!player || !player.present) throw new DomainError('Игрок не найден', 404);
      player.seatConfirmed = true;
      break;
    }
    case 'swapSeats': {
      const id = field(action.playerId, 160, true);
      const otherId = field(action.withPlayerId, 160, true);
      if (id === otherId) throw new DomainError('Выберите двух разных игроков');
      const tables = ensureSeatingTables(state);
      const firstPlayer = players.find((item, index) => playerKey(item, index) === id);
      const secondPlayer = players.find((item, index) => playerKey(item, index) === otherId);
      const firstSeat = findPlayerSeat(tables, id, firstPlayer?.name);
      const secondSeat = findPlayerSeat(tables, otherId, secondPlayer?.name);
      if (!firstSeat || !secondSeat) throw new DomainError('Оба игрока должны занимать места');
      const a = tables[firstSeat.tableNo - 1].seats[firstSeat.seatNo - 1];
      const b = tables[secondSeat.tableNo - 1].seats[secondSeat.seatNo - 1];
      tables[firstSeat.tableNo - 1].seats[firstSeat.seatNo - 1] = b;
      tables[secondSeat.tableNo - 1].seats[secondSeat.seatNo - 1] = a;
      break;
    }
    case 'autoSeat':
    case 'clearSeating':
    case 'shuffleSeating':
    case 'balanceSeating': {
      const tables = ensureSeatingTables(state);
      if (!tables.length) throw new DomainError('Сначала настройте столы');
      const activeList = players
        .map((p, index) => ({ player: p, id: playerKey(p, index) }))
        .filter(({ player }) => player.present && player.status !== 'busted');
      const byId = new Map(activeList.map(item => [item.id, item.player]));
      const placeOnSeat = (playerId: string, tableNo: number, seatNo: number) => {
        const p = byId.get(playerId);
        if (!p) return;
        tables[tableNo - 1].seats[seatNo - 1] = { name: String(p.name || 'Игрок'), playerId: p.player_id ?? playerId };
      };
      const clearAllSeats = () => {
        for (const table of tables) {
          if (Array.isArray(table.seats)) table.seats = table.seats.map(() => emptySeat());
        }
      };
      if (action.type === 'clearSeating') {
        clearAllSeats();
        break;
      }
      const { seats, occupied } = allSeatsOf(tables);
      if (!activeList.length) throw new DomainError('Нет пришедших игроков для рассадки');
      if (action.type === 'autoSeat') {
        const seatedIds = new Set(occupied.map(item => item.playerId));
        const waiting = activeList.filter(item => !seatedIds.has(item.id)).map(item => item.id);
        if (!waiting.length) throw new DomainError('Все пришедшие игроки уже рассажены');
        const plan = planSeating(seats, occupied, waiting);
        if (!plan.length) throw new DomainError('Нет свободных мест за столами');
        for (const item of plan) placeOnSeat(item.playerId, item.tableNo, item.seatNo);
        break;
      }
      if (activeList.length > seats.length) {
        throw new DomainError('Для рассадки нужно достаточно мест и хотя бы один пришедший игрок');
      }
      if (action.type === 'shuffleSeating') {
        clearAllSeats();
        const shuffled = [...activeList];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const plan = planSeating(seats, [], shuffled.map(item => item.id));
        for (const item of plan) placeOnSeat(item.playerId, item.tableNo, item.seatNo);
        break;
      }
      // balanceSeating
      const target = new Map<number, number>();
      for (const item of planSeating(seats, [], activeList.map(entry => entry.id))) {
        target.set(item.tableNo, (target.get(item.tableNo) ?? 0) + 1);
      }
      const kept: { tableNo: number; seatNo: number }[] = [];
      const moving: { id: string; seat: { tableNo: number; seatNo: number } | null }[] = [];
      const withSeats = activeList
        .map(item => ({ id: item.id, seat: findPlayerSeat(tables, item.id, item.player.name) }))
        .sort((a, b) => (a.seat?.seatNo ?? 99) - (b.seat?.seatNo ?? 99));
      for (const entry of withSeats) {
        if (entry.seat && (target.get(entry.seat.tableNo) ?? 0) > 0) {
          kept.push(entry.seat);
          target.set(entry.seat.tableNo, target.get(entry.seat.tableNo)! - 1);
        } else {
          moving.push(entry);
        }
      }
      if (!moving.length) throw new DomainError('Столы уже сбалансированы');
      for (const entry of moving) {
        if (entry.seat) tables[entry.seat.tableNo - 1].seats[entry.seat.seatNo - 1] = emptySeat();
      }
      for (const item of planSeating(seats, kept, moving.map(entry => entry.id))) {
        placeOnSeat(item.playerId, item.tableNo, item.seatNo);
      }
      break;
    }
    case 'finish': {
      timer.isRunning = false;
      timer.isPaused = false;
      timer.levelEndAt = null;
      timer.breakUntil = null;
      patch.status = 'past';
      const active = players.filter(p => p.present && p.status !== 'busted');
      if (active.length === 1) active[0].place = 1;
      updateStats(state, players);
      break;
    }
    case 'setFinishPlace': {
      const id = field(action.playerId, 160, true);
      const targetPlayer = players.find((item, index) => playerKey(item, index) === id);
      if (!targetPlayer || !targetPlayer.present || targetPlayer.status !== 'busted') {
        throw new DomainError('Изменить место можно только у выбывшего игрока');
      }
      const activeCount = players.filter(p => p.present && p.status !== 'busted').length;
      const out = players
        .filter(p => p.present && p.status === 'busted')
        .sort((a, b) => (Number(a.place) || 9999) - (Number(b.place) || 9999) || (b.bustOrder ?? 0) - (a.bustOrder ?? 0));
      const place = integer(action.place, activeCount + 1, activeCount + out.length, 'Укажите место среди выбывших игроков');
      const next = out.filter(p => p !== targetPlayer);
      next.splice(place - activeCount - 1, 0, targetPlayer);
      // В updateStats bustOrder=1 — самый первый вылетевший (последнее место), bustOrder=out.length — последний вылетевший (наивысшее место)
      next.forEach((p, idx) => {
        p.place = activeCount + idx + 1;
        p.bustOrder = next.length - idx;
      });
      updateStats(state, players);
      break;
    }
    case 'swapOutcome': {
      const id = field(action.playerId, 160, true);
      const otherId = field(action.withPlayerId, 160, true);
      const first = players.find((item, index) => playerKey(item, index) === id);
      const second = players.find((item, index) => playerKey(item, index) === otherId);
      if (!first || !second || id === otherId || !first.present || !second.present) {
        throw new DomainError('Выберите другого пришедшего игрока');
      }
      const firstOut = first.status === 'busted';
      const secondOut = second.status === 'busted';
      if (!firstOut && !secondOut) throw new DomainError('Хотя бы один из игроков должен быть вылетевшим');
      if (firstOut && secondOut) {
        const tmpOrder = first.bustOrder ?? null;
        const tmpPlace = first.place ?? null;
        first.bustOrder = second.bustOrder ?? null;
        first.place = second.place ?? null;
        second.bustOrder = tmpOrder;
        second.place = tmpPlace;
      } else {
        const activeP = firstOut ? second : first;
        const activeId = firstOut ? otherId : id;
        const outP = firstOut ? first : second;
        const outId = firstOut ? id : otherId;
        const tables = ensureSeatingTables(state);
        const seat = findPlayerSeat(tables, activeId, activeP.name);
        activeP.status = 'busted';
        activeP.bustOrder = outP.bustOrder ?? 1;
        activeP.place = outP.place ?? null;
        outP.status = 'playing';
        outP.busted = false;
        outP.bustOrder = null;
        outP.place = null;
        if (seat) {
          tables[seat.tableNo - 1].seats[seat.seatNo - 1] = { name: String(outP.name || 'Игрок'), playerId: outP.player_id ?? outId };
        }
      }
      updateStats(state, players);
      break;
    }
    case 'setManualStats': {
      const stats = action.stats;
      state.onetableManualStats = {
        entered: integer(stats.entered, 0, 5000),
        reentries: integer(stats.reentries, 0, 5000),
        out: integer(stats.out, 0, 5000),
      };
      break;
    }
    case 'settleBalance':
    case 'payment': {
      const id = field(action.playerId, 160, true);
      const player = players.find((item, index) => playerKey(item, index) === id);
      if (!player) throw new DomainError('Игрок не записан на этот турнир', 404);
      const method = action.method ?? 'cash';
      if (!['cash', 'card', 'transfer'].includes(method)) throw new DomainError('Укажите способ оплаты', 400);
      const amount = action.type === 'payment'
        ? integer(action.amount, 1, 10_000_000, 'Укажите сумму оплаты')
        : integer(action.amount ?? action.expectedDue, 1, 10_000_000, 'Укажите сумму оплаты');
      const list = Array.isArray(player.payments) ? player.payments : [];
      list.push({ id: now, amount, method, ts: now, by: actor });
      player.payments = list;
      break;
    }
    case 'clearPayments': {
      const id = field(action.playerId, 160, true);
      const player = players.find((item, index) => playerKey(item, index) === id);
      if (!player) throw new DomainError('Игрок не записан на этот турнир', 404);
      player.payments = [];
      if (action.resetTerms) {
        player.buyIn = null;
        player.freeEntries = 0;
        player.addonFree = false;
      }
      break;
    }
    case 'publishTournament':
      if (game.status !== 'draft' || !game.date) throw new DomainError('Укажите дату черновика');
      patch.status = 'open';
      break;
    case 'start':
    case 'nextLevel':
    case 'toggleClock':
    case 'clockControl':
      if ('revision' in action && action.revision !== undefined && action.revision !== (room?.version ?? 0)) {
        throw new DomainError('Таймер изменился. Повторите действие.');
      }
      editClock(timer, levels, action, now, Number((state.onetableConfig as Partial<Config> | undefined)?.manualBreakMinutes) || 15);
      break;
    case 'register':
    case 'unregister': {
      const id = field(action.playerId, 160, true);
      const index = players.findIndex((item, index) => playerKey(item, index) === id);
      const registered = game.registrations.some(reg => String(reg.player_id) === id);
      if (action.type === 'register') {
        if (!/^[1-9]\d{0,14}$/.test(id)) throw new DomainError('Игрок не найден в CRM Doyle', 404);
        if (index >= 0 || registered) throw new DomainError('Игрок уже записан');
        const cutoff = Number(tournament.lateRegUntilLevel) || 0;
        if (cutoff && playingLevel(levels, Number(timer.levelIndex) || 0) > cutoff) throw new DomainError('Поздняя регистрация закрыта');
        return { state: null, patch, attendance: { id, status: 'register' }, message: 'Игрок записан' };
      }
      if (players[index]?.present) throw new DomainError('Сначала снимите отметку прихода');
      if (registered) return { state: null, patch, attendance: { id, status: 'unregister' }, message: 'Запись отменена' };
      if (index < 0) throw new DomainError('Игрок не записан на этот турнир', 404);
      players.splice(index, 1);
      break;
    }
    case 'importNames': {
      if (!Array.isArray(action.names) || action.names.length < 1 || action.names.length > 500) throw new DomainError('Укажите список игроков', 400);
      if (action.replace) throw new DomainError('Чтобы заменить список, сначала отмените лишние записи по одной');
      const names = new Set(players.map(player => player.name?.trim().toLowerCase()));
      for (const raw of action.names) {
        const name = field(raw, 80, true);
        const key = name.toLowerCase();
        if (names.has(key)) continue;
        names.add(key);
        players.push({ name, present: false, status: 'registered', reentries: 0, ko: 0 });
      }
      break;
    }
    case 'checkIn':
    case 'checkOut':
    case 'adjustReentry':
    case 'reenter':
    case 'bust':
    case 'undoBust':
    case 'knockouts':
    case 'setTariff':
    case 'compEntry':
    case 'compAddon':
    case 'addon': {
      const id = field(action.playerId, 160, true);
      const match = game.registrations.find(reg => String(reg.player_id) === id);
      let player = players.find((item, index) => playerKey(item, index) === id);
      if (!player && match && (action.type === 'checkIn' || action.type === 'checkOut')) {
        player = registrationPlayer(match);
        players.push(player);
      }
      if (!player) throw new DomainError('Игрок не записан на этот турнир', 404);
      const log = Array.isArray(player.entryLog) ? player.entryLog as Json[] : [];
      const index = Number(timer.levelIndex) || 0;
      const stamp = { at: date, by: actor, level: levels[index]?.kind === 'break' ? null : playingLevel(levels, index) };
      const count = Number(player.reentries) || 0;
      if (action.type === 'checkIn' || action.type === 'checkOut') {
        const present = action.type === 'checkIn';
        if (player.present !== present) {
          const events = log.filter(entry => entry.how !== 'arrive');
          player.entryLog = present ? [{ ...stamp, how: 'arrive' }, ...events] : events;
          Object.assign(player, { present, status: present ? 'playing' : 'registered', busted: false, place: null, bustOrder: null });
          if (!present) releaseSeat(state, id, player.name);
        }
        if (match) attendance = { id, status: present ? 'present' : 'registered' };
      } else {
        if (!player.present) throw new DomainError('Сначала отметьте приход игрока');
        if (action.type === 'adjustReentry') {
          if (action.expectedReentries !== undefined && action.expectedReentries !== count) throw new DomainError('Реэнтри уже изменились. Обновите турнир.');
          if (action.delta !== 1 && action.delta !== -1) throw new DomainError('Проверьте число реэнтри', 400);
          player.reentries = integer(count + action.delta, 0, 1000);
          if (action.delta === 1) log.push({ ...stamp, how: 'manual' });
          else {
            const last = log.findLast(entry => entry.how !== 'arrive' && !entry.cancelled);
            if (last) last.cancelled = { at: date, by: actor };
          }
          player.entryLog = log;
        } else if (action.type === 'reenter' || action.type === 'undoBust') {
          if (player.status !== 'busted' && !player.busted) throw new DomainError('Игрок уже в игре');
          if (action.type === 'reenter') {
            player.reentries = integer(count + 1, 1, 1000);
            player.entryLog = [...log, { ...stamp, how: 'bust', bustOrder: player.bustOrder }];
          } else {
            const delta = (player.koDelta || {}) as Json;
            player.ko = Math.max(0, (Number(player.ko) || 0) - (Number(delta.ko) || 0));
            player.koPts = Math.max(0, (Number(player.koPts) || 0) - (Number(delta.koPts) || 0));
          }
          Object.assign(player, { status: 'playing', busted: false, bustOrder: null, place: null, koDelta: null });
        } else if (action.type === 'bust') {
          if (player.status === 'busted' || player.busted) throw new DomainError('Игрок уже отмечен вылетевшим');
          if (action.knockouts !== undefined) {
            const ko = integer(action.knockouts, 0, 500);
            player.koDelta = { ko: Math.max(0, ko - (Number(player.ko) || 0)), koPts: 0 };
            player.ko = ko;
          }
          Object.assign(player, { status: 'busted', bustOrder: Math.max(0, ...players.map(p => p.bustOrder ?? 0)) + 1 });
          releaseSeat(state, id, player.name);
        } else if (action.type === 'knockouts') {
          player.ko = integer(action.value, 0, 500);
        } else if (action.type === 'setTariff') {
          if (![0, 50, 100].includes(action.rate)) throw new DomainError('Укажите тариф входа', 400);
          player.buyIn = action.rate === 100 ? null : Math.round((Number(tournament.defaultBuyIn ?? game.entry_fee) || 0) * action.rate / 100);
        } else if (action.type === 'compEntry' || action.type === 'compAddon') {
          if (typeof action.enabled !== 'boolean') throw new DomainError('Укажите льготу', 400);
          if (action.type === 'compEntry') player.freeEntries = action.enabled ? Math.max(1, Number(player.freeEntries) || 0) : 0;
          else player.addonFree = action.enabled;
        } else if (action.type === 'addon') {
          const current = player.addon ? Number(player.addonTier) || 1 : 0;
          if (!tournament.addonEnabled || (action.expectedTier !== undefined && current !== action.expectedTier)) throw new DomainError('Аддон сейчас недоступен');
          const tier = integer(action.tier ?? (action.enabled ? 1 : 0), 0, 3);
          Object.assign(player, { addon: tier > 0, addonTier: tier });
        }
      }
      updateStats(state, players);
      break;
    }
    case 'toggleFinalTable':
      timer.finalTableActive = !timer.finalTableActive;
      timer.finalTableUntil = null;
      break;
    case 'displayMode':
      if (!['clock', 'seating', 'results', 'payouts'].includes(action.mode)) throw new DomainError('Проверьте режим экрана', 400);
      state.onetableDisplay = action.mode;
      break;
    default:
      throw new DomainError('Это действие пока недоступно для турниров Doyle', 422);
  }
  if (!room && (action.type === 'checkIn' || action.type === 'checkOut' || action.type === 'start')) updateStats(state, players);
  const previousJournal = Array.isArray(state.onetableJournal) ? state.onetableJournal : [];
  state.onetableJournal = [{ id: Math.max(now, (Number(state._savedAt) || 0) + 1),
    label: journalLabels[action.type], actor, time: now }, ...previousJournal].slice(0, 100);
  state._savedAt = Math.max(now, (Number(state._savedAt) || 0) + 1);
  return { state, patch, attendance, message: 'Изменение сохранено' };
}
