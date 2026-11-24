import { randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { Club, Command, PublicSchedule, Session, Tournament, TournamentDefinition } from '../shared/model.ts';
import { defaultConfig, formats, type Preset } from '../shared/operations.ts';
import { inWeek, scheduleKey, weekStart } from '../shared/schedule.ts';
import { assertStructureEditable, configOf, displayOf, structureOf, type StateRow } from './runtime.ts';
import { DomainError, field, scheduledDate, validateConfig, validateStructure } from './validation.ts';

export const tournamentColumns = `id,name,club_id AS "clubId",state,description,layout,
  to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startsAt"`;

export async function tournamentRow(tx: Transaction, clubId: string, id: string, lock = false) {
  const { rows: [row] } = await tx.query<StateRow>(
    `SELECT ${tournamentColumns},level,remaining,started_at AS "startedAt",revision,config,structure,manual_break AS "manualBreak",display,manual_stats AS "manualStats"
    FROM tournaments WHERE club_id=$1 AND id=$2` + (lock ? ' FOR UPDATE' : ''), [clubId, id]);
  if (!row) throw new DomainError('Турнир не найден', 404);
  return row;
}

export async function publicSchedule(db: PGlite, clubId: string): Promise<PublicSchedule> {
  return db.transaction(async tx => {
    const { rows: [club] } = await tx.query<Club>('SELECT id,name,venue,accent FROM clubs WHERE id=$1', [clubId]);
    if (!club) throw new DomainError('Клуб не найден', 404);
    const { rows } = await tx.query<Tournament & { config: StateRow['config'] }>(
      `SELECT ${tournamentColumns},config FROM tournaments WHERE club_id=$1 AND state<>'draft'
       ORDER BY CASE state WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, starts_at NULLS LAST,name,id`, [clubId]);
    return { club, tournaments: rows.map(({ config, layout: _layout, ...item }) => ({
      ...item, format: config.format ?? defaultConfig.format, buyIn: config.buyIn ?? defaultConfig.buyIn,
      startStack: config.startStack ?? defaultConfig.startStack,
    })) };
  });
}

async function layoutOf(tx: Transaction, clubId: string, layout: string | null) {
  if (layout === null) return;
  const name = layout.slice(5);
  if (layout.startsWith('base:') && Object.hasOwn(formats, name)) {
    return { structure: formats[name], config: { ...defaultConfig, seating: false, format: name } };
  }
  if (layout.startsWith('club:')) {
    const { rows: [preset] } = await tx.query<Preset>(
      'SELECT name,structure,config FROM blind_presets WHERE club_id=$1 AND name=$2', [clubId, name]);
    if (preset) return preset;
  }
  throw new DomainError('Макет этого клуба не найден. Выберите другой макет', 404);
}

export async function createTournament(tx: Transaction, session: Session, action: Extract<Command, { type: 'createTournament' }>) {
  const clubId = session.club.id;
  const name = field(action.name, 80, true);
  const description = field(action.description ?? '', 1000);
  const startsAt = scheduledDate(action.startsAt ?? null);
  if (action.publish !== undefined && typeof action.publish !== 'boolean') throw new DomainError('Выберите способ сохранения', 400);
  if (action.publish && !startsAt) throw new DomainError('Укажите дату и время перед публикацией', 400);
  const layout = action.layout == null ? null : field(action.layout, 45, true);
  const preset = await layoutOf(tx, clubId, layout);
  const structure = validateStructure(action.structure === undefined ? preset?.structure ?? formats.Deepstack : action.structure);
  const defaults = { ...defaultConfig, seating: false, format: layout?.slice(5) ?? defaultConfig.format, ...preset?.config };
  const config = validateConfig(action.config === undefined
    ? { ...defaults, lateRegistration: Math.min(defaults.lateRegistration, structure.filter(level => level.kind === 'play').length) } : action.config, structure);
  const id = await insertTournament(tx, clubId, { name, description, startsAt, layout, config, structure }, !!action.publish);
  const initialLimit = config.seating ? config.registrationLimit : 0;
  const tableCount = Math.min(20, Math.max(3, Math.ceil(initialLimit / 10)));
  const seatsPerTable = Math.min(10, Math.max(8, Math.ceil(initialLimit / tableCount)));
  await tx.query('INSERT INTO seats SELECT $1,t,s FROM generate_series(1,$2::int) t CROSS JOIN generate_series(1,$3::int) s',
    [id, tableCount, seatsPerTable]);
  return { message: action.publish ? 'Турнир опубликован' : 'Черновик сохранён', tournamentId: id };
}

async function insertTournament(tx: Transaction, clubId: string, definition: TournamentDefinition, publish: boolean) {
  const { name, description, startsAt, layout, config, structure } = definition;
  const id = randomUUID();
  await tx.query(`INSERT INTO tournaments (id,club_id,name,description,starts_at,layout,config,structure,remaining,state)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, clubId, name, description, startsAt, layout, JSON.stringify(config), JSON.stringify(structure),
      structure[0].duration, publish ? 'scheduled' : 'draft']);
  return id;
}

function monday(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !scheduledDate(value + 'T00:00:00.000Z') ||
      weekStart(value) !== value) throw new DomainError('Выберите неделю', 400);
  return value;
}

export async function copyTournamentWeek(tx: Transaction, clubId: string, action: Extract<Command, { type: 'copyTournamentWeek' }>, time: number) {
  const sourceWeek = monday(action.sourceWeek);
  const targetWeek = monday(action.targetWeek);
  if (targetWeek <= sourceWeek) throw new DomainError('Неделя назначения должна быть позже исходной', 400);
  if (!Array.isArray(action.tournaments) || !action.tournaments.length || action.tournaments.length > 100 ||
      typeof action.publish !== 'boolean') throw new DomainError('Выберите от 1 до 100 турниров', 400);

  const existing = await tx.query<Pick<Tournament, 'name' | 'startsAt'>>(
    `SELECT ${tournamentColumns} FROM tournaments WHERE club_id=$1 AND starts_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Moscow')
    AND starts_at < (($2::date + 7)::timestamp AT TIME ZONE 'Europe/Moscow')`, [clubId, targetWeek]);
  const dates = new Set(existing.rows.flatMap(item => item.startsAt ? [scheduleKey(item.name, item.startsAt)] : []));
  const sources = new Set<string>();
  const label = action.publish ? 'Турнир скопирован и опубликован' : 'Черновик скопирован из расписания';
  for (const item of action.tournaments) {
    const sourceId = field(item?.sourceId, 80, true);
    const name = field(item?.name, 80, true);
    const startsAt = scheduledDate(item?.startsAt);
    const source = await tournamentRow(tx, clubId, sourceId);
    if (sources.has(sourceId) || !source.startsAt || source.state === 'draft' || !inWeek(source.startsAt, sourceWeek) ||
        !startsAt || !inWeek(startsAt, targetWeek)) throw new DomainError('Проверьте турниры и даты выбранных недель', 400);
    sources.add(sourceId);
    const key = scheduleKey(name, startsAt);
    if (dates.has(key)) throw new DomainError('«' + name + '» уже есть на это время. Обновите план недели', 409);
    dates.add(key);
    const id = await insertTournament(tx, clubId, { ...source, name, startsAt, config: configOf(source), structure: structureOf(source) }, action.publish);
    await tx.query('INSERT INTO seats SELECT $1,table_no,seat_no FROM seats WHERE tournament_id=$2', [id, sourceId]);
    await tx.query("INSERT INTO journal (tournament_id,label,actor,time) VALUES ($1,$2,'Администратор',$3)", [id, label, time]);
  }
  return (action.publish ? 'Опубликовано турниров: ' : 'Сохранено черновиков: ') + action.tournaments.length;
}

export async function updateDefinition(tx: Transaction, row: StateRow, action: Extract<Command, { type: 'updateTournament' }>) {
  if (row.state === 'finished') throw new DomainError('Турнир завершён');
  const name = field(action.name, 80, true);
  const description = field(action.description, 1000);
  const startsAt = scheduledDate(action.startsAt);
  if (row.state !== 'draft' && row.startsAt && startsAt === null) throw new DomainError('Укажите дату и время турнира', 400);
  const layout = action.layout === null ? null : field(action.layout, 45, true);
  if (layout !== row.layout) {
    if (row.state === 'live') throw new DomainError('Макет можно сменить до начала игры');
    await layoutOf(tx, row.clubId, layout);
  }
  const structure = validateStructure(action.structure);
  if (row.manualBreak && JSON.stringify(structure) !== JSON.stringify(structureOf(row))) {
    throw new DomainError('Во время перерыва нельзя менять структуру уровней');
  }
  assertStructureEditable(row, structure);
  const previous = configOf(row);
  const config = validateConfig(action.config, structure, row.state === 'live' ? previous.seating : undefined, previous.anteEnabled);
  const display = displayOf(row);
  if (!config.seating && display.mode === 'seating') display.mode = 'clock';
  await tx.query(`UPDATE tournaments SET name=$2,description=$3,starts_at=$4,layout=$5,
    config=$6,structure=$7,remaining=$8,display=$9 WHERE id=$1`, [
    row.id, name, description, startsAt, layout, JSON.stringify(config), JSON.stringify(structure),
    row.state === 'live' ? row.remaining : structure[0].duration, JSON.stringify(display),
  ]);
  return row.state === 'draft' ? 'Черновик сохранён' : 'Изменения турнира сохранены';
}
