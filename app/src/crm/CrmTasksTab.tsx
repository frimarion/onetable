import { useMemo, useState, type FormEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import {
  DAY_MS,
  defaultOwners,
  pipelineStageMap,
  taskKindLabels,
  type CrmTask,
  type GuestSummary,
  type TaskKind,
} from '../../shared/crm';
import type { Run } from '../api';

type TaskScope = 'active' | 'overdue' | 'today' | 'upcoming' | 'done';

function formatDue(ms: number) {
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function defaultDueInput(now: number) {
  const d = new Date(now + 3 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CrmTasksTab({
  guests,
  data,
  run,
  busy,
  onSelectGuest,
}: {
  guests: GuestSummary[];
  data: Snapshot;
  run: Run;
  busy: boolean;
  onSelectGuest: (playerId: string) => void;
}) {
  const [scope, setScope] = useState<TaskScope>('active');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [resultText, setResultText] = useState('');

  // Форма новой задачи
  const [playerId, setPlayerId] = useState(() => guests[0]?.player.id ?? '');
  const [kind, setKind] = useState<TaskKind>('call');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(defaultOwners[0]);
  const [dueInput, setDueInput] = useState(() => defaultDueInput(data.serverTime));

  const endOfToday = useMemo(() => {
    const d = new Date(data.serverTime);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, [data.serverTime]);

  const playerMap = useMemo(() => new Map(guests.map(g => [g.player.id, g.player])), [guests]);

  const counts = useMemo(() => {
    const open = data.crm.tasks.filter(t => t.completedAt === null);
    const overdue = open.filter(t => t.dueAt < data.serverTime).length;
    const today = open.filter(t => t.dueAt >= data.serverTime && t.dueAt <= endOfToday).length;
    const upcoming = open.filter(t => t.dueAt > endOfToday).length;
    const done = data.crm.tasks.length - open.length;
    return { active: open.length, overdue, today, upcoming, done };
  }, [data.crm.tasks, data.serverTime, endOfToday]);

  const owners = useMemo(() => {
    const set = new Set<string>(defaultOwners);
    for (const task of data.crm.tasks) {
      if (task.assignee.trim()) set.add(task.assignee.trim());
    }
    return [...set];
  }, [data.crm.tasks]);

  const filtered = useMemo(() => {
    return data.crm.tasks.filter(task => {
      if (ownerFilter !== 'all' && task.assignee !== ownerFilter) return false;
      const isDone = task.completedAt !== null;
      if (scope === 'done') return isDone;
      if (isDone) return false;
      if (scope === 'overdue') return task.dueAt < data.serverTime;
      if (scope === 'today') return task.dueAt >= data.serverTime && task.dueAt <= endOfToday;
      if (scope === 'upcoming') return task.dueAt > endOfToday;
      return true;
    });
  }, [data.crm.tasks, scope, ownerFilter, data.serverTime, endOfToday]);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!playerId || !title.trim()) return;
    const dueMs = Date.parse(dueInput);
    const dueAt = Number.isFinite(dueMs) ? dueMs : data.serverTime + DAY_MS;
    void run(
      { type: 'addCrmTask', playerId, kind, title: title.trim(), assignee, dueAt },
      () => {
        setTitle('');
        setCreating(false);
      },
    );
  }

  function handleComplete(task: CrmTask) {
    void run(
      { type: 'completeCrmTask', taskId: task.id, result: resultText.trim() },
      () => {
        setCompletingId(null);
        setResultText('');
      },
    );
  }

  return (
    <div className="crm-stack">
      <div className="crm-filter-bar">
        <div className="crm-segmented" role="group" aria-label="Фильтр задач">
          {([
            ['active', 'Активные', counts.active],
            ['overdue', 'Просрочены', counts.overdue],
            ['today', 'На сегодня', counts.today],
            ['upcoming', 'Позже', counts.upcoming],
            ['done', 'Выполнены', counts.done],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={scope === id ? 'crm-seg-btn active' : 'crm-seg-btn'}
              aria-pressed={scope === id}
              onClick={() => setScope(id)}
            >
              {label} <span className={`crm-count-pill${id === 'overdue' && count > 0 ? ' danger' : ''}`}>{count}</span>
            </button>
          ))}
        </div>

        <div className="crm-filters">
          <select aria-label="Ответственный" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="all">Все ответственные</option>
            {owners.map(owner => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
          <button type="button" className="button primary compact" onClick={() => setCreating(prev => !prev)}>
            <Plus size={15} /> Новая задача
          </button>
        </div>
      </div>

      {creating && (
        <section className="panel crm-panel" aria-label="Создать задачу">
          <div className="panel-head">
            <h2>Новая задача</h2>
          </div>
          <form className="crm-panel-body crm-task-create-form" onSubmit={handleCreate}>
            <div className="crm-form-grid">
              <label>
                Гость
                <select value={playerId} onChange={e => setPlayerId(e.target.value)} required>
                  {guests.map(g => (
                    <option key={g.player.id} value={g.player.id}>
                      {g.player.nickname || g.player.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Тип задачи
                <select value={kind} onChange={e => setKind(e.target.value as TaskKind)}>
                  {(Object.keys(taskKindLabels) as TaskKind[]).map(k => (
                    <option key={k} value={k}>{taskKindLabels[k]}</option>
                  ))}
                </select>
              </label>
              <label>
                Ответственный
                <select value={assignee} onChange={e => setAssignee(e.target.value)}>
                  {owners.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </select>
              </label>
              <label>
                Срок выполнения
                <input type="datetime-local" value={dueInput} onChange={e => setDueInput(e.target.value)} required />
              </label>
            </div>
            <label>
              Что нужно сделать
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                maxLength={300}
                placeholder="Например, Позвонить и напомнить о пятничном турнире"
              />
            </label>
            <div className="actions">
              <button type="submit" className="button primary" disabled={busy || !title.trim()}>
                Создать задачу
              </button>
              <button type="button" className="button" onClick={() => setCreating(false)}>
                Отмена
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel crm-panel" aria-label="Список задач">
        <div className="panel-head">
          <h2>Задачи по гостям</h2>
          <span className="count">{filtered.length}</span>
        </div>
        {filtered.length ? (
          <div className="crm-tasks-list">
            {filtered.map(task => {
              const player = playerMap.get(task.playerId);
              const isOverdue = task.completedAt === null && task.dueAt < data.serverTime;
              const isToday = task.completedAt === null && !isOverdue && task.dueAt <= endOfToday;
              const stageMeta = player ? pipelineStageMap[player.stage] : null;
              return (
                <div key={task.id} className={`crm-task-row${task.completedAt ? ' completed' : ''}`}>
                  <div className="crm-task-main">
                    <div className="crm-task-head">
                      <span className={`crm-task-badge ${task.completedAt ? 'done' : isOverdue ? 'overdue' : isToday ? 'today' : 'upcoming'}`}>
                        {task.completedAt ? 'Выполнена' : formatDue(task.dueAt)}
                      </span>
                      <span className="crm-deal-tag">{taskKindLabels[task.kind]}</span>
                      {stageMeta && <span className="muted">{stageMeta.shortLabel}</span>}
                    </div>
                    <strong className="crm-task-title">{task.title}</strong>
                    <div className="crm-task-meta muted">
                      <button
                        type="button"
                        className="crm-link-btn"
                        onClick={() => onSelectGuest(task.playerId)}
                      >
                        {player ? player.nickname || player.name : 'Гость'}
                      </button>
                      <span>· {task.assignee}</span>
                      {task.result && <span>· Итог: {task.result}</span>}
                    </div>

                    {completingId === task.id && (
                      <div className="crm-task-complete-box">
                        <input
                          value={resultText}
                          onChange={e => setResultText(e.target.value)}
                          placeholder="Результат выполнения (необязательно)…"
                          maxLength={400}
                          autoFocus
                        />
                        <button type="button" className="button primary compact" disabled={busy} onClick={() => handleComplete(task)}>
                          Подтвердить
                        </button>
                        <button type="button" className="button compact" onClick={() => setCompletingId(null)}>
                          Отмена
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="actions">
                    {task.completedAt === null && completingId !== task.id && (
                      <button
                        type="button"
                        className="button compact"
                        disabled={busy}
                        onClick={() => {
                          setCompletingId(task.id);
                          setResultText('');
                        }}
                      >
                        <Check size={14} /> Выполнить
                      </button>
                    )}
                    <button
                      type="button"
                      className="button icon compact"
                      aria-label="Удалить задачу"
                      disabled={busy}
                      onClick={() => run({ type: 'deleteCrmTask', taskId: task.id })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty">В этом разделе задач нет</p>
        )}
      </section>
    </div>
  );
}
