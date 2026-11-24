import type { Payment, Player, Tournament, Visit } from './model.ts';

export type CrmPeriod = 'day' | 'week' | 'month' | 'custom';
export type MessageChannel = 'telegram' | 'instagram' | 'phone' | 'club';
export type MessageDirection = 'in' | 'out';
export type PipelineStage = 'lead' | 'registered' | 'first_visit' | 'regular' | 'reactivation' | 'lost';
export type TaskKind = 'call' | 'follow_up' | 'meeting';
export type TaskUrgency = 'overdue' | 'today' | 'upcoming' | 'none';
export type BroadcastSegment =
  | 'all'
  | 'new'
  | 'one_visit'
  | 'regular'
  | 'inactive_14'
  | 'inactive_30'
  | 'no_visits'
  | 'tag';

export type PipelineStageMeta = {
  id: PipelineStage;
  label: string;
  shortLabel: string;
  tone: 'neutral' | 'info' | 'accent' | 'strong' | 'warn' | 'muted';
};

export const pipelineStages: PipelineStageMeta[] = [
  { id: 'lead', label: 'Новый лид', shortLabel: 'Лид', tone: 'neutral' },
  { id: 'registered', label: 'Записался на турнир', shortLabel: 'Записался', tone: 'info' },
  { id: 'first_visit', label: 'Первый визит', shortLabel: '1-й визит', tone: 'accent' },
  { id: 'regular', label: 'Постоянный гость', shortLabel: 'Постоянный', tone: 'strong' },
  { id: 'reactivation', label: 'Вернуть (спящий)', shortLabel: 'Вернуть', tone: 'warn' },
  { id: 'lost', label: 'Отказ / архив', shortLabel: 'Архив', tone: 'muted' },
];

export const pipelineStageMap: Record<PipelineStage, PipelineStageMeta> = Object.fromEntries(
  pipelineStages.map(stage => [stage.id, stage]),
) as Record<PipelineStage, PipelineStageMeta>;

export const taskKindLabels: Record<TaskKind, string> = {
  call: 'Связаться',
  follow_up: 'Напомнить',
  meeting: 'Встреча в клубе',
};

export const defaultOwners = ['Администратор', 'Менеджер Анна', 'Флор Дмитрий'];

export type CrmTask = {
  id: number;
  playerId: string;
  kind: TaskKind;
  title: string;
  assignee: string;
  dueAt: number;
  completedAt: number | null;
  result: string;
  createdAt: number;
};

export type CrmEvent = {
  id: number;
  playerId: string;
  kind: string;
  actor: string;
  summary: string;
  createdAt: number;
};

export type PlayerNote = {
  id: number;
  playerId: string;
  author: string;
  body: string;
  createdAt: number;
};

export type PlayerMessage = {
  id: number;
  playerId: string;
  direction: MessageDirection;
  channel: MessageChannel;
  author: string;
  body: string;
  createdAt: number;
};

export type RegistrationRecord = {
  playerId: string;
  tournamentId: string;
  tournamentName: string;
  status: 'registered' | 'active' | 'out';
  queued: boolean;
  registeredAt: number;
  visitedAt: number | null;
  broadcastId: string | null;
};

export type BroadcastSummary = {
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
  registeredCount: number;
  attendedCount: number;
  revenue: number;
  rateLimitPerSec: number;
  createdAt: number;
  sentAt: number | null;
};

export type CrmData = {
  registrations: RegistrationRecord[];
  notes: PlayerNote[];
  messages: PlayerMessage[];
  broadcasts: BroadcastSummary[];
  tasks: CrmTask[];
  events: CrmEvent[];
  botConfigured: boolean;
  rateLimitPerSec: number;
};

export type CrmCommand =
  | { type: 'addPlayerNote'; playerId: string; body: string }
  | { type: 'deletePlayerNote'; noteId: number }
  | { type: 'addPlayerMessage'; playerId: string; direction: MessageDirection; channel: MessageChannel; body: string }
  | { type: 'setPlayerStage'; playerId: string; stage: PipelineStage }
  | { type: 'addCrmTask'; playerId: string; kind: TaskKind; title: string; assignee?: string; dueAt: number }
  | { type: 'completeCrmTask'; taskId: number; result?: string }
  | { type: 'deleteCrmTask'; taskId: number }
  | {
      type: 'sendBroadcast';
      title: string;
      segment: BroadcastSegment;
      tag?: string;
      tournamentId?: string | null;
      message: string;
      linkUrl?: string;
      recipientIds: string[];
    }
  | { type: 'trackBroadcastClick'; broadcastId: string; playerId: string };

export const broadcastSegmentLabels: Record<BroadcastSegment, string> = {
  all: 'Все зарегистрированные',
  new: 'Новые гости (до 14 дн.)',
  one_visit: 'Посетили один раз',
  regular: 'Постоянные гости (3+ визита)',
  inactive_14: 'Не приходили 14+ дней',
  inactive_30: 'Не приходили 30+ дней',
  no_visits: 'Зарегистрированы, но не приходили',
  tag: 'По тегу',
};

export const channelLabels: Record<MessageChannel, string> = {
  telegram: 'Telegram',
  instagram: 'Instagram',
  phone: 'Телефон',
  club: 'В клубе',
};

export const DAY_MS = 86_400_000;

export type GuestActivity = 'active' | 'cooling' | 'inactive' | 'never';

export type GuestSummary = {
  player: Player;
  visitsCount: number;
  registrationsCount: number;
  totalSpent: number;
  avgCheck: number;
  due: number;
  firstVisitAt: number | null;
  lastVisitAt: number | null;
  daysSinceLastVisit: number | null;
  activity: GuestActivity;
  tagList: string[];
};

export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function buildGuestSummaries(
  roster: Player[],
  registrations: RegistrationRecord[],
  visits: Visit[],
  payments: Payment[],
  now: number,
): GuestSummary[] {
  const visitsByPlayer = new Map<string, Visit[]>();
  for (const visit of visits) {
    const list = visitsByPlayer.get(visit.playerId) ?? [];
    list.push(visit);
    visitsByPlayer.set(visit.playerId, list);
  }

  const regsByPlayer = new Map<string, number>();
  for (const reg of registrations) {
    regsByPlayer.set(reg.playerId, (regsByPlayer.get(reg.playerId) ?? 0) + 1);
  }

  const spentByPlayer = new Map<string, number>();
  const balanceByPlayerTournament = new Map<string, Map<string, number>>();
  for (const payment of payments) {
    if (payment.kind === 'payment') {
      spentByPlayer.set(payment.playerId, (spentByPlayer.get(payment.playerId) ?? 0) + payment.amount);
    }
    const perTournament = balanceByPlayerTournament.get(payment.playerId) ?? new Map<string, number>();
    const delta = payment.waived ? 0 : payment.kind === 'payment' ? -payment.amount : payment.amount;
    perTournament.set(payment.tournamentId, (perTournament.get(payment.tournamentId) ?? 0) + delta);
    balanceByPlayerTournament.set(payment.playerId, perTournament);
  }

  return roster.map(player => {
    const playerVisits = visitsByPlayer.get(player.id) ?? [];
    let firstVisitAt: number | null = null;
    let lastVisitAt: number | null = null;
    for (const visit of playerVisits) {
      if (firstVisitAt === null || visit.time < firstVisitAt) firstVisitAt = visit.time;
      if (lastVisitAt === null || visit.time > lastVisitAt) lastVisitAt = visit.time;
    }
    const daysSinceLastVisit = lastVisitAt === null ? null : Math.max(0, Math.floor((now - lastVisitAt) / DAY_MS));
    const activity: GuestActivity =
      daysSinceLastVisit === null
        ? 'never'
        : daysSinceLastVisit <= 14
          ? 'active'
          : daysSinceLastVisit <= 30
            ? 'cooling'
            : 'inactive';
    const totalSpent = spentByPlayer.get(player.id) ?? 0;
    const avgCheck = playerVisits.length > 0 ? Math.round(totalSpent / playerVisits.length) : 0;
    const perTournament = balanceByPlayerTournament.get(player.id);
    const due = perTournament
      ? [...perTournament.values()].reduce((acc, amount) => acc + Math.max(0, amount), 0)
      : 0;
    return {
      player,
      visitsCount: playerVisits.length,
      registrationsCount: regsByPlayer.get(player.id) ?? 0,
      totalSpent,
      avgCheck,
      due,
      firstVisitAt,
      lastVisitAt,
      daysSinceLastVisit,
      activity,
      tagList: parseTags(player.tags),
    };
  });
}

export function periodBounds(
  period: CrmPeriod,
  now: number,
  customFrom?: string,
  customTo?: string,
): { start: number; end: number } {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (period === 'day') return { start: startOfToday.getTime(), end: endOfToday.getTime() };
  if (period === 'week') return { start: startOfToday.getTime() - 6 * DAY_MS, end: endOfToday.getTime() };
  if (period === 'month') return { start: startOfToday.getTime() - 29 * DAY_MS, end: endOfToday.getTime() };

  const fromMs = customFrom ? new Date(customFrom + 'T00:00:00').getTime() : startOfToday.getTime() - 29 * DAY_MS;
  const toMs = customTo ? new Date(customTo + 'T23:59:59.999').getTime() : endOfToday.getTime();
  const validFrom = Number.isFinite(fromMs) ? fromMs : startOfToday.getTime() - 29 * DAY_MS;
  const validTo = Number.isFinite(toMs) ? toMs : endOfToday.getTime();
  return validFrom <= validTo ? { start: validFrom, end: validTo } : { start: validTo, end: validFrom };
}

export type SourceBreakdown = {
  source: string;
  guests: number;
  attended: number;
  share: number;
};

export type TournamentPeriodRow = {
  id: string;
  name: string;
  date: number;
  registered: number;
  attended: number;
  conversion: number;
  revenue: number;
};

export type CrmAnalytics = {
  newRegistered: number;
  attendedGuests: number;
  totalVisits: number;
  newAttended: number;
  returningAttended: number;
  revenue: number;
  avgCheck: number;
  repeatVisitRate: number;
  registrationsTotal: number;
  registrationsAttended: number;
  registrationConversion: number;
  sources: SourceBreakdown[];
  tournaments: TournamentPeriodRow[];
};

export function computeCrmAnalytics(
  roster: Player[],
  registrations: RegistrationRecord[],
  visits: Visit[],
  payments: Payment[],
  schedule: Tournament[],
  start: number,
  end: number,
): CrmAnalytics {
  const inRange = (ts: number | null) => ts !== null && ts >= start && ts <= end;

  const firstVisitByPlayer = new Map<string, number>();
  for (const visit of visits) {
    const prev = firstVisitByPlayer.get(visit.playerId);
    if (prev === undefined || visit.time < prev) firstVisitByPlayer.set(visit.playerId, visit.time);
  }

  const newRegisteredPlayers = roster.filter(player => inRange(player.registeredAt));
  const periodVisits = visits.filter(visit => inRange(visit.time));
  const attendedSet = new Set(periodVisits.map(visit => visit.playerId));

  let newAttended = 0;
  let returningAttended = 0;
  for (const playerId of attendedSet) {
    const first = firstVisitByPlayer.get(playerId);
    if (first !== undefined && first >= start && first <= end) {
      const visitsInRange = periodVisits.filter(v => v.playerId === playerId).length;
      if (visitsInRange > 1) returningAttended++;
      else newAttended++;
    } else {
      returningAttended++;
    }
  }

  const periodPayments = payments.filter(p => p.kind === 'payment' && inRange(p.time));
  const revenue = periodPayments.reduce((sum, p) => sum + p.amount, 0);
  const avgCheck = periodVisits.length > 0 ? Math.round(revenue / periodVisits.length) : 0;
  const repeatVisitRate = attendedSet.size > 0 ? Math.round((returningAttended / attendedSet.size) * 100) : 0;

  const periodRegs = registrations.filter(reg => inRange(reg.registeredAt) || inRange(reg.visitedAt));
  const registrationsTotal = periodRegs.length;
  const registrationsAttended = periodRegs.filter(reg => reg.visitedAt !== null).length;
  const registrationConversion =
    registrationsTotal > 0 ? Math.round((registrationsAttended / registrationsTotal) * 100) : 0;

  // Разбивка по источникам: берём гостей, которые пришли или зарегистрировались в периоде (если период пуст — всех)
  const relevantIds = new Set<string>([
    ...newRegisteredPlayers.map(p => p.id),
    ...attendedSet,
  ]);
  const sourceBase = relevantIds.size > 0 ? roster.filter(p => relevantIds.has(p.id)) : [];
  const sourceMap = new Map<string, { guests: number; attended: number }>();
  for (const player of sourceBase) {
    const key = player.source.trim() || 'Не указан';
    const current = sourceMap.get(key) ?? { guests: 0, attended: 0 };
    current.guests += 1;
    if (attendedSet.has(player.id)) current.attended += 1;
    sourceMap.set(key, current);
  }
  const totalSourceGuests = sourceBase.length;
  const sources: SourceBreakdown[] = [...sourceMap.entries()]
    .map(([source, stat]) => ({
      source,
      guests: stat.guests,
      attended: stat.attended,
      share: totalSourceGuests > 0 ? Math.round((stat.guests / totalSourceGuests) * 100) : 0,
    }))
    .sort((a, b) => b.guests - a.guests || a.source.localeCompare(b.source, 'ru'));

  // Сводка по турнирам за период
  const tournamentById = new Map<string, TournamentPeriodRow>();
  for (const reg of periodRegs) {
    const existing = tournamentById.get(reg.tournamentId) ?? {
      id: reg.tournamentId,
      name: reg.tournamentName,
      date: reg.visitedAt ?? reg.registeredAt,
      registered: 0,
      attended: 0,
      conversion: 0,
      revenue: 0,
    };
    existing.registered += 1;
    if (reg.visitedAt !== null) existing.attended += 1;
    if ((reg.visitedAt ?? reg.registeredAt) > existing.date) existing.date = reg.visitedAt ?? reg.registeredAt;
    tournamentById.set(reg.tournamentId, existing);
  }
  for (const payment of periodPayments) {
    const existing = tournamentById.get(payment.tournamentId) ?? {
      id: payment.tournamentId,
      name: payment.tournamentName,
      date: payment.time,
      registered: 0,
      attended: 0,
      conversion: 0,
      revenue: 0,
    };
    existing.revenue += payment.amount;
    tournamentById.set(payment.tournamentId, existing);
  }
  const scheduleDates = new Map(schedule.map(t => [t.id, t.startsAt ? Date.parse(t.startsAt) : null]));
  const tournaments = [...tournamentById.values()]
    .map(row => ({
      ...row,
      date: scheduleDates.get(row.id) ?? row.date,
      conversion: row.registered > 0 ? Math.round((row.attended / row.registered) * 100) : 0,
    }))
    .sort((a, b) => b.date - a.date);

  return {
    newRegistered: newRegisteredPlayers.length,
    attendedGuests: attendedSet.size,
    totalVisits: periodVisits.length,
    newAttended,
    returningAttended,
    revenue,
    avgCheck,
    repeatVisitRate,
    registrationsTotal,
    registrationsAttended,
    registrationConversion,
    sources,
    tournaments,
  };
}

export type RetentionMetrics = {
  totalAttendedGuests: number;
  oneVisitCount: number;
  twoPlusVisitsCount: number;
  returnedIn7Days: number;
  returnedIn7DaysPct: number;
  returnedIn30Days: number;
  returnedIn30DaysPct: number;
  churnedCount: number;
  avgVisitsPerGuest: number;
  segments: {
    inactive14: GuestSummary[];
    inactive30: GuestSummary[];
    oneVisitOnly: GuestSummary[];
    registeredNoVisit: GuestSummary[];
  };
};

export function computeRetention(
  guests: GuestSummary[],
  visits: Visit[],
  now: number,
): RetentionMetrics {
  const visitsByPlayer = new Map<string, number[]>();
  for (const visit of visits) {
    const arr = visitsByPlayer.get(visit.playerId) ?? [];
    arr.push(visit.time);
    visitsByPlayer.set(visit.playerId, arr);
  }
  for (const arr of visitsByPlayer.values()) arr.sort((a, b) => a - b);

  const attended = guests.filter(g => g.visitsCount > 0);
  const oneVisitCount = attended.filter(g => g.visitsCount === 1).length;
  const twoPlusVisitsCount = attended.filter(g => g.visitsCount >= 2).length;

  let returnedIn7Days = 0;
  let returnedIn30Days = 0;
  for (const guest of attended) {
    const times = visitsByPlayer.get(guest.player.id) ?? [];
    if (times.length < 2) continue;
    const first = times[0];
    const second = times[1];
    const gap = second - first;
    if (gap <= 7 * DAY_MS) returnedIn7Days += 1;
    if (gap <= 30 * DAY_MS) returnedIn30Days += 1;
  }

  const churnedCount = attended.filter(g => g.daysSinceLastVisit !== null && g.daysSinceLastVisit > 30).length;
  const totalVisits = attended.reduce((sum, g) => sum + g.visitsCount, 0);
  const avgVisitsPerGuest = attended.length > 0 ? Math.round((totalVisits / attended.length) * 10) / 10 : 0;

  const inactive14 = guests
    .filter(g => g.daysSinceLastVisit !== null && g.daysSinceLastVisit >= 14)
    .sort((a, b) => (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0));
  const inactive30 = guests
    .filter(g => g.daysSinceLastVisit !== null && g.daysSinceLastVisit >= 30)
    .sort((a, b) => (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0));
  const oneVisitOnly = guests
    .filter(g => g.visitsCount === 1)
    .sort((a, b) => (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0));
  const registeredNoVisit = guests
    .filter(g => g.visitsCount === 0)
    .sort((a, b) => b.player.registeredAt - a.player.registeredAt);

  return {
    totalAttendedGuests: attended.length,
    oneVisitCount,
    twoPlusVisitsCount,
    returnedIn7Days,
    returnedIn7DaysPct: attended.length > 0 ? Math.round((returnedIn7Days / attended.length) * 100) : 0,
    returnedIn30Days,
    returnedIn30DaysPct: attended.length > 0 ? Math.round((returnedIn30Days / attended.length) * 100) : 0,
    churnedCount,
    avgVisitsPerGuest,
    segments: {
      inactive14,
      inactive30,
      oneVisitOnly,
      registeredNoVisit,
    },
  };
}

export function selectBroadcastRecipients(
  guests: GuestSummary[],
  segment: BroadcastSegment,
  now: number,
  tag?: string,
): { matched: GuestSummary[]; eligible: GuestSummary[]; skippedNoConsent: number } {
  const matched = guests.filter(guest => {
    switch (segment) {
      case 'all':
        return true;
      case 'new':
        return guest.player.registeredAt > 0 && now - guest.player.registeredAt <= 14 * DAY_MS;
      case 'one_visit':
        return guest.visitsCount === 1;
      case 'regular':
        return guest.visitsCount >= 3;
      case 'inactive_14':
        return guest.daysSinceLastVisit !== null && guest.daysSinceLastVisit >= 14;
      case 'inactive_30':
        return guest.daysSinceLastVisit !== null && guest.daysSinceLastVisit >= 30;
      case 'no_visits':
        return guest.visitsCount === 0;
      case 'tag':
        return Boolean(tag) && guest.tagList.some(t => t.toLowerCase() === tag!.toLowerCase());
    }
  });
  const eligible = matched.filter(g => g.player.telegramConsent && g.player.telegram.trim() !== '');
  return {
    matched,
    eligible,
    skippedNoConsent: matched.length - eligible.length,
  };
}

export function taskUrgency(tasks: CrmTask[], now: number): { urgency: TaskUrgency; nextTask: CrmTask | null; overdueCount: number } {
  const open = tasks.filter(task => task.completedAt === null).sort((a, b) => a.dueAt - b.dueAt);
  if (!open.length) return { urgency: 'none', nextTask: null, overdueCount: 0 };
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const overdueCount = open.filter(task => task.dueAt < now).length;
  const nextTask = open[0];
  if (overdueCount > 0) return { urgency: 'overdue', nextTask, overdueCount };
  if (nextTask.dueAt <= endOfToday.getTime()) return { urgency: 'today', nextTask, overdueCount: 0 };
  return { urgency: 'upcoming', nextTask, overdueCount: 0 };
}
