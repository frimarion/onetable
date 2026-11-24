import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Check, MessageSquare, Send, StickyNote, Trash2, X } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import {
  DAY_MS,
  channelLabels,
  defaultOwners,
  pipelineStages,
  taskKindLabels,
  type CrmTask,
  type GuestSummary,
  type MessageChannel,
  type MessageDirection,
  type PipelineStage,
  type TaskKind,
} from '../../shared/crm';
import type { Run } from '../api';
import { paymentLabels } from '../../shared/payments';
import { money } from '../widgets';

type ComposerMode = 'note' | 'task' | 'message';
type TimelineFilter = 'all' | 'messages' | 'notes' | 'tasks' | 'events';

type TimelineEntry =
  | { id: string; time: number; type: 'message'; direction: MessageDirection; channel: MessageChannel; author: string; body: string }
  | { id: string; time: number; type: 'note'; noteId: number; author: string; body: string }
  | { id: string; time: number; type: 'task'; task: CrmTask }
  | { id: string; time: number; type: 'event'; badge: string; title: string; detail?: string };

const tagPresets = ['VIP', 'Регуляр', 'Новичок', 'Спящий'];

function formatDate(ms: number | null) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CrmGuestDrawer({
  guest,
  data,
  run,
  busy,
  onClose,
}: {
  guest: GuestSummary;
  data: Snapshot;
  run: Run;
  busy: boolean;
  onClose: () => void;
}) {
  const player = guest.player;
  const [tagsDraft, setTagsDraft] = useState(player.tags);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all');
  const [composerMode, setComposerMode] = useState<ComposerMode>('note');

  // Поля универсального компоузера
  const [noteText, setNoteText] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgChannel, setMsgChannel] = useState<MessageChannel>('telegram');
  const [msgDirection, setMsgDirection] = useState<MessageDirection>('out');
  const [taskKind, setTaskKind] = useState<TaskKind>('call');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState(player.owner || defaultOwners[0]);
  const [taskDue, setTaskDue] = useState(() => toLocalInput(data.serverTime + 3 * 3_600_000));
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);
  const [taskResult, setTaskResult] = useState('');

  useEffect(() => {
    setTagsDraft(player.tags);
    setTaskAssignee(player.owner || defaultOwners[0]);
  }, [player.id, player.tags, player.owner]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const playerTasks = useMemo(
    () => data.crm.tasks.filter(t => t.playerId === player.id),
    [data.crm.tasks, player.id],
  );
  const openTasks = useMemo(
    () => playerTasks.filter(t => t.completedAt === null).sort((a, b) => a.dueAt - b.dueAt),
    [playerTasks],
  );

  const timeline = useMemo(() => {
    const items: TimelineEntry[] = [];
    for (const m of data.crm.messages) {
      if (m.playerId !== player.id) continue;
      items.push({
        id: 'msg-' + m.id,
        time: m.createdAt,
        type: 'message',
        direction: m.direction,
        channel: m.channel,
        author: m.author,
        body: m.body,
      });
    }
    for (const n of data.crm.notes) {
      if (n.playerId !== player.id) continue;
      items.push({ id: 'note-' + n.id, time: n.createdAt, type: 'note', noteId: n.id, author: n.author, body: n.body });
    }
    for (const t of playerTasks) {
      if (t.completedAt === null) continue;
      items.push({ id: 'task-' + t.id, time: t.completedAt, type: 'task', task: t });
    }
    for (const ev of data.crm.events) {
      if (ev.playerId !== player.id) continue;
      items.push({ id: 'ev-' + ev.id, time: ev.createdAt, type: 'event', badge: 'Этап', title: ev.summary, detail: ev.actor });
    }
    for (const reg of data.crm.registrations) {
      if (reg.playerId !== player.id) continue;
      items.push({
        id: `reg-${reg.tournamentId}-${reg.registeredAt}`,
        time: reg.registeredAt,
        type: 'event',
        badge: 'Запись',
        title: `Запись на «${reg.tournamentName}»`,
        detail: reg.visitedAt ? 'Пришёл на турнир' : reg.queued ? 'Лист ожидания' : 'Не пришёл',
      });
      if (reg.visitedAt) {
        items.push({
          id: `vis-${reg.tournamentId}-${reg.visitedAt}`,
          time: reg.visitedAt,
          type: 'event',
          badge: 'Визит',
          title: `Пришёл в клуб · ${reg.tournamentName}`,
        });
      }
    }
    for (const pay of data.payments) {
      if (pay.playerId !== player.id) continue;
      items.push({
        id: 'pay-' + pay.id,
        time: pay.time,
        type: 'event',
        badge: pay.kind === 'payment' ? 'Оплата' : 'Начисление',
        title: `${paymentLabels[pay.kind]} · ${money(pay.waived ? 0 : pay.amount)}`,
        detail: pay.tournamentName,
      });
    }
    return items.sort((a, b) => b.time - a.time);
  }, [data.crm.messages, data.crm.notes, data.crm.events, data.crm.registrations, data.payments, playerTasks, player.id]);

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'all') return timeline;
    if (timelineFilter === 'messages') return timeline.filter(i => i.type === 'message');
    if (timelineFilter === 'notes') return timeline.filter(i => i.type === 'note');
    if (timelineFilter === 'tasks') return timeline.filter(i => i.type === 'task');
    return timeline.filter(i => i.type === 'event');
  }, [timeline, timelineFilter]);

  const owners = useMemo(() => {
    const set = new Set<string>(defaultOwners);
    if (player.owner.trim()) set.add(player.owner.trim());
    return [...set];
  }, [player.owner]);

  function togglePresetTag(tag: string) {
    const current = tagsDraft.split(',').map(t => t.trim()).filter(Boolean);
    const exists = current.some(t => t.toLowerCase() === tag.toLowerCase());
    setTagsDraft((exists ? current.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...current, tag]).join(', '));
  }

  function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run({
      type: 'updatePlayer',
      playerId: player.id,
      name: String(fields.get('name')),
      nickname: String(fields.get('nickname')),
      phone: String(fields.get('phone')),
      telegram: String(fields.get('telegram')),
      instagram: String(fields.get('instagram')),
      telegramConsent: fields.get('telegramConsent') === 'on',
      source: String(fields.get('source')),
      owner: String(fields.get('owner')),
      tags: tagsDraft,
      note: String(fields.get('note')),
    });
  }

  function handleStageClick(nextStage: PipelineStage) {
    if (busy || nextStage === player.stage) return;
    void run({ type: 'setPlayerStage', playerId: player.id, stage: nextStage });
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composerMode === 'note') {
      if (!noteText.trim()) return;
      void run({ type: 'addPlayerNote', playerId: player.id, body: noteText.trim() }, () => setNoteText(''));
    } else if (composerMode === 'message') {
      if (!msgBody.trim()) return;
      void run(
        { type: 'addPlayerMessage', playerId: player.id, direction: msgDirection, channel: msgChannel, body: msgBody.trim() },
        () => setMsgBody(''),
      );
    } else {
      if (!taskTitle.trim()) return;
      const parsed = Date.parse(taskDue);
      const dueAt = Number.isFinite(parsed) ? parsed : data.serverTime + DAY_MS;
      void run(
        { type: 'addCrmTask', playerId: player.id, kind: taskKind, title: taskTitle.trim(), assignee: taskAssignee, dueAt },
        () => setTaskTitle(''),
      );
    }
  }

  function setQuickDue(hoursFromNow: number) {
    setTaskDue(toLocalInput(data.serverTime + hoursFromNow * 3_600_000));
  }

  return (
    <div className="crm-drawer-backdrop" onClick={() => !busy && onClose()}>
      <aside
        className="crm-amo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-guest-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="crm-amo-left">
          <div className="crm-drawer-head">
            <div>
              <h2 id="drawer-guest-title">{player.nickname || player.name}</h2>
              <p className="muted">
                {player.nickname && player.nickname !== player.name ? `${player.name} · ` : ''}
                Регистрация: {formatDate(player.registeredAt)}
              </p>
            </div>
            <button type="button" className="button icon" aria-label="Закрыть карточку" disabled={busy} onClick={onClose}>
              <X size={19} />
            </button>
          </div>

          <div className="crm-stage-stepper" role="group" aria-label="Этап воронки">
            {pipelineStages.map(stage => (
              <button
                key={stage.id}
                type="button"
                disabled={busy}
                className={`crm-stage-pill tone-${stage.tone}${player.stage === stage.id ? ' active' : ''}`}
                aria-pressed={player.stage === stage.id}
                onClick={() => handleStageClick(stage.id)}
              >
                {stage.shortLabel}
              </button>
            ))}
          </div>

          <div className="crm-drawer-kpis">
            <div>
              <span>Визиты</span>
              <strong>{guest.visitsCount}</strong>
            </div>
            <div>
              <span>Покупки</span>
              <strong>{money(guest.totalSpent)}</strong>
            </div>
            <div>
              <span>Ср. чек</span>
              <strong>{guest.avgCheck ? money(guest.avgCheck) : '—'}</strong>
            </div>
            <div>
              <span>К оплате</span>
              <strong className={guest.due > 0 ? 'owing' : ''}>{money(guest.due)}</strong>
            </div>
          </div>

          <div className="crm-amo-left-scroll">
            <form className="crm-profile-form" key={player.id} onSubmit={handleSaveProfile}>
              <label>
                Ответственный
                <select name="owner" defaultValue={player.owner || defaultOwners[0]}>
                  {owners.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </select>
              </label>

              <div className="crm-form-grid">
                <label>
                  Имя и фамилия
                  <input name="name" defaultValue={player.name} required maxLength={80} />
                </label>
                <label>
                  Никнейм
                  <input name="nickname" defaultValue={player.nickname} maxLength={40} />
                </label>
                <label>
                  Телефон
                  <input name="phone" type="tel" defaultValue={player.phone} maxLength={40} placeholder="+7 999 000-00-00" />
                </label>
                <label>
                  Telegram
                  <input name="telegram" defaultValue={player.telegram} maxLength={60} placeholder="@username" />
                </label>
                <label>
                  Instagram
                  <input name="instagram" defaultValue={player.instagram} maxLength={60} placeholder="@account" />
                </label>
                <label>
                  Источник
                  <input name="source" defaultValue={player.source} maxLength={100} placeholder="Telegram, Instagram" />
                </label>
              </div>

              <label className="crm-checkbox">
                <input type="checkbox" name="telegramConsent" defaultChecked={player.telegramConsent} />
                <span>Согласие на Telegram-рассылки</span>
              </label>

              <div className="crm-tags-field">
                <label>
                  Теги
                  <input value={tagsDraft} onChange={e => setTagsDraft(e.target.value)} maxLength={120} placeholder="VIP, Регуляр" />
                </label>
                <div className="crm-chip-row">
                  {tagPresets.map(tag => {
                    const active = tagsDraft.toLowerCase().includes(tag.toLowerCase());
                    return (
                      <button
                        type="button"
                        key={tag}
                        className={active ? 'crm-chip active' : 'crm-chip'}
                        onClick={() => togglePresetTag(tag)}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label>
                Заметка в профиле
                <textarea name="note" defaultValue={player.note} maxLength={500} rows={2} />
              </label>

              <button type="submit" className="button primary wide" disabled={busy}>
                Сохранить карточку
              </button>
            </form>

            <form
              className="crm-inline-pay"
              onSubmit={event => {
                event.preventDefault();
                const amount = Number(new FormData(event.currentTarget).get('amount'));
                if (amount > 0) void run({ type: 'payment', playerId: player.id, amount });
                event.currentTarget.reset();
              }}
            >
              <label>
                Оплата за «{data.tournament.name}», ₽
                <input name="amount" type="number" min="1" max="1000000" required />
              </label>
              <button type="submit" className="button" disabled={busy}>
                Принять
              </button>
            </form>
          </div>
        </div>

        <div className="crm-amo-right">
          <div className="crm-timeline-head">
            <div className="crm-segmented" role="group" aria-label="Фильтр ленты событий">
              {([
                ['all', 'Вся лента'],
                ['messages', 'Переписки'],
                ['notes', 'Заметки'],
                ['tasks', 'Задачи'],
                ['events', 'События'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={timelineFilter === id ? 'crm-seg-btn active' : 'crm-seg-btn'}
                  aria-pressed={timelineFilter === id}
                  onClick={() => setTimelineFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="crm-timeline-scroll">
            {openTasks.length > 0 && (
              <div className="crm-open-tasks">
                {openTasks.map(task => {
                  const overdue = task.dueAt < data.serverTime;
                  return (
                    <div key={task.id} className={`crm-open-task${overdue ? ' overdue' : ''}`}>
                      <div className="crm-open-task-top">
                        <span className={`crm-task-badge ${overdue ? 'overdue' : 'today'}`}>
                          <CalendarClock size={12} /> {formatDateTime(task.dueAt)}
                        </span>
                        <span className="crm-deal-tag">{taskKindLabels[task.kind]}</span>
                        <span className="muted">{task.assignee}</span>
                        <div className="crm-open-task-actions">
                          {completingTaskId !== task.id && (
                            <button
                              type="button"
                              className="button compact"
                              disabled={busy}
                              onClick={() => {
                                setCompletingTaskId(task.id);
                                setTaskResult('');
                              }}
                            >
                              <Check size={13} /> Выполнить
                            </button>
                          )}
                          <button
                            type="button"
                            className="button icon compact"
                            aria-label="Удалить задачу"
                            disabled={busy}
                            onClick={() => run({ type: 'deleteCrmTask', taskId: task.id })}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <strong>{task.title}</strong>
                      {completingTaskId === task.id && (
                        <div className="crm-task-complete-box">
                          <input
                            value={taskResult}
                            onChange={e => setTaskResult(e.target.value)}
                            placeholder="Итог по задаче (необязательно)…"
                            maxLength={400}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="button primary compact"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                { type: 'completeCrmTask', taskId: task.id, result: taskResult.trim() },
                                () => {
                                  setCompletingTaskId(null);
                                  setTaskResult('');
                                },
                              )
                            }
                          >
                            Готово
                          </button>
                          <button type="button" className="button compact" onClick={() => setCompletingTaskId(null)}>
                            Отмена
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="crm-feed">
              {filteredTimeline.map(item => {
                if (item.type === 'message') {
                  return (
                    <article key={item.id} className={`crm-msg ${item.direction}`}>
                      <div className="crm-msg-meta">
                        <strong>{item.author}</strong>
                        <span className="muted">
                          {channelLabels[item.channel]} · {formatDateTime(item.time)}
                        </span>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  );
                }
                if (item.type === 'note') {
                  return (
                    <article key={item.id} className="crm-note">
                      <div className="crm-note-meta">
                        <span className="muted">
                          Примечание · {item.author} · {formatDateTime(item.time)}
                        </span>
                        <button
                          type="button"
                          className="button icon compact"
                          aria-label="Удалить заметку"
                          disabled={busy}
                          onClick={() => run({ type: 'deletePlayerNote', noteId: item.noteId })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p>{item.body}</p>
                    </article>
                  );
                }
                if (item.type === 'task') {
                  return (
                    <article key={item.id} className="crm-timeline-event">
                      <span className="crm-deal-tag">Задача выполнена</span>
                      <div className="crm-timeline-event-body">
                        <strong>{item.task.title}</strong>
                        <small className="muted">
                          {item.task.assignee}
                          {item.task.result ? ` · ${item.task.result}` : ''} · {formatDateTime(item.time)}
                        </small>
                      </div>
                    </article>
                  );
                }
                return (
                  <article key={item.id} className="crm-timeline-event">
                    <span className="crm-deal-tag">{item.badge}</span>
                    <div className="crm-timeline-event-body">
                      <strong>{item.title}</strong>
                      <small className="muted">
                        {item.detail ? `${item.detail} · ` : ''}
                        {formatDateTime(item.time)}
                      </small>
                    </div>
                  </article>
                );
              })}
              {!filteredTimeline.length && <p className="empty">В ленте пока нет записей</p>}
            </div>
          </div>

          <form className="crm-amo-composer" onSubmit={handleComposerSubmit}>
            <div className="crm-amo-composer-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={composerMode === 'note'} className={composerMode === 'note' ? 'active' : ''} onClick={() => setComposerMode('note')}>
                <StickyNote size={14} /> Примечание
              </button>
              <button type="button" role="tab" aria-selected={composerMode === 'task'} className={composerMode === 'task' ? 'active' : ''} onClick={() => setComposerMode('task')}>
                <CalendarClock size={14} /> Задача
              </button>
              <button type="button" role="tab" aria-selected={composerMode === 'message'} className={composerMode === 'message' ? 'active' : ''} onClick={() => setComposerMode('message')}>
                <MessageSquare size={14} /> Сообщение
              </button>
            </div>

            {composerMode === 'note' && (
              <>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="Добавить примечание сотрудника…"
                />
                <div className="crm-amo-composer-foot">
                  <span className="muted">Видно только сотрудникам клуба</span>
                  <button type="submit" className="button primary compact" disabled={busy || !noteText.trim()}>
                    Сохранить
                  </button>
                </div>
              </>
            )}

            {composerMode === 'task' && (
              <>
                <div className="crm-amo-task-controls">
                  <select aria-label="Тип задачи" value={taskKind} onChange={e => setTaskKind(e.target.value as TaskKind)}>
                    {(Object.keys(taskKindLabels) as TaskKind[]).map(k => (
                      <option key={k} value={k}>{taskKindLabels[k]}</option>
                    ))}
                  </select>
                  <select aria-label="Ответственный" value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)}>
                    {owners.map(owner => (
                      <option key={owner} value={owner}>{owner}</option>
                    ))}
                  </select>
                  <input type="datetime-local" aria-label="Срок" value={taskDue} onChange={e => setTaskDue(e.target.value)} required />
                </div>
                <div className="crm-chip-row">
                  <button type="button" className="crm-chip" onClick={() => setQuickDue(2)}>Через 2 ч</button>
                  <button type="button" className="crm-chip" onClick={() => setQuickDue(24)}>Завтра</button>
                  <button type="button" className="crm-chip" onClick={() => setQuickDue(72)}>Через 3 дня</button>
                </div>
                <input
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  maxLength={300}
                  placeholder="Что нужно сделать по гостю…"
                />
                <div className="crm-amo-composer-foot">
                  <span className="muted">Появится на карточке в воронке и во вкладке «Задачи»</span>
                  <button type="submit" className="button primary compact" disabled={busy || !taskTitle.trim()}>
                    Поставить задачу
                  </button>
                </div>
              </>
            )}

            {composerMode === 'message' && (
              <>
                <div className="crm-composer-row">
                  <select aria-label="Канал" value={msgChannel} onChange={e => setMsgChannel(e.target.value as MessageChannel)}>
                    {Object.entries(channelLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <select aria-label="Направление" value={msgDirection} onChange={e => setMsgDirection(e.target.value as MessageDirection)}>
                    <option value="out">Исходящее (клуб)</option>
                    <option value="in">Входящее (гость)</option>
                  </select>
                </div>
                <textarea
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Текст сообщения для истории переписки…"
                />
                <div className="crm-amo-composer-foot">
                  <span className="muted">Сохранится в общей ленте гостя</span>
                  <button type="submit" className="button primary compact" disabled={busy || !msgBody.trim()}>
                    <Send size={14} /> Записать
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      </aside>
    </div>
  );
}
