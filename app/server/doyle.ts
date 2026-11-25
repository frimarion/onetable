import { randomBytes, randomUUID } from 'node:crypto';
import { doyleQueries, optionalDoyleResources, type DoyleOverlay, type DoyleResource, type DoyleRows } from '../shared/doyleQueries.ts';
import type { AuthContext } from './auth.ts';
import type { PgAdapter } from './pgAdapter.ts';
import { DomainError, field, integer, scheduledDate, validateConfig, validateStructure } from './validation.ts';
import type { Command, CommandResult } from '../shared/model.ts';
import { defaultConfig, formats } from '../shared/operations.ts';
import { parseTags, pipelineStages } from '../shared/crm.ts';
import { encodeLevels, planDoyleCommand, type DoyleGame, type DoyleRoom } from './doyleCommands.ts';
import { DOYLE_CLUB_ID } from '../shared/workspace.ts';

const linkedUserId = process.env.DOYLE_ONETABLE_USER_ID;
const serviceKey = process.env.DOYLE_SERVICE_ROLE_KEY;
const VALID_STAGES = new Set(pipelineStages.map(s => s.id));

export function usesDoyleData(ctx: AuthContext): boolean {
  return Boolean(serviceKey && linkedUserId && ctx.club.id === DOYLE_CLUB_ID);
}

export function hasDoyleAccess(ctx: AuthContext): boolean {
  return usesDoyleData(ctx) && linkedUserId === ctx.user.id && ctx.memberRole === 'owner';
}

export function canWriteDoyle(ctx: AuthContext): boolean {
  return process.env.DOYLE_COMMANDS_ENABLED === '1' && hasDoyleAccess(ctx);
}

async function doyleRest<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; prefer?: string },
): Promise<T> {
  const method = options?.method ?? (options?.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    apikey: serviceKey!,
    Authorization: 'Bearer ' + serviceKey!,
    'Content-Type': 'application/json',
  };
  if (options?.prefer) headers.Prefer = options.prefer;
  const response = await fetch('http://127.0.0.1:8000/rest/v1/' + path, {
    method,
    headers,
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error('Doyle request failed', method, response.status, path.split('?')[0], errText.slice(0, 200));
    throw new DomainError('Не удалось выполнить действие в Doyle. Попробуйте ещё раз.', 502);
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const CLUB_COMMANDS = new Set<Command['type']>([
  'updatePlayer', 'addPlayer', 'addPlayerNote', 'deletePlayerNote',
  'addPlayerMessage', 'setPlayerStage', 'addCrmTask', 'completeCrmTask', 'deleteCrmTask',
  'settleOldDebts', 'savePreset', 'deletePreset', 'saveRatingPreset', 'deleteRatingPreset',
  'createTournament', 'copyTournamentWeek',
]);

async function nextDoyleId(table: 'doyle_players' | 'doyle_tournaments'): Promise<number> {
  const rows = await doyleRest<{ id: number }[]>(`${table}?select=id&order=id.desc&limit=1`);
  return (Number(rows[0]?.id) || 0) + 1;
}

function numericPlayerId(raw: string): number {
  const clean = String(raw || '').trim();
  if (!/^[1-9]\d{0,14}$/.test(clean)) throw new DomainError('Игрок не найден в базе Doyle', 404);
  return Number(clean);
}

async function addDoyleEvent(pg: PgAdapter, playerId: string, kind: string, actor: string, summary: string, now: number) {
  await pg.systemTransaction(async tx => {
    await tx.query(
      'INSERT INTO doyle_crm_events (player_id, kind, actor, summary, created_at) VALUES ($1,$2,$3,$4,$5)',
      [playerId, kind, actor, summary, now],
    );
  });
}

async function createDoyleTournamentRow(
  input: {
    name: string;
    startsAt?: string | null;
    description?: string;
    layout?: string | null;
    publish?: boolean;
    config?: Partial<typeof defaultConfig>;
    structure?: ReturnType<typeof validateStructure>;
  },
  actor: string,
): Promise<number> {
  const name = field(input.name, 80, true);
  const structure = input.structure ? validateStructure(input.structure) : formats.Deepstack;
  const config = validateConfig({ ...defaultConfig, ...(input.config || {}) }, structure);
  const date = input.startsAt ? scheduledDate(input.startsAt) : null;
  if (input.publish && !date) throw new DomainError('Для публикации укажите дату и время турнира', 400);

  const id = await nextDoyleId('doyle_tournaments');
  const roomId = randomBytes(3).toString('hex').toUpperCase();
  const displayToken = randomUUID();
  const nowIso = new Date().toISOString();

  const tablesCount = Math.min(20, Math.max(3, Math.ceil((config.registrationLimit || 27) / 10)));
  const seatsCap = Math.min(10, Math.max(8, Math.ceil((config.registrationLimit || tablesCount * 9) / tablesCount)));
  const initialTables = config.seating
    ? Array.from({ length: tablesCount }, (_, ti) => ({
        name: `Стол ${ti + 1}`,
        seats: Array.from({ length: seatsCap }, () => ({ name: '', playerId: null })),
        dealer: { name: '', playerId: null },
      }))
    : [];

  const roomState = {
    tournament: {
      name,
      createdAt: nowIso,
      createdBy: actor,
      startStack: config.startStack,
      defaultBuyIn: config.buyIn,
      reentryFee: config.reentryFee,
      lateRegUntilLevel: config.lateRegistration,
      addonEnabled: config.addon,
      addonCost: config.addonCost,
      addonChips: config.addonChips,
      pko: config.knockout,
    },
    timer: { levelIndex: 0, isRunning: false, isPaused: false, levelEndAt: null },
    structure: { levels: encodeLevels(structure, config.anteEnabled) },
    seating: { isActive: config.seating, tables: initialTables },
    info: { comment: config.comment, bonusHand: config.bonusHand },
    onetableDescription: field(input.description || '', 1000),
    onetableLayout: input.layout ?? null,
    onetableConfig: {
      addon2Cost: config.addon2Cost,
      addon2Chips: config.addon2Chips,
      addon3Cost: config.addon3Cost,
      addon3Chips: config.addon3Chips,
      ratingGuarantee: config.ratingGuarantee,
      manualBreakMinutes: config.manualBreakMinutes,
      autoAdvance: config.autoAdvance,
      rating: config.rating,
    },
    players: [],
    stats: { registered: 0, alive: 0, busted: 0, reentries: 0 },
    onetableJournal: [{ id: Date.now(), label: input.publish ? 'Турнир создан и опубликован' : 'Создан черновик турнира', actor, time: Date.now() }],
    _savedAt: Date.now(),
  };

  await doyleRest('rooms', {
    method: 'POST',
    body: { room_id: roomId, state: roomState, branch: 'MSK', display_token: displayToken, version: 0 },
    prefer: 'return=minimal',
  });
  await doyleRest('doyle_tournaments', {
    method: 'POST',
    body: {
      id,
      name,
      city: 'MSK',
      date,
      slots: config.registrationLimit || 50,
      status: input.publish ? 'open' : 'draft',
      entry_fee: config.buyIn,
      stack: config.startStack,
      format: config.format || 'Deepstack',
      room_id: roomId,
    },
    prefer: 'return=minimal',
  });
  return id;
}

async function writeDoyleClubCommand(
  pg: PgAdapter,
  ctx: AuthContext,
  tournamentId: string,
  action: Command,
): Promise<CommandResult> {
  const now = Date.now();
  const actor = ctx.user.name || ctx.user.email;

  if (action.type === 'updatePlayer') {
    const pid = numericPlayerId(action.playerId);
    const pidStr = String(pid);
    const fullName = field(action.name ?? '', 80);
    const nickname = field(action.nickname ?? '', 80);
    const note = field(action.note ?? '', 2000);
    const telegram = field(action.telegram ?? '', 80).replace(/^@/, '');
    const phone = field(action.phone ?? '', 40);
    const instagram = field(action.instagram ?? '', 80);
    const source = field(action.source ?? '', 80);
    const owner = field(action.owner ?? '', 80);
    const stage = action.stage && VALID_STAGES.has(action.stage) ? action.stage : '';

    const patch: Record<string, unknown> = {
      bio: note,
      tg_username: telegram || null,
      updated_at: new Date(now).toISOString(),
    };
    if (nickname || fullName) patch.name = nickname || fullName;
    if (fullName) patch.full_name = fullName;
    if (typeof action.telegramConsent === 'boolean') patch.marketing_consent = action.telegramConsent;

    await doyleRest(`doyle_players?id=eq.${pid}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });

    // Теги в crm_player_tags
    const tags = [...new Set(parseTags(action.tags || '').map(t => t.slice(0, 40)))];
    await doyleRest(`crm_player_tags?player_id=eq.${pid}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (tags.length) {
      await doyleRest('crm_player_tags', {
        method: 'POST',
        body: tags.map(tag => ({ player_id: pid, tag })),
        prefer: 'return=minimal',
      });
    }

    // Дополнительные CRM-поля в БД OneTable
    await pg.systemTransaction(async tx => {
      await tx.query(
        `INSERT INTO doyle_player_meta (player_id, stage, owner, phone, instagram, source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (player_id) DO UPDATE SET
           stage=CASE WHEN EXCLUDED.stage<>'' THEN EXCLUDED.stage ELSE doyle_player_meta.stage END,
           owner=EXCLUDED.owner, phone=EXCLUDED.phone, instagram=EXCLUDED.instagram,
           source=EXCLUDED.source, updated_at=EXCLUDED.updated_at`,
        [pidStr, stage, owner, phone, instagram, source, now],
      );
    });
    await addDoyleEvent(pg, pidStr, 'profile', actor, 'Обновлена карточка гостя', now);
    return { message: 'Карточка гостя обновлена' };
  }

  if (action.type === 'addPlayer') {
    const fullName = field(action.name, 80, true);
    const nickname = field(action.nickname ?? '', 80);
    const note = field(action.note ?? '', 2000);
    const telegram = field(action.telegram ?? '', 80).replace(/^@/, '');
    const phone = field(action.phone ?? '', 40);
    const instagram = field(action.instagram ?? '', 80);
    const source = field(action.source ?? '', 80);
    const owner = field(action.owner ?? '', 80);
    const stage = action.stage && VALID_STAGES.has(action.stage) ? action.stage : 'lead';
    const pid = await nextDoyleId('doyle_players');
    const pidStr = String(pid);

    await doyleRest('doyle_players', {
      method: 'POST',
      body: {
        id: pid,
        name: nickname || fullName,
        full_name: fullName,
        tg_username: telegram || null,
        bio: note || null,
        marketing_consent: Boolean(action.telegramConsent),
        city: 'MSK',
        auth_provider: 'manual',
      },
      prefer: 'return=minimal',
    });

    const tags = [...new Set(parseTags(action.tags || '').map(t => t.slice(0, 40)))];
    if (tags.length) {
      await doyleRest('crm_player_tags', {
        method: 'POST',
        body: tags.map(tag => ({ player_id: pid, tag })),
        prefer: 'return=minimal',
      });
    }

    await pg.systemTransaction(async tx => {
      await tx.query(
        `INSERT INTO doyle_player_meta (player_id, stage, owner, phone, instagram, source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pidStr, stage, owner, phone, instagram, source, now],
      );
    });
    await addDoyleEvent(pg, pidStr, 'created', actor, 'Гость добавлен в CRM', now);

    if (action.enroll && /^[1-9]\d{0,14}$/.test(tournamentId)) {
      await doyleRest('doyle_registrations', {
        method: 'POST',
        body: { tournament_id: Number(tournamentId), player_id: pid, attendance: 'registered', source: 'admin' },
        prefer: 'return=minimal',
      });
      return { message: `${fullName} добавлен в CRM и записан на турнир` };
    }
    return { message: `${fullName} добавлен в CRM` };
  }

  if (action.type === 'addPlayerNote') {
    const pid = numericPlayerId(action.playerId);
    const body = field(action.body, 2000, true);
    await doyleRest('crm_player_notes', {
      method: 'POST',
      body: { player_id: pid, text: body, admin_email: ctx.user.email },
      prefer: 'return=minimal',
    });
    await addDoyleEvent(pg, String(pid), 'note', actor, 'Добавлена заметка', now);
    return { message: 'Заметка добавлена' };
  }

  if (action.type === 'deletePlayerNote') {
    const noteId = integer(action.noteId, 1, Number.MAX_SAFE_INTEGER);
    await doyleRest(`crm_player_notes?id=eq.${noteId}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { message: 'Заметка удалена' };
  }

  if (action.type === 'addPlayerMessage') {
    const pidStr = String(numericPlayerId(action.playerId));
    const body = field(action.body, 2000, true);
    const direction = action.direction === 'in' ? 'in' : 'out';
    const channel = ['telegram', 'instagram', 'phone', 'club'].includes(action.channel) ? action.channel : 'club';
    await pg.systemTransaction(async tx => {
      await tx.query(
        'INSERT INTO doyle_crm_messages (player_id, direction, channel, author, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [pidStr, direction, channel, actor, body, now],
      );
    });
    await addDoyleEvent(pg, pidStr, 'message', actor, `Сообщение (${channel})`, now);
    return { message: 'Сообщение сохранено' };
  }

  if (action.type === 'setPlayerStage') {
    const pidStr = String(numericPlayerId(action.playerId));
    if (!VALID_STAGES.has(action.stage)) throw new DomainError('Неизвестный этап воронки', 400);
    await pg.systemTransaction(async tx => {
      await tx.query(
        `INSERT INTO doyle_player_meta (player_id, stage, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (player_id) DO UPDATE SET stage=EXCLUDED.stage, updated_at=EXCLUDED.updated_at`,
        [pidStr, action.stage, now],
      );
    });
    const stageLabel = pipelineStages.find(s => s.id === action.stage)?.label || action.stage;
    await addDoyleEvent(pg, pidStr, 'stage', actor, `Этап воронки: ${stageLabel}`, now);
    return { message: `Этап обновлён: ${stageLabel}` };
  }

  if (action.type === 'addCrmTask') {
    const pidStr = String(numericPlayerId(action.playerId));
    const title = field(action.title, 200, true);
    const kind = ['call', 'follow_up', 'meeting'].includes(action.kind) ? action.kind : 'call';
    const assignee = field(action.assignee || actor, 80);
    const dueAt = Number(action.dueAt) || now + 86_400_000;
    await pg.systemTransaction(async tx => {
      await tx.query(
        'INSERT INTO doyle_crm_tasks (player_id, kind, title, assignee, due_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [pidStr, kind, title, assignee, dueAt, now],
      );
    });
    await addDoyleEvent(pg, pidStr, 'task', actor, `Задача: ${title}`, now);
    return { message: 'Задача добавлена' };
  }

  if (action.type === 'completeCrmTask') {
    const taskId = integer(action.taskId, 1, Number.MAX_SAFE_INTEGER);
    const result = field(action.result || '', 400);
    await pg.systemTransaction(async tx => {
      const row = (await tx.query<{ player_id: string; title: string }>(
        'UPDATE doyle_crm_tasks SET completed_at=$2, result=$3 WHERE id=$1 RETURNING player_id, title',
        [taskId, now, result],
      )).rows[0];
      if (!row) throw new DomainError('Задача не найдена', 404);
      await tx.query(
        'INSERT INTO doyle_crm_events (player_id, kind, actor, summary, created_at) VALUES ($1,$2,$3,$4,$5)',
        [row.player_id, 'task_done', actor, `Выполнено: ${row.title}`, now],
      );
    });
    return { message: 'Задача выполнена' };
  }

  if (action.type === 'deleteCrmTask') {
    const taskId = integer(action.taskId, 1, Number.MAX_SAFE_INTEGER);
    await pg.systemTransaction(async tx => {
      await tx.query('DELETE FROM doyle_crm_tasks WHERE id=$1', [taskId]);
    });
    return { message: 'Задача удалена' };
  }

  if (action.type === 'settleOldDebts') {
    const pid = numericPlayerId(action.playerId);
    const method = ['cash', 'card', 'transfer', 'prior'].includes(action.method) ? action.method : 'cash';
    const settledAt = new Date(now).toISOString();
    let count = 0;
    for (const item of action.debts || []) {
      const rawId = String(item.id || '');
      const match = /^debt-(\d+)$/.exec(rawId) || /^(\d+)$/.exec(rawId);
      if (!match) continue;
      await doyleRest(`crm_player_debts?id=eq.${match[1]}&player_id=eq.${pid}`, {
        method: 'PATCH',
        body: { settled_at: settledAt, method },
        prefer: 'return=minimal',
      });
      count++;
    }
    if (!count) throw new DomainError('Не найдены долги для погашения', 400);
    return { message: `Погашено долгов: ${count}` };
  }

  if (action.type === 'savePreset') {
    const name = field(action.name, 80, true);
    const structure = validateStructure(action.structure);
    const encoded = encodeLevels(structure, action.anteEnabled ?? true);
    const cfg = action.config;
    const body = {
      name,
      start_stack: cfg?.startStack ?? defaultConfig.startStack,
      late_reg_until_level: cfg?.lateRegistration ?? 0,
      default_buy_in: cfg?.buyIn ?? defaultConfig.buyIn,
      enables_seating: Boolean(cfg?.seating ?? true),
      levels: encoded,
      updated_at: new Date(now).toISOString(),
    };
    const existing = await doyleRest<{ id: number }[]>(`tournament_blueprints?select=id&name=eq.${encodeURIComponent(name)}&limit=1`);
    if (existing[0]) {
      await doyleRest(`tournament_blueprints?id=eq.${existing[0].id}`, { method: 'PATCH', body, prefer: 'return=minimal' });
    } else {
      await doyleRest('tournament_blueprints', { method: 'POST', body, prefer: 'return=minimal' });
    }
    return { message: `Макет «${name}» сохранён` };
  }

  if (action.type === 'deletePreset') {
    const name = field(action.name, 80, true);
    await doyleRest(`tournament_blueprints?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { message: `Макет «${name}» удалён` };
  }

  if (action.type === 'saveRatingPreset') {
    const name = field(action.name, 80, true);
    await pg.systemTransaction(async tx => {
      await tx.query(
        `INSERT INTO doyle_rating_presets (name, scheme, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (name) DO UPDATE SET scheme=EXCLUDED.scheme, updated_at=EXCLUDED.updated_at`,
        [name, JSON.stringify(action.scheme), now],
      );
    });
    return { message: `Макет рейтинга «${name}» сохранён` };
  }

  if (action.type === 'deleteRatingPreset') {
    const name = field(action.name, 80, true);
    await pg.systemTransaction(async tx => {
      await tx.query('DELETE FROM doyle_rating_presets WHERE name=$1', [name]);
    });
    return { message: `Макет рейтинга «${name}» удалён` };
  }

  if (action.type === 'createTournament') {
    const newId = await createDoyleTournamentRow(action, actor);
    return {
      message: action.publish ? 'Турнир создан и опубликован' : 'Черновик турнира создан',
      tournamentId: String(newId),
    };
  }

  if (action.type === 'copyTournamentWeek') {
    if (!Array.isArray(action.tournaments) || !action.tournaments.length) {
      throw new DomainError('Выберите хотя бы один турнир для копирования', 400);
    }
    let lastId = '';
    for (const item of action.tournaments) {
      const srcId = String(item.sourceId || '');
      let srcGame: DoyleGame | undefined;
      let srcRoom: DoyleRoom | undefined;
      if (/^[1-9]\d{0,14}$/.test(srcId)) {
        const games = await doyleRest<DoyleGame[]>(`doyle_tournaments?select=id,name,status,room_id,date,slots,entry_fee,stack,format,level_duration,late_reg&id=eq.${srcId}`);
        srcGame = games[0];
        if (srcGame?.room_id) {
          const rooms = await doyleRest<DoyleRoom[]>(`rooms?select=state,version&room_id=eq.${encodeURIComponent(srcGame.room_id)}`);
          srcRoom = rooms[0];
        }
      }
      const st = (srcRoom?.state || {}) as Record<string, unknown>;
      const stT = (st.tournament || {}) as Record<string, unknown>;
      const stS = (st.structure || {}) as Record<string, unknown>;
      const rawLevels = Array.isArray(stS.levels) ? stS.levels as Record<string, unknown>[] : null;
      const structure = rawLevels?.length
        ? rawLevels.map(l => ({
            kind: (l.isBreak || l.kind === 'break' ? 'break' : 'play') as 'play' | 'break',
            small: Number(l.sb ?? l.small) || 0,
            big: Number(l.bb ?? l.big) || 0,
            ante: l.anteMode === 'NONE' ? 0 : Number(l.ante ?? l.bb ?? l.big) || 0,
            duration: Math.round((Number(l.min ?? l.minutes) || 15) * 60),
          }))
        : formats.Deepstack;
      const newId = await createDoyleTournamentRow({
        name: item.name,
        startsAt: item.startsAt,
        publish: action.publish,
        structure,
        config: {
          ...defaultConfig,
          ...(st.onetableConfig as Partial<typeof defaultConfig> | undefined),
          buyIn: Number(stT.defaultBuyIn ?? srcGame?.entry_fee ?? defaultConfig.buyIn) || 0,
          startStack: Number(stT.startStack ?? srcGame?.stack ?? defaultConfig.startStack) || 30_000,
          registrationLimit: Number(srcGame?.slots ?? 0) || 0,
          format: srcGame?.format || defaultConfig.format,
          seating: Boolean((st.seating as Record<string, unknown> | undefined)?.isActive ?? true),
          knockout: Boolean(stT.pko),
          addon: Boolean(stT.addonEnabled),
        },
      }, actor);
      lastId = String(newId);
    }
    return {
      message: `Скопировано турниров: ${action.tournaments.length}`,
      tournamentId: lastId || undefined,
    };
  }

  throw new DomainError('Это действие пока недоступно для турниров Doyle', 422);
}

export async function writeDoyleCommand(
  pg: PgAdapter,
  ctx: AuthContext,
  id: string,
  requestId: string,
  command: Command,
): Promise<CommandResult> {
  if (!canWriteDoyle(ctx)) throw new DomainError('Нет доступа к управлению турнирами Doyle', 403);
  if (CLUB_COMMANDS.has(command.type)) {
    return writeDoyleClubCommand(pg, ctx, id, command);
  }
  if (!/^[1-9]\d{0,14}$/.test(id)) throw new DomainError('Турнир не найден', 404);
  const request = {
    p_tournament_id: id,
    p_fingerprint: JSON.stringify(command),
    p_request_id: requestId,
    p_expected: null,
    p_version: null,
    p_patch: {},
    p_state: null,
    p_attendance: null,
    p_new_room_id: null,
    p_display_token: null,
  };
  const save = (overrides = {}) => doyleRest<string>('rpc/onetable_save_doyle_command', { body: { ...request, ...overrides } });
  const existing = await save();
  if (existing === 'saved') return { message: 'Изменение сохранено' };
  if (existing === 'missing') throw new DomainError('Турнир не найден', 404);
  if (existing !== 'new') throw new DomainError('Идентификатор действия уже использован', 409);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [game] = await doyleRest<DoyleGame[]>('doyle_tournaments?select=id,name,status,room_id,date,slots,entry_fee,stack,format,level_duration,late_reg&id=eq.' + id);
    if (!game) throw new DomainError('Турнир не найден', 404);
    const [room, registrations] = await Promise.all([
      game.room_id ? doyleRest<DoyleRoom[]>('rooms?select=state,version&room_id=eq.' + encodeURIComponent(game.room_id)) : [],
      !game.room_id || ['checkIn', 'checkOut', 'register', 'unregister'].includes(command.type)
        ? doyleRest<DoyleGame['registrations']>('doyle_registrations?select=player_id,attendance,doyle_players(name)&tournament_id=eq.' + id + '&order=id') : [],
    ]);
    if (game.room_id && !room[0]) throw new DomainError('Комната этого турнира недоступна', 409);
    const plan = planDoyleCommand({ ...game, registrations }, room[0], command, ctx.user.email);
    const result = await save({
      p_expected: game,
      p_version: room[0]?.version ?? null,
      p_state: plan.state,
      p_patch: plan.patch,
      p_attendance: plan.attendance,
      p_new_room_id: !game.room_id && plan.state ? randomBytes(3).toString('hex').toUpperCase() : null,
      p_display_token: !game.room_id && plan.state ? randomUUID() : null,
    });
    if (result === 'saved') return { message: plan.message };
    if (result === 'missing_player') throw new DomainError('Игрок не записан на этот турнир', 404);
    if (result !== 'conflict') break;
  }
  throw new DomainError('Турнир изменился. Обновите данные и повторите действие.', 409);
}

async function readDoyleOverlay(pg: PgAdapter): Promise<DoyleOverlay> {
  try {
    return await pg.systemTransaction(async tx => {
      const [meta, tasks, messages, events, presets] = await Promise.all([
        tx.query<{ player_id: string; stage: string; owner: string; phone: string; instagram: string; source: string }>(
          'SELECT player_id, stage, owner, phone, instagram, source FROM doyle_player_meta',
        ),
        tx.query<{ id: string; player_id: string; kind: string; title: string; assignee: string; due_at: string; completed_at: string | null; result: string; created_at: string }>(
          'SELECT id, player_id, kind, title, assignee, due_at, completed_at, result, created_at FROM doyle_crm_tasks ORDER BY created_at DESC LIMIT 1000',
        ),
        tx.query<{ id: string; player_id: string; direction: string; channel: string; author: string; body: string; created_at: string }>(
          'SELECT id, player_id, direction, channel, author, body, created_at FROM doyle_crm_messages ORDER BY created_at DESC LIMIT 1000',
        ),
        tx.query<{ id: string; player_id: string; kind: string; actor: string; summary: string; created_at: string }>(
          'SELECT id, player_id, kind, actor, summary, created_at FROM doyle_crm_events ORDER BY created_at DESC LIMIT 1000',
        ),
        tx.query<{ name: string; scheme: unknown }>(
          'SELECT name, scheme FROM doyle_rating_presets ORDER BY name',
        ),
      ]);
      return {
        playerMeta: meta.rows,
        crmTasks: tasks.rows.map(r => ({
          id: Number(r.id),
          player_id: r.player_id,
          kind: r.kind,
          title: r.title,
          assignee: r.assignee,
          due_at: Number(r.due_at),
          completed_at: r.completed_at != null ? Number(r.completed_at) : null,
          result: r.result,
          created_at: Number(r.created_at),
        })),
        crmMessages: messages.rows.map(r => ({
          id: Number(r.id),
          player_id: r.player_id,
          direction: r.direction,
          channel: r.channel,
          author: r.author,
          body: r.body,
          created_at: Number(r.created_at),
        })),
        crmEvents: events.rows.map(r => ({
          id: Number(r.id),
          player_id: r.player_id,
          kind: r.kind,
          actor: r.actor,
          summary: r.summary,
          created_at: Number(r.created_at),
        })),
        ratingPresets: presets.rows,
      };
    });
  } catch {
    return {};
  }
}

export async function readDoyleRows(ctx: AuthContext, pg?: PgAdapter): Promise<DoyleRows> {
  if (!hasDoyleAccess(ctx)) throw new DomainError('Нет доступа к данным Doyle', 403);

  const [entries, overlay] = await Promise.all([
    Promise.all((Object.keys(doyleQueries) as DoyleResource[]).map(async resource => {
      try {
        const query = doyleQueries[resource];
        const rows: unknown[] = [];
        const perPage = 500;
        for (let offset = 0; ; offset += perPage) {
          const separator = query.includes('?') ? '&' : '?';
          const page = await doyleRest<unknown[]>(query + separator + 'offset=' + offset + (query.includes('&limit=') ? '' : '&limit=' + perPage));
          if (!Array.isArray(page)) throw new Error('Invalid response');
          for (const item of page) rows.push(item);
          if (optionalDoyleResources.has(resource) || page.length < perPage) break;
        }
        return [resource, rows] as const;
      } catch {
        if (optionalDoyleResources.has(resource)) return [resource, []] as const;
        throw new DomainError('Не удалось загрузить данные Doyle. Попробуйте ещё раз.', 502);
      }
    })),
    pg ? readDoyleOverlay(pg) : Promise.resolve({}),
  ]);
  return { ...(Object.fromEntries(entries) as Record<DoyleResource, unknown[]>), ...overlay };
}
