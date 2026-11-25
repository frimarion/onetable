import { doyleQueries, optionalDoyleResources, type DoyleResource, type DoyleRows } from '../shared/doyleQueries.ts';
import type { AuthContext } from './auth.ts';
import { DomainError } from './validation.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Command, CommandResult } from '../shared/model.ts';
import { planDoyleCommand, type DoyleGame, type DoyleRoom } from './doyleCommands.ts';

const linkedUserId = process.env.DOYLE_ONETABLE_USER_ID;
const serviceKey = process.env.DOYLE_SERVICE_ROLE_KEY;

export function hasDoyleAccess(ctx: AuthContext): boolean {
  return Boolean(serviceKey && linkedUserId === ctx.user.id && ctx.club.id === 'doyle' && ctx.memberRole === 'owner');
}

export function canWriteDoyle(ctx: AuthContext): boolean {
  return process.env.DOYLE_COMMANDS_ENABLED === '1' && hasDoyleAccess(ctx);
}

async function doyleRest<T>(path: string, post?: object): Promise<T> {
  const response = await fetch('http://127.0.0.1:8000/rest/v1/' + path, {
    headers: { apikey: serviceKey!, Authorization: 'Bearer ' + serviceKey!, 'Content-Type': 'application/json' },
    ...(post ? { method: 'POST', body: JSON.stringify(post) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) {
    console.error('Doyle request failed', response.status, path.split('?')[0]);
    throw new DomainError('Не удалось выполнить действие в Doyle. Попробуйте ещё раз.', 502);
  }
  return await response.json() as T;
}

export async function writeDoyleCommand(ctx: AuthContext, id: string, requestId: string, command: Command): Promise<CommandResult> {
  if (!canWriteDoyle(ctx)) throw new DomainError('Нет доступа к управлению турнирами Doyle', 403);
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
  const save = (overrides = {}) => doyleRest<string>('rpc/onetable_save_doyle_command', { ...request, ...overrides });
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

export async function readDoyleRows(ctx: AuthContext): Promise<DoyleRows> {
  if (!hasDoyleAccess(ctx)) throw new DomainError('Нет доступа к данным Doyle', 403);

  const entries = await Promise.all((Object.keys(doyleQueries) as DoyleResource[]).map(async resource => {
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
  }));
  return Object.fromEntries(entries) as DoyleRows;
}
