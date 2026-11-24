import { randomUUID } from 'node:crypto';
import type { Transaction } from '@electric-sql/pglite';
import {
  broadcastSegmentLabels,
  channelLabels,
  pipelineStageMap,
  taskKindLabels,
  type BroadcastSegment,
  type BroadcastSummary,
  type CrmCommand,
  type CrmData,
  type CrmEvent,
  type CrmTask,
  type MessageChannel,
  type MessageDirection,
  type PipelineStage,
  type PlayerMessage,
  type PlayerNote,
  type RegistrationRecord,
  type TaskKind,
} from '../shared/crm.ts';
import { DomainError, field, integer } from './validation.ts';

export const crmTypes = [
  'addPlayerNote',
  'deletePlayerNote',
  'addPlayerMessage',
  'setPlayerStage',
  'addCrmTask',
  'completeCrmTask',
  'deleteCrmTask',
  'sendBroadcast',
  'trackBroadcastClick',
] as const satisfies readonly CrmCommand['type'][];

export const emptyCrmData: CrmData = {
  registrations: [],
  notes: [],
  messages: [],
  broadcasts: [],
  tasks: [],
  events: [],
  botConfigured: false,
  rateLimitPerSec: 25,
};

const validSegments = new Set<string>(Object.keys(broadcastSegmentLabels));
const validChannels = new Set<string>(Object.keys(channelLabels));
const validStages = new Set<string>(Object.keys(pipelineStageMap));
const validTaskKinds = new Set<string>(Object.keys(taskKindLabels));

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === 'string' && validStages.has(value);
}

export async function loadCrmData(tx: Transaction, clubId: string): Promise<CrmData> {
  const registrations = (
    await tx.query<{
      playerId: string;
      tournamentId: string;
      tournamentName: string;
      status: 'registered' | 'active' | 'out';
      queued: boolean;
      registeredAt: string | null;
      visitedAt: string | null;
      broadcastId: string | null;
    }>(
      `SELECT e.player_id AS "playerId", t.id AS "tournamentId", t.name AS "tournamentName",
        e.status, (e.queued_at IS NOT NULL) AS queued,
        COALESCE(e.registered_at, e.queued_at, e.visited_at, EXTRACT(EPOCH FROM COALESCE(t.starts_at, NOW()))::bigint * 1000) AS "registeredAt",
        e.visited_at AS "visitedAt", e.broadcast_id AS "broadcastId"
       FROM entries e
       JOIN tournaments t ON t.id = e.tournament_id
       WHERE e.club_id = $1
       ORDER BY COALESCE(e.visited_at, e.registered_at, e.queued_at, 0) DESC, t.name`,
      [clubId],
    )
  ).rows.map<RegistrationRecord>(row => ({
    playerId: row.playerId,
    tournamentId: row.tournamentId,
    tournamentName: row.tournamentName,
    status: row.status,
    queued: row.queued,
    registeredAt: Number(row.registeredAt ?? 0),
    visitedAt: row.visitedAt === null ? null : Number(row.visitedAt),
    broadcastId: row.broadcastId,
  }));

  const notes = (
    await tx.query<{ id: number; playerId: string; author: string; body: string; createdAt: string }>(
      `SELECT id::int, player_id AS "playerId", author, body, created_at AS "createdAt"
       FROM player_notes WHERE club_id = $1 ORDER BY created_at DESC, id DESC`,
      [clubId],
    )
  ).rows.map<PlayerNote>(row => ({ ...row, createdAt: Number(row.createdAt) }));

  const messages = (
    await tx.query<{
      id: number;
      playerId: string;
      direction: MessageDirection;
      channel: MessageChannel;
      author: string;
      body: string;
      createdAt: string;
    }>(
      `SELECT id::int, player_id AS "playerId", direction, channel, author, body, created_at AS "createdAt"
       FROM player_messages WHERE club_id = $1 ORDER BY created_at DESC, id DESC`,
      [clubId],
    )
  ).rows.map<PlayerMessage>(row => ({ ...row, createdAt: Number(row.createdAt) }));

  const broadcastRows = (
    await tx.query<{
      id: string;
      title: string;
      segment: BroadcastSegment;
      segmentLabel: string;
      tournamentId: string | null;
      tournamentName: string | null;
      message: string;
      linkUrl: string;
      status: 'draft' | 'sending' | 'sent' | 'failed';
      mode: 'demo' | 'live';
      sentCount: number;
      failedCount: number;
      clicksCount: number;
      rateLimitPerSec: number;
      createdAt: string;
      sentAt: string | null;
    }>(
      `SELECT b.id, b.title, b.segment, b.segment_label AS "segmentLabel",
        b.tournament_id AS "tournamentId", t.name AS "tournamentName",
        b.message, b.link_url AS "linkUrl", b.status, b.mode,
        b.sent_count AS "sentCount", b.failed_count AS "failedCount",
        b.clicks_count AS "clicksCount", b.rate_limit_per_sec AS "rateLimitPerSec",
        b.created_at AS "createdAt", b.sent_at AS "sentAt"
       FROM broadcasts b
       LEFT JOIN tournaments t ON t.id = b.tournament_id
       WHERE b.club_id = $1
       ORDER BY b.created_at DESC`,
      [clubId],
    )
  ).rows;

  const recipientStats = (
    await tx.query<{
      broadcastId: string;
      clicks: number;
      registered: number;
      attended: number;
      revenue: number;
    }>(
      `SELECT r.broadcast_id AS "broadcastId",
        COUNT(*) FILTER (WHERE r.clicked_at IS NOT NULL)::int AS clicks,
        COUNT(DISTINCT CASE WHEN r.registered_tournament_id IS NOT NULL OR e.player_id IS NOT NULL THEN r.player_id END)::int AS registered,
        COUNT(DISTINCT CASE WHEN r.visited_tournament_id IS NOT NULL OR e.visited_at IS NOT NULL THEN r.player_id END)::int AS attended,
        COALESCE(SUM(pay.total), 0)::int AS revenue
       FROM broadcast_recipients r
       JOIN broadcasts b ON b.id = r.broadcast_id
       LEFT JOIN entries e ON e.club_id = r.club_id
         AND e.player_id = r.player_id
         AND (
           (b.tournament_id IS NOT NULL AND e.tournament_id = b.tournament_id)
           OR e.broadcast_id = b.id
         )
       LEFT JOIN (
         SELECT club_id, tournament_id, player_id, SUM(amount)::int AS total
         FROM payments
         WHERE kind = 'payment' AND NOT voided
         GROUP BY club_id, tournament_id, player_id
       ) pay ON pay.club_id = r.club_id
         AND pay.player_id = r.player_id
         AND pay.tournament_id = COALESCE(r.visited_tournament_id, CASE WHEN e.visited_at IS NOT NULL THEN e.tournament_id END)
       WHERE r.club_id = $1
       GROUP BY r.broadcast_id`,
      [clubId],
    )
  ).rows;

  const statsMap = new Map(recipientStats.map(item => [item.broadcastId, item]));
  const broadcasts: BroadcastSummary[] = broadcastRows.map(row => {
    const stat = statsMap.get(row.id);
    return {
      ...row,
      clicksCount: Math.max(row.clicksCount, stat?.clicks ?? 0),
      registeredCount: stat?.registered ?? 0,
      attendedCount: stat?.attended ?? 0,
      revenue: stat?.revenue ?? 0,
      createdAt: Number(row.createdAt),
      sentAt: row.sentAt === null ? null : Number(row.sentAt),
    };
  });

  const tasks = (
    await tx.query<{
      id: number;
      playerId: string;
      kind: TaskKind;
      title: string;
      assignee: string;
      dueAt: string;
      completedAt: string | null;
      result: string;
      createdAt: string;
    }>(
      `SELECT id::int, player_id AS "playerId", kind, title, assignee,
        due_at AS "dueAt", completed_at AS "completedAt", result, created_at AS "createdAt"
       FROM crm_tasks WHERE club_id = $1 ORDER BY completed_at NULLS FIRST, due_at ASC, id DESC`,
      [clubId],
    )
  ).rows.map<CrmTask>(row => ({
    ...row,
    dueAt: Number(row.dueAt),
    completedAt: row.completedAt === null ? null : Number(row.completedAt),
    createdAt: Number(row.createdAt),
  }));

  const events = (
    await tx.query<{
      id: number;
      playerId: string;
      kind: string;
      actor: string;
      summary: string;
      createdAt: string;
    }>(
      `SELECT id::int, player_id AS "playerId", kind, actor, summary, created_at AS "createdAt"
       FROM crm_events WHERE club_id = $1 ORDER BY created_at DESC, id DESC LIMIT 300`,
      [clubId],
    )
  ).rows.map<CrmEvent>(row => ({ ...row, createdAt: Number(row.createdAt) }));

  return {
    registrations,
    notes,
    messages,
    broadcasts,
    tasks,
    events,
    botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    rateLimitPerSec: 25,
  };
}

export async function crmOperation(
  tx: Transaction,
  clubId: string,
  action: CrmCommand,
  time: number,
): Promise<string> {
  if (action.type === 'addPlayerNote') {
    const playerId = field(action.playerId, 80, true);
    const body = field(action.body, 1000, true);
    const exists = await tx.query('SELECT name FROM players WHERE club_id=$1 AND id=$2', [clubId, playerId]);
    if (!exists.rows[0]) throw new DomainError('Игрок не найден', 404);
    await tx.query(
      "INSERT INTO player_notes (club_id, player_id, author, body, created_at) VALUES ($1,$2,'Администратор',$3,$4)",
      [clubId, playerId, body, time],
    );
    return 'Заметка сохранена';
  }

  if (action.type === 'deletePlayerNote') {
    const noteId = integer(action.noteId, 1, 2_000_000_000, 'Некорректная заметка');
    const deleted = await tx.query('DELETE FROM player_notes WHERE club_id=$1 AND id=$2 RETURNING id', [clubId, noteId]);
    if (!deleted.rows[0]) throw new DomainError('Заметка не найдена', 404);
    return 'Заметка удалена';
  }

  if (action.type === 'addPlayerMessage') {
    const playerId = field(action.playerId, 80, true);
    const body = field(action.body, 2000, true);
    if (action.direction !== 'in' && action.direction !== 'out') {
      throw new DomainError('Укажите направление сообщения', 400);
    }
    if (!validChannels.has(action.channel)) {
      throw new DomainError('Выберите канал переписки', 400);
    }
    const { rows } = await tx.query<{ name: string }>('SELECT name FROM players WHERE club_id=$1 AND id=$2', [clubId, playerId]);
    if (!rows[0]) throw new DomainError('Игрок не найден', 404);
    const author = action.direction === 'in' ? rows[0].name : 'Администратор';
    await tx.query(
      'INSERT INTO player_messages (club_id, player_id, direction, channel, author, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [clubId, playerId, action.direction, action.channel, author, body, time],
    );
    return 'Сообщение добавлено в историю';
  }

  if (action.type === 'setPlayerStage') {
    const playerId = field(action.playerId, 80, true);
    if (!isPipelineStage(action.stage)) throw new DomainError('Неизвестный этап воронки', 400);
    const { rows } = await tx.query<{ name: string; stage: PipelineStage }>(
      'SELECT name, stage FROM players WHERE club_id=$1 AND id=$2',
      [clubId, playerId],
    );
    if (!rows[0]) throw new DomainError('Игрок не найден', 404);
    if (rows[0].stage === action.stage) return 'Этап не изменился';
    const prevLabel = pipelineStageMap[rows[0].stage]?.label ?? rows[0].stage;
    const nextLabel = pipelineStageMap[action.stage].label;
    await tx.query('UPDATE players SET stage=$3 WHERE club_id=$1 AND id=$2', [clubId, playerId, action.stage]);
    await tx.query(
      "INSERT INTO crm_events (club_id, player_id, kind, actor, summary, created_at) VALUES ($1,$2,'stage','Администратор',$3,$4)",
      [clubId, playerId, `Этап изменён: «${prevLabel}» → «${nextLabel}»`, time],
    );
    return `${rows[0].name} · этап «${nextLabel}»`;
  }

  if (action.type === 'addCrmTask') {
    const playerId = field(action.playerId, 80, true);
    const title = field(action.title, 300, true);
    const assignee = field(action.assignee ?? 'Администратор', 80) || 'Администратор';
    if (!validTaskKinds.has(action.kind)) throw new DomainError('Выберите тип задачи', 400);
    if (typeof action.dueAt !== 'number' || !Number.isFinite(action.dueAt) || action.dueAt <= 0) {
      throw new DomainError('Укажите срок выполнения задачи', 400);
    }
    const exists = await tx.query('SELECT 1 FROM players WHERE club_id=$1 AND id=$2', [clubId, playerId]);
    if (!exists.rows[0]) throw new DomainError('Игрок не найден', 404);
    await tx.query(
      'INSERT INTO crm_tasks (club_id, player_id, kind, title, assignee, due_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [clubId, playerId, action.kind, title, assignee, Math.round(action.dueAt), time],
    );
    return 'Задача создана';
  }

  if (action.type === 'completeCrmTask') {
    const taskId = integer(action.taskId, 1, 2_000_000_000, 'Некорректная задача');
    const result = field(action.result ?? '', 400);
    const { rows } = await tx.query<{ playerId: string; title: string }>(
      'UPDATE crm_tasks SET completed_at=$3, result=$4 WHERE club_id=$1 AND id=$2 RETURNING player_id AS "playerId", title',
      [clubId, taskId, time, result],
    );
    if (!rows[0]) throw new DomainError('Задача не найдена', 404);
    await tx.query(
      "INSERT INTO crm_events (club_id, player_id, kind, actor, summary, created_at) VALUES ($1,$2,'task','Администратор',$3,$4)",
      [clubId, rows[0].playerId, `Выполнена задача: «${rows[0].title}»${result ? ' — ' + result : ''}`, time],
    );
    return 'Задача выполнена';
  }

  if (action.type === 'deleteCrmTask') {
    const taskId = integer(action.taskId, 1, 2_000_000_000, 'Некорректная задача');
    const deleted = await tx.query('DELETE FROM crm_tasks WHERE club_id=$1 AND id=$2 RETURNING id', [clubId, taskId]);
    if (!deleted.rows[0]) throw new DomainError('Задача не найдена', 404);
    return 'Задача удалена';
  }

  if (action.type === 'sendBroadcast') {
    if (!validSegments.has(action.segment)) throw new DomainError('Неизвестный сегмент рассылки', 400);
    const message = field(action.message, 4096, true);
    const title = field(action.title ?? '', 120) || broadcastSegmentLabels[action.segment];
    const linkUrl = field(action.linkUrl ?? '', 400);
    const tag = action.tag ? field(action.tag, 60) : '';
    const tournamentId = action.tournamentId ? field(action.tournamentId, 80) : null;
    if (tournamentId) {
      const exists = await tx.query('SELECT 1 FROM tournaments WHERE club_id=$1 AND id=$2', [clubId, tournamentId]);
      if (!exists.rows[0]) throw new DomainError('Выбранный турнир не найден', 404);
    }
    const rawIds = Array.isArray(action.recipientIds) ? action.recipientIds : [];
    const uniqueIds = [...new Set(rawIds.map(id => field(id, 80)).filter(Boolean))];
    if (!uniqueIds.length) throw new DomainError('Выберите хотя бы одного получателя', 400);

    const eligible = (
      await tx.query<{ id: string; telegram: string }>(
        `SELECT id, telegram FROM players
         WHERE club_id = $1 AND id = ANY($2::text[]) AND telegram_consent = true AND btrim(telegram) <> ''`,
        [clubId, uniqueIds],
      )
    ).rows;
    if (!eligible.length) {
      throw new DomainError('Нет получателей с согласием на Telegram-рассылку и указанным Telegram', 400);
    }

    const broadcastId = 'bc-' + randomUUID().slice(0, 8);
    const segmentLabel =
      action.segment === 'tag' && tag ? `Тег «${tag}»` : broadcastSegmentLabels[action.segment];
    const mode = process.env.TELEGRAM_BOT_TOKEN ? 'live' : 'demo';
    const rateLimitPerSec = 25;

    await tx.query(
      `INSERT INTO broadcasts (id, club_id, title, segment, segment_label, tournament_id, message, link_url, status, mode, sent_count, failed_count, clicks_count, rate_limit_per_sec, created_at, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',$9,$10,0,0,$11,$12,$12)`,
      [broadcastId, clubId, title, action.segment, segmentLabel, tournamentId, message, linkUrl, mode, eligible.length, rateLimitPerSec, time],
    );

    const textWithLink = linkUrl ? `${message}\n${linkUrl}` : message;
    for (const recipient of eligible) {
      await tx.query(
        `INSERT INTO broadcast_recipients (broadcast_id, club_id, player_id, status, sent_at)
         VALUES ($1,$2,$3,'sent',$4)`,
        [broadcastId, clubId, recipient.id, time],
      );
      await tx.query(
        `INSERT INTO player_messages (club_id, player_id, direction, channel, author, body, created_at)
         VALUES ($1,$2,'out','telegram','Бот клуба (рассылка)',$3,$4)`,
        [clubId, recipient.id, textWithLink, time],
      );
    }

    return `Рассылка отправлена · получателей: ${eligible.length} (лимит ${rateLimitPerSec} сообщ./сек)`;
  }

  if (action.type === 'trackBroadcastClick') {
    const broadcastId = field(action.broadcastId, 80, true);
    const playerId = field(action.playerId, 80, true);
    const updated = await tx.query(
      `UPDATE broadcast_recipients
       SET clicked_at = COALESCE(clicked_at, $4)
       WHERE broadcast_id = $1 AND club_id = $2 AND player_id = $3
       RETURNING player_id`,
      [broadcastId, clubId, playerId, time],
    );
    if (!updated.rows[0]) throw new DomainError('Получатель рассылки не найден', 404);
    await tx.query(
      `UPDATE broadcasts SET clicks_count = (
         SELECT COUNT(*)::int FROM broadcast_recipients WHERE broadcast_id = $1 AND clicked_at IS NOT NULL
       ) WHERE id = $1`,
      [broadcastId],
    );
    return 'Переход по ссылке зафиксирован';
  }

  throw new DomainError('Неизвестное действие CRM', 400);
}
